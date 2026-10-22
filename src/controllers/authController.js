const bcryptjs = require('bcryptjs')
const conexion = require('../database/db')
const { crearToken } = require('./tokenCifrado')
const { validarUsuario, limpiar } = require('./validaciones')
const { NOMBRE_COOKIE, opcionesCookie } = require('../routes/auth')

const ROL_CLIENTE = 'Cliente'
const COSTO_BCRYPT = 10

// Hash de relleno: si el usuario no existe se compara contra este
const HASH_RELLENO = bcryptjs.hashSync('relleno-no-es-una-contraseña', COSTO_BCRYPT)

// Bloqueo temporal por intentos fallidos de login
const MAX_INTENTOS = 5
const MINUTOS_BLOQUEO = 5
const intentos = new Map()

function claveIntento(req, usuario) {
    return `${req.ip}|${usuario.toLowerCase()}`
}

function estaBloqueado(clave) {
    const registro = intentos.get(clave)
    if (!registro || !registro.hasta) return 0
    const restante = registro.hasta - Date.now()
    if (restante <= 0) { intentos.delete(clave); return 0 }
    return Math.ceil(restante / 60000)
}

function registrarFallo(clave) {
    const registro = intentos.get(clave) || { fallos: 0, hasta: 0 }
    registro.fallos += 1
    if (registro.fallos >= MAX_INTENTOS) {
        registro.hasta = Date.now() + MINUTOS_BLOQUEO * 60000
        registro.fallos = 0
    }
    intentos.set(clave, registro)
}

// vistas
exports.vistaLogin = (req, res) => {
    const alerta = req.query.registro === 'ok'
        ? { titulo: 'Cuenta creada', mensaje: 'Ya puedes iniciar sesión.', icono: 'success' }
        : null
    res.render('login', { alerta, datos: {} })
}

exports.vistaRegistro = (req, res) => {
    res.render('register', { errores: [], datos: {} })
}

//login
exports.login = async (req, res, next) => {
    try {
        const usuario = limpiar(req.body.usuario)
        const password = typeof req.body.password === 'string' ? req.body.password : ''

        if (!usuario || !password) {
            return res.status(400).render('login', {
                datos: { usuario },
                alerta: { titulo: 'Advertencia', mensaje: 'Ingresa tu usuario y contraseña.', icono: 'info' }
            })
        }

        const clave = claveIntento(req, usuario)
        const minutos = estaBloqueado(clave)
        if (minutos) {
            return res.status(429).render('login', {
                datos: { usuario },
                alerta: { titulo: 'Demasiados intentos', mensaje: `Espera ${minutos} minuto(s) antes de volver a intentar.`, icono: 'warning' }
            })
        }

        const [filas] = await conexion.query(
            'SELECT id, password, activo FROM usuarios WHERE usuario = ?', [usuario])
        const encontrado = filas[0]
        const coincide = await bcryptjs.compare(password, encontrado ? encontrado.password : HASH_RELLENO)

        if (!encontrado || !coincide) {
            registrarFallo(clave)
            return res.status(401).render('login', {
                datos: { usuario },
                alerta: { titulo: 'Error', mensaje: 'Usuario y/o contraseña incorrectos.', icono: 'error' }
            })
        }

        if (!encontrado.activo) {
            return res.status(403).render('login', {
                datos: { usuario },
                alerta: { titulo: 'Cuenta desactivada', mensaje: 'Tu cuenta está desactivada. Habla con el administrador.', icono: 'warning' }
            })
        }

        intentos.delete(clave)
        res.cookie(NOMBRE_COOKIE, crearToken(encontrado.id), opcionesCookie())
        return res.redirect('/')
    } catch (error) {
        next(error)
    }
}

//registro
exports.registro = async (req, res, next) => {
    try {
        const { errores, nombre, usuario, password } = validarUsuario(req.body)

        if (errores.length) {
            return res.status(400).render('register', { errores, datos: { nombre, usuario } })
        }

        const [existe] = await conexion.query('SELECT id FROM usuarios WHERE usuario = ?', [usuario])
        if (existe.length) {
            return res.status(409).render('register', {
                errores: ['Ese nombre de usuario ya está ocupado, elige otro.'],
                datos: { nombre, usuario }
            })
        }

        const hash = await bcryptjs.hash(password, COSTO_BCRYPT)
        await conexion.query(
            `INSERT INTO usuarios (nombre, usuario, password, rol_id)
             VALUES (?, ?, ?, (SELECT id FROM roles WHERE nombre = ?))`,
            [nombre, usuario, hash, ROL_CLIENTE])

        return res.redirect('/login?registro=ok')
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).render('register', {
                errores: ['Ese nombre de usuario ya está ocupado, elige otro.'],
                datos: { nombre: req.body.nombre, usuario: req.body.usuario }
            })
        }
        next(error)
    }
}

exports.logout = (req, res) => {
    res.clearCookie(NOMBRE_COOKIE, { path: '/' })
    return res.redirect('/login')
}

exports.COSTO_BCRYPT = COSTO_BCRYPT
