// Validacion de caja servicio
const conexion = require('../database/db')
const menu = require('./menuService')
const { ErrorNegocio } = menu

const MEDIOS_PAGO = ['efectivo', 'tarjeta', 'transferencia']
const MAX_UNIDADES = 100          // por comanda
const MAX_CANTIDAD_LINEA = 50     // unidades iguales en una línea

const redondear = n => Math.round(n * 100) / 100

// Caja de la barra de snacks
async function cajaSnacks(db = conexion) {
    const [[caja]] = await db.query("SELECT id, nombre FROM cajas WHERE servicio = 'snacks' AND activo = 1 ORDER BY id LIMIT 1")
    if (!caja) throw new ErrorNegocio('No hay una caja de snacks activa. Revisa la tabla cajas.', 409)
    return caja
}

// Cuenta abierta de una mesa 
async function cuentaAbiertaDeMesa(mesaId, db = conexion) {
    const [[cuenta]] = await db.query(
        "SELECT * FROM cuentas WHERE mesa_id = ? AND estado = 'abierta' ORDER BY id DESC LIMIT 1", [mesaId])
    return cuenta || null
}

// Mesas con cuenta abierta
async function cuentasAbiertas() {
    const [filas] = await conexion.query(`
        SELECT cu.id, cu.mesa_id, m.numero AS mesa, cu.cliente_nombre, cu.abierta_en,
               COUNT(DISTINCT co.id) AS comandas,
               COALESCE(SUM(CASE WHEN co.estado = 'pagada' THEN co.total END), 0) AS total,
               (SELECT COUNT(*) FROM comanda_articulos a JOIN comandas c2 ON c2.id = a.comanda_id
                 WHERE c2.cuenta_id = cu.id AND a.estado IN ('pendiente','en_preparacion','lista')) AS pendientes
          FROM cuentas cu
          JOIN mesas m ON m.id = cu.mesa_id
          LEFT JOIN comandas co ON co.cuenta_id = cu.id
         WHERE cu.estado = 'abierta'
         GROUP BY cu.id
         ORDER BY m.numero`)
    return filas
}

async function cerrarCuenta(id) {
    const [r] = await conexion.query(
        "UPDATE cuentas SET estado = 'cerrada', cerrada_en = NOW() WHERE id = ? AND estado = 'abierta'", [id])
    if (!r.affectedRows) throw new ErrorNegocio('Esa cuenta no existe o ya estaba cerrada.', 404)
}

// Valida el encabezado del pedido
async function validarDestino(datos) {
    const paraLlevar = datos.para_llevar === true || datos.para_llevar === 1 || datos.para_llevar === '1' || datos.para_llevar === 'true'
    const cliente = typeof datos.cliente === 'string' ? datos.cliente.trim().replace(/\s+/g, ' ') : ''
    if (cliente.length < 2 || cliente.length > 80) {
        throw new ErrorNegocio('Escribe el nombre del cliente (2 a 80 letras): sirve para encontrarlo si cambia de mesa.', 422)
    }
    if (paraLlevar) return { paraLlevar: true, mesa: null, cliente }

    const mesaId = Number(datos.mesa_id)
    if (!Number.isInteger(mesaId) || mesaId <= 0) throw new ErrorNegocio('Elige la mesa o marca "Para llevar".', 422)
    const [[mesa]] = await conexion.query('SELECT id, numero, activo FROM mesas WHERE id = ?', [mesaId])
    if (!mesa || !mesa.activo) throw new ErrorNegocio('Esa mesa no existe o está desactivada.', 422)
    return { paraLlevar: false, mesa, cliente }
}

// Valida y cotiza cada línea
async function armarUnidades(lineas) {
    if (!Array.isArray(lineas) || !lineas.length) throw new ErrorNegocio('El pedido está vacío.', 422)
    const unidades = []
    for (const [i, linea] of lineas.entries()) {
        const cantidad = Number(linea.cantidad ?? 1)
        if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD_LINEA) {
            throw new ErrorNegocio(`Línea ${i + 1}: la cantidad debe ser de 1 a ${MAX_CANTIDAD_LINEA}.`, 422)
        }
        const cotizacion = await menu.cotizar({
            producto_id: linea.producto_id, estilo_id: linea.estilo_id, tamano_id: linea.tamano_id,
            quitar: Array.isArray(linea.quitar) ? linea.quitar : [],
            extras: Array.isArray(linea.extras) ? linea.extras : []
        })
        for (let n = 0; n < cantidad; n++) unidades.push(cotizacion)
        if (unidades.length > MAX_UNIDADES) throw new ErrorNegocio(`Máximo ${MAX_UNIDADES} artículos por comanda.`, 422)
    }
    return unidades
}

// Valida el cobro 
function validarPago(pago, total) {
    pago = pago || {}
    const medio = String(pago.medio || '')
    if (!MEDIOS_PAGO.includes(medio)) throw new ErrorNegocio('Elige cómo paga: efectivo, tarjeta o transferencia.', 422)
    const referencia = typeof pago.referencia === 'string' ? pago.referencia.trim().slice(0, 60) : ''

    if (medio === 'efectivo') {
        const recibido = Number(pago.recibido)
        if (!Number.isFinite(recibido) || recibido <= 0) throw new ErrorNegocio('Escribe cuánto efectivo entregó el cliente.', 422)
        if (recibido + 0.001 < total) throw new ErrorNegocio(`El efectivo no alcanza: faltan $${(total - recibido).toFixed(2)}.`, 422)
        if (recibido > 100000) throw new ErrorNegocio('Revisa la cantidad recibida.', 422)
        return { medio, recibido: redondear(recibido), cambio: redondear(recibido - total), referencia: null }
    }
    return { medio, recibido: total, cambio: 0, referencia: referencia || null }
}

//registra la comanda ya pagada, sus unidades, cambios y su ticket.
async function registrarComanda(datos, usuarioId) {
    const destino = await validarDestino(datos || {})
    const unidades = await armarUnidades(datos.articulos)
    const total = redondear(unidades.reduce((s, u) => s + u.precio, 0))
    const pago = validarPago(datos.pago, total)

    const db = await conexion.getConnection()
    try {
        await db.beginTransaction()
        const caja = await cajaSnacks(db)

        // Cuenta
        let cuentaId, cuentaNueva = true
        if (destino.mesa) {
            const [[abierta]] = await db.query(
                "SELECT id FROM cuentas WHERE mesa_id = ? AND estado = 'abierta' ORDER BY id DESC LIMIT 1 FOR UPDATE", [destino.mesa.id])
            if (abierta) { cuentaId = abierta.id; cuentaNueva = false }
        }
        if (!cuentaId) {
            const [r] = await db.query(
                // Para llevar no ocupa mesa
                `INSERT INTO cuentas (mesa_id, para_llevar, cliente_nombre, estado, cerrada_en)
                 VALUES (?, ?, ?, ?, ${destino.paraLlevar ? 'NOW()' : 'NULL'})`,
                [destino.mesa ? destino.mesa.id : null, destino.paraLlevar ? 1 : 0, destino.cliente,
                 destino.paraLlevar ? 'cerrada' : 'abierta'])
            cuentaId = r.insertId
        }

        // Folio consecutivo de comanda
        const [[{ folio }]] = await db.query('SELECT COALESCE(MAX(folio), 0) + 1 AS folio FROM comandas FOR UPDATE')
        const [rc] = await db.query(
            `INSERT INTO comandas (folio, cuenta_id, caja_id, usuario_id, mesa_id, para_llevar, cliente_nombre,
                                   total, medio_pago, recibido, cambio, referencia)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [folio, cuentaId, caja.id, usuarioId, destino.mesa ? destino.mesa.id : null, destino.paraLlevar ? 1 : 0,
             destino.cliente, total, pago.medio, pago.recibido, pago.cambio, pago.referencia])
        const comandaId = rc.insertId

        // Una fila por unidad.
        for (const u of unidades) {
            const [ra] = await db.query(
                `INSERT INTO comanda_articulos (comanda_id, producto_id, estilo_id, tamano_id, descripcion, piezas,
                                                precio_unitario, va_a_cocina, estado, entregado_en)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${u.va_a_cocina ? 'NULL' : 'NOW()'})`,
                [comandaId, u.producto_id, u.estilo_id, u.tamano_id, u.descripcion, u.piezas || null,
                 u.precio, u.va_a_cocina ? 1 : 0, u.va_a_cocina ? 'pendiente' : 'entregada'])
            for (const m of u.modificaciones) {
                await db.query(
                    'INSERT INTO articulo_modificaciones (articulo_id, ingrediente_id, tipo, nombre, precio) VALUES (?, ?, ?, ?, ?)',
                    [ra.insertId, m.ingrediente_id, m.tipo, m.nombre, m.precio])
            }
        }

        // Ticket con su propio número 
        const [[{ folioTicket }]] = await db.query('SELECT COALESCE(MAX(folio), 0) + 1 AS folioTicket FROM tickets FOR UPDATE')
        const [rt] = await db.query('INSERT INTO tickets (comanda_id, folio) VALUES (?, ?)', [comandaId, folioTicket])

        await db.commit()
        return {
            id: comandaId, folio, ticket_id: rt.insertId, ticket_folio: folioTicket, total,
            cambio: pago.cambio, cuenta_id: cuentaId, cuenta_nueva: cuentaNueva,
            unidades: unidades.length, a_cocina: unidades.filter(u => u.va_a_cocina).length
        }
    } catch (e) {
        await db.rollback()
        throw e
    } finally {
        db.release()
    }
}

// Comanda completa
async function detalleComanda(id) {
    const [[c]] = await conexion.query(`
        SELECT co.*, m.numero AS mesa, u.nombre AS atendio, ca.nombre AS caja, ca.id AS caja_numero,
               t.id AS ticket_id, t.folio AS ticket_folio, t.emitido_en, cu.estado AS cuenta_estado
          FROM comandas co
          JOIN usuarios u ON u.id = co.usuario_id
          JOIN cajas ca ON ca.id = co.caja_id
          JOIN cuentas cu ON cu.id = co.cuenta_id
          LEFT JOIN mesas m ON m.id = co.mesa_id
          LEFT JOIN tickets t ON t.comanda_id = co.id
         WHERE co.id = ?`, [id])
    if (!c) return null

    const [articulos] = await conexion.query(
        'SELECT * FROM comanda_articulos WHERE comanda_id = ? ORDER BY id', [id])
    const [mods] = await conexion.query(`
        SELECT am.* FROM articulo_modificaciones am
          JOIN comanda_articulos a ON a.id = am.articulo_id
         WHERE a.comanda_id = ? ORDER BY am.tipo DESC, am.id`, [id])
    articulos.forEach(a => {
        a.quitar = mods.filter(m => m.articulo_id === a.id && m.tipo === 'quitar')
        a.extras = mods.filter(m => m.articulo_id === a.id && m.tipo === 'extra')
    })

    // Cuenta de la mesa
    const [cuenta] = await conexion.query(
        `SELECT id, folio, total, estado, creada_en FROM comandas WHERE cuenta_id = ? ORDER BY id`, [c.cuenta_id])
    const [cancelaciones] = await conexion.query(`
        SELECT k.*, s.nombre AS solicito, a.nombre AS autorizo, ar.descripcion AS articulo
          FROM cancelaciones k
          JOIN usuarios s ON s.id = k.solicito_id
          LEFT JOIN usuarios a ON a.id = k.autorizo_id
          LEFT JOIN comanda_articulos ar ON ar.id = k.articulo_id
         WHERE k.comanda_id = ? ORDER BY k.id DESC`, [id])

    return {
        ...c, articulos, cuenta, cancelaciones,
        cuenta_total: redondear(cuenta.filter(x => x.estado === 'pagada').reduce((s, x) => s + x.total, 0)),
        grupos: agrupar(articulos)
    }
}

// Junta unidades idénticas para el ticket
function agrupar(articulos) {
    const grupos = []
    for (const a of articulos) {
        const firma = [a.descripcion, a.precio_unitario, a.estado,
            a.quitar.map(m => m.ingrediente_id).join(','), a.extras.map(m => m.ingrediente_id).join(',')].join('|')
        const g = grupos.find(x => x.firma === firma)
        if (g) { g.cantidad++; g.ids.push(a.id) } else grupos.push({ firma, cantidad: 1, ids: [a.id], ...a })
    }
    grupos.forEach(g => { g.importe = redondear(g.cantidad * g.precio_unitario) })
    return grupos
}

// Comandas de un día 
async function comandasDelDia(fecha) {
    const [filas] = await conexion.query(`
        SELECT co.id, co.folio, co.creada_en, co.para_llevar, m.numero AS mesa, co.cliente_nombre,
               co.total, co.medio_pago, co.estado, u.nombre AS atendio, t.id AS ticket_id,
               COUNT(a.id) AS unidades,
               SUM(a.estado IN ('pendiente','en_preparacion','lista')) AS pendientes,
               SUM(a.estado = 'cancelada') AS canceladas
          FROM comandas co
          JOIN usuarios u ON u.id = co.usuario_id
          LEFT JOIN mesas m ON m.id = co.mesa_id
          LEFT JOIN tickets t ON t.comanda_id = co.id
          LEFT JOIN comanda_articulos a ON a.comanda_id = co.id
         WHERE DATE(co.creada_en) = ?
         GROUP BY co.id
         ORDER BY co.id DESC`, [fecha])
    return filas
}

// cancelar sin reembolso. 
async function solicitarCancelacion({ comandaId, articuloId, motivo }, usuario) {
    motivo = typeof motivo === 'string' ? motivo.trim() : ''
    if (motivo.length < 5 || motivo.length > 255) throw new ErrorNegocio('Escribe el motivo de la cancelación (5 a 255 letras).', 422)

    const [[c]] = await conexion.query('SELECT id, estado FROM comandas WHERE id = ?', [comandaId])
    if (!c) throw new ErrorNegocio('Esa comanda no existe.', 404)
    if (c.estado === 'cancelada') throw new ErrorNegocio('La comanda ya está cancelada.', 409)

    let monto, articulo = null
    if (articuloId) {
        const [[a]] = await conexion.query('SELECT * FROM comanda_articulos WHERE id = ? AND comanda_id = ?', [articuloId, comandaId])
        if (!a) throw new ErrorNegocio('Ese artículo no es de esta comanda.', 422)
        if (a.estado === 'cancelada') throw new ErrorNegocio('Ese artículo ya está cancelado.', 409)
        articulo = a
        monto = a.precio_unitario
    } else {
        const [[{ vivo }]] = await conexion.query(
            "SELECT COALESCE(SUM(precio_unitario), 0) AS vivo FROM comanda_articulos WHERE comanda_id = ? AND estado <> 'cancelada'", [comandaId])
        monto = vivo
    }
    const [[repetida]] = await conexion.query(
        `SELECT id FROM cancelaciones WHERE comanda_id = ? AND estado = 'solicitada' AND (articulo_id <=> ?)`,
        [comandaId, articulo ? articulo.id : null])
    if (repetida) throw new ErrorNegocio('Ya hay una solicitud pendiente para eso; espera a que la resuelva un administrador.', 409)

    const [r] = await conexion.query(
        'INSERT INTO cancelaciones (comanda_id, articulo_id, motivo, monto, solicito_id) VALUES (?, ?, ?, ?, ?)',
        [comandaId, articulo ? articulo.id : null, motivo, monto, usuario.id])
    if (usuario.esAdmin) await resolverCancelacion(r.insertId, true, usuario.id)
    return { id: r.insertId, aprobada: Boolean(usuario.esAdmin) }
}

async function resolverCancelacion(id, aprobar, adminId) {
    const db = await conexion.getConnection()
    try {
        await db.beginTransaction()
        const [[k]] = await db.query('SELECT * FROM cancelaciones WHERE id = ? FOR UPDATE', [id])
        if (!k) throw new ErrorNegocio('Esa solicitud no existe.', 404)
        if (k.estado !== 'solicitada') throw new ErrorNegocio('Esa solicitud ya se resolvió.', 409)

        await db.query(
            'UPDATE cancelaciones SET estado = ?, autorizo_id = ?, resuelta_en = NOW() WHERE id = ?',
            [aprobar ? 'aprobada' : 'rechazada', adminId, id])
        if (aprobar) {
            // Sin reembolso
            if (k.articulo_id) {
                await db.query("UPDATE comanda_articulos SET estado = 'cancelada' WHERE id = ?", [k.articulo_id])
            } else {
                await db.query("UPDATE comanda_articulos SET estado = 'cancelada' WHERE comanda_id = ?", [k.comanda_id])
            }
            const [[{ vivos }]] = await db.query(
                "SELECT COUNT(*) AS vivos FROM comanda_articulos WHERE comanda_id = ? AND estado <> 'cancelada'", [k.comanda_id])
            if (!vivos) await db.query("UPDATE comandas SET estado = 'cancelada' WHERE id = ?", [k.comanda_id])
        }
        await db.commit()
    } catch (e) {
        await db.rollback()
        throw e
    } finally {
        db.release()
    }
}

async function listaCancelaciones() {
    const [filas] = await conexion.query(`
        SELECT k.*, co.folio, s.nombre AS solicito, a.nombre AS autorizo, ar.descripcion AS articulo
          FROM cancelaciones k
          JOIN comandas co ON co.id = k.comanda_id
          JOIN usuarios s ON s.id = k.solicito_id
          LEFT JOIN usuarios a ON a.id = k.autorizo_id
          LEFT JOIN comanda_articulos ar ON ar.id = k.articulo_id
         ORDER BY k.estado = 'solicitada' DESC, k.id DESC
         LIMIT 200`)
    return filas
}

module.exports = {
    MEDIOS_PAGO, ErrorNegocio, cajaSnacks, cuentaAbiertaDeMesa, cuentasAbiertas, cerrarCuenta,
    registrarComanda, detalleComanda, comandasDelDia, solicitarCancelacion, resolverCancelacion, listaCancelaciones
}
