// Catálogo de salones con mobiliario 
const conexion = require('../database/db')
const { texto, entero, decimal } = require('./formatos')
const { imagenDelFormulario, galeria, borrarArchivo } = require('./subidas')

const idValido = v => entero(v, 1)
const conError = (ruta, mensaje) => ruta + (ruta.includes('?') ? '&' : '?') + 'error=' + encodeURIComponent(mensaje)
const errorDe = req => (req.query.error ? [String(req.query.error).slice(0, 300)] : [])
const descartarSubida = req => { if (req.file) borrarArchivo('/uploads/' + req.file.filename) }

const TAMANOS = ['chico', 'mediano', 'grande']
const ESTADOS_BRINCOLIN = {
    disponible: 'Disponible', en_limpieza: 'En limpieza', en_reparacion: 'En reparación', baja: 'Dado de baja'
}
// tamaños
const MAX_BRINCOLINES = { chico: 1, mediano: 1, grande: 2 }

// salones
exports.salones = async (req, res, next) => {
    try {
        const [salones] = await conexion.query(`
            SELECT s.*, i.archivo AS imagen FROM salones s LEFT JOIN imagenes i ON i.id = s.imagen_id
             ORDER BY FIELD(s.tamano, 'chico', 'mediano', 'grande'), s.nombre`)
        const [mobiliario] = await conexion.query(`
            SELECT m.*, (SELECT COUNT(*) FROM salon_mobiliario sm WHERE sm.mobiliario_id = m.id) AS usos
              FROM mobiliario m ORDER BY m.id`)
        const [cantidades] = await conexion.query(`
            SELECT sm.salon_id, sm.cantidad, m.nombre FROM salon_mobiliario sm
              JOIN mobiliario m ON m.id = sm.mobiliario_id WHERE sm.cantidad > 0 ORDER BY m.id`)
        salones.forEach(s => { s.mobiliario = cantidades.filter(c => c.salon_id === s.id) })
        res.render('catalogos/salones/lista', { titulo: 'Salones', salones, mobiliario, errores: errorDe(req) })
    } catch (e) { next(e) }
}

async function datosFormSalon() {
    const [mobiliario] = await conexion.query('SELECT * FROM mobiliario ORDER BY id')
    return { mobiliario, imagenes: await galeria(), TAMANOS, MAX_BRINCOLINES }
}

async function leerSalon(req, id = 0) {
    const b = req.body
    const errores = []
    const datos = {
        nombre: texto(b.nombre),
        tamano: TAMANOS.includes(b.tamano) ? b.tamano : null,
        aforo_maximo: entero(b.aforo_maximo, 1, 1000),
        max_brincolines: entero(b.max_brincolines, 0, 2),
        precio_renta: decimal(b.precio_renta, 0, 999999),
        cuota_garantia: decimal(b.cuota_garantia, 0, 999999),
        descripcion: texto(b.descripcion) || null,
        activo: b.activo ? 1 : 0
    }
    if (!datos.nombre || datos.nombre.length > 80) errores.push('El nombre es obligatorio (máximo 80 caracteres).')
    if (!datos.tamano) errores.push('Elige el tamaño: chico, mediano o grande.')
    if (datos.aforo_maximo === null) errores.push('El aforo máximo debe ser de 1 a 1000 personas.')
    if (datos.max_brincolines === null) errores.push('Los brincolines incluidos deben ser 0, 1 o 2.')
    else if (datos.tamano && datos.max_brincolines > MAX_BRINCOLINES[datos.tamano]) {
        errores.push(`Un salón ${datos.tamano} incluye máximo ${MAX_BRINCOLINES[datos.tamano]} brincolín(es).`)
    }
    if (datos.precio_renta === null) errores.push('El precio de renta debe ser un número de 0 en adelante.')
    if (datos.cuota_garantia === null) errores.push('La cuota de garantía debe ser un número de 0 en adelante.')
    if (datos.descripcion && datos.descripcion.length > 255) errores.push('La descripción es muy larga.')
    if (req.errorSubida) errores.push(req.errorSubida)

    const [mobiliario] = await conexion.query('SELECT id, nombre FROM mobiliario')
    const piezas = []
    for (const m of mobiliario) {
        const v = texto(String(b[`mob_${m.id}`] ?? ''))
        if (v === '') continue
        const cantidad = entero(v, 0, 5000)
        if (cantidad === null) errores.push(`La cantidad de ${m.nombre} debe ser un entero de 0 a 5000.`)
        else piezas.push([m.id, cantidad])
    }
    // Debe haber al menos una silla por persona 
    const sillas = mobiliario.find(m => m.nombre === 'Sillas')
    const nSillas = sillas ? (piezas.find(p => p[0] === sillas.id) || [0, 0])[1] : null
    if (sillas && datos.aforo_maximo && nSillas < datos.aforo_maximo) {
        errores.push(`Para un aforo de ${datos.aforo_maximo} personas se necesitan al menos ${datos.aforo_maximo} sillas.`)
    }
    if (!errores.length) {
        const [dup] = await conexion.query('SELECT id FROM salones WHERE nombre = ? AND id <> ?', [datos.nombre, id])
        if (dup.length) errores.push('Ya existe un salón con ese nombre.')
    }
    return { errores, datos, piezas }
}

exports.formSalon = async (req, res, next) => {
    try {
        const id = req.params.id ? idValido(req.params.id) : null
        let datos = { tamano: 'chico', max_brincolines: 1, activo: 1 }, cantidades = {}
        if (id) {
            const [[s]] = await conexion.query('SELECT * FROM salones WHERE id = ?', [id])
            if (!s) return res.redirect('/catalogos/salones')
            datos = s
            const [filas] = await conexion.query('SELECT * FROM salon_mobiliario WHERE salon_id = ?', [id])
            filas.forEach(f => { cantidades[f.mobiliario_id] = f.cantidad })
        }
        res.render('catalogos/salones/form', {
            titulo: id ? 'Modificar salón' : 'Nuevo salón', modo: id ? 'editar' : 'nuevo',
            datos, cantidades, errores: [], ...(await datosFormSalon())
        })
    } catch (e) { next(e) }
}

exports.guardarSalon = async (req, res, next) => {
    const conn = await conexion.getConnection()
    try {
        const id = req.params.id ? idValido(req.params.id) : null
        if (req.params.id && !id) { descartarSubida(req); return res.redirect('/catalogos/salones') }
        let actual = null
        if (id) {
            ;[[actual]] = await conexion.query('SELECT * FROM salones WHERE id = ?', [id])
            if (!actual) { descartarSubida(req); return res.redirect('/catalogos/salones') }
        }
        const { errores, datos, piezas } = await leerSalon(req, id || 0)
        if (errores.length) {
            descartarSubida(req)
            const cantidades = {}
            Object.keys(req.body).filter(k => k.startsWith('mob_')).forEach(k => { cantidades[k.slice(4)] = req.body[k] })
            return res.status(400).render('catalogos/salones/form', {
                titulo: id ? 'Modificar salón' : 'Nuevo salón', modo: id ? 'editar' : 'nuevo',
                datos: { ...req.body, ...datos, id, imagen_id: req.body.imagen_id }, cantidades, errores, ...(await datosFormSalon())
            })
        }
        datos.imagen_id = (await imagenDelFormulario(req, datos.nombre)) || (actual ? actual.imagen_id : null)

        await conn.beginTransaction()
        let salonId = id
        if (id) await conn.query('UPDATE salones SET ? WHERE id = ?', [datos, id])
        else { const [r] = await conn.query('INSERT INTO salones SET ?', [datos]); salonId = r.insertId }
        await conn.query('DELETE FROM salon_mobiliario WHERE salon_id = ?', [salonId])
        if (piezas.length) {
            await conn.query('INSERT INTO salon_mobiliario (salon_id, mobiliario_id, cantidad) VALUES ?', [piezas.map(p => [salonId, ...p])])
        }
        await conn.commit()
        res.redirect('/catalogos/salones?ok=guardado')
    } catch (e) {
        await conn.rollback().catch(() => {})
        next(e)
    } finally { conn.release() }
}

exports.eliminarSalon = async (req, res, next) => {
    try {
        await conexion.query('DELETE FROM salones WHERE id = ?', [idValido(req.params.id) || 0])
        res.redirect('/catalogos/salones?ok=eliminado')
    } catch (e) {
        if (e.code === 'ER_ROW_IS_REFERENCED_2') return res.redirect(conError('/catalogos/salones', 'Ese salón ya tiene reservas; desactívalo en lugar de eliminarlo.'))
        next(e)
    }
}

// Tipos de mobiliario
exports.guardarMobiliario = async (req, res, next) => {
    try {
        const id = req.params.id ? idValido(req.params.id) : null
        const nombre = texto(req.body.nombre)
        if (!nombre || nombre.length > 60) return res.redirect(conError('/catalogos/salones', 'El mobiliario necesita un nombre (máximo 60 caracteres).'))
        const [dup] = await conexion.query('SELECT id FROM mobiliario WHERE nombre = ? AND id <> ?', [nombre, id || 0])
        if (dup.length) return res.redirect(conError('/catalogos/salones', `Ya existe el mobiliario "${nombre}".`))
        if (id) await conexion.query('UPDATE mobiliario SET nombre = ? WHERE id = ?', [nombre, id])
        else await conexion.query('INSERT INTO mobiliario (nombre) VALUES (?)', [nombre])
        res.redirect('/catalogos/salones?ok=guardado#mobiliario')
    } catch (e) { next(e) }
}

exports.eliminarMobiliario = async (req, res, next) => {
    try {
        await conexion.query('DELETE FROM mobiliario WHERE id = ?', [idValido(req.params.id) || 0])
        res.redirect('/catalogos/salones?ok=eliminado#mobiliario')
    } catch (e) {
        if (e.code === 'ER_ROW_IS_REFERENCED_2') return res.redirect(conError('/catalogos/salones', 'Ese mobiliario está asignado a algún salón; pon su cantidad en 0 o quítalo primero.'))
        next(e)
    }
}

// BRINCOLINES 
exports.brincolines = async (req, res, next) => {
    try {
        const [brincolines] = await conexion.query(`
            SELECT b.*, i.archivo AS imagen FROM brincolines b LEFT JOIN imagenes i ON i.id = b.imagen_id
             ORDER BY b.estado = 'baja', b.nombre`)
        res.render('catalogos/brincolines/lista', { titulo: 'Brincolines', brincolines, ESTADOS_BRINCOLIN, errores: errorDe(req) })
    } catch (e) { next(e) }
}

async function leerBrincolin(req, id = 0) {
    const b = req.body
    const errores = []
    const datos = {
        nombre: texto(b.nombre),
        descripcion: texto(b.descripcion) || null,
        largo_m: decimal(b.largo_m, 0.5, 30),
        ancho_m: decimal(b.ancho_m, 0.5, 30),
        alto_m: decimal(b.alto_m, 0.5, 15),
        precio_dia: decimal(b.precio_dia, 1, 999999),
        garantia: decimal(b.garantia, 0, 999999),
        estado: Object.keys(ESTADOS_BRINCOLIN).includes(b.estado) ? b.estado : null
    }
    if (!datos.nombre || datos.nombre.length > 80) errores.push('El nombre es obligatorio (máximo 80 caracteres).')
    if (datos.largo_m === null || datos.ancho_m === null || datos.alto_m === null) errores.push('Las medidas deben estar en metros (de 0.5 a 30, alto hasta 15).')
    if (datos.precio_dia === null) errores.push('El precio por día debe ser mayor a $0.')
    if (datos.garantia === null) errores.push('La garantía debe ser un número de 0 en adelante.')
    if (!datos.estado) errores.push('Elige un estado válido.')
    if (datos.descripcion && datos.descripcion.length > 255) errores.push('La descripción es muy larga.')
    if (req.errorSubida) errores.push(req.errorSubida)
    if (!errores.length) {
        const [dup] = await conexion.query('SELECT id FROM brincolines WHERE nombre = ? AND id <> ?', [datos.nombre, id])
        if (dup.length) errores.push('Ya existe un brincolín con ese nombre.')
    }
    return { errores, datos }
}

exports.formBrincolin = async (req, res, next) => {
    try {
        const id = req.params.id ? idValido(req.params.id) : null
        let datos = { estado: 'disponible' }
        if (id) {
            const [[b]] = await conexion.query('SELECT * FROM brincolines WHERE id = ?', [id])
            if (!b) return res.redirect('/catalogos/brincolines')
            datos = b
        }
        res.render('catalogos/brincolines/form', {
            titulo: id ? 'Modificar brincolín' : 'Nuevo brincolín', modo: id ? 'editar' : 'nuevo',
            datos, errores: [], imagenes: await galeria(), ESTADOS_BRINCOLIN
        })
    } catch (e) { next(e) }
}

exports.guardarBrincolin = async (req, res, next) => {
    try {
        const id = req.params.id ? idValido(req.params.id) : null
        let actual = null
        if (req.params.id) {
            ;[[actual]] = id ? await conexion.query('SELECT * FROM brincolines WHERE id = ?', [id]) : [[null]]
            if (!actual) { descartarSubida(req); return res.redirect('/catalogos/brincolines') }
        }
        const { errores, datos } = await leerBrincolin(req, id || 0)
        if (errores.length) {
            descartarSubida(req)
            return res.status(400).render('catalogos/brincolines/form', {
                titulo: id ? 'Modificar brincolín' : 'Nuevo brincolín', modo: id ? 'editar' : 'nuevo',
                datos: { ...req.body, ...datos, id }, errores, imagenes: await galeria(), ESTADOS_BRINCOLIN
            })
        }
        datos.imagen_id = (await imagenDelFormulario(req, datos.nombre)) || (actual ? actual.imagen_id : null)
        if (id) await conexion.query('UPDATE brincolines SET ? WHERE id = ?', [datos, id])
        else await conexion.query('INSERT INTO brincolines SET ?', [datos])
        res.redirect('/catalogos/brincolines?ok=guardado')
    } catch (e) { next(e) }
}

exports.cambiarEstadoBrincolin = async (req, res, next) => {
    try {
        const id = idValido(req.params.id)
        const estado = req.body.estado
        if (!id || !Object.keys(ESTADOS_BRINCOLIN).includes(estado)) return res.redirect(conError('/catalogos/brincolines', 'Estado no válido.'))
        await conexion.query('UPDATE brincolines SET estado = ? WHERE id = ?', [estado, id])
        res.redirect('/catalogos/brincolines?ok=guardado')
    } catch (e) { next(e) }
}

exports.eliminarBrincolin = async (req, res, next) => {
    try {
        await conexion.query('DELETE FROM brincolines WHERE id = ?', [idValido(req.params.id) || 0])
        res.redirect('/catalogos/brincolines?ok=eliminado')
    } catch (e) {
        if (e.code === 'ER_ROW_IS_REFERENCED_2') return res.redirect(conError('/catalogos/brincolines', 'Ese brincolín ya tiene rentas; dalo de baja en lugar de eliminarlo.'))
        next(e)
    }
}


// CONSULTAS 

exports.consultas = async (req, res, next) => {
    try {
        const [salones] = await conexion.query(`
            SELECT s.*, i.archivo AS imagen FROM salones s LEFT JOIN imagenes i ON i.id = s.imagen_id
             WHERE s.activo = 1 ORDER BY FIELD(s.tamano, 'chico', 'mediano', 'grande')`)
        const [brincolines] = await conexion.query(`
            SELECT b.*, i.archivo AS imagen FROM brincolines b LEFT JOIN imagenes i ON i.id = b.imagen_id
             WHERE b.estado <> 'baja' ORDER BY b.precio_dia`)
        res.render('consultas', { titulo: 'Consultas', salones, brincolines, ESTADOS_BRINCOLIN })
    } catch (e) { next(e) }
}

exports.ESTADOS_BRINCOLIN = ESTADOS_BRINCOLIN
