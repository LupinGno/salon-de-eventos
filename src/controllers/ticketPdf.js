// Puente entre Node.js y Python para el ticket PDF (US-28).
// Ejecuta ticket_pdf.py, le manda los datos como JSON y recibe el PDF.
// Busca Python en este orden: variable PYTHON del .env, "python", "py" (Windows) y "python3".
const { spawn } = require('child_process')
const path = require('path')

const SCRIPT = path.join(__dirname, 'ticket_pdf.py')
const TIEMPO_MAXIMO_MS = 15000

function candidatos() {
    const lista = [process.env.PYTHON, 'python', 'py', 'python3'].filter(Boolean)
    return [...new Set(lista)]
}

// Intenta con un ejecutable; resuelve con el PDF o rechaza con un error que dice qué hacer
function ejecutar(comando, datos) {
    return new Promise((resolve, reject) => {
        let hijo
        try {
            hijo = spawn(comando, [SCRIPT], { windowsHide: true })
        } catch (e) {
            return reject(Object.assign(new Error('no encontrado'), { siguiente: true }))
        }
        const partes = []
        let errores = ''
        const reloj = setTimeout(() => { hijo.kill(); reject(new Error('Python tardó demasiado en generar el PDF.')) }, TIEMPO_MAXIMO_MS)

        hijo.stdout.on('data', d => partes.push(d))
        hijo.stderr.on('data', d => { errores += d.toString() })
        hijo.on('error', e => {
            clearTimeout(reloj)
            // ENOENT = ese comando no existe en esta computadora: probar el siguiente
            reject(Object.assign(new Error(e.message), { siguiente: e.code === 'ENOENT' }))
        })
        hijo.on('close', codigo => {
            clearTimeout(reloj)
            const pdf = Buffer.concat(partes)
            if (codigo === 0 && pdf.slice(0, 4).toString() === '%PDF') return resolve(pdf)
            if (/No module named ['"]?reportlab/.test(errores)) {
                return reject(new Error('Falta la librería de Python reportlab. Instálala con: pip install reportlab'))
            }
            // En Windows, "python" puede ser el acceso directo de la Microsoft Store (código 9009)
            if (codigo === 9009 || /was not found|no se encontr/i.test(errores)) {
                return reject(Object.assign(new Error('no encontrado'), { siguiente: true }))
            }
            reject(new Error(`Python terminó con error: ${errores.trim().split('\n').pop() || 'código ' + codigo}`))
        })
        hijo.stdin.on('error', () => {})
        hijo.stdin.end(JSON.stringify(datos), 'utf8')
    })
}

async function generar(datos) {
    for (const comando of candidatos()) {
        try {
            return await ejecutar(comando, datos)
        } catch (e) {
            if (!e.siguiente) throw e
        }
    }
    throw new Error('No encontré Python en esta computadora. Instálalo desde python.org (marca "Add python.exe to PATH") y luego: pip install reportlab')
}

module.exports = { generar }
