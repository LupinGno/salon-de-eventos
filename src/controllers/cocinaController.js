// Módulo 3 — Cocina y recepción (US-32 a US-37). Sprint 5 (estados y tiempo real) y Sprint 6 (entrega).
const cocina = require('./cocinaService')
const tiempoReal = require('./tiempoReal')
const { ErrorNegocio } = require('./menuService')
const { entero } = require('./formatos')

const ACCIONES = { preparar: 'en_preparacion', lista: 'lista' }

// Si la pantalla pidió JSON (botones con fetch) responde JSON; si no, regresa a la página
function responder(req, res, destino, error, datos) {
    const quiereJson = req.accepts(['html', 'json']) === 'json' || Boolean(req.is('application/json'))
    if (error) {
        if (quiereJson) return res.status(error.status).json({ error: error.message })
        return res.redirect(destino)
    }
    if (quiereJson) return res.json({ ok: true, ...(datos || {}) })
    res.redirect(destino)
}

// Avisa a las pantallas abiertas lo que cambió (Sprint 5)
function avisar(resultado) {
    tiempoReal.emitir('cocina', 'cocina:cambio', { comanda_id: resultado.comanda_id })
    tiempoReal.emitir('recepcion', 'recepcion:cambio', { comanda_id: resultado.comanda_id })
    // US-35: recepción recibe el aviso con número de comanda y contenido
    if (resultado.aviso) tiempoReal.emitir('recepcion', 'recepcion:aviso', resultado.aviso)
    // Al entregar, los avisos de esa comanda ya están atendidos: se quitan de todas las pantallas
    for (const id of resultado.avisos_cerrados || []) tiempoReal.emitir('recepcion', 'recepcion:visto', { id })
}

// Envuelve una acción: errores de negocio → 404/409/422; los demás → 500
const accion = (destino, fn) => async (req, res, next) => {
    try {
        const r = await fn(req)
        avisar(r)
        responder(req, res, destino, null, { aviso: r.aviso || undefined })
    } catch (e) {
        if (e instanceof ErrorNegocio) return responder(req, res, destino, e)
        next(e)
    }
}

// US-32, US-33: monitor de cocina. Con ?parcial=1 devuelve solo la cola (para refrescarla sin recargar)
exports.monitor = async (req, res, next) => {
    try {
        const [comandas, resumen] = await Promise.all([cocina.colaCocina(), cocina.resumenCocina()])
        if (req.query.parcial) return res.render('cocina/_cola', { comandas, resumen, f: res.locals.f })
        res.render('cocina/monitor', { titulo: 'Cocina', comandas, resumen })
    } catch (e) { next(e) }
}

// US-34: preparar o marcar lista UNA unidad
exports.cambiarArticulo = async (req, res, next) => {
    const nuevo = ACCIONES[req.params.accion]
    if (!nuevo) return res.status(404).json({ error: 'Acción no válida' })
    return accion('/cocina', r => cocina.cambiarEstado(entero(r.params.id, 1), nuevo, r.usuario.id))(req, res, next)
}

// US-34, US-35: toda la comanda lista → sale de la cola y avisa a recepción
exports.comandaLista = accion('/cocina', req => cocina.cambiarEstadoComanda(entero(req.params.id, 1), 'lista', req.usuario.id))

// US-35, US-37: recepción ve lo listo para llevar a la mesa o empacar
exports.entregas = async (req, res, next) => {
    try {
        const comandas = await cocina.paraEntregar()
        if (req.query.parcial) return res.render('caja/_entregas', { comandas, f: res.locals.f })
        res.render('caja/entregas', { titulo: 'Para entregar', comandas })
    } catch (e) { next(e) }
}

// US-36: recepción entrega una unidad o todo lo listo de la comanda (queda hora y quién)
exports.entregarArticulo = accion('/caja/entregas', req => cocina.cambiarEstado(entero(req.params.id, 1), 'entregada', req.usuario.id))
exports.entregarComanda = accion('/caja/entregas', req => cocina.cambiarEstadoComanda(entero(req.params.id, 1), 'entregada', req.usuario.id))

// US-35: avisos sin atender (la pantalla los pide al abrirse por si se perdió alguno)
exports.avisos = async (req, res, next) => {
    try {
        res.json({ avisos: await cocina.avisosPendientes() })
    } catch (e) { next(e) }
}
exports.avisoVisto = async (req, res, next) => {
    try {
        await cocina.marcarAvisoVisto(entero(req.params.id, 1), req.usuario.id)
        tiempoReal.emitir('recepcion', 'recepcion:visto', { id: entero(req.params.id, 1) })
        res.json({ ok: true })
    } catch (e) {
        if (e instanceof ErrorNegocio) return res.status(e.status).json({ error: e.message })
        next(e)
    }
}

// US-37: control de pendientes con entrega parcial
exports.pendientes = async (req, res, next) => {
    try {
        const comandas = await cocina.controlPendientes()
        if (req.query.parcial) return res.render('caja/_pendientes', { comandas, f: res.locals.f })
        res.render('caja/pendientes', { titulo: 'Pendientes', comandas })
    } catch (e) { next(e) }
}

// US-36: historial de entregas del día con hora y quién entregó
exports.entregadas = async (req, res, next) => {
    try {
        const filas = await cocina.entregadasHoy()
        if (req.query.parcial) return res.render('caja/_entregadas', { filas, f: res.locals.f })
        res.render('caja/entregadas', { titulo: 'Entregado hoy', filas })
    } catch (e) { next(e) }
}
