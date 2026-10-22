//El administrador registra, modifica y elimina usuarios
const bcryptjs = require('bcryptjs')
const conexion = require('../database/db')
const { validarUsuario } = require('./validaciones')
const { ROLES } = require('../routes/modulos')
const { COSTO_BCRYPT } = require('./authController')

const MENSAJES = {
    creado: { titulo: 'Usuario registrado', mensaje: 'El usuario se creó correctamente.', icono: 'success' },
    actualizado: { titulo: 'Cambios guardados', mensaje: 'El usuario se actualizó correctamente.', icono: 'success' },
    eliminado: { titulo: 'Usuario eliminado', mensaje: 'El usuario se eliminó del sistema.', icono: 'success' },
    'no-propio': { titulo: 'No permitido', mensaje: 'No puedes eliminar tu propia cuenta.', icono: 'warning' },
    'ultimo-admin': { titulo: 'No permitido', mensaje: 'Debe quedar al menos un administrador activo.', icono: 'warning' },
    'no-existe': { titulo: 'No encontrado', mensaje: 'Ese usuario no existe.', icono: 'error' }
}

async function obtenerRoles() {
    const [roles] = await conexion.query('SELECT id, nombre, descripcion FROM roles ORDER BY id')
    return roles
}

async function obtenerUsuario(id) {
    const [filas] = await conexion.query(
        `SELECT u.id, u.nombre, u.usuario, u.rol_id, u.activo, r.nombre AS rol
           FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ?`, [id])
    return filas[0]
}

// ¿Cuántos administradores activos quedan sin contar a este usuario?
async function otrosAdminsActivos(idExcluido) {
    const [[{ total }]] = await conexion.query(
        `SELECT COUNT(*) AS total FROM usuarios u JOIN roles r ON r.id = u.rol_id
          WHERE r.nombre = ? AND u.activo = 1 AND u.id <> ?`, [ROLES.ADMIN, idExcluido])
    return total
}

function idValido(valor) {
    const id = Number(valor)
    return Number.isInteger(id) && id > 0 ? id : null
}

exports.lista = async (req, res, next) => {
    try {
        const [usuarios] = await conexion.query(
            `SELECT u.id, u.nombre, u.usuario, u.activo, u.creado_en, r.nombre AS rol
               FROM usuarios u JOIN roles r ON r.id = u.rol_id
              ORDER BY r.id, u.nombre`)
        res.render('usuarios/lista', {
            titulo: 'Usuarios y roles',
            usuarios,
            alerta: MENSAJES[req.query.msg] || null
        })
    } catch (error) { next(error) }
}

exports.formNuevo = async (req, res, next) => {
    try {
        res.render('usuarios/form', {
            titulo: 'Registrar usuario',
            modo: 'nuevo',
            roles: await obtenerRoles(),
            datos: { activo: 1 },
            errores: []
        })
    } catch (error) { next(error) }
}

exports.crear = async (req, res, next) => {
    try {
        const roles = await obtenerRoles()
        const { errores, nombre, usuario, password } = validarUsuario(req.body)
        const rolId = Number(req.body.rol_id)
        const activo = req.body.activo ? 1 : 0

        if (!roles.some(r => r.id === rolId)) errores.push('Selecciona un rol válido.')

        if (!errores.length) {
            const [existe] = await conexion.query('SELECT id FROM usuarios WHERE usuario = ?', [usuario])
            if (existe.length) errores.push('Ese nombre de usuario ya está ocupado.')
        }

        if (errores.length) {
            return res.status(400).render('usuarios/form', {
                titulo: 'Registrar usuario', modo: 'nuevo', roles, errores,
                datos: { nombre, usuario, rol_id: rolId, activo }
            })
        }

        const hash = await bcryptjs.hash(password, COSTO_BCRYPT)
        await conexion.query(
            'INSERT INTO usuarios (nombre, usuario, password, rol_id, activo) VALUES (?, ?, ?, ?, ?)',
            [nombre, usuario, hash, rolId, activo])

        res.redirect('/usuarios?msg=creado')
    } catch (error) { next(error) }
}

exports.formEditar = async (req, res, next) => {
    try {
        const id = idValido(req.params.id)
        const usuario = id && await obtenerUsuario(id)
        if (!usuario) return res.redirect('/usuarios?msg=no-existe')

        res.render('usuarios/form', {
            titulo: 'Modificar usuario',
            modo: 'editar',
            roles: await obtenerRoles(),
            datos: usuario,
            errores: []
        })
    } catch (error) { next(error) }
}

exports.actualizar = async (req, res, next) => {
    try {
        const id = idValido(req.params.id)
        const actual = id && await obtenerUsuario(id)
        if (!actual) return res.redirect('/usuarios?msg=no-existe')

        const roles = await obtenerRoles()
        const { errores, nombre, usuario, password, cambiaPassword } =
            validarUsuario(req.body, { passwordOpcional: true })
        const rolId = Number(req.body.rol_id)
        const activo = req.body.activo ? 1 : 0
        const rolNuevo = roles.find(r => r.id === rolId)

        if (!rolNuevo) errores.push('Selecciona un rol válido.')

        if (!errores.length) {
            const [existe] = await conexion.query(
                'SELECT id FROM usuarios WHERE usuario = ? AND id <> ?', [usuario, id])
            if (existe.length) errores.push('Ese nombre de usuario ya está ocupado.')
        }

        // No dejar el sistema sin administrador activo
        const dejaDeSerAdminActivo = actual.rol === 'Administrador' && actual.activo &&
            (!rolNuevo || rolNuevo.nombre !== 'Administrador' || !activo)
        if (!errores.length && dejaDeSerAdminActivo && await otrosAdminsActivos(id) === 0) {
            errores.push('Debe quedar al menos un administrador activo; no puedes quitarle el rol ni desactivarlo.')
        }

        if (errores.length) {
            return res.status(400).render('usuarios/form', {
                titulo: 'Modificar usuario', modo: 'editar', roles, errores,
                datos: { id, nombre, usuario, rol_id: rolId, activo }
            })
        }

        if (cambiaPassword) {
            const hash = await bcryptjs.hash(password, COSTO_BCRYPT)
            await conexion.query(
                'UPDATE usuarios SET nombre = ?, usuario = ?, rol_id = ?, activo = ?, password = ? WHERE id = ?',
                [nombre, usuario, rolId, activo, hash, id])
        } else {
            await conexion.query(
                'UPDATE usuarios SET nombre = ?, usuario = ?, rol_id = ?, activo = ? WHERE id = ?',
                [nombre, usuario, rolId, activo, id])
        }

        res.redirect('/usuarios?msg=actualizado')
    } catch (error) { next(error) }
}

exports.eliminar = async (req, res, next) => {
    try {
        const id = idValido(req.params.id)
        const actual = id && await obtenerUsuario(id)
        if (!actual) return res.redirect('/usuarios?msg=no-existe')

        if (actual.id === req.usuario.id) return res.redirect('/usuarios?msg=no-propio')

        if (actual.rol === 'Administrador' && actual.activo && await otrosAdminsActivos(id) === 0) {
            return res.redirect('/usuarios?msg=ultimo-admin')
        }

        await conexion.query('DELETE FROM usuarios WHERE id = ?', [id])
        res.redirect('/usuarios?msg=eliminado')
    } catch (error) { next(error) }
}
