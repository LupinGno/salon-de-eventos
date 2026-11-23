//Pantalla de Limpieza 
const limpieza = require('./limpiezaService')
const { ErrorNegocio } = require('./menuService')

const quiereJson = req => req.accepts(['html', 'json']) === 'json'

//Limpieza ve solo su lista de pendientes
exports.pendientes = async (req, res, next) => {
    try {
        const tareas = await limpieza.pendientes()
        if (quiereJson(req)) return res.json(tareas)
        const errores = req.query.error ? [String(req.query.error).slice(0, 200)] : []
        res.render('limpieza/pendientes', { titulo: 'Limpieza', tareas, hechas: await limpieza.revisadasHoy(), errores })
    } catch (e) { next(e) }
}

const accion = (fn, ok) => async (req, res, next) => {
    try {
        const resultado = await fn(Number(req.params.id) || 0, req.body, req.usuario)
        if (quiereJson(req)) return res.json(resultado)
        res.redirect(`/limpieza?ok=${ok}`)
    } catch (e) {
        if (!(e instanceof ErrorNegocio)) return next(e)
        if (quiereJson(req)) return res.status(e.status).json({ error: e.message })
        res.redirect(`/limpieza?error=${encodeURIComponent(e.message)}`)
    }
}
exports.revisarBrincolin = accion(limpieza.revisarBrincolin, 'revisado')
exports.revisarSalon = accion(limpieza.revisarSalon, 'revisado')
