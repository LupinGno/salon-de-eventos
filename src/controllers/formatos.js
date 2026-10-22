// Lectura y validación de valores

const texto = v => (typeof v === 'string' ? v.trim() : '')

const lista = v => (v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : [v])

function entero(v, min = -Infinity, max = Infinity) {
    const s = texto(String(v ?? ''))
    if (!/^-?\d+$/.test(s)) return null
    const n = Number(s)
    return n >= min && n <= max ? n : null
}

// Decimal con hasta 2 decimales dentro de un rango
function decimal(v, min = -Infinity, max = Infinity) {
    const s = texto(String(v ?? '')).replace(',', '.')
    if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null
    const n = Number(s)
    return n >= min && n <= max ? n : null
}

function fecha(v) {
    const s = texto(v)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
    const [a, m, d] = s.split('-').map(Number)
    const f = new Date(Date.UTC(a, m - 1, d))
    // Rechaza fechas que no existen
    return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d ? s : null
}

function fechaHora(v) {
    const s = texto(v)
    const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/)
    if (!m || !fecha(m[1]) || +m[2] > 23 || +m[3] > 59) return null
    return `${m[1]} ${m[2]}:${m[3]}:00`
}

// 'YYYY-MM-DD HH:MM:SS' (como lo da MySQL) → valor para <input type="datetime-local">
const aInputFechaHora = v => (v ? String(v).slice(0, 16).replace(' ', 'T') : '')

const dinero = n => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
function fechaCorta(v) {
    if (!v) return ''
    const s = String(v)
    const [a, m, d] = s.slice(0, 10).split('-')
    const hora = s.length > 10 ? ' ' + s.slice(11, 16) : ''
    return `${Number(d)} ${MESES[Number(m) - 1]} ${a}${hora}`
}


module.exports = { texto, lista, entero, decimal, fecha, fechaHora, aInputFechaHora, dinero, fechaCorta }
