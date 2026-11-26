// Compras de insumos para reponer ingredientes
const conexion = require('../database/db')
const { ErrorNegocio } = require('./menuService')
const formatos = require('./formatos')

const texto = v => (typeof v === 'string' ? v.trim() : '')
const redondear = n => Math.round(Number(n) * 100) / 100

function leerCompra(datos) {
    datos = datos || {}
    const errores = []
    const ingredienteId = formatos.entero(datos.ingrediente_id, 1)
    if (!ingredienteId) errores.push('Elige el ingrediente.')
    const cantidad = formatos.decimal(datos.cantidad, 0.01, 1000000)
    if (cantidad === null) errores.push('Escribe cuánto compraste (mayor a 0).')
    const costoTotal = formatos.decimal(datos.costo_total, 0.01, 1000000)
    if (costoTotal === null) errores.push('Escribe el costo total de la compra.')
    const proveedor = texto(datos.proveedor).slice(0, 120) || null
    if (errores.length) throw Object.assign(new ErrorNegocio(errores[0], 422), { errores })
    return { ingredienteId, cantidad, costoTotal, proveedor }
}

// registra la compra, sube el stock y recalcula el costo promedio ponderado
async function registrar(datos, usuario) {
    const c = leerCompra(datos)
    const db = await conexion.getConnection()
    try {
        await db.beginTransaction()
        const [[ing]] = await db.query('SELECT id, nombre, unidad, stock, costo_promedio FROM ingredientes WHERE id = ? FOR UPDATE', [c.ingredienteId])
        if (!ing) throw new ErrorNegocio('Ese ingrediente no existe.', 404)
        if (ing.stock === null) throw new ErrorNegocio(`"${ing.nombre}" no lleva control de stock: actívalo en Catálogos → Inventario antes de comprarlo.`, 409)
        const stockAnterior = Number(ing.stock)
        const costoAnterior = ing.costo_promedio === null ? null : Number(ing.costo_promedio)
        const valorAnterior = costoAnterior === null ? 0 : stockAnterior * costoAnterior
        const nuevoStock = redondear(stockAnterior + c.cantidad)
        const costoPromedio = redondear((valorAnterior + c.costoTotal) / nuevoStock)
        await db.query('UPDATE ingredientes SET stock = ?, costo_promedio = ? WHERE id = ?', [nuevoStock, costoPromedio, ing.id])
        const [r] = await db.query(
            'INSERT INTO compras_insumos (ingrediente_id, cantidad, costo_total, proveedor, usuario_id) VALUES (?, ?, ?, ?, ?)',
            [ing.id, c.cantidad, c.costoTotal, c.proveedor, usuario.id])
        const nota = `Compra de insumos${c.proveedor ? ` (${c.proveedor})` : ''}`
        await db.query(
            `INSERT INTO movimientos_inventario (ingrediente_id, tipo, cantidad, stock_despues, usuario_id, nota)
             VALUES (?, 'entrada', ?, ?, ?, ?)`, [ing.id, c.cantidad, nuevoStock, usuario.id, nota])
        await db.commit()
        return { id: r.insertId, ingrediente: ing.nombre, cantidad: c.cantidad, costo_total: c.costoTotal, stock: nuevoStock, costo_promedio: costoPromedio }
    } catch (e) {
        await db.rollback()
        throw e
    } finally {
        db.release()
    }
}

// Ingredientes con control de stock 
async function ingredientesControlados() {
    const [filas] = await conexion.query(
        "SELECT id, nombre, unidad, stock, costo_promedio FROM ingredientes WHERE activo = 1 AND stock IS NOT NULL ORDER BY nombre")
    return filas
}

// Historial de compras 
async function historial(limite = 200) {
    const [filas] = await conexion.query(
        `SELECT c.*, i.nombre AS ingrediente, i.unidad, u.nombre AS usuario
           FROM compras_insumos c JOIN ingredientes i ON i.id = c.ingrediente_id JOIN usuarios u ON u.id = c.usuario_id
          ORDER BY c.creado_en DESC LIMIT ?`, [limite])
    return filas.map(f => ({ ...f, cantidad: Number(f.cantidad), costo_total: Number(f.costo_total) }))
}

module.exports = { registrar, ingredientesControlados, historial }
