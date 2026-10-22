// vigencia de existencias
const conexion = require('./db')

const INTERVALO_MS = 30 * 1000

async function desactivarVencidos() {
    const [resultado] = await conexion.query(
        `UPDATE productos
            SET activo = 0, motivo_inactivo = 'vigencia'
          WHERE activo = 1 AND vigente_hasta IS NOT NULL AND vigente_hasta <= NOW()`)
    if (resultado.affectedRows) {
        console.log(`[vigencias] ${resultado.affectedRows} producto(s) desactivado(s) por vigencia`)
    }
    return resultado.affectedRows
}

function iniciar() {
    const correr = () => desactivarVencidos().catch(e => console.error('[vigencias]', e.code || e.message))
    correr()
    return setInterval(correr, INTERVALO_MS)
}

module.exports = { iniciar, desactivarVencidos }
