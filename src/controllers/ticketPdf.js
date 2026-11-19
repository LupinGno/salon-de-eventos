// Puente entre Node.js y Python
const { spawn } = require('child_process')
const path = require('path')

const TIEMPO_MAXIMO_MS = 15000

function candidatos() {
    const lista = [process.env.PYTHON, 'python', 'py', 'python3'].filter(Boolean)
    return [...new Set(lista)]
}

// Intenta con un ejecutable o rechaza con un error que dice qué hacer
function ejecutar(comando, datos, script) {
    return new Promise((resolve, reject) => {
        let hijo
        try {
            hijo = spawn(comando, [path.join(__dirname, script)], { windowsHide: true })
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
            // el comando no existe en esta computadora
            reject(Object.assign(new Error(e.message), { siguiente: e.code === 'ENOENT' }))
        })
        hijo.on('close', codigo => {
            clearTimeout(reloj)
            const pdf = Buffer.concat(partes)
            if (codigo === 0 && pdf.slice(0, 4).toString() === '%PDF') return resolve(pdf)
            if (/No module named ['"]?reportlab/.test(errores)) {
                return reject(new Error('Falta la librería de Python reportlab. Instálala con: pip install reportlab'))
            }
            if (codigo === 9009 || /was not found|no se encontr/i.test(errores)) {
                return reject(Object.assign(new Error('no encontrado'), { siguiente: true }))
            }
            reject(new Error(`Python terminó con error: ${errores.trim().split('\n').pop() || 'código ' + codigo}`))
        })
        hijo.stdin.on('error', () => {})
        hijo.stdin.end(JSON.stringify(datos), 'utf8')
    })
}

async function generar(datos, script = 'ticket_pdf.py') {
    for (const comando of candidatos()) {
        try {
            return await ejecutar(comando, datos, script)
        } catch (e) {
            if (!e.siguiente) throw e
        }
    }
    throw new Error('No encontré Python en esta computadora. Instálalo desde python.org (marca "Add python.exe to PATH") y luego: pip install reportlab')
}

module.exports = { generar }
