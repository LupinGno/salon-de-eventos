const conexion = require('../database/db')
const { verificarToken } = require('../controllers/tokenCifrado')
const { ROLES, CLAVES, modulosPorClaves } = require('./modulos')

const NOMBRE_COOKIE = 'token'

function opcionesCookie() {
    const horas = Number(process.env.COOKIE_HORAS) || 8
    return {
        httpOnly: true,                 // JavaScript del navegador no puede leerla
        sameSite: 'strict',             // no se envía desde otros sitios 
        secure: process.env.NODE_ENV === 'production', 
        maxAge: horas * 60 * 60 * 1000,
        path: '/'
    }
}

// Valores que todas las vistas esperan
function valoresPorDefecto(req, res, next) {
    res.locals.usuario = null
    res.locals.menu = []
    res.locals.alerta = null
    res.locals.rutaActual = req.path
    next()
}

// Páginas privadas para que no se guarden en cache
function noCache(req, res, next) {
    res.set('Cache-Control', 'private, no-cache, no-store, must-revalidate')
    res.set('Pragma', 'no-cache')
    res.set('Expires', '0')
    next()
}

const quiereJson = req => req.originalUrl.startsWith('/api/') || req.accepts(['html', 'json']) === 'json'

function sinSesion(req, res) {
    res.clearCookie(NOMBRE_COOKIE, { path: '/' })
    if (quiereJson(req)) return res.status(401).json({ error: 'Sesión inválida o vencida' })
    return res.redirect('/login')
}

// validacion de token y usuario activo. Si no, al login.
async function autenticado(req, res, next) {
    const token = req.cookies[NOMBRE_COOKIE]
    if (!token) return sinSesion(req, res)

    let datos
    try {
        datos = verificarToken(token)
    } catch (error) {
        return sinSesion(req, res)
    }

    try {
        const [filas] = await conexion.query(
            `SELECT u.id, u.nombre, u.usuario, u.activo, u.rol_id, r.nombre AS rol
               FROM usuarios u JOIN roles r ON r.id = u.rol_id
              WHERE u.id = ?`, [datos.id])

        if (filas.length === 0 || !filas[0].activo) return sinSesion(req, res)
        const usuario = filas[0]

        // Cambio de permisos instantaneo 
        if (usuario.rol === ROLES.ADMIN) {
            usuario.modulos = [...CLAVES]
        } else {
            const [permisos] = await conexion.query('SELECT modulo FROM rol_modulos WHERE rol_id = ?', [usuario.rol_id])
            usuario.modulos = permisos.map(p => p.modulo)
        }

        req.usuario = usuario
        res.locals.usuario = usuario
        res.locals.menu = modulosPorClaves(usuario.modulos)
        next()
    } catch (error) {
        next(error)
    }
}

// restriccion de rutas
function permitirRoles(...roles) {
    return (req, res, next) => {
        if (req.usuario && roles.includes(req.usuario.rol)) return next()
        return prohibido(req, res)
    }
}

//restringe una ruta a quien tenga permiso sobre alguno de esos módulos
function permitirModulo(...claves) {
    return (req, res, next) => {
        if (req.usuario && claves.some(c => req.usuario.modulos.includes(c))) return next()
        return prohibido(req, res)
    }
}

function prohibido(req, res) {
    if (quiereJson(req)) return res.status(403).json({ error: 'No tienes permiso para este módulo' })
    return res.status(403).render('error', {
        codigo: 403,
        titulo: 'Acceso denegado',
        mensaje: 'Tu puesto no tiene permiso para entrar a este módulo.'
    })
}

// No recarga el login si ya existe una sesion activa
function soloInvitados(req, res, next) {
    const token = req.cookies[NOMBRE_COOKIE]
    if (!token) return next()
    try {
        verificarToken(token)
        return res.redirect('/')
    } catch {
        res.clearCookie(NOMBRE_COOKIE, { path: '/' })
        return next()
    }
}

module.exports = {
    NOMBRE_COOKIE, opcionesCookie, valoresPorDefecto, noCache,
    autenticado, permitirRoles, permitirModulo, prohibido, soloInvitados
}
