const path = require('path')

// variables de entorno
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

// Motor de plantillas EJS
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))

// No revelar que el servidor es Express
app.disable('x-powered-by')

// Archivos estáticos como CSS, JS y fotos
app.use(express.static(path.join(__dirname, 'public')))

// Bootstrap
const modulos = path.join(__dirname, '..', 'node_modules')
app.use('/vendor/bootstrap', express.static(path.join(modulos, 'bootstrap', 'dist')))
app.use('/vendor/bootstrap-icons', express.static(path.join(modulos, 'bootstrap-icons', 'font')))
app.use('/vendor/sweetalert2', express.static(path.join(modulos, 'sweetalert2', 'dist')))

// Para recibir datos
app.use(express.urlencoded({ extended: false }))
app.use(express.json())

// Cookies 
app.use(cookieParser())

// Encabezados básicos de seguridad
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'same-origin')
    next()
})

// Evitar que el botón "atrás" muestre páginas privadas después de salir
app.use(noCache)
app.use(valoresPorDefecto)

// Rutas
app.use('/', require('./routes/router'))

// error 404
app.use((req, res) => {
    res.status(404).render('error', { codigo: 404, titulo: 'Página no encontrada', mensaje: 'La dirección que buscas no existe.' })
})

// Errores inesperados
app.use((err, req, res, next) => {
    console.error(err)
    res.status(500).render('error', { codigo: 500, titulo: 'Error del servidor', mensaje: 'Ocurrió un error inesperado. Intenta de nuevo.' })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
    console.log(`Servidor activo en http://localhost:${PORT}`)
    // revision si los productos se vencen
    require('./database/vigencias').iniciar()
})
