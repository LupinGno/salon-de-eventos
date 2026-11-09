// cambio real
const { Server } = require('socket.io')
const conexion = require('../database/db')
const { verificarToken } = require('./tokenCifrado')

let io = null

// Lee la cookie
function leerCookie(encabezado, nombre) {
    for (const parte of String(encabezado || '').split(';')) {
        const [k, ...v] = parte.trim().split('=')
        if (k === nombre) return decodeURIComponent(v.join('='))
    }
    return null
}

async function usuarioDelToken(token) {
    const datos = verificarToken(token)                
    const [[u]] = await conexion.query(
        `SELECT u.id, u.nombre, u.activo, u.rol_id, r.nombre AS rol
           FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ?`, [datos.id])
    if (!u || !u.activo) throw new Error('Usuario inactivo')
    if (u.rol === 'Administrador') {
        u.modulos = ['cocina', 'caja-snacks']
    } else {
        const [p] = await conexion.query('SELECT modulo FROM rol_modulos WHERE rol_id = ?', [u.rol_id])
        u.modulos = p.map(x => x.modulo)
    }
    return u
}

function iniciar(servidorHttp) {
    io = new Server(servidorHttp, {
        serveClient: true,                
        cors: { origin: false }           
    })

    io.use(async (socket, next) => {
        try {
            const token = leerCookie(socket.handshake.headers.cookie, 'token')
            if (!token) return next(new Error('Sin sesión'))
            socket.data.usuario = await usuarioDelToken(token)
            next()
        } catch (e) {
            next(new Error('Sesión inválida'))
        }
    })

    io.on('connection', socket => {
        const u = socket.data.usuario
        if (u.modulos.includes('cocina')) socket.join('cocina')
        if (u.modulos.includes('caja-snacks')) socket.join('recepcion')
        socket.emit('listo', { salas: [...socket.rooms].filter(s => s !== socket.id) })
    })
    return io
}

function emitir(sala, evento, datos) {
    if (io) io.to(sala).emit(evento, datos || {})
}

module.exports = { iniciar, emitir, leerCookie }
