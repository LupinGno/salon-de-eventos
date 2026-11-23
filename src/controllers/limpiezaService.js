// Limpieza
const conexion = require('../database/db')
const { ErrorNegocio } = require('./menuService')
const reservas = require('./reservasService')
const brincolines = require('./brincolinesService')

const texto = v => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '')

async function pendientes() {
    const [filas] = await conexion.query(`
        SELECT t.id, t.tipo, t.origen, t.reserva_id, t.renta_id, t.brincolin_id, DATE_FORMAT(t.creada_en, '%d/%m/%Y %H:%i') AS creada_texto,
               s.nombre AS salon, DATE_FORMAT(rs.fecha_evento, '%Y-%m-%d') AS fecha_evento, rs.cuota_garantia, rs.personas,
               b.nombre AS brincolin, i.archivo AS imagen, rb.garantia AS garantia_renta, DATE_FORMAT(rb.fecha, '%Y-%m-%d') AS fecha_renta
          FROM tareas_limpieza t
          LEFT JOIN reservas_salon rs ON rs.id = t.reserva_id
          LEFT JOIN salones s ON s.id = rs.salon_id
          LEFT JOIN brincolines b ON b.id = t.brincolin_id
          LEFT JOIN imagenes i ON i.id = COALESCE(b.imagen_id, s.imagen_id)
          LEFT JOIN rentas_brincolin rb ON rb.id = t.renta_id
         WHERE t.estado = 'pendiente'
         ORDER BY t.creada_en, t.id`)
    filas.forEach(t => {
        t.folio = t.reserva_id ? reservas.folio(t.reserva_id) : t.renta_id ? brincolines.folio(t.renta_id) : null
        t.garantia_renta = t.garantia_renta === null ? null : Number(t.garantia_renta)
        t.cuota_garantia = t.cuota_garantia === null ? null : Number(t.cuota_garantia)
    })
    return filas
}

// Bloquea la tarea pendiente dentro de una transacción
async function conTarea(id, tipo, accion) {
    const db = await conexion.getConnection()
    try {
        await db.beginTransaction()
        const [[t]] = await db.query('SELECT * FROM tareas_limpieza WHERE id = ? FOR UPDATE', [Number(id) || 0])
        if (!t) throw new ErrorNegocio('Esa tarea no existe.', 404)
        if (t.tipo !== tipo) throw new ErrorNegocio('Esa tarea es de otro tipo.', 422)
        if (t.estado !== 'pendiente') throw new ErrorNegocio('Esa tarea ya se revisó.', 409)
        const resultado = await accion(db, t)
        await db.commit()
        return resultado
    } catch (e) {
        await db.rollback()
        throw e
    } finally {
        db.release()
    }
}

// revisar un brincolín
async function revisarBrincolin(id, datos, usuario) {
    datos = datos || {}
    const resultado = String(datos.resultado || '')
    const observaciones = texto(datos.observaciones)
    if (!['limpio', 'danos'].includes(resultado)) throw new ErrorNegocio('Elige si quedó limpio y sin daños o si tiene daños.', 422)
    if (resultado === 'danos' && observaciones.length < 5) throw new ErrorNegocio('Describe los daños (por ejemplo: costura rota, no infla).', 422)
    return conTarea(id, 'brincolin', async (db, t) => {
        const [[b]] = await db.query('SELECT * FROM brincolines WHERE id = ? FOR UPDATE', [t.brincolin_id])
        let renta = null
        if (t.renta_id) {
            await db.query('SELECT id FROM rentas_brincolin WHERE id = ? FOR UPDATE', [t.renta_id])
            renta = await brincolines.detalleRenta(t.renta_id, db)
        }
        let devuelto = 0
        if (resultado === 'limpio') {
            await db.query("UPDATE brincolines SET estado = 'disponible' WHERE id = ?", [b.id])
            if (renta && renta.estado_garantia === 'retenida') {
                devuelto = renta.garantia
                await brincolines.registrarPago(db, renta, usuario.id, 'devolucion_garantia', -devuelto, renta.medio_pago, renta.cliente_nombre)
                await db.query("UPDATE rentas_brincolin SET estado_garantia = 'devuelta' WHERE id = ?", [renta.id])
            }
        } else {
            await db.query("UPDATE brincolines SET estado = 'en_reparacion' WHERE id = ?", [b.id])
            if (renta) {
                await db.query("UPDATE rentas_brincolin SET estado_garantia = 'cobrada' WHERE id = ? AND estado_garantia = 'retenida'", [renta.id])
                await db.query(
                    `INSERT INTO incidencias (renta_id, brincolin_id, usuario_id, tipo, descripcion, accion, resuelta_en, resuelta_por)
                     VALUES (?, ?, ?, 'dano_cliente', ?, 'ninguna', NOW(), ?)`,
                    [renta.id, b.id, usuario.id, `Regresó con daños: ${observaciones}`.slice(0, 255), usuario.id])
            }
            await brincolines.marcarRentasAfectadas(db, b.id, `${b.nombre} está en reparación: ${observaciones}`, usuario.id)
        }
        await db.query(
            `UPDATE tareas_limpieza SET estado = ?, resultado = ?, observaciones = ?, revisado_por = ?, liberado_en = NOW() WHERE id = ?`,
            [resultado === 'limpio' ? 'liberado' : 'con_danos', resultado, observaciones || null, usuario.id, t.id])
        return {
            resultado, brincolin: b.nombre, estado: resultado === 'limpio' ? 'disponible' : 'en_reparacion',
            devuelto, a: renta ? renta.cliente_nombre : null, medio: renta ? renta.medio_pago : null
        }
    })
}

//revisar el salón
async function revisarSalon(id, datos, usuario) {
    const revision = reservas.leerRevisionSalon(datos)
    return conTarea(id, 'salon', async (db, t) => {
        const resultado = await reservas.revisarSalon(db, t.reserva_id, revision, usuario)
        await db.query(
            `UPDATE tareas_limpieza SET estado = ?, resultado = ?, observaciones = ?, costo_danos = ?, revisado_por = ?, liberado_en = NOW() WHERE id = ?`,
            [revision.resultado === 'danos' ? 'con_danos' : 'liberado', revision.resultado, revision.descripcion || null, revision.costo, usuario.id, t.id])
        return resultado
    })
}

// Lo que ya se revisó hoy
async function revisadasHoy() {
    const [filas] = await conexion.query(`
        SELECT t.id, t.tipo, t.resultado, t.estado, DATE_FORMAT(t.liberado_en, '%H:%i') AS hora, s.nombre AS salon, b.nombre AS brincolin
          FROM tareas_limpieza t
          LEFT JOIN reservas_salon rs ON rs.id = t.reserva_id LEFT JOIN salones s ON s.id = rs.salon_id
          LEFT JOIN brincolines b ON b.id = t.brincolin_id
         WHERE t.estado <> 'pendiente' AND DATE(t.liberado_en) = CURDATE()
         ORDER BY t.liberado_en DESC LIMIT 50`)
    return filas
}

module.exports = { pendientes, revisarBrincolin, revisarSalon, revisadasHoy }
