// Subida de imágenes 
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const multer = require('multer')
const conexion = require('../database/db')

const CARPETA = path.join(__dirname, '..', 'public', 'uploads')
fs.mkdirSync(CARPETA, { recursive: true })

const TIPOS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }

const subir = multer({
    storage: multer.diskStorage({
        destination: CARPETA,
        filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + TIPOS[file.mimetype])
    }),
    limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 200 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase()
        const ok = TIPOS[file.mimetype] && ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)
        cb(ok ? null : new Error('TIPO'), Boolean(ok))
    }
})

// uso de Middleware para procesa el formulario multipart y deja un mensaje en req.errorSubida si falla
function campoImagen(nombreCampo = 'archivo') {
    const procesar = subir.single(nombreCampo)
    return (req, res, next) => {
        procesar(req, res, error => {
            if (error) {
                req.errorSubida = error.code === 'LIMIT_FILE_SIZE'
                    ? 'La imagen pesa más de 2 MB.'
                    : error.message === 'TIPO'
                        ? 'La imagen debe ser JPG, PNG, WEBP o GIF.'
                        : 'No se pudo subir la imagen.'
            }
            next()
        })
    }
}

async function registrarImagen(file, nombre) {
    const archivo = '/uploads/' + file.filename
    const [r] = await conexion.query('INSERT INTO imagenes (nombre, archivo) VALUES (?, ?)',
        [(nombre || file.originalname).slice(0, 80), archivo])
    return r.insertId
}

// Borra del disco un archivo subido 
function borrarArchivo(archivo) {
    if (!archivo || !archivo.startsWith('/uploads/')) return
    fs.unlink(path.join(CARPETA, path.basename(archivo)), () => {})
}

// Decide la imagen de un formulario
async function imagenDelFormulario(req, nombre) {
    if (req.file) return registrarImagen(req.file, nombre)
    const id = Number(req.body.imagen_id)
    if (!Number.isInteger(id) || id <= 0) return null
    const [[existe]] = await conexion.query('SELECT id FROM imagenes WHERE id = ?', [id])
    return existe ? id : null
}

async function galeria() {
    const [imagenes] = await conexion.query('SELECT id, nombre, archivo FROM imagenes ORDER BY nombre')
    return imagenes
}

module.exports = { campoImagen, registrarImagen, borrarArchivo, imagenDelFormulario, galeria }
