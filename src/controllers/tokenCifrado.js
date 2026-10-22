// Token web encriptado

const crypto = require('crypto')
const jwt = require('jsonwebtoken')

const ALGORITMO = 'aes-256-gcm'

const clave = () => crypto.createHash('sha256').update(process.env.TOKEN_CLAVE_CIFRADO).digest()

function encriptar(texto) {
    const iv = crypto.randomBytes(12)
    const cifrador = crypto.createCipheriv(ALGORITMO, clave(), iv)
    const cifrado = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()])
    const etiqueta = cifrador.getAuthTag()
    return Buffer.concat([iv, etiqueta, cifrado]).toString('base64url')
}

function desencriptar(token) {
    const datos = Buffer.from(token, 'base64url')
    if (datos.length < 29) throw new Error('Token con formato inválido')
    const iv = datos.subarray(0, 12)
    const etiqueta = datos.subarray(12, 28)
    const cifrado = datos.subarray(28)
    const descifrador = crypto.createDecipheriv(ALGORITMO, clave(), iv)
    descifrador.setAuthTag(etiqueta)
    return Buffer.concat([descifrador.update(cifrado), descifrador.final()]).toString('utf8')
}

// Crea el token final que va en la cookie
function crearToken(usuarioId) {
    const firmado = jwt.sign({ id: usuarioId }, process.env.JWT_SECRETO, {
        expiresIn: process.env.JWT_TIEMPO_EXPIRA || '8h',
        algorithm: 'HS256'
    })
    return encriptar(firmado)
}

// Devuelve el contenido del token o lanza error si está alterado o vencido
function verificarToken(tokenCifrado) {
    const firmado = desencriptar(tokenCifrado)
    return jwt.verify(firmado, process.env.JWT_SECRETO, { algorithms: ['HS256'] })
}

module.exports = { crearToken, verificarToken }
