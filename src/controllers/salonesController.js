// Disponibilidad de salones
const salones = require('./salonesService')
const { ErrorNegocio } = require('./menuService')

exports.disponibilidad = async (req, res, next) => {
    try {
        const proximas = await salones.proximasReservas()
        let resultado = null, errores = []
        if (req.query.fecha) {
            try {
                resultado = await salones.disponibilidad(req.query)
            } catch (e) {
                if (!(e instanceof ErrorNegocio)) throw e
                if (req.accepts(['html', 'json']) === 'json') return res.status(e.status).json({ error: e.message })
                errores = [e.message]
            }
        }
        if (req.accepts(['html', 'json']) === 'json') return res.json(resultado || { salones: [] })
        res.render('salones/disponibilidad', {
            titulo: 'Renta de salones', resultado, proximas, errores,
            q: { fecha: req.query.fecha || '', personas: req.query.personas || '', tamano: req.query.tamano || '', con_alimentos: req.query.con_alimentos || '' },
            porMesa: salones.PERSONAS_POR_MESA
        })
    } catch (e) { next(e) }
}
