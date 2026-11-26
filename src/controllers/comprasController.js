// Compras de insumos 
const compras = require('./comprasService')
const { ErrorNegocio } = require('./menuService')

const quiereJson = req => req.accepts(['html', 'json']) === 'json'

exports.lista = async (req, res, next) => {
    try {
        const [ingredientes, historial] = await Promise.all([compras.ingredientesControlados(), compras.historial()])
        if (quiereJson(req)) return res.json({ ingredientes, historial })
        res.render('catalogos/compras', {
            titulo: 'Compras de insumos', ingredientes, historial,
            errores: req.query.error ? [String(req.query.error).slice(0, 200)] : []
        })
    } catch (e) { next(e) }
}

exports.registrar = async (req, res, next) => {
    try {
        const r = await compras.registrar(req.body, req.usuario)
        if (quiereJson(req)) return res.status(201).json(r)
        res.redirect('/catalogos/compras?ok=compra-registrada')
    } catch (e) {
        if (!(e instanceof ErrorNegocio)) return next(e)
        if (quiereJson(req)) return res.status(e.status).json({ error: e.message, errores: e.errores || [e.message] })
        res.redirect(`/catalogos/compras?error=${encodeURIComponent(e.message)}`)
    }
}
