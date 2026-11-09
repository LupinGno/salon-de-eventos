const path = require('path')

// 1) Variables de entorno: se cargan ANTES que todo lo demás,
//    porque db.js y los controladores las leen al importarse.
require('dotenv').config({ path: path.join(__dirname, 'env', '.env'), quiet: true })

const requeridas = ['DB_HOST', 'DB_USER', 'DB_DATABASE', 'JWT_SECRETO', 'TOKEN_CLAVE_CIFRADO']
const faltantes = requeridas.filter(v => !process.env[v])
if (faltantes.length) {
    console.error('Faltan variables en src/env/.env:', faltantes.join(', '))
    process.exit(1)
}

const express = require('express')
const cookieParser = require('cookie-parser')
const { noCache, valoresPorDefecto } = require('./routes/auth')

const app = express()

// Motor de plantillas EJS y carpeta de vistas
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))

// No revelar que el servidor es Express
app.disable('x-powered-by')

// Archivos estáticos (css, js, imágenes)
app.use(express.static(path.join(__dirname, 'public')))

// Bootstrap, iconos y SweetAlert se sirven desde node_modules (npm install),
// así la página se ve bien aunque no haya internet el día de la demo.
const modulos = path.join(__dirname, '..', 'node_modules')
app.use('/vendor/bootstrap', express.static(path.join(modulos, 'bootstrap', 'dist')))
app.use('/vendor/bootstrap-icons', express.static(path.join(modulos, 'bootstrap-icons', 'font')))
app.use('/vendor/sweetalert2', express.static(path.join(modulos, 'sweetalert2', 'dist')))

// Recibir datos de formularios
app.use(express.urlencoded({ extended: false }))
app.use(express.json())

// Cookies (ahí viaja el token encriptado)
app.use(cookieParser())

// Encabezados básicos de seguridad
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'same-origin')
    next()
})

// Evitar que el botón "atrás" muestre páginas privadas después de salir.
// (En la base original este middleware estaba DESPUÉS de las rutas y nunca se ejecutaba.)
app.use(noCache)
app.use(valoresPorDefecto)

// Rutas
app.use('/', require('./routes/router'))

// 404
app.use((req, res) => {
    res.status(404).render('error', { codigo: 404, titulo: 'Página no encontrada', mensaje: 'La dirección que buscas no existe.' })
})

// Errores inesperados
app.use((err, req, res, next) => {
    console.error(err)
    res.status(500).render('error', { codigo: 500, titulo: 'Error del servidor', mensaje: 'Ocurrió un error inesperado. Intenta de nuevo.' })
})

// Sprint 5: el mismo servidor atiende las páginas (Express) y el tiempo real (Socket.IO)
const http = require('http')
const servidor = http.createServer(app)
require('./controllers/tiempoReal').iniciar(servidor)

const PORT = process.env.PORT || 3000
servidor.listen(PORT, () => {
    console.log(`Servidor activo en http://localhost:${PORT}`)
    // US-13: revisa cada 30 s los productos cuya vigencia ya pasó
    require('./database/vigencias').iniciar()
})
