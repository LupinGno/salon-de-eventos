// Validaciones del lado del servidor 

const REGEX_USUARIO = /^[a-zA-Z0-9._-]{3,30}$/

function limpiar(texto) {
    return typeof texto === 'string' ? texto.trim() : ''
}

// poder editar usuario sin cambiar la contraseña
function validarUsuario(datos, opciones = {}) {
    const errores = []
    const nombre = limpiar(datos.nombre)
    const usuario = limpiar(datos.usuario)
    const password = typeof datos.password === 'string' ? datos.password : ''
    const confirmar = typeof datos.confirmar === 'string' ? datos.confirmar : ''

    if (!nombre) errores.push('El nombre es obligatorio.')
    else if (nombre.length > 100) errores.push('El nombre no puede pasar de 100 caracteres.')

    if (!usuario) errores.push('El usuario es obligatorio.')
    else if (!REGEX_USUARIO.test(usuario)) errores.push('El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo, sin espacios.')

    const cambiaPassword = !opciones.passwordOpcional || password || confirmar
    if (cambiaPassword) {
        if (!password) errores.push('La contraseña es obligatoria.')
        else if (password.length < 8 || password.length > 72) errores.push('La contraseña debe tener entre 8 y 72 caracteres.')
        else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) errores.push('La contraseña debe tener al menos una letra y un número.')

        if (!confirmar) errores.push('Debes verificar la contraseña.')
        else if (password !== confirmar) errores.push('La contraseña y su verificación no coinciden.')
    }

    return { errores, nombre, usuario, password, cambiaPassword: Boolean(cambiaPassword) }
}

module.exports = { validarUsuario, limpiar }
