// Reglas del menú 
const conexion = require('../database/db')

class ErrorNegocio extends Error {
    constructor(mensaje, status = 409) {
        super(mensaje)
        this.status = status
    }
}

const SQL_PRODUCTO = `
    SELECT p.*, c.nombre AS categoria, c.permite_quitar, c.orden AS categoria_orden,
           i.archivo AS imagen,
           t.nombre AS temporada, t.fecha_inicio, t.fecha_fin, t.activo AS temporada_activa,
           -- La hora SIEMPRE se toma del reloj de la base de datos (el mismo que usa el proceso de vigencias)
           (p.vigente_hasta IS NOT NULL AND p.vigente_hasta <= NOW()) AS vencido,
           DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoy
      FROM productos p
      JOIN categorias c ON c.id = p.categoria_id
      LEFT JOIN imagenes i ON i.id = p.imagen_id
      LEFT JOIN temporadas t ON t.id = p.temporada_id`

// lo que se puede vender, con sus ingredientes, extras, tamaños y estilos
function estadoProducto(p) {
    const hoy = p.hoy
    if (!p.activo) {
        return { vendible: false, motivo: p.motivo_inactivo === 'vigencia' ? 'Se acabó su vigencia' : 'Dado de baja' }
    }
    if (p.vencido) return { vendible: false, motivo: 'Se acabó su vigencia' }
    if (p.temporada_id) {
        if (!p.temporada_activa) return { vendible: false, motivo: `Temporada ${p.temporada} suspendida` }
        if (hoy < p.fecha_inicio) return { vendible: false, motivo: `Temporada ${p.temporada}: empieza el ${p.fecha_inicio}` }
        if (hoy > p.fecha_fin) return { vendible: false, motivo: `Temporada ${p.temporada}: terminó el ${p.fecha_fin}` }
    }
    return { vendible: true, motivo: null }
}

// estilo disponible hoy
function estiloDisponible(e, hoy) {
    if (!e.activo) return false
    if (e.temporada_id && (!e.temporada_activa || hoy < e.fecha_inicio || hoy > e.fecha_fin)) return false
    return true
}

async function detalleProducto(id) {
    const [[producto]] = await conexion.query(`${SQL_PRODUCTO} WHERE p.id = ?`, [id])
    if (!producto) return null

    // cantidad de cada ingrediente que se gasta por unidad del producto, y si hay suficiente stock
    const [ingredientes] = await conexion.query(
        `SELECT pi.ingrediente_id AS id, i.nombre, pi.tipo, pi.cantidad, i.unidad, i.stock
           FROM producto_ingredientes pi JOIN ingredientes i ON i.id = pi.ingrediente_id
          WHERE pi.producto_id = ? ORDER BY pi.tipo, i.nombre`, [id])
    const [extras] = await conexion.query(
        `SELECT pe.ingrediente_id AS id, i.nombre, pe.precio, pe.cantidad, i.unidad, i.stock
           FROM producto_extras pe JOIN ingredientes i ON i.id = pe.ingrediente_id
          WHERE pe.producto_id = ? ORDER BY i.nombre`, [id])
    const [estilos] = await conexion.query(
        `SELECT e.*, im.archivo AS imagen, t.nombre AS temporada, t.fecha_inicio, t.fecha_fin, t.activo AS temporada_activa
           FROM estilos e
           LEFT JOIN imagenes im ON im.id = e.imagen_id
           LEFT JOIN temporadas t ON t.id = e.temporada_id
          WHERE e.producto_id = ? ORDER BY e.id`, [id])
    const [tamanos] = await conexion.query(
        'SELECT * FROM tamanos WHERE producto_id = ? ORDER BY orden, precio', [id])

    estilos.forEach(e => { e.disponible = estiloDisponible(e, producto.hoy) })

    // minimo para vender el producto mas chico
    const factorMinimo = tamanos.length ? Math.min(...tamanos.map(t => Number(t.factor_receta) || 1)) : 1
    const alcanza = (i, factor) => i.stock === null || Number(i.stock) + 0.001 >= Number(i.cantidad) * factor
    ingredientes.forEach(i => { i.agotado = !alcanza(i, factorMinimo) })
    extras.forEach(x => { x.agotado = !alcanza(x, 1) })
    const sinFijo = ingredientes.filter(i => i.tipo === 'fijo' && i.agotado).map(i => i.nombre)

    let estado = estadoProducto(producto)
    if (estado.vendible && sinFijo.length) estado = { vendible: false, motivo: `Agotado: no hay ${sinFijo.join(', ')}`, agotado: true }

    return {
        ...producto,
        ...estado,
        fijos: ingredientes.filter(i => i.tipo === 'fijo'),
        moviles: ingredientes.filter(i => i.tipo === 'movil'),
        extras, estilos, tamanos,
        precio_desde: tamanos.length ? Math.min(...tamanos.map(t => t.precio)) : producto.precio_base
    }
}

// cuanto gasta una unidad de cada ingrediente 
function consumoDeUnidad(p, tamano, quitar, extras) {
    const factor = tamano ? Number(tamano.factor_receta) || 1 : 1
    const consumo = new Map()
    const sumar = (i, cantidad) => consumo.set(i.id, { ingrediente_id: i.id, nombre: i.nombre,
        cantidad: Math.round(((consumo.get(i.id)?.cantidad || 0) + cantidad) * 100) / 100 })
    for (const i of [...p.fijos, ...p.moviles]) if (!quitar.includes(i.id)) sumar(i, Number(i.cantidad) * factor)
    for (const x of p.extras) if (extras.includes(x.id)) sumar(x, Number(x.cantidad))
    return [...consumo.values()]
}

// Menú completo 
async function menuCompleto() {
    const [productos] = await conexion.query(`${SQL_PRODUCTO} ORDER BY c.orden, p.nombre`)
    const detalles = []
    for (const p of productos) detalles.push(await detalleProducto(p.id))
    return detalles
}

// valida un artículo como lo mandaría la caja y calcula su precio.
async function cotizar(item) {
    const id = Number(item.producto_id)
    if (!Number.isInteger(id) || id <= 0) throw new ErrorNegocio('Falta el producto.', 422)

    const p = await detalleProducto(id)
    if (!p) throw new ErrorNegocio('El producto no existe.', 404)
    if (!p.vendible) throw new ErrorNegocio(`"${p.nombre}" no se puede vender: ${p.motivo}.`, 409)

    const desglose = []
    const modificaciones = []   
    let precio, tamanoElegido = null, estiloElegido = null

    // Tamaño
    if (p.tamanos.length) {
        const tamano = p.tamanos.find(t => t.id === Number(item.tamano_id))
        if (!tamano) throw new ErrorNegocio(`Elige un tamaño válido para "${p.nombre}".`, 422)
        tamanoElegido = tamano
        precio = tamano.precio
        desglose.push({ concepto: `${p.nombre} ${tamano.nombre}`, importe: tamano.precio })
    } else {
        precio = p.precio_base
        desglose.push({ concepto: p.nombre, importe: p.precio_base })
    }

    // Estilo
    const estilosDisponibles = p.estilos.filter(e => e.disponible)
    if (p.estilos.length) {
        const estilo = p.estilos.find(e => e.id === Number(item.estilo_id))
        if (!estilo) throw new ErrorNegocio(`Elige un estilo para "${p.nombre}".`, 422)
        if (!estilo.disponible) throw new ErrorNegocio(`El estilo "${estilo.nombre}" no está disponible hoy.`, 409)
        estiloElegido = estilo
        if (estilo.precio_extra > 0) {
            precio += estilo.precio_extra
            desglose.push({ concepto: `Estilo ${estilo.nombre}`, importe: estilo.precio_extra })
        } else {
            desglose.push({ concepto: `Estilo ${estilo.nombre}`, importe: 0 })
        }
    }

    // Quitar ingredientes
    const quitar = [...new Set((item.quitar || []).map(Number))]
    for (const ingId of quitar) {
        if (!p.permite_quitar) throw new ErrorNegocio(`En ${p.categoria} no se pueden quitar ingredientes.`, 422)
        const fijo = p.fijos.find(f => f.id === ingId)
        if (fijo) throw new ErrorNegocio(`"${fijo.nombre}" es ingrediente fijo de ${p.nombre}; no se puede quitar.`, 422)
        const movil = p.moviles.find(m => m.id === ingId)
        if (!movil) throw new ErrorNegocio(`Ese ingrediente no forma parte de ${p.nombre}.`, 422)
        desglose.push({ concepto: `Sin ${movil.nombre}`, importe: 0 })
        modificaciones.push({ ingrediente_id: movil.id, tipo: 'quitar', nombre: movil.nombre, precio: 0 })
    }

    // Extras
    const extras = [...new Set((item.extras || []).map(Number))]
    for (const ingId of extras) {
        const extra = p.extras.find(e => e.id === ingId)
        if (!extra) throw new ErrorNegocio(`Ese extra no está disponible para ${p.nombre}.`, 422)
        if (extra.agotado) throw new ErrorNegocio(`Ya no hay ${extra.nombre} para agregar como extra.`, 409)
        precio += extra.precio
        desglose.push({ concepto: `Extra ${extra.nombre}`, importe: extra.precio })
        modificaciones.push({ ingrediente_id: extra.id, tipo: 'extra', nombre: extra.nombre, precio: extra.precio })
    }

    // Nombre como se vende
    const descripcion = [p.nombre + (tamanoElegido ? ` ${tamanoElegido.nombre}` : ''), estiloElegido && estiloElegido.nombre]
        .filter(Boolean).join(' · ')

    return {
        producto_id: p.id,
        estilo_id: estiloElegido ? estiloElegido.id : null,
        tamano_id: tamanoElegido ? tamanoElegido.id : null,
        descripcion,
        modificaciones,
        consumo: consumoDeUnidad(p, tamanoElegido, quitar, extras),   // Sprint 7: lo que se descuenta del inventario
        producto: p.nombre,
        piezas: p.piezas_por_orden,
        va_a_cocina: Boolean(p.requiere_preparacion),
        precio: Math.round(precio * 100) / 100,
        desglose,
        estilos_disponibles: estilosDisponibles.length
    }
}

module.exports = { ErrorNegocio, estadoProducto, detalleProducto, menuCompleto, cotizar }
