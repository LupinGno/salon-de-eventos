const mysql = require('mysql2')

// Pool de conexiones
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4',
    // Fechas como texto 
    dateStrings: true,
    decimalNumbers: true
})

// Zona horaria de cada conexión
const ZONA = process.env.DB_TIMEZONE || '-06:00'
pool.on('connection', c => c.query('SET time_zone = ?', [ZONA]))
const conexion = pool.promise()

// Al arrancar revisa que MySQL responda y que ya existan las tablas
conexion.query('SELECT COUNT(*) AS n FROM usuarios')
    .then(() => console.log('Base de datos conectada'))
    .catch(error => {
        if (error.code === 'ER_NO_SUCH_TABLE') {
            console.error('La base está vacía: faltan las tablas.')
            console.error('Créalas con los .sql de la carpeta base_de_datos (ver LEEME.md de los extras).')
        } else {
            console.error('Error de conexión con la BD:', error.code || error.message)
            console.error('¿Está prendido el contenedor de MySQL? Revisa con: docker ps')
        }
    })

module.exports = conexion
