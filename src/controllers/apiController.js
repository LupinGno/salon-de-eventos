// API JSON que usará la caja 
const conexion = require('../database/db')
const menu = require('./menuService')
const { entero, lista } = require('./formatos')

// Solo lo que se puede vender hoy
exports.menu = async (req, res, next) => {
    try {
        const productos = (await menu.menuCompleto()).filter(p => p.vendible)
        res.json(productos.map(p => ({
            id: p.id, nombre: p.nombre, categoria: p.categoria, imagen: p.imagen,
            precio_base: p.precio_base, precio_desde: p.precio_desde, piezas_por_orden: p.piezas_por_orden,
            va_a_cocina: Boolean(p.requiere_preparacion), permite_quitar: Boolean(p.permite_quitar),
            fijos: p.fijos, moviles: p.moviles, extras: p.extras, tamanos: p.tamanos,
            estilos: p.estilos.filter(e => e.disponible).map(e => ({ id: e.id, nombre: e.nombre, precio_extra: e.precio_extra, imagen: e.imagen }))
        })))
    } catch (e) { next(e) }
}

// la caja lee las mesas activas en cada pedido, sin reiniciar nada
exports.mesas = async (req, res, next) => {
    try {
        const [mesas] = await conexion.query('SELECT id, numero, capacidad FROM mesas WHERE activo = 1 ORDER BY numero')
        res.json(mesas)
    } catch (e) { next(e) }
}

// Detalle de un producto aunque no esté a la venta 
exports.producto = async (req, res, next) => {
    try {
        const id = entero(req.params.id, 1)
        const p = id && await menu.detalleProducto(id)
        if (!p) return res.status(404).json({ error: 'El producto no existe' })
        res.json({
            id: p.id, nombre: p.nombre, vendible: p.vendible, motivo: p.motivo,
            permite_quitar: Boolean(p.permite_quitar), fijos: p.fijos, moviles: p.moviles, extras: p.extras,
            tamanos: p.tamanos, estilos: p.estilos.map(e => ({ id: e.id, nombre: e.nombre, precio_extra: e.precio_extra, disponible: e.disponible }))
        })
    } catch (e) { next(e) }
}

//valida un artículo y calcula su precio; rechaza lo inactivo aunque se mande a mano
exports.cotizar = async (req, res, next) => {
    try {
        const b = req.body || {}
        const resultado = await menu.cotizar({
            producto_id: b.producto_id, estilo_id: b.estilo_id, tamano_id: b.tamano_id,
            quitar: lista(b.quitar), extras: lista(b.extras)
        })
        res.json(resultado)
    } catch (e) {
        if (e instanceof menu.ErrorNegocio) return res.status(e.status).json({ error: e.message })
        next(e)
    }
}
