// Catálogos generales
const conexion = require('../database/db')
const menu = require('./menuService')
const { MODULOS, ROLES } = require('../routes/modulos')
const { texto, lista, entero, fecha } = require('./formatos')
const { registrarImagen, borrarArchivo } = require('./subidas')

const idValido = v => entero(v, 1)
const conError = (ruta, mensaje) => ruta + (ruta.includes('?') ? '&' : '?') + 'error=' + encodeURIComponent(mensaje)
const errorDe = req => (req.query.error ? [String(req.query.error).slice(0, 300)] : [])

// inicio de la sección de catálogos
exports.inicio = async (req, res, next) => {
    try {
        const [[c]] = await conexion.query(`SELECT
            (SELECT COUNT(*) FROM productos) AS productos,
            (SELECT COUNT(*) FROM productos WHERE activo = 1) AS productos_activos,
            (SELECT COUNT(*) FROM ingredientes) AS ingredientes,
            (SELECT COUNT(*) FROM temporadas) AS temporadas,
            (SELECT COUNT(*) FROM mesas WHERE activo = 1) AS mesas,
            (SELECT COUNT(*) FROM salones) AS salones,
            (SELECT COUNT(*) FROM brincolines WHERE estado <> 'baja') AS brincolines,
            (SELECT COUNT(*) FROM imagenes) AS imagenes`)
        res.render('catalogos/index', { titulo: 'Administración y catálogos', c })
    } catch (e) { next(e) }
}

// ingredientes 
exports.ingredientes = async (req, res, next) => {
    try {
        const [ingredientes] = await conexion.query(`
            SELECT i.*,
                   (SELECT COUNT(*) FROM producto_ingredientes pi WHERE pi.ingrediente_id = i.id) AS en_recetas,
                   (SELECT COUNT(*) FROM producto_extras pe WHERE pe.ingrediente_id = i.id) AS como_extra
              FROM ingredientes i ORDER BY i.nombre`)
        res.render('catalogos/ingredientes', { titulo: 'Ingredientes', ingredientes, errores: errorDe(req) })
    } catch (e) { next(e) }
}

exports.guardarIngrediente = async (req, res, next) => {
    try {
        const id = req.params.id ? idValido(req.params.id) : null
        const nombre = texto(req.body.nombre)
        const activo = req.body.activo === undefined && !id ? 1 : (req.body.activo ? 1 : 0)
        if (!nombre || nombre.length > 60) return res.redirect(conError('/catalogos/ingredientes', 'El nombre es obligatorio (máximo 60 caracteres).'))
        const [dup] = await conexion.query('SELECT id FROM ingredientes WHERE nombre = ? AND id <> ?', [nombre, id || 0])
        if (dup.length) return res.redirect(conError('/catalogos/ingredientes', `Ya existe el ingrediente "${nombre}".`))
        if (id) await conexion.query('UPDATE ingredientes SET nombre = ?, activo = ? WHERE id = ?', [nombre, activo, id])
        else await conexion.query('INSERT INTO ingredientes (nombre) VALUES (?)', [nombre])
        res.redirect('/catalogos/ingredientes?ok=guardado')
    } catch (e) { next(e) }
}

exports.eliminarIngrediente = async (req, res, next) => {
    try {
        await conexion.query('DELETE FROM ingredientes WHERE id = ?', [idValido(req.params.id) || 0])
        res.redirect('/catalogos/ingredientes?ok=eliminado')
    } catch (e) {
        if (e.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.redirect(conError('/catalogos/ingredientes', 'Ese ingrediente se usa en alguna receta o como extra; quítalo de ahí primero o desactívalo.'))
        }
        next(e)
    }
}

//temporadas
function estadoTemporada(t, hoy) {
    if (!t.activo) return { texto: 'Suspendida', clase: 'secondary' }
    if (hoy < t.fecha_inicio) return { texto: 'Próxima', clase: 'info' }
    if (hoy > t.fecha_fin) return { texto: 'Terminada', clase: 'secondary' }
    return { texto: 'En curso', clase: 'success' }
}

exports.temporadas = async (req, res, next) => {
    try {
        const [temporadas] = await conexion.query(`
            SELECT t.*,
                   (SELECT COUNT(*) FROM productos p WHERE p.temporada_id = t.id) AS productos,
                   (SELECT COUNT(*) FROM estilos e WHERE e.temporada_id = t.id) AS estilos
              FROM temporadas t ORDER BY t.fecha_inicio`)
        const [[{ hoy }]] = await conexion.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoy")
        temporadas.forEach(t => { t.estado = estadoTemporada(t, hoy) })
        const editar = idValido(req.query.editar)
        res.render('catalogos/temporadas', {
            titulo: 'Temporadas', temporadas, errores: errorDe(req),
            datos: temporadas.find(t => t.id === editar) || { activo: 1 }
        })
    } catch (e) { next(e) }
}

exports.guardarTemporada = async (req, res, next) => {
    try {
        const id = req.params.id ? idValido(req.params.id) : null
        const nombre = texto(req.body.nombre)
        const inicio = fecha(req.body.fecha_inicio), fin = fecha(req.body.fecha_fin)
        const activo = req.body.activo ? 1 : 0
        const volver = id ? `/catalogos/temporadas?editar=${id}` : '/catalogos/temporadas'
        const errores = []
        if (!nombre || nombre.length > 60) errores.push('El nombre es obligatorio (máximo 60 caracteres).')
        if (!inicio || !fin) errores.push('Las fechas de inicio y fin son obligatorias.')
        else if (fin < inicio) errores.push('La fecha de fin no puede ser antes del inicio.')
        if (!errores.length) {
            const [dup] = await conexion.query('SELECT id FROM temporadas WHERE nombre = ? AND id <> ?', [nombre, id || 0])
            if (dup.length) errores.push('Ya existe una temporada con ese nombre.')
        }
        if (errores.length) return res.redirect(conError(volver, errores.join(' ')))
        if (id) await conexion.query('UPDATE temporadas SET nombre = ?, fecha_inicio = ?, fecha_fin = ?, activo = ? WHERE id = ?', [nombre, inicio, fin, activo, id])
        else await conexion.query('INSERT INTO temporadas (nombre, fecha_inicio, fecha_fin, activo) VALUES (?, ?, ?, ?)', [nombre, inicio, fin, activo])
        res.redirect('/catalogos/temporadas?ok=guardado')
    } catch (e) { next(e) }
}

exports.eliminarTemporada = async (req, res, next) => {
    try {
        const id = idValido(req.params.id) || 0
        const [[uso]] = await conexion.query(`SELECT
            (SELECT COUNT(*) FROM productos WHERE temporada_id = ?) + (SELECT COUNT(*) FROM estilos WHERE temporada_id = ?) AS total`, [id, id])
        if (uso.total) return res.redirect(conError('/catalogos/temporadas', 'Esa temporada tiene productos o sabores asignados; cámbialos primero o suspéndela.'))
        await conexion.query('DELETE FROM temporadas WHERE id = ?', [id])
        res.redirect('/catalogos/temporadas?ok=eliminado')
    } catch (e) { next(e) }
}

// mesas
const MAX_MESAS = 500

exports.mesas = async (req, res, next) => {
    try {
        const [mesas] = await conexion.query('SELECT * FROM mesas ORDER BY numero')
        res.render('catalogos/mesas', { titulo: 'Mesas', mesas, maxMesas: MAX_MESAS, errores: errorDe(req) })
    } catch (e) { next(e) }
}

exports.agregarMesas = async (req, res, next) => {
    try {
        const cantidad = entero(req.body.cantidad, 1, 50)
        const capacidad = entero(req.body.capacidad, 1, 30)
        if (!cantidad || !capacidad) return res.redirect(conError('/catalogos/mesas', 'Indica cuántas mesas (1 a 50) y su capacidad (1 a 30 personas).'))
        const [[{ total, ultimo }]] = await conexion.query('SELECT COUNT(*) AS total, COALESCE(MAX(numero), 0) AS ultimo FROM mesas')
        if (total + cantidad > MAX_MESAS || ultimo + cantidad > MAX_MESAS) {
            return res.redirect(conError('/catalogos/mesas', `El sistema admite hasta ${MAX_MESAS} mesas.`))
        }
        const filas = Array.from({ length: cantidad }, (_, i) => [ultimo + i + 1, capacidad])
        await conexion.query('INSERT INTO mesas (numero, capacidad) VALUES ?', [filas])
        res.redirect('/catalogos/mesas?ok=mesas')
    } catch (e) { next(e) }
}

exports.actualizarMesa = async (req, res, next) => {
    try {
        const id = idValido(req.params.id)
        const capacidad = entero(req.body.capacidad, 1, 30)
        if (!id || !capacidad) return res.redirect(conError('/catalogos/mesas', 'La capacidad debe ser de 1 a 30 personas.'))
        await conexion.query('UPDATE mesas SET capacidad = ?, activo = ? WHERE id = ?', [capacidad, req.body.activo ? 1 : 0, id])
        res.redirect('/catalogos/mesas?ok=guardado')
    } catch (e) { next(e) }
}

exports.eliminarMesa = async (req, res, next) => {
    try {
        await conexion.query('DELETE FROM mesas WHERE id = ?', [idValido(req.params.id) || 0])
        res.redirect('/catalogos/mesas?ok=eliminado')
    } catch (e) {
        if (e.code === 'ER_ROW_IS_REFERENCED_2') return res.redirect(conError('/catalogos/mesas', 'Esa mesa ya tiene comandas; desactívala en lugar de eliminarla.'))
        next(e)
    }
}

// imagenes
const SQL_USOS = `(SELECT COUNT(*) FROM productos WHERE imagen_id = i.id) + (SELECT COUNT(*) FROM estilos WHERE imagen_id = i.id)
                + (SELECT COUNT(*) FROM salones WHERE imagen_id = i.id) + (SELECT COUNT(*) FROM brincolines WHERE imagen_id = i.id)`

exports.imagenes = async (req, res, next) => {
    try {
        const [imagenes] = await conexion.query(`SELECT i.*, ${SQL_USOS} AS usos FROM imagenes i ORDER BY i.nombre`)
        res.render('catalogos/imagenes', { titulo: 'Imágenes', imagenes, errores: errorDe(req) })
    } catch (e) { next(e) }
}

exports.subirImagen = async (req, res, next) => {
    try {
        if (req.errorSubida) return res.redirect(conError('/catalogos/imagenes', req.errorSubida))
        if (!req.file) return res.redirect(conError('/catalogos/imagenes', 'Elige un archivo de imagen.'))
        const nombre = texto(req.body.nombre)
        if (!nombre || nombre.length > 80) {
            borrarArchivo('/uploads/' + req.file.filename)
            return res.redirect(conError('/catalogos/imagenes', 'Ponle un nombre a la imagen (máximo 80 caracteres).'))
        }
        await registrarImagen(req.file, nombre)
        res.redirect('/catalogos/imagenes?ok=imagen')
    } catch (e) { next(e) }
}

exports.eliminarImagen = async (req, res, next) => {
    try {
        const id = idValido(req.params.id) || 0
        const [[img]] = await conexion.query(`SELECT i.*, ${SQL_USOS} AS usos FROM imagenes i WHERE i.id = ?`, [id])
        if (!img) return res.redirect('/catalogos/imagenes')
        if (img.usos) return res.redirect(conError('/catalogos/imagenes', `"${img.nombre}" se usa en ${img.usos} elemento(s); cámbialos de imagen primero.`))
        await conexion.query('DELETE FROM imagenes WHERE id = ?', [id])
        borrarArchivo(img.archivo)
        res.redirect('/catalogos/imagenes?ok=eliminado')
    } catch (e) { next(e) }
}

// permisos por puesto
exports.permisos = async (req, res, next) => {
    try {
        const [roles] = await conexion.query('SELECT * FROM roles ORDER BY id')
        const [filas] = await conexion.query('SELECT rol_id, modulo FROM rol_modulos')
        const tiene = new Set(filas.map(f => `${f.rol_id}|${f.modulo}`))
        res.render('catalogos/permisos', { titulo: 'Permisos por puesto', roles, modulos: MODULOS, tiene, ROLES })
    } catch (e) { next(e) }
}

exports.guardarPermisos = async (req, res, next) => {
    const conn = await conexion.getConnection()
    try {
        const [roles] = await conn.query('SELECT * FROM roles ORDER BY id')
        const filas = []
        for (const rol of roles) {
            if (rol.nombre === ROLES.ADMIN) {
                MODULOS.forEach(m => filas.push([rol.id, m.clave]))   // el admin siempre conserva todo
                continue
            }
            const elegidos = lista(req.body[`rol_${rol.id}`])
            for (const m of MODULOS) {
                if (m.soloAdmin) continue                              // usuarios: solo administrador
                if (elegidos.includes(m.clave)) filas.push([rol.id, m.clave])
            }
        }
        await conn.beginTransaction()
        await conn.query('DELETE FROM rol_modulos')
        await conn.query('INSERT INTO rol_modulos (rol_id, modulo) VALUES ?', [filas])
        await conn.commit()
        res.redirect('/catalogos/permisos?ok=permisos')
    } catch (e) {
        await conn.rollback().catch(() => {})
        next(e)
    } finally { conn.release() }
}

//vista del menú como cajero
exports.vistaMenu = async (req, res, next) => {
    try {
        const productos = await menu.menuCompleto()
        res.render('catalogos/menu', {
            titulo: 'Vista del menú',
            vendibles: productos.filter(p => p.vendible),
            noVendibles: productos.filter(p => !p.vendible),
            todos: productos
        })
    } catch (e) { next(e) }
}

