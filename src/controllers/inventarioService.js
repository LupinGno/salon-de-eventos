// Inventario de ingredientes
const conexion = require('../database/db')
const { ErrorNegocio } = require('./menuService')

const UNIDADES = { pieza: 'pz', g: 'g', ml: 'ml' }
const redondear = n => Math.round(n * 100) / 100
const cantidadTexto = (n, unidad) => `${Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 })} ${UNIDADES[unidad] || unidad}`

// Suma del consumo de varias unidades
function sumarConsumo(articulos) {
    const total = new Map()
    for (const a of articulos) {
        for (const c of a.consumo) total.set(c.ingrediente_id, (total.get(c.ingrediente_id) || 0) + c.cantidad)
    }
    return total
}

// Descuenta  de lo vendido
async function descontarVenta(db, comandaId, articulos, usuarioId) {
    const total = sumarConsumo(articulos)
    if (!total.size) return

    const [filas] = await db.query(
        'SELECT id, nombre, unidad, stock FROM ingredientes WHERE id IN (?) AND stock IS NOT NULL ORDER BY id FOR UPDATE',
        [[...total.keys()]])
    const controlados = new Map(filas.map(f => [f.id, { ...f, stock: Number(f.stock) }]))

    const faltan = []
    for (const [id, necesita] of total) {
        const ing = controlados.get(id)
        if (ing && ing.stock + 0.001 < necesita) {
            faltan.push(`${ing.nombre} (se necesitan ${cantidadTexto(necesita, ing.unidad)} y quedan ${cantidadTexto(ing.stock, ing.unidad)})`)
        }
    }
    if (faltan.length) throw new ErrorNegocio(`No alcanza el inventario: ${faltan.join('; ')}.`, 409)

    // Un movimiento por unidad e ingrediente
    const movimientos = []
    for (const a of articulos) {
        for (const c of a.consumo) {
            const ing = controlados.get(c.ingrediente_id)
            if (!ing) continue
            ing.stock = redondear(ing.stock - c.cantidad)
            movimientos.push([c.ingrediente_id, 'venta', -c.cantidad, ing.stock, comandaId, a.articulo_id, usuarioId])
        }
    }
    if (!movimientos.length) return
    await db.query(
        `INSERT INTO movimientos_inventario (ingrediente_id, tipo, cantidad, stock_despues, comanda_id, articulo_id, usuario_id)
         VALUES ?`, [movimientos])
    for (const ing of controlados.values()) {
        await db.query('UPDATE ingredientes SET stock = ? WHERE id = ?', [ing.stock, ing.id])
    }
}

// cancelación con devolución
async function devolverArticulos(db, articuloIds, usuarioId) {
    if (!articuloIds.length) return 0
    // Lo vendido menos lo ya devuelto
    const [pendientes] = await db.query(`
        SELECT ingrediente_id, articulo_id, comanda_id, -SUM(cantidad) AS cantidad
          FROM movimientos_inventario
         WHERE articulo_id IN (?) AND tipo IN ('venta', 'devolucion')
         GROUP BY ingrediente_id, articulo_id, comanda_id
        HAVING cantidad > 0`, [articuloIds])
    if (!pendientes.length) return 0
    const ids = [...new Set(pendientes.map(p => p.ingrediente_id))]
    const [filas] = await db.query('SELECT id, stock FROM ingredientes WHERE id IN (?) ORDER BY id FOR UPDATE', [ids])
    const stock = new Map(filas.map(f => [f.id, f.stock === null ? null : Number(f.stock)]))

    const movimientos = []
    for (const p of pendientes) {
        if (stock.get(p.ingrediente_id) === null) continue   
        const nuevo = redondear(stock.get(p.ingrediente_id) + Number(p.cantidad))
        stock.set(p.ingrediente_id, nuevo)
        movimientos.push([p.ingrediente_id, 'devolucion', Number(p.cantidad), nuevo, p.comanda_id, p.articulo_id, usuarioId,
                          'Cancelación con reembolso: no se preparó'])
    }
    if (!movimientos.length) return 0
    await db.query(
        `INSERT INTO movimientos_inventario (ingrediente_id, tipo, cantidad, stock_despues, comanda_id, articulo_id, usuario_id, nota)
         VALUES ?`, [movimientos])
    for (const [id, valor] of stock) if (valor !== null) await db.query('UPDATE ingredientes SET stock = ? WHERE id = ?', [valor, id])
    return movimientos.length
}

// Estado de un ingrediente
function estadoStock(i) {
    if (i.stock === null) return { clave: 'libre', texto: 'Sin control', clase: 'text-bg-light border' }
    const s = Number(i.stock), min = Number(i.stock_minimo)
    if (s <= 0) return { clave: 'agotado', texto: 'Agotado', clase: 'text-bg-danger' }
    if (s <= min) return { clave: 'bajo', texto: 'Surtir pronto', clase: 'text-bg-warning' }
    return { clave: 'ok', texto: 'Suficiente', clase: 'text-bg-success' }
}

//Lista del inventario 
async function inventario() {
    const [filas] = await conexion.query(`
        SELECT i.*,
               (SELECT COALESCE(-SUM(m.cantidad), 0) FROM movimientos_inventario m
                 WHERE m.ingrediente_id = i.id AND m.tipo IN ('venta','devolucion') AND DATE(m.creado_en) = CURDATE()) AS usado_hoy,
               (SELECT COUNT(*) FROM producto_ingredientes pi WHERE pi.ingrediente_id = i.id)
             + (SELECT COUNT(*) FROM producto_extras pe WHERE pe.ingrediente_id = i.id) AS usos
          FROM ingredientes i
         ORDER BY (i.stock IS NULL), (i.stock <= i.stock_minimo) DESC, i.nombre`)
    return filas.map(i => ({ ...i, estado: estadoStock(i), unidad_corta: UNIDADES[i.unidad] }))
}

// Cuántos ingredientes hay que surtir 
async function alertas() {
    const [filas] = await conexion.query(
        `SELECT nombre, unidad, stock, stock_minimo FROM ingredientes
          WHERE activo = 1 AND stock IS NOT NULL AND stock <= stock_minimo ORDER BY stock / GREATEST(stock_minimo, 1), nombre`)
    return filas.map(i => ({ ...i, estado: estadoStock(i), unidad_corta: UNIDADES[i.unidad] }))
}

// Entrada, merma o ajuste 
async function registrarMovimiento(ingredienteId, { tipo, cantidad, nota }, usuarioId) {
    if (!['entrada', 'merma', 'ajuste'].includes(tipo)) throw new ErrorNegocio('Elige entrada, merma o ajuste.', 422)
    const valor = Number(cantidad)
    if (!Number.isFinite(valor) || valor < 0 || valor > 1000000 || Math.round(valor * 100) !== valor * 100) {
        throw new ErrorNegocio('Escribe una cantidad válida (hasta 2 decimales).', 422)
    }
    if (tipo !== 'ajuste' && valor <= 0) throw new ErrorNegocio('La cantidad debe ser mayor a 0.', 422)
    nota = typeof nota === 'string' ? nota.trim().slice(0, 160) : ''
    if (tipo !== 'entrada' && nota.length < 3) throw new ErrorNegocio('Escribe el motivo de la merma o del ajuste.', 422)

    const db = await conexion.getConnection()
    try {
        await db.beginTransaction()
        const [[ing]] = await db.query('SELECT id, nombre, unidad, stock FROM ingredientes WHERE id = ? FOR UPDATE', [ingredienteId])
        if (!ing) throw new ErrorNegocio('Ese ingrediente no existe.', 404)
        if (ing.stock === null) throw new ErrorNegocio(`"${ing.nombre}" no lleva control de stock; actívalo primero.`, 409)
        const actual = Number(ing.stock)
        const cambio = tipo === 'entrada' ? valor : tipo === 'merma' ? -valor : redondear(valor - actual)
        const nuevo = redondear(actual + cambio)
        if (nuevo < 0) throw new ErrorNegocio(`No puedes sacar más de lo que hay (${cantidadTexto(actual, ing.unidad)}).`, 422)
        if (tipo === 'ajuste' && cambio === 0) throw new ErrorNegocio('El conteo coincide con el sistema; no hay nada que ajustar.', 422)
        await db.query('UPDATE ingredientes SET stock = ? WHERE id = ?', [nuevo, ing.id])
        await db.query(
            'INSERT INTO movimientos_inventario (ingrediente_id, tipo, cantidad, stock_despues, usuario_id, nota) VALUES (?, ?, ?, ?, ?, ?)',
            [ing.id, tipo, cambio, nuevo, usuarioId, nota || null])
        await db.commit()
        return { nombre: ing.nombre, cambio, stock: nuevo, unidad: ing.unidad }
    } catch (e) {
        await db.rollback()
        throw e
    } finally {
        db.release()
    }
}

// unidad, mínimo y si se controla.
async function configurar(ingredienteId, { unidad, stock_minimo, controlar, stock_inicial, costo }, usuarioId) {
    if (!UNIDADES[unidad]) throw new ErrorNegocio('Elige la unidad: pieza, gramos o mililitros.', 422)
    const minimo = Number(stock_minimo)
    if (!Number.isFinite(minimo) || minimo < 0 || minimo > 1000000) throw new ErrorNegocio('El mínimo debe ser 0 o más.', 422)
    // Costo por unidad
    const sinCosto = costo === undefined || String(costo).trim() === ''
    const precio = sinCosto ? null : Number(costo)
    if (!sinCosto && (!Number.isFinite(precio) || precio < 0 || precio > 100000)) {
        throw new ErrorNegocio('El costo por unidad debe ser 0 o más (déjalo vacío si no lo sabes).', 422)
    }
    const db = await conexion.getConnection()
    try {
        await db.beginTransaction()
        const [[ing]] = await db.query('SELECT id, stock FROM ingredientes WHERE id = ? FOR UPDATE', [ingredienteId])
        if (!ing) throw new ErrorNegocio('Ese ingrediente no existe.', 404)
        await db.query('UPDATE ingredientes SET unidad = ?, stock_minimo = ?, costo_promedio = ? WHERE id = ?',
            [unidad, minimo, precio === null ? null : redondear(precio), ing.id])
        if (controlar && ing.stock === null) {
            const inicial = Number(stock_inicial)
            if (!Number.isFinite(inicial) || inicial < 0) throw new ErrorNegocio('Escribe con cuánto stock arranca.', 422)
            await db.query('UPDATE ingredientes SET stock = ? WHERE id = ?', [inicial, ing.id])
            await db.query(
                "INSERT INTO movimientos_inventario (ingrediente_id, tipo, cantidad, stock_despues, usuario_id, nota) VALUES (?, 'entrada', ?, ?, ?, 'Inicio del control de stock')",
                [ing.id, inicial, inicial, usuarioId])
        } else if (!controlar && ing.stock !== null) {
            await db.query('UPDATE ingredientes SET stock = NULL WHERE id = ?', [ing.id])
        }
        await db.commit()
    } catch (e) {
        await db.rollback()
        throw e
    } finally {
        db.release()
    }
}

//historial de un ingrediente
async function movimientos(ingredienteId, limite = 100) {
    const [filas] = await conexion.query(`
        SELECT m.*, u.nombre AS usuario, c.folio
          FROM movimientos_inventario m
          LEFT JOIN usuarios u ON u.id = m.usuario_id
          LEFT JOIN comandas c ON c.id = m.comanda_id
         WHERE m.ingrediente_id = ?
         ORDER BY m.id DESC LIMIT ?`, [ingredienteId, limite])
    return filas
}

module.exports = {
    UNIDADES, cantidadTexto, estadoStock, descontarVenta, devolverArticulos,
    inventario, alertas, registrarMovimiento, configurar, movimientos
}
