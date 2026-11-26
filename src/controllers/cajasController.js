// Pantallas de cajas y finanzas
const cajas = require('./cajasService')
const horario = require('./horarioService')
const { ErrorNegocio } = require('./menuService')
const ticketPdf = require('./ticketPdf')

const quiereJson = req => req.accepts(['html', 'json']) === 'json'
const errorDe = req => (req.query.error ? [String(req.query.error).slice(0, 200)] : [])

// Responde un error
function fallo(req, res, next, e) {
    if (!(e instanceof ErrorNegocio)) return next(e)
    if (quiereJson(req)) return res.status(e.status).json({ error: e.message, errores: e.errores || [e.message] })
    res.status(e.status).render('error', { codigo: e.status, titulo: e.status === 403 ? 'Acceso denegado' : 'Caja no encontrada', mensaje: e.message })
}

// mis cajas con su turno y su saldo por medio
exports.panel = async (req, res, next) => {
    try {
        const datos = await cajas.panel(req.usuario)
        if (quiereJson(req)) return res.json(datos)
        res.render('cajas/panel', { titulo: 'Cajas', ...datos, errores: errorDe(req) })
    } catch (e) { fallo(req, res, next, e) }
}

exports.detalle = async (req, res, next) => {
    try {
        const d = await cajas.detalleCaja(req.params.id, req.usuario)
        if (quiereJson(req)) return res.json(d)
        res.render('cajas/caja', {
            titulo: d.caja.nombre, ...d, empleados: await cajas.empleados(),
            CLASES: cajas.CLASES, errores: errorDe(req)
        })
    } catch (e) { fallo(req, res, next, e) }
}

// Acciones sobre una caja
const accion = (fn, ok) => async (req, res, next) => {
    const id = Number(req.params.id) || 0
    try {
        const resultado = await fn(id, req.body, req.usuario)
        if (quiereJson(req)) return res.status(201).json(resultado)
        res.redirect(`/cajas/${id}?ok=${ok}`)
    } catch (e) {
        if (!(e instanceof ErrorNegocio)) return next(e)
        if (quiereJson(req)) return res.status(e.status).json({ error: e.message, errores: e.errores || [e.message] })
        if (e.status === 403 || e.status === 404) return fallo(req, res, next, e)
        res.redirect(`/cajas/${id}?error=${encodeURIComponent(e.message)}`)
    }
}
exports.abrir = accion(cajas.abrirTurno, 'turno-abierto')
exports.extra = accion(cajas.registrarExtra, 'extra-registrado')

// movimientos de todas mis cajas con filtros
exports.movimientos = async (req, res, next) => {
    try {
        const datos = await cajas.movimientos(req.query, req.usuario)
        if (quiereJson(req)) return res.json(datos)
        res.render('cajas/movimientos', { titulo: 'Movimientos de caja', ...datos, TIPOS: cajas.TIPOS, errores: errorDe(req) })
    } catch (e) { fallo(req, res, next, e) }
}

exports.arqueo = accion(cajas.arqueo, 'arqueo-guardado')

// US-70 y US-71: cerrar el turno y ver su corte
exports.cerrar = async (req, res, next) => {
    const id = Number(req.params.id) || 0
    try {
        const r = await cajas.cerrarTurno(id, req.body, req.usuario)
        if (quiereJson(req)) return res.status(201).json(r)
        res.redirect(`/cajas/turnos/${r.turno_id}?ok=turno-cerrado`)
    } catch (e) {
        if (!(e instanceof ErrorNegocio)) return next(e)
        if (quiereJson(req)) return res.status(e.status).json({ error: e.message })
        if (e.status === 404) return fallo(req, res, next, e)
        res.redirect(`/cajas/${id}?error=${encodeURIComponent(e.message)}`)
    }
}

exports.corte = async (req, res, next) => {
    try {
        const c = await cajas.corte(req.params.id, req.usuario)
        if (quiereJson(req)) return res.json(c)
        res.render('cajas/corte', { titulo: `Corte ${c.turno.folio}`, ...c, TIPOS: cajas.TIPOS, errores: errorDe(req) })
    } catch (e) { fallo(req, res, next, e) }
}

const enviarPdf = (res, pdf, nombre) => {
    res.set('Content-Type', 'application/pdf')
    res.set('Content-Disposition', `inline; filename="${nombre}"`)
    res.send(pdf)
}
const falloPdf = (req, res, next, e, volver) => {
    if (/Python|reportlab/i.test(e.message)) return res.redirect(`${volver}${volver.includes('?') ? '&' : '?'}error=${encodeURIComponent(e.message)}`)
    fallo(req, res, next, e)
}

exports.cortePdf = async (req, res, next) => {
    try {
        const c = await cajas.corte(req.params.id, req.usuario)
        enviarPdf(res, await ticketPdf.generar(cajas.datosCorte(c), 'caja_pdf.py'), `corte-${c.turno.folio}.pdf`)
    } catch (e) { falloPdf(req, res, next, e, `/cajas/turnos/${Number(req.params.id) || 0}`) }
}

// US-77: el reporte de movimientos con los mismos filtros, en PDF
exports.reportePdf = async (req, res, next) => {
    try {
        const d = await cajas.datosReporte(req.query, req.usuario)
        enviarPdf(res, await ticketPdf.generar(d, 'caja_pdf.py'), `reporte-cajas-${d.filas.length ? 'movimientos' : 'vacio'}.pdf`)
    } catch (e) { falloPdf(req, res, next, e, '/cajas/movimientos') }
}

// US-74: aprobaciones del administrador
exports.aprobaciones = async (req, res, next) => {
    try {
        const d = await cajas.pendientesAprobacion()
        if (quiereJson(req)) return res.json(d)
        res.render('cajas/aprobaciones', { titulo: 'Aprobaciones', ...d, errores: errorDe(req) })
    } catch (e) { next(e) }
}
const resolver = aprobar => async (req, res, next) => {
    try {
        const r = await cajas.resolverExtra(req.params.id, aprobar, req.body, req.usuario)
        if (quiereJson(req)) return res.json(r)
        res.redirect(`/cajas/aprobaciones?ok=${aprobar ? 'salida-aprobada' : 'salida-rechazada'}`)
    } catch (e) {
        if (!(e instanceof ErrorNegocio)) return next(e)
        if (quiereJson(req)) return res.status(e.status).json({ error: e.message })
        res.redirect(`/cajas/aprobaciones?error=${encodeURIComponent(e.message)}`)
    }
}
exports.aprobarExtra = resolver(true)
exports.rechazarExtra = resolver(false)

// US-72 y US-73: consolidado mensual y verificación de medios
exports.consolidado = async (req, res, next) => {
    try {
        const d = await cajas.consolidado(req.query.mes)
        if (quiereJson(req)) return res.json(d)
        res.render('cajas/consolidado', { titulo: 'Consolidado mensual', ...d, TIPOS: cajas.TIPOS, errores: [] })
    } catch (e) { next(e) }
}

// US-76: gráficas del negocio
exports.graficas = async (req, res, next) => {
    try {
        const d = await cajas.graficas(req.query)
        if (quiereJson(req)) return res.json(d)
        res.render('cajas/graficas', { titulo: 'Gráficas del negocio', ...d, errores: [] })
    } catch (e) { next(e) }
}

// US-78: agenda de rentas y catálogos de todos los servicios
exports.agenda = async (req, res, next) => {
    try {
        const d = await cajas.agenda(req.query)
        if (quiereJson(req)) return res.json(d)
        res.render('cajas/agenda', { titulo: 'Agenda de rentas', ...d, errores: [] })
    } catch (e) { next(e) }
}

// ====================== Sprint 13 ======================

// Horario semanal por día y cambios forzosos para una fecha
exports.horario = async (req, res, next) => {
    try {
        const d = await horario.cuadricula()
        if (quiereJson(req)) return res.json(d)
        res.render('cajas/horario', { titulo: 'Horario de cajas', ...d, errores: errorDe(req) })
    } catch (e) { next(e) }
}

exports.guardarHorario = async (req, res, next) => {
    try {
        const asignaciones = Object.entries(req.body || {})
            .filter(([k, v]) => k.startsWith('asig_') && v)
            .map(([k, v]) => { const [, dia, cajaId] = k.split('_'); return { dia, caja_id: cajaId, usuario_id: v } })
        const r = await horario.guardarSemana(asignaciones)
        if (quiereJson(req)) return res.status(201).json(r)
        res.redirect('/cajas/horario?ok=horario-guardado')
    } catch (e) { next(e) }
}

exports.forzarHorario = async (req, res, next) => {
    try {
        const r = await horario.forzar(req.body, req.usuario)
        if (quiereJson(req)) return res.status(201).json(r)
        res.redirect('/cajas/horario?ok=cambio-forzado')
    } catch (e) {
        if (!(e instanceof ErrorNegocio)) return next(e)
        if (quiereJson(req)) return res.status(e.status).json({ error: e.message })
        res.redirect(`/cajas/horario?error=${encodeURIComponent(e.message)}`)
    }
}

exports.quitarExcepcion = async (req, res, next) => {
    try {
        const r = await horario.quitarExcepcion(req.params.id, req.usuario)
        if (quiereJson(req)) return res.json(r)
        res.redirect('/cajas/horario?ok=cambio-quitado')
    } catch (e) { fallo(req, res, next, e) }
}

// Bitácora del administrador: cierres forzados y reasignaciones
exports.bitacora = async (req, res, next) => {
    try {
        const filas = await horario.bitacora()
        if (quiereJson(req)) return res.json({ filas })
        res.render('cajas/bitacora', { titulo: 'Bitácora del administrador', filas, errores: [] })
    } catch (e) { next(e) }
}
