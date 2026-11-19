// pantallas de la reserva completa de salones 
const reservas = require('./reservasService')
const salones = require('./salonesService')
const { ErrorNegocio } = require('./menuService')

const quiereJson = req => req.accepts(['html', 'json']) === 'json'
const FILTROS = { proximas: 'Próximas', hoy: 'Hoy', por_liquidar: 'Por liquidar', terminadas: 'Terminadas', todas: 'Todas' }

// Formulario de reserva
exports.formulario = async (req, res, next) => {
    try {
        const q = req.query
        let disp
        try {
            disp = await salones.disponibilidad({ fecha: q.fecha, personas: q.personas, con_alimentos: q.con_alimentos })
        } catch (e) {
            if (e instanceof ErrorNegocio) return res.redirect('/salones')
            throw e
        }
        const s = disp.salones.find(x => x.id === Number(q.salon_id))
        if (!s || !s.disponible) return res.redirect(`/salones?fecha=${encodeURIComponent(q.fecha)}&personas=${encodeURIComponent(q.personas)}&con_alimentos=${q.con_alimentos === '1' ? 1 : 0}`)
        const c = disp.consulta
        const k = s.cotizacion
        const conAlimentos = c.conAlimentos && c.fecha !== c.hoy       
        res.render('salones/reservar', {
            titulo: `Reservar ${s.nombre}`, s, c, k, conAlimentos,
            alimentosHoy: c.conAlimentos && c.fecha === c.hoy,
            menuEventos: conAlimentos ? await reservas.menuEventos() : [],
            brincolines: await reservas.brincolinesLibres(c.fecha),
            terminos: reservas.terminos({
                aforo: s.aforo, personas: c.personas, con_alimentos: conAlimentos, cuota: k.cuota, cliente: 'quien paga la renta',
                pago_total: k.pago_total, fecha_limite_texto: k.fecha_limite.split('-').reverse().join('/')
            }),
            porMesa: salones.PERSONAS_POR_MESA
        })
    } catch (e) { next(e) }
}

// guardar la reserva y regresar a la lista
exports.crear = async (req, res, next) => {
    try {
        const r = await reservas.crearReserva(req.body, req.usuario)
        res.status(201).json({ ...r, url: `/salones/reservas/${r.id}?ok=reserva-creada` })
    } catch (e) {
        if (e instanceof ErrorNegocio) return res.status(e.status).json({ error: e.message, errores: e.errores || [e.message] })
        next(e)
    }
}

exports.lista = async (req, res, next) => {
    try {
        const filtro = FILTROS[req.query.filtro] ? req.query.filtro : 'proximas'
        const filas = await reservas.listaReservas(filtro)
        if (quiereJson(req)) return res.json(filas)
        res.render('salones/reservas', { titulo: 'Reservas de salones', filas, filtro, FILTROS })
    } catch (e) { next(e) }
}

exports.detalle = async (req, res, next) => {
    try {
        const r = await reservas.detalleReserva(Number(req.params.id) || 0)
        if (!r) {
            if (quiereJson(req)) return res.status(404).json({ error: 'Esa reserva no existe.' })
            return res.redirect('/salones/reservas?ok=no-existe')
        }
        if (quiereJson(req)) return res.json(r)
        const errores = req.query.error ? [String(req.query.error).slice(0, 200)] : []
        res.render('salones/detalle', { titulo: `Reserva ${r.folio}`, r, errores, CONCEPTOS: reservas.CONCEPTOS })
    } catch (e) { next(e) }
}

// Acciones de la reserva: liquidar, cancelar alimentos, entregar, recibir, cobrar daños
const accion = (fn, ok) => async (req, res, next) => {
    const id = Number(req.params.id) || 0
    try {
        const resultado = await fn(id, req.body, req.usuario)
        if (quiereJson(req)) return res.json(resultado)
        res.redirect(`/salones/reservas/${id}?ok=${ok}`)
    } catch (e) {
        if (!(e instanceof ErrorNegocio)) return next(e)
        if (quiereJson(req)) return res.status(e.status).json({ error: e.message })
        res.redirect(`/salones/reservas/${id}?error=${encodeURIComponent(e.message)}`)
    }
}
exports.liquidar = accion((id, b, u) => reservas.liquidar(id, b, u), 'reserva-liquidada')
exports.cancelarAlimentos = accion((id, b, u) => reservas.cancelarAlimentos(id, b.motivo, u), 'alimentos-cancelados')
exports.entregar = accion((id, b, u) => reservas.entregarSalon(id, b, u), 'salon-entregado')
exports.recibir = accion((id, b, u) => reservas.recibirSalon(id, b, u), 'salon-recibido')
exports.cobrarDanos = accion((id, b, u) => reservas.cobrarDanos(id, b, u), 'danos-cobrados')

const enviarPdf = (res, archivo, nombre) => {
    res.set('Content-Type', 'application/pdf')
    res.set('Content-Disposition', `inline; filename="${nombre}"`)
    res.send(archivo)
}

// contrato firmado
exports.contrato = async (req, res, next) => {
    try {
        const k = await reservas.contrato(req.params.id)
        if (!k) return res.status(404).render('error', { codigo: 404, titulo: 'Contrato no encontrado', mensaje: 'Esa reserva no tiene contrato.' })
        res.set('X-Contrato-SHA256', k.sha256)
        enviarPdf(res, k.pdf, `contrato-${reservas.folio(Number(req.params.id))}.pdf`)
    } catch (e) { next(e) }
}

//comprobante con los pagos al día
exports.comprobante = async (req, res, next) => {
    const id = Number(req.params.id) || 0
    try {
        const c = await reservas.comprobante(id)
        if (!c) return res.status(404).render('error', { codigo: 404, titulo: 'Reserva no encontrada', mensaje: 'Esa reserva no existe.' })
        enviarPdf(res, c.pdf, `comprobante-${c.r.folio}.pdf`)
    } catch (e) {
        if (/Python|reportlab/i.test(e.message)) return res.redirect(`/salones/reservas/${id}?error=${encodeURIComponent(e.message)}`)
        next(e)
    }
}
