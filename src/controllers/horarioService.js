//  Horario por día de cada caja, cambios forzosos y bitácora del administrador
const conexion = require('../database/db')
const { ErrorNegocio } = require('./menuService')
const formatos = require('./formatos')
const { ROLES } = require('../routes/modulos')

const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']   // índice = JS Date.getUTCDay()
const DIAS_ORDEN = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']
const DIAS_TEXTO = { lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles', jueves: 'Jueves', viernes: 'Viernes', sabado: 'Sábado', domingo: 'Domingo' }
const texto = v => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '')

const esAdmin = u => u.rol === ROLES.ADMIN
const diaDeFecha = fecha => DIAS[new Date(`${fecha}T00:00:00Z`).getUTCDay()]

async function hoyDia(db = conexion) {
    const [[f]] = await db.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoy")
    return { hoy: f.hoy, dia: diaDeFecha(f.hoy) }
}

// A quién le toca una caja en una fecha
async function asignadoEn(cajaId, fecha, dia, db = conexion) {
    const [[exc]] = await db.query('SELECT usuario_id FROM horario_excepciones WHERE fecha = ? AND caja_id = ?', [fecha, cajaId])
    if (exc) return exc.usuario_id
    const [[h]] = await db.query('SELECT usuario_id FROM horario_cajas WHERE dia_semana = ? AND caja_id = ?', [dia, cajaId])
    return h ? h.usuario_id : undefined
}

//¿puede este usuario operar hoy esta caja?
async function puedeOperarHoy(usuario, cajaId, db = conexion) {
    if (esAdmin(usuario)) return { permitido: true }
    const { hoy, dia } = await hoyDia(db)
    const asignado = await asignadoEn(cajaId, hoy, dia, db)
    if (asignado === undefined) return { permitido: true }   // nadie ha configurado el horario: no se restringe
    if (asignado === usuario.id) return { permitido: true }
    return { permitido: false, mensaje: asignado === null ? 'Hoy esta caja no tiene a nadie asignado.' : 'Hoy esta caja le toca a otro compañero según el horario.' }
}

// Empleados que pueden tener horario 
async function empleados(db = conexion) {
    const [filas] = await db.query(
        `SELECT u.id, u.nombre, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id
          WHERE u.activo = 1 AND r.nombre NOT IN ('Cliente', 'Administrador') ORDER BY u.nombre`)
    return filas
}

// La cuadrícula completa: día × caja 
async function cuadricula() {
    const [cajas] = await conexion.query('SELECT id, nombre, servicio FROM cajas WHERE activo = 1 ORDER BY id')
    const [filas] = await conexion.query(
        `SELECT h.dia_semana, h.caja_id, h.usuario_id, u.nombre AS usuario FROM horario_cajas h JOIN usuarios u ON u.id = h.usuario_id`)
    const grid = Object.fromEntries(DIAS_ORDEN.map(d => [d, Object.fromEntries(cajas.map(c => [c.id, null]))]))
    filas.forEach(f => { grid[f.dia_semana][f.caja_id] = { usuario_id: f.usuario_id, usuario: f.usuario } })
    const { hoy, dia } = await hoyDia()
    const [excs] = await conexion.query(
        `SELECT e.*, ca.nombre AS caja, u.nombre AS usuario, a.nombre AS admin
           FROM horario_excepciones e JOIN cajas ca ON ca.id = e.caja_id LEFT JOIN usuarios u ON u.id = e.usuario_id
           JOIN usuarios a ON a.id = e.creado_por
          WHERE e.fecha >= CURDATE() ORDER BY e.fecha, e.caja_id`)
    return { cajas, dias: DIAS_ORDEN, diasTexto: DIAS_TEXTO, grid, hoy, diaHoy: dia, empleados: await empleados(), excepciones: excs }
}

//  el administrador arma el horario semanal completo 
async function guardarSemana(asignaciones) {
    asignaciones = Array.isArray(asignaciones) ? asignaciones : []
    const [cajas] = await conexion.query('SELECT id FROM cajas WHERE activo = 1')
    const idsCajas = new Set(cajas.map(c => c.id))
    const filas = []
    for (const a of asignaciones) {
        const dia = DIAS_ORDEN.includes(a.dia) ? a.dia : null
        const cajaId = formatos.entero(a.caja_id, 1)
        const usuarioId = formatos.entero(a.usuario_id, 1)
        if (!dia || !cajaId || !usuarioId || !idsCajas.has(cajaId)) continue
        filas.push([dia, cajaId, usuarioId])
    }
    // Una persona, una caja por día
    const porPersonaDia = new Map()
    filas.forEach(f => porPersonaDia.set(`${f[0]}|${f[2]}`, f))
    const definitivas = [...porPersonaDia.values()]

    const db = await conexion.getConnection()
    try {
        await db.beginTransaction()
        await db.query('DELETE FROM horario_cajas')
        if (definitivas.length) await db.query('INSERT INTO horario_cajas (dia_semana, caja_id, usuario_id) VALUES ?', [definitivas])
        await db.commit()
    } catch (e) {
        await db.rollback()
        throw e
    } finally {
        db.release()
    }
    return { guardadas: definitivas.length }
}

function leerExcepcion(datos) {
    datos = datos || {}
    const errores = []
    const fecha = formatos.fecha(datos.fecha)
    if (!fecha) errores.push('Elige una fecha válida.')
    const cajaId = formatos.entero(datos.caja_id, 1)
    if (!cajaId) errores.push('Elige la caja.')
    const usuarioId = String(datos.usuario_id || '') === '' ? null : formatos.entero(datos.usuario_id, 1)
    if (datos.usuario_id && !usuarioId) errores.push('Elige a la persona o déjalo vacío para cerrar la caja ese día.')
    const motivo = texto(datos.motivo)
    if (motivo.length < 5 || motivo.length > 200) errores.push('Escribe el motivo del cambio (5 a 200 letras).')
    if (errores.length) throw Object.assign(new ErrorNegocio(errores[0], 422), { errores })
    return { fecha, cajaId, usuarioId, motivo }
}

// cambio forzoso del admin para una fecha. Si la persona ya tiene otra caja
async function forzar(datos, admin) {
    const e = leerExcepcion(datos)
    const db = await conexion.getConnection()
    try {
        await db.beginTransaction()
        const [[caja]] = await db.query('SELECT id, nombre FROM cajas WHERE id = ? AND activo = 1 FOR UPDATE', [e.cajaId])
        if (!caja) throw new ErrorNegocio('Esa caja no existe.', 404)
        if (e.usuarioId) {
            const dia = diaDeFecha(e.fecha)
            const [otras] = await db.query(
                `SELECT ca.nombre AS caja FROM horario_excepciones ex JOIN cajas ca ON ca.id = ex.caja_id
                  WHERE ex.fecha = ? AND ex.caja_id <> ? AND ex.usuario_id = ?
                  UNION
                 SELECT ca.nombre FROM horario_cajas h JOIN cajas ca ON ca.id = h.caja_id
                  WHERE h.dia_semana = ? AND h.caja_id <> ? AND h.usuario_id = ?
                    AND NOT EXISTS (SELECT 1 FROM horario_excepciones ex2 WHERE ex2.fecha = ? AND ex2.caja_id = h.caja_id)`,
                [e.fecha, e.cajaId, e.usuarioId, dia, e.cajaId, e.usuarioId, e.fecha])
            if (otras.length) throw new ErrorNegocio(`Esa persona ya tiene asignada "${otras[0].caja}" ese día: no puede estar en dos sitios.`, 409)
        }
        await db.query(
            `INSERT INTO horario_excepciones (fecha, caja_id, usuario_id, motivo, creado_por) VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE usuario_id = VALUES(usuario_id), motivo = VALUES(motivo), creado_por = VALUES(creado_por)`,
            [e.fecha, e.cajaId, e.usuarioId, e.motivo, admin.id])
        const [[{ id }]] = await db.query('SELECT id FROM horario_excepciones WHERE fecha = ? AND caja_id = ?', [e.fecha, e.cajaId])
        await db.query(
            "INSERT INTO bitacora_admin (admin_id, accion, objeto, objeto_id, motivo) VALUES (?, 'reasignar_horario', 'horario_excepciones', ?, ?)",
            [admin.id, id, `${caja.nombre} · ${e.fecha}: ${e.motivo}`])
        await db.commit()
        return { id, ...e }
    } catch (err) {
        await db.rollback()
        throw err
    } finally {
        db.release()
    }
}

async function quitarExcepcion(id, admin) {
    const [r] = await conexion.query('DELETE FROM horario_excepciones WHERE id = ?', [Number(id) || 0])
    if (!r.affectedRows) throw new ErrorNegocio('Ese cambio forzoso ya no existe.', 404)
    return { id: Number(id) }
}

// Bitácora del administrador
async function bitacora(limite = 100) {
    const [filas] = await conexion.query(
        `SELECT b.*, a.nombre AS admin FROM bitacora_admin b JOIN usuarios a ON a.id = b.admin_id
          ORDER BY b.creado_en DESC LIMIT ?`, [limite])
    return filas
}

async function registrarBitacora(db, admin, accion, objeto, objetoId, motivo) {
    await db.query(
        'INSERT INTO bitacora_admin (admin_id, accion, objeto, objeto_id, motivo) VALUES (?, ?, ?, ?, ?)',
        [admin.id, accion, objeto, objetoId, motivo])
}

module.exports = {
    DIAS_ORDEN, DIAS_TEXTO, diaDeFecha, hoyDia, asignadoEn, puedeOperarHoy,
    empleados, cuadricula, guardarSemana, forzar, quitarExcepcion, bitacora, registrarBitacora
}
