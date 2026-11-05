//  Cocina y recepción 
const cocina = require('./cocinaService')
const { ErrorNegocio } = require('./menuService')
const { entero } = require('./formatos')

const ACCIONES = { preparar: 'en_preparacion', lista: 'lista', entregar: 'entregada' }

// Si la pantalla pidió J
function responder(req, res, destino, error) {
    const quiereJson = req.accepts(['html', 'json']) === 'json' || Boolean(req.is('application/json'))
    if (error) {
        if (quiereJson) return res.status(error.status).json({ error: error.message })
        return res.redirect(destino)
    }
    if (quiereJson) return res.json({ ok: true })
    res.redirect(destino)
}

// monitor de cocina parcial
exports.monitor = async (req, res, next) => {
    try {
        const comandas = await cocina.colaCocina()
        if (req.query.parcial) return res.render('cocina/_cola', { comandas, f: res.locals.f })
        res.render('cocina/monitor', { titulo: 'Cocina', comandas })
    } catch (e) { next(e) }
}

//  preparar o marcar lista una unidad
exports.cambiarArticulo = async (req, res, next) => {
    try {
        const nuevo = ACCIONES[req.params.accion]
        if (!nuevo || nuevo === 'entregada') return res.status(404).json({ error: 'Acción no válida' })
        await cocina.cambiarEstado(entero(req.params.id, 1), nuevo)
        responder(req, res, '/cocina')
    } catch (e) {
        if (e instanceof ErrorNegocio) return responder(req, res, '/cocina', e)
        next(e)
    }
}

// toda la comanda lista
exports.comandaLista = async (req, res, next) => {
    try {
        await cocina.cambiarEstadoComanda(entero(req.params.id, 1), 'lista')
        responder(req, res, '/cocina')
    } catch (e) {
        if (e instanceof ErrorNegocio) return responder(req, res, '/cocina', e)
        next(e)
    }
}

// recepción ve lo listo para llevar a la mesa o empacar
exports.entregas = async (req, res, next) => {
    try {
        const comandas = await cocina.paraEntregar()
        if (req.query.parcial) return res.render('caja/_entregas', { comandas, f: res.locals.f })
        res.render('caja/entregas', { titulo: 'Para entregar', comandas })
    } catch (e) { next(e) }
}

//recepción entrega una unidad o toda la comanda
exports.entregarArticulo = async (req, res, next) => {
    try {
        await cocina.cambiarEstado(entero(req.params.id, 1), 'entregada')
        responder(req, res, '/caja/entregas')
    } catch (e) {
        if (e instanceof ErrorNegocio) return responder(req, res, '/caja/entregas', e)
        next(e)
    }
}
exports.entregarComanda = async (req, res, next) => {
    try {
        await cocina.cambiarEstadoComanda(entero(req.params.id, 1), 'entregada')
        responder(req, res, '/caja/entregas')
    } catch (e) {
        if (e instanceof ErrorNegocio) return responder(req, res, '/caja/entregas', e)
        next(e)
    }
}
