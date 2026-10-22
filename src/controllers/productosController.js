const conexion = require('../database/db')
const menu = require('./menuService')
const { texto, lista, entero, decimal, fechaHora, aInputFechaHora } = require('./formatos')
const { imagenDelFormulario, galeria, borrarArchivo } = require('./subidas')

const idValido = v => entero(v, 1)

// Hora actual según la base de datos 
async function ahoraBD() {
    const [[{ ahora }]] = await conexion.query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS ahora")
    return ahora
}

async function catalogosFormulario() {
    const [categorias] = await conexion.query('SELECT * FROM categorias ORDER BY orden')
    const [temporadas] = await conexion.query('SELECT * FROM temporadas ORDER BY fecha_inicio')
    const [ingredientes] = await conexion.query('SELECT id, nombre FROM ingredientes WHERE activo = 1 ORDER BY nombre')
    return { categorias, temporadas, ingredientes, imagenes: await galeria() }
}

// Si el formulario falla y ya se había subido una imagen, se borra
function descartarSubida(req) {
    if (req.file) borrarArchivo('/uploads/' + req.file.filename)
}

// lista
exports.lista = async (req, res, next) => {
    try {
        const categoriaId = idValido(req.query.categoria)
        const [categorias] = await conexion.query('SELECT * FROM categorias ORDER BY orden')
        let productos = await menu.menuCompleto()
        if (categoriaId) productos = productos.filter(p => p.categoria_id === categoriaId)
        res.render('catalogos/productos/lista', { titulo: 'Recetas', productos, categorias, categoriaId })
    } catch (e) { next(e) }
}

// Leer y validar el formulario de receta
async function leerFormulario(req, idActual = null) {
    const b = req.body
    const errores = []
    const datos = {
        nombre: texto(b.nombre),
        categoria_id: idValido(b.categoria_id),
        descripcion: texto(b.descripcion) || null,
        precio_base: decimal(b.precio_base, 0, 99999),
        piezas_por_orden: texto(b.piezas_por_orden) === '' ? null : entero(b.piezas_por_orden, 1, 200),
        requiere_preparacion: b.requiere_preparacion ? 1 : 0,
        temporada_id: texto(b.temporada_id) === '' ? null : idValido(b.temporada_id),
        vigente_hasta: texto(b.vigente_hasta) === '' ? null : fechaHora(b.vigente_hasta),
        activo: b.activo ? 1 : 0,
        imagen_id: idValido(b.imagen_id)
    }

    if (!datos.nombre) errores.push('El nombre es obligatorio.')
    else if (datos.nombre.length > 80) errores.push('El nombre no puede pasar de 80 caracteres.')
    if (/\b(combo|paquete|promo(ci[oó]n)?|2x1|3x2)\b/i.test(datos.nombre + ' ' + (datos.descripcion || ''))) {
        errores.push('No se permiten combos, paquetes ni promociones: registra cada alimento por separado.')
    }
    if (datos.descripcion && datos.descripcion.length > 255) errores.push('La descripción no puede pasar de 255 caracteres.')
    if (datos.precio_base === null) errores.push('El precio base debe ser un número de 0 en adelante (máximo 2 decimales).')
    if (datos.piezas_por_orden === null && texto(b.piezas_por_orden) !== '') errores.push('Las piezas por orden deben ser un entero de 1 a 200.')
    if (datos.vigente_hasta === null && texto(b.vigente_hasta) !== '') errores.push('La fecha de vigencia no es válida.')
    if (datos.activo && datos.vigente_hasta && datos.vigente_hasta <= await ahoraBD()) {
        errores.push('La vigencia ya pasó: cámbiala a una fecha futura o deja el producto inactivo.')
    }

    const [[categoria]] = datos.categoria_id
        ? await conexion.query('SELECT * FROM categorias WHERE id = ?', [datos.categoria_id]) : [[null]]
    if (!categoria) errores.push('Elige una categoría.')

    if (datos.temporada_id) {
        const [[t]] = await conexion.query('SELECT id FROM temporadas WHERE id = ?', [datos.temporada_id])
        if (!t) errores.push('La temporada elegida no existe.')
    } else if (texto(b.temporada_id) !== '') errores.push('La temporada elegida no existe.')

    // Ingredientes de la receta
    const ingIds = lista(b.ing_id), ingTipos = lista(b.ing_tipo)
    const ingredientes = []
    ingIds.forEach((v, i) => {
        if (texto(v) === '') return
        const id = idValido(v), tipo = ingTipos[i]
        if (!id || !['fijo', 'movil'].includes(tipo)) return errores.push('Hay un ingrediente de la receta con datos inválidos.')
        if (ingredientes.some(x => x.id === id)) return errores.push('Un ingrediente está repetido en la receta.')
        ingredientes.push({ id, tipo })
    })
    // En pizza y alitas no se quitan ingredientes
    if (categoria && !categoria.permite_quitar && ingredientes.some(x => x.tipo === 'movil')) {
        errores.push(`En ${categoria.nombre} no se pueden quitar ingredientes: márcalos todos como fijos.`)
    }

    // Extras con costo
    const extIds = lista(b.ext_id), extPrecios = lista(b.ext_precio)
    const extras = []
    extIds.forEach((v, i) => {
        if (texto(v) === '') return
        const id = idValido(v), precio = decimal(extPrecios[i], 0.5, 9999)
        if (!id) return errores.push('Hay un extra con datos inválidos.')
        if (precio === null) return errores.push('Cada extra debe tener un costo adicional mayor a $0.')
        if (extras.some(x => x.id === id)) return errores.push('Un extra está repetido.')
        extras.push({ id, precio })
    })

    // Que los ingredientes existan
    const todos = [...new Set([...ingredientes, ...extras].map(x => x.id))]
    if (todos.length) {
        const [existen] = await conexion.query('SELECT id FROM ingredientes WHERE id IN (?)', [todos])
        if (existen.length !== todos.length) errores.push('Alguno de los ingredientes ya no existe.')
    }

    if (!errores.length) {
        const [dup] = await conexion.query('SELECT id FROM productos WHERE nombre = ? AND id <> ?', [datos.nombre, idActual || 0])
        if (dup.length) errores.push('Ya existe una receta con ese nombre.')
    }
    if (req.errorSubida) errores.push(req.errorSubida)

    return { errores, datos, ingredientes, extras }
}

async function guardarReceta(conn, productoId, ingredientes, extras) {
    await conn.query('DELETE FROM producto_ingredientes WHERE producto_id = ?', [productoId])
    await conn.query('DELETE FROM producto_extras WHERE producto_id = ?', [productoId])
    if (ingredientes.length) {
        await conn.query('INSERT INTO producto_ingredientes (producto_id, ingrediente_id, tipo) VALUES ?',
            [ingredientes.map(x => [productoId, x.id, x.tipo])])
    }
    if (extras.length) {
        await conn.query('INSERT INTO producto_extras (producto_id, ingrediente_id, precio) VALUES ?',
            [extras.map(x => [productoId, x.id, x.precio])])
    }
}

function renderForm(res, status, extra) {
    return res.status(status).render('catalogos/productos/form', extra)
}

// Alta
exports.formNuevo = async (req, res, next) => {
    try {
        const categoriaId = idValido(req.query.categoria) || 1
        renderForm(res, 200, {
            titulo: 'Nueva receta', modo: 'nuevo', errores: [], ...(await catalogosFormulario()),
            datos: { categoria_id: categoriaId, precio_base: '', activo: 1, requiere_preparacion: 1 },
            receta: [], extrasForm: []
        })
    } catch (e) { next(e) }
}

exports.crear = async (req, res, next) => {
    const conn = await conexion.getConnection()
    try {
        const { errores, datos, ingredientes, extras } = await leerFormulario(req)
        if (errores.length) {
            descartarSubida(req)
            return renderForm(res, 400, {
                titulo: 'Nueva receta', modo: 'nuevo', errores, ...(await catalogosFormulario()),
                datos: { ...req.body, ...datos }, receta: ingredientes, extrasForm: extras
            })
        }
        datos.imagen_id = await imagenDelFormulario(req, datos.nombre)
        datos.motivo_inactivo = datos.activo ? null : 'manual'

        await conn.beginTransaction()
        const [r] = await conn.query('INSERT INTO productos SET ?', [datos])
        await guardarReceta(conn, r.insertId, ingredientes, extras)
        await conn.commit()
        res.redirect(`/catalogos/productos/${r.insertId}?ok=creado`)
    } catch (e) {
        await conn.rollback().catch(() => {})
        next(e)
    } finally { conn.release() }
}


// Detalle (estilos y tamaños) y modificación

exports.detalle = async (req, res, next) => {
    try {
        const id = idValido(req.params.id)
        const producto = id && await menu.detalleProducto(id)
        if (!producto) return res.redirect('/catalogos/productos?ok=no-existe')
        const [temporadas] = await conexion.query('SELECT * FROM temporadas ORDER BY fecha_inicio')
        res.render('catalogos/productos/detalle', {
            titulo: producto.nombre, producto, temporadas, imagenes: await galeria(),
            errores: req.query.error ? [String(req.query.error).slice(0, 200)] : []
        })
    } catch (e) { next(e) }
}

exports.formEditar = async (req, res, next) => {
    try {
        const id = idValido(req.params.id)
        const producto = id && await menu.detalleProducto(id)
        if (!producto) return res.redirect('/catalogos/productos?ok=no-existe')
        renderForm(res, 200, {
            titulo: 'Modificar receta', modo: 'editar', errores: [], ...(await catalogosFormulario()),
            datos: { ...producto, vigente_hasta: aInputFechaHora(producto.vigente_hasta) },
            receta: [...producto.fijos, ...producto.moviles].map(x => ({ id: x.id, tipo: x.tipo })),
            extrasForm: producto.extras.map(x => ({ id: x.id, precio: x.precio }))
        })
    } catch (e) { next(e) }
}

exports.actualizar = async (req, res, next) => {
    const conn = await conexion.getConnection()
    try {
        const id = idValido(req.params.id)
        const [[actual]] = id ? await conexion.query('SELECT * FROM productos WHERE id = ?', [id]) : [[null]]
        if (!actual) { descartarSubida(req); return res.redirect('/catalogos/productos?ok=no-existe') }

        const { errores, datos, ingredientes, extras } = await leerFormulario(req, id)
        if (errores.length) {
            descartarSubida(req)
            return renderForm(res, 400, {
                titulo: 'Modificar receta', modo: 'editar', errores, ...(await catalogosFormulario()),
                datos: { ...req.body, ...datos, id, vigente_hasta: texto(req.body.vigente_hasta) },
                receta: ingredientes, extrasForm: extras
            })
        }
        datos.imagen_id = await imagenDelFormulario(req, datos.nombre)
        datos.motivo_inactivo = datos.activo ? null : (actual.activo ? 'manual' : actual.motivo_inactivo || 'manual')

        await conn.beginTransaction()
        await conn.query('UPDATE productos SET ? WHERE id = ?', [datos, id])
        await guardarReceta(conn, id, ingredientes, extras)
        await conn.commit()
        res.redirect(`/catalogos/productos/${id}?ok=guardado`)
    } catch (e) {
        await conn.rollback().catch(() => {})
        next(e)
    } finally { conn.release() }
}

// Dar de baja / volver a activar
exports.cambiarEstado = async (req, res, next) => {
    try {
        const id = idValido(req.params.id)
        const [[p]] = id ? await conexion.query('SELECT * FROM productos WHERE id = ?', [id]) : [[null]]
        if (!p) return res.redirect('/catalogos/productos?ok=no-existe')
        if (p.activo) {
            await conexion.query("UPDATE productos SET activo = 0, motivo_inactivo = 'manual' WHERE id = ?", [id])
            return res.redirect(`/catalogos/productos?ok=baja`)
        }
        if (p.vigente_hasta && p.vigente_hasta <= await ahoraBD()) {
            return res.redirect(`/catalogos/productos/${id}?error=` + encodeURIComponent('No se puede activar: su vigencia ya pasó. Modifica la receta y pon una vigencia futura o quítala.'))
        }
        await conexion.query('UPDATE productos SET activo = 1, motivo_inactivo = NULL WHERE id = ?', [id])
        res.redirect(`/catalogos/productos?ok=alta`)
    } catch (e) { next(e) }
}

exports.eliminar = async (req, res, next) => {
    try {
        const id = idValido(req.params.id)
        if (!id) return res.redirect('/catalogos/productos?ok=no-existe')
        await conexion.query('DELETE FROM productos WHERE id = ?', [id])
        res.redirect('/catalogos/productos?ok=eliminado')
    } catch (e) {
        if (e.code === 'ER_ROW_IS_REFERENCED_2') return res.redirect('/catalogos/productos?ok=en-uso')
        next(e)
    }
}

// Estilos

async function leerEstilo(req, productoId, idActual = 0) {
    const b = req.body
    const errores = []
    const datos = {
        nombre: texto(b.nombre),
        descripcion: texto(b.descripcion) || null,
        precio_extra: texto(b.precio_extra) === '' ? 0 : decimal(b.precio_extra, 0, 9999),
        temporada_id: texto(b.temporada_id) === '' ? null : idValido(b.temporada_id),
        activo: b.activo ? 1 : 0
    }
    if (!datos.nombre || datos.nombre.length > 60) errores.push('El nombre del estilo es obligatorio (máximo 60 caracteres).')
    if (datos.precio_extra === null) errores.push('El precio extra del estilo debe ser 0 o más.')
    if (datos.descripcion && datos.descripcion.length > 255) errores.push('La descripción del estilo es muy larga.')
    if (req.errorSubida) errores.push(req.errorSubida)
    if (!errores.length) {
        const [dup] = await conexion.query('SELECT id FROM estilos WHERE producto_id = ? AND nombre = ? AND id <> ?',
            [productoId, datos.nombre, idActual])
        if (dup.length) errores.push('Ese producto ya tiene un estilo con ese nombre.')
    }
    return { errores, datos }
}

exports.crearEstilo = async (req, res, next) => {
    try {
        const productoId = idValido(req.params.id)
        const [[p]] = productoId ? await conexion.query('SELECT id, imagen_id FROM productos WHERE id = ?', [productoId]) : [[null]]
        if (!p) { descartarSubida(req); return res.redirect('/catalogos/productos?ok=no-existe') }
        const { errores, datos } = await leerEstilo(req, productoId)
        if (errores.length) {
            descartarSubida(req)
            return res.redirect(`/catalogos/productos/${productoId}?error=` + encodeURIComponent(errores.join(' ')))
        }
        //  si no se elige imagen, el estilo usa la misma imagen base del producto
        datos.imagen_id = (await imagenDelFormulario(req, datos.nombre)) || p.imagen_id
        await conexion.query('INSERT INTO estilos SET ?', [{ ...datos, producto_id: productoId }])
        res.redirect(`/catalogos/productos/${productoId}?ok=estilo#estilos`)
    } catch (e) { next(e) }
}

exports.actualizarEstilo = async (req, res, next) => {
    try {
        const productoId = idValido(req.params.id), estiloId = idValido(req.params.estiloId)
        const [[e]] = estiloId ? await conexion.query('SELECT * FROM estilos WHERE id = ? AND producto_id = ?', [estiloId, productoId]) : [[null]]
        if (!e) { descartarSubida(req); return res.redirect(`/catalogos/productos/${productoId}`) }
        const { errores, datos } = await leerEstilo(req, productoId, estiloId)
        if (errores.length) {
            descartarSubida(req)
            return res.redirect(`/catalogos/productos/${productoId}?error=` + encodeURIComponent(errores.join(' ')))
        }
        datos.imagen_id = (await imagenDelFormulario(req, datos.nombre)) || e.imagen_id
        await conexion.query('UPDATE estilos SET ? WHERE id = ?', [datos, estiloId])
        res.redirect(`/catalogos/productos/${productoId}?ok=estilo#estilos`)
    } catch (err) { next(err) }
}

exports.eliminarEstilo = async (req, res, next) => {
    try {
        const productoId = idValido(req.params.id), estiloId = idValido(req.params.estiloId)
        await conexion.query('DELETE FROM estilos WHERE id = ? AND producto_id = ?', [estiloId || 0, productoId || 0])
        res.redirect(`/catalogos/productos/${productoId}?ok=eliminado#estilos`)
    } catch (e) { next(e) }
}

// Tamaños 

exports.guardarTamano = async (req, res, next) => {
    try {
        const productoId = idValido(req.params.id)
        const tamanoId = req.params.tamanoId ? idValido(req.params.tamanoId) : null
        const nombre = texto(req.body.nombre)
        const precio = decimal(req.body.precio, 0.5, 99999)
        const orden = entero(req.body.orden, 0, 99) ?? 0
        const volver = `/catalogos/productos/${productoId}`
        const [[p]] = productoId ? await conexion.query('SELECT id FROM productos WHERE id = ?', [productoId]) : [[null]]
        if (!p) return res.redirect('/catalogos/productos?ok=no-existe')
        if (!nombre || nombre.length > 40 || precio === null) {
            return res.redirect(volver + '?error=' + encodeURIComponent('El tamaño necesita nombre (máx. 40) y un precio mayor a $0.'))
        }
        const [dup] = await conexion.query('SELECT id FROM tamanos WHERE producto_id = ? AND nombre = ? AND id <> ?', [productoId, nombre, tamanoId || 0])
        if (dup.length) return res.redirect(volver + '?error=' + encodeURIComponent('Ya existe un tamaño con ese nombre.'))
        if (tamanoId) {
            await conexion.query('UPDATE tamanos SET nombre = ?, precio = ?, orden = ? WHERE id = ? AND producto_id = ?', [nombre, precio, orden, tamanoId, productoId])
        } else {
            await conexion.query('INSERT INTO tamanos (producto_id, nombre, precio, orden) VALUES (?, ?, ?, ?)', [productoId, nombre, precio, orden])
        }
        res.redirect(volver + '?ok=tamano#tamanos')
    } catch (e) { next(e) }
}

exports.eliminarTamano = async (req, res, next) => {
    try {
        const productoId = idValido(req.params.id), tamanoId = idValido(req.params.tamanoId)
        await conexion.query('DELETE FROM tamanos WHERE id = ? AND producto_id = ?', [tamanoId || 0, productoId || 0])
        res.redirect(`/catalogos/productos/${productoId}?ok=eliminado#tamanos`)
    } catch (e) { next(e) }
}
