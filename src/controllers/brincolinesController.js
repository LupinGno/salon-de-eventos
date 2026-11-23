//Pantallas de renta de brincolines 
const brincolines = require('./brincolinesService')
const { ErrorNegocio } = require('./menuService')
const salones = require('./salonesService')

const quiereJson = req => req.accepts(['html', 'json']) === 'json'
const FILTROS = { proximas: 'Próximas', hoy: 'Hoy', por_recoger: 'Por recoger', atencion: 'Fallas por resolver', terminadas: 'Terminadas', todas: 'Todas' }

//catálogo de disponibles por fecha
exports.catalogo = async (req, res, next) => {
    try {
        const hoy = await salones.hoyBD()
        const manana = salones.sumarDias(hoy, 1)
        const q = { fecha: req.query.fecha || manana }
        let resultado = null, errores = []
        try {
            resultado = await brincolines.catalogoPorFecha(q.fecha)
        } catch (e) {
            if (!(e instanceof ErrorNegocio)) throw e
            errores = [e.message]
        }
        if (quiereJson(req)) return errores.length ? res.status(422).json({ error: errores[0] }) : res.json(resultado)
        res.render('brincolines/catalogo', { titulo: 'Renta de brincolines', q, manana, resultado, errores, margen: brincolines.MARGEN_ESPACIO })
    } catch (e) { next(e) }
}

// Formulario de renta
exports.formulario = async (req, res, next) => {
    try {
        let cat
        try {
            cat = await brincolines.catalogoPorFecha(req.query.fecha)
        } catch (e) {
            if (e instanceof ErrorNegocio) return res.redirect('/brincolines')
            throw e
        }
        const b = cat.brincolines.find(x => x.id === Number(req.query.brincolin_id))
        if (!b || !b.disponible) return res.redirect(`/brincolines?fecha=${encodeURIComponent(cat.fecha)}`)
        const terminos = brincolines.terminos({
            ...brincolines.datosTerminos({ largo_m: b.largo, ancho_m: b.ancho, alto_m: b.alto, garantia: b.garantia }, cat.fecha, 'quien paga la renta')
        })
        res.render('brincolines/rentar', { titulo: `Rentar ${b.nombre}`, b, cat, terminos, fechaLarga: brincolines.fechaLarga })
    } catch (e) { next(e) }
}

exports.crear = async (req, res, next) => {
    try {
        const r = await brincolines.crearRenta(req.body, req.usuario)
        res.status(201).json({ ...r, url: `/brincolines/rentas/${r.id}?ok=renta-creada` })
    } catch (e) {
        if (e instanceof ErrorNegocio) return res.status(e.status).json({ error: e.message, errores: e.errores || [e.message] })
        next(e)
    }
}

exports.lista = async (req, res, next) => {
    try {
        const filtro = FILTROS[req.query.filtro] ? req.query.filtro : 'proximas'
        const filas = await brincolines.listaRentas(filtro)
        if (quiereJson(req)) return res.json(filas)
        res.render('brincolines/rentas', { titulo: 'Rentas de brincolines', filas, filtro, FILTROS })
    } catch (e) { next(e) }
}

exports.detalle = async (req, res, next) => {
    try {
        const r = await brincolines.detalleRenta(Number(req.params.id) || 0)
        if (!r) {
            if (quiereJson(req)) return res.status(404).json({ error: 'Esa renta no existe.' })
            return res.redirect('/brincolines/rentas')
        }
        const extra = await extrasDetalle(r)
        if (quiereJson(req)) return res.json({ ...r, extra })
        const errores = req.query.error ? [String(req.query.error).slice(0, 200)] : []
        res.render('brincolines/detalle', { titulo: `Renta ${r.folio}`, r, errores, extra })
    } catch (e) { next(e) }
}

// Incidencias, sugerencias y qué cambios se pueden hacer
const extrasDetalle = r => brincolines.extrasDetalle(r)

//JSON para las pruebas
const accion = (fn, ok) => async (req, res, next) => {
    const id = Number(req.params.id) || 0
    try {
        const resultado = await fn(id, req.body, req.usuario)
        if (quiereJson(req)) return res.json(resultado)
        res.redirect(`/brincolines/rentas/${id}?ok=${ok}`)
    } catch (e) {
        if (!(e instanceof ErrorNegocio)) return next(e)
        if (quiereJson(req)) return res.status(e.status).json({ error: e.message })
        res.redirect(`/brincolines/rentas/${id}?error=${encodeURIComponent(e.message)}`)
    }
}
exports.instalar = accion((id, b, u) => brincolines.instalar(id, b, u), 'brincolin-instalado')
exports.noInstalar = accion((id, b, u) => brincolines.noInstalar(id, b, u), 'brincolin-no-instalado')
exports.recoger = accion((id, b, u) => brincolines.recoger(id, u), 'brincolin-recogido')
exports.resolver = accion((id, b, u) => brincolines.resolverFalla(id, b, u), 'falla-resuelta')
exports.cambiar = accion((id, b, u) => brincolines.cambiarModelo(id, b, u), 'modelo-cambiado')
exports.cancelar = accion((id, b, u) => brincolines.cancelarCliente(id, b, u), 'renta-cancelada')

//reportar daños, dar de baja y regresar de reparación
exports.equipo = async (req, res, next) => {
    try {
        const filas = await brincolines.equipo()
        if (quiereJson(req)) return res.json(filas)
        const errores = req.query.error ? [String(req.query.error).slice(0, 200)] : []
        res.render('brincolines/equipo', { titulo: 'Equipo de brincolines', filas, errores })
    } catch (e) { next(e) }
}
const accionEquipo = (fn, ok) => async (req, res, next) => {
    try {
        const resultado = await fn(Number(req.params.id) || 0, req.body, req.usuario)
        if (quiereJson(req)) return res.json(resultado)
        res.redirect(`/brincolines/equipo?ok=${resultado.afectadas ? ok + '-rentas' : ok}`)
    } catch (e) {
        if (!(e instanceof ErrorNegocio)) return next(e)
        if (quiereJson(req)) return res.status(e.status).json({ error: e.message })
        res.redirect(`/brincolines/equipo?error=${encodeURIComponent(e.message)}`)
    }
}
exports.reportarDano = accionEquipo((id, b, u) => brincolines.reportarDano(id, b, u), 'dano-reportado')
exports.reparado = accionEquipo((id, b, u) => brincolines.terminarReparacion(id, u), 'reparado')

const enviarPdf = (res, archivo, nombre) => {
    res.set('Content-Type', 'application/pdf')
    res.set('Content-Disposition', `inline; filename="${nombre}"`)
    res.send(archivo)
}

// US-57: contrato firmado
exports.contrato = async (req, res, next) => {
    try {
        const k = await brincolines.contrato(req.params.id)
        if (!k) return res.status(404).render('error', { codigo: 404, titulo: 'Contrato no encontrado', mensaje: 'Esa renta no tiene contrato.' })
        res.set('X-Contrato-SHA256', k.sha256)
        enviarPdf(res, k.pdf, `contrato-${brincolines.folio(Number(req.params.id))}.pdf`)
    } catch (e) { next(e) }
}

exports.comprobante = async (req, res, next) => {
    const id = Number(req.params.id) || 0
    try {
        const c = await brincolines.comprobante(id)
        if (!c) return res.status(404).render('error', { codigo: 404, titulo: 'Renta no encontrada', mensaje: 'Esa renta no existe.' })
        enviarPdf(res, c.pdf, `comprobante-${c.r.folio}.pdf`)
    } catch (e) {
        if (/Python|reportlab/i.test(e.message)) return res.redirect(`/brincolines/rentas/${id}?error=${encodeURIComponent(e.message)}`)
        next(e)
    }
}
