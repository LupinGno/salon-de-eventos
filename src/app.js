const path = require('path')

//Variables de entorno
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

app.disable('x-powered-by')

// Archivos estáticos 
app.use(express.static(path.join(__dirname, 'public')))

// Bootstrap, iconos y SweetAlert 
const modulos = path.join(__dirname, '..', 'node_modules')
app.use('/vendor/bootstrap', express.static(path.join(modulos, 'bootstrap', 'dist')))
app.use('/vendor/bootstrap-icons', express.static(path.join(modulos, 'bootstrap-icons', 'font')))
app.use('/vendor/sweetalert2', express.static(path.join(modulos, 'sweetalert2', 'dist')))
app.use('/vendor/chart.js', express.static(path.join(modulos, 'chart.js', 'dist')))   // Sprint 12: gráficas

// Recibir datos de formularios
app.use(express.urlencoded({ extended: false }))
app.use(express.json({ limit: '1mb' }))  

// Cookies
app.use(cookieParser())

// Encabezados básicos de seguridad
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'same-origin')
    next()
})

// Evitar que el botón "atrás" muestre páginas privadas después de salir.
app.use(noCache)
app.use(valoresPorDefecto)

// Rutas
app.use('/', require('./routes/router'))

const pideJson = req => req.originalUrl.startsWith('/api/') || req.accepts(['html', 'json']) === 'json'

// 404
app.use((req, res) => {
    if (pideJson(req)) return res.status(404).json({ error: 'La dirección que buscas no existe.' })
    res.status(404).render('error', { codigo: 404, titulo: 'Página no encontrada', mensaje: 'La dirección que buscas no existe.' })
})

// Errores inesperados
app.use((err, req, res, next) => {
    console.error(err)
    // Mensajes claros para los dos errores más comunes 
    let mensaje = 'Ocurrió un error inesperado. Intenta de nuevo.'
    if (['ER_BAD_FIELD_ERROR', 'ER_NO_SUCH_TABLE'].includes(err.code)) {
        mensaje = 'A la base de datos le falta una migración. Revisa la terminal del servidor.'
    } else if (['ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'ETIMEDOUT'].includes(err.code)) {
        mensaje = 'No hay conexión con la base de datos. Revisa que Docker y MySQL estén encendidos.'
    }
    if (pideJson(req)) return res.status(500).json({ error: mensaje })
    res.status(500).render('error', { codigo: 500, titulo: 'Error del servidor', mensaje })
})
const http = require('http')
const servidor = http.createServer(app)
require('./controllers/tiempoReal').iniciar(servidor)

const PORT = process.env.PORT || 3000
servidor.listen(PORT, () => {
    console.log(`Servidor activo en http://localhost:${PORT}`)
    // Avisa en la terminal 
    require('./database/revisarBase').revisar().catch(() => {})
    // revisa cada 30 s los productos cuya vigencia ya pasó
    require('./database/vigencias').iniciar()
})
