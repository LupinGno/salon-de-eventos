// Pantallas del inventario de ingredientes
const inventario = require('./inventarioService')
const { ErrorNegocio } = require('./menuService')
const { entero } = require('./formatos')
const idValido = v => entero(v, 1)

const conError = (ruta, mensaje) => ruta + (ruta.includes('?') ? '&' : '?') + 'error=' + encodeURIComponent(mensaje)
const errorDe = req => (req.query.error ? [String(req.query.error).slice(0, 300)] : [])

//tabla con stock, mínimo, estado y lo usado hoy
exports.vista = async (req, res, next) => {
    try {
        const ingredientes = await inventario.inventario()
        const cuenta = { agotado: 0, bajo: 0, ok: 0, libre: 0 }
        ingredientes.forEach(i => { cuenta[i.estado.clave]++ })
        res.render('catalogos/inventario', { titulo: 'Inventario', ingredientes, cuenta, errores: errorDe(req), t: inventario.cantidadTexto })
    } catch (e) { next(e) }
}

//entrada
exports.movimiento = async (req, res, next) => {
    const volver = req.body.volver === 'historial' ? `/catalogos/inventario/${req.params.id}` : '/catalogos/inventario'
    try {
        const r = await inventario.registrarMovimiento(idValido(req.params.id) || 0, req.body, req.usuario.id)
        res.redirect(`${volver}?ok=movimiento&n=${encodeURIComponent(r.nombre)}`)
    } catch (e) {
        if (e instanceof ErrorNegocio) return res.redirect(conError(volver, e.message))
        next(e)
    }
}

//unidad, mínimo y si se controla el stock
exports.configurar = async (req, res, next) => {
    const volver = `/catalogos/inventario/${req.params.id}`
    try {
        await inventario.configurar(idValido(req.params.id) || 0, {
            unidad: req.body.unidad, stock_minimo: req.body.stock_minimo,
            controlar: Boolean(req.body.controlar), stock_inicial: req.body.stock_inicial,
            costo: req.body.costo
        }, req.usuario.id)
        res.redirect(volver + '?ok=guardado')
    } catch (e) {
        if (e instanceof ErrorNegocio) return res.redirect(conError(volver, e.message))
        next(e)
    }
}

// historial de un ingrediente
exports.historial = async (req, res, next) => {
    try {
        const id = idValido(req.params.id)
        const todos = await inventario.inventario()
        const ing = todos.find(i => i.id === id)
        if (!ing) return res.redirect(conError('/catalogos/inventario', 'Ese ingrediente no existe.'))
        const movimientos = await inventario.movimientos(id)
        res.render('catalogos/inventario_historial', { titulo: `Inventario · ${ing.nombre}`, ing, movimientos, errores: errorDe(req), t: inventario.cantidadTexto })
    } catch (e) { next(e) }
}
