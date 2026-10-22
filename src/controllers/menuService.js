// Reglas del menú que no dependen de la pantalla 

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

// verifica si un producto se puede vened
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

// Un estilo de temporada solo se ofrece dentro de sus fechas
function estiloDisponible(e, hoy) {
    if (!e.activo) return false
    if (e.temporada_id && (!e.temporada_activa || hoy < e.fecha_inicio || hoy > e.fecha_fin)) return false
    return true
}

async function detalleProducto(id) {
    const [[producto]] = await conexion.query(`${SQL_PRODUCTO} WHERE p.id = ?`, [id])
    if (!producto) return null

    const [ingredientes] = await conexion.query(
        `SELECT pi.ingrediente_id AS id, i.nombre, pi.tipo
           FROM producto_ingredientes pi JOIN ingredientes i ON i.id = pi.ingrediente_id
          WHERE pi.producto_id = ? ORDER BY pi.tipo, i.nombre`, [id])
    const [extras] = await conexion.query(
        `SELECT pe.ingrediente_id AS id, i.nombre, pe.precio
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

    return {
        ...producto,
        ...estadoProducto(producto),
        fijos: ingredientes.filter(i => i.tipo === 'fijo'),
        moviles: ingredientes.filter(i => i.tipo === 'movil'),
        extras, estilos, tamanos,
        precio_desde: tamanos.length ? Math.min(...tamanos.map(t => t.precio)) : producto.precio_base
    }
}

// Menú completo con el estado de cada producto
async function menuCompleto() {
    const [productos] = await conexion.query(`${SQL_PRODUCTO} ORDER BY c.orden, p.nombre`)
    const detalles = []
    for (const p of productos) detalles.push(await detalleProducto(p.id))
    return detalles
}

// validacion y calculo de precio 
async function cotizar(item) {
    const id = Number(item.producto_id)
    if (!Number.isInteger(id) || id <= 0) throw new ErrorNegocio('Falta el producto.', 422)

    const p = await detalleProducto(id)
    if (!p) throw new ErrorNegocio('El producto no existe.', 404)
    if (!p.vendible) throw new ErrorNegocio(`"${p.nombre}" no se puede vender: ${p.motivo}.`, 409)

    const desglose = []
    let precio

    // Tamaño
    if (p.tamanos.length) {
        const tamano = p.tamanos.find(t => t.id === Number(item.tamano_id))
        if (!tamano) throw new ErrorNegocio(`Elige un tamaño válido para "${p.nombre}".`, 422)
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
        if (estilo.precio_extra > 0) {
            precio += estilo.precio_extra
            desglose.push({ concepto: `Estilo ${estilo.nombre}`, importe: estilo.precio_extra })
        } else {
            desglose.push({ concepto: `Estilo ${estilo.nombre}`, importe: 0 })
        }
    }

    // Quitar ingredientes
    const quitar = (item.quitar || []).map(Number)
    for (const ingId of quitar) {
        if (!p.permite_quitar) throw new ErrorNegocio(`En ${p.categoria} no se pueden quitar ingredientes.`, 422)
        const fijo = p.fijos.find(f => f.id === ingId)
        if (fijo) throw new ErrorNegocio(`"${fijo.nombre}" es ingrediente fijo de ${p.nombre}; no se puede quitar.`, 422)
        const movil = p.moviles.find(m => m.id === ingId)
        if (!movil) throw new ErrorNegocio(`Ese ingrediente no forma parte de ${p.nombre}.`, 422)
        desglose.push({ concepto: `Sin ${movil.nombre}`, importe: 0 })
    }

    // Extras
    const extras = (item.extras || []).map(Number)
    for (const ingId of extras) {
        const extra = p.extras.find(e => e.id === ingId)
        if (!extra) throw new ErrorNegocio(`Ese extra no está disponible para ${p.nombre}.`, 422)
        precio += extra.precio
        desglose.push({ concepto: `Extra ${extra.nombre}`, importe: extra.precio })
    }

    return {
        producto: p.nombre,
        piezas: p.piezas_por_orden,
        va_a_cocina: Boolean(p.requiere_preparacion),
        precio: Math.round(precio * 100) / 100,
        desglose,
        estilos_disponibles: estilosDisponibles.length
    }
}

module.exports = { ErrorNegocio, estadoProducto, detalleProducto, menuCompleto, cotizar }
