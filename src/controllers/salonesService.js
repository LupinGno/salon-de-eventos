// Renta de salones
const conexion = require('../database/db')
const { ErrorNegocio } = require('./menuService')

const TAMANOS = ['chico', 'mediano', 'grande']
const PERSONAS_POR_MESA = 8           // una mesa estándar
const DIAS_PAGO_TOTAL = 3            
const DIAS_ANTES_LIQUIDAR = 2         // liquidar 2 días antes del evento
const redondear = n => Math.round(n * 100) / 100

// Fecha local 
async function hoyBD() {
    const [[{ hoy }]] = await conexion.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoy")
    return hoy
}
const diasEntre = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5)
const sumarDias = (fecha, dias) => new Date(Date.parse(fecha + 'T00:00:00Z') + dias * 864e5).toISOString().slice(0, 10)

// Valida lo que pide el cliente
async function leerConsulta(q) {
    const fecha = String(q.fecha || '').trim()
    const personas = Number(q.personas)
    const tamano = TAMANOS.includes(q.tamano) ? q.tamano : ''
    const conAlimentos = q.con_alimentos === '1' || q.con_alimentos === 1 || q.con_alimentos === true
    const hoy = await hoyBD()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) throw new ErrorNegocio('Elige una fecha válida.', 422)
    if (fecha < hoy) throw new ErrorNegocio('La fecha ya pasó.', 422)
    if (diasEntre(hoy, fecha) > 365) throw new ErrorNegocio('Solo se reserva hasta con un año de anticipación.', 422)
    if (!Number.isInteger(personas) || personas < 1 || personas > 1000) throw new ErrorNegocio('Escribe cuántas personas van (1 a 1000).', 422)
    return { fecha, personas, tamano, conAlimentos, hoy }
}

// Qué mobiliario se necesita para x personas
function mobiliarioNecesario(personas, conAlimentos) {
    const mesas = Math.ceil(personas / PERSONAS_POR_MESA)
    return {
        sillas: personas, mesas, manteles: mesas, bocina: 1,
        desechables: conAlimentos ? personas : 0      
    }
}

// Lo que tiene el salón, por tipo
function inventarioSalon(filas) {
    const buscar = palabra => filas.filter(f => f.nombre.toLowerCase().includes(palabra)).reduce((s, f) => s + f.cantidad, 0)
    return { sillas: buscar('silla'), mesas: buscar('mesa'), manteles: buscar('mantel'), bocina: buscar('bocina') }
}

// anticipo y fecha límite de pago.
function cotizar(salon, fecha, hoy, totalAlimentos = 0) {
    const dias = diasEntre(hoy, fecha)
    const pagoTotal = dias <= DIAS_PAGO_TOTAL
    const renta = Number(salon.precio_renta), cuota = Number(salon.cuota_garantia)
    const alimentos = redondear(Number(totalAlimentos) || 0)
    const precio = redondear(renta + alimentos)
    const pagoRenta = pagoTotal ? precio : redondear(precio / 2)
    return {
        renta, alimentos, precio, cuota, total: redondear(precio + cuota), dias,
        pago_total: pagoTotal,
        pago_renta: pagoRenta,                       // lo que se paga hoy de la renta + los alimentos
        anticipo: redondear(pagoRenta + cuota),      // lo que se cobra hoy en total
        saldo: redondear(precio - pagoRenta),        // lo que queda por liquidar
        fecha_limite: pagoTotal ? hoy : sumarDias(fecha, -DIAS_ANTES_LIQUIDAR)
    }
}

// salones para esa fecha y esas personas
async function disponibilidad(consulta) {
    const c = await leerConsulta(consulta)
    const [salones] = await conexion.query(
        `SELECT s.*, i.archivo AS imagen,
                (SELECT r.id FROM reservas_salon r WHERE r.salon_id = s.id AND r.fecha_evento = ? AND r.estado <> 'cancelada' LIMIT 1) AS reserva_id
           FROM salones s LEFT JOIN imagenes i ON i.id = s.imagen_id
          WHERE s.activo = 1 ${c.tamano ? 'AND s.tamano = ?' : ''}
          ORDER BY FIELD(s.tamano, 'chico', 'mediano', 'grande'), s.aforo_maximo`,
        c.tamano ? [c.fecha, c.tamano] : [c.fecha])
    const [mobiliario] = await conexion.query(
        `SELECT sm.salon_id, m.nombre, sm.cantidad FROM salon_mobiliario sm JOIN mobiliario m ON m.id = sm.mobiliario_id`)
    const necesario = mobiliarioNecesario(c.personas, c.conAlimentos)

    const resultado = salones.map(s => {
        const tiene = inventarioSalon(mobiliario.filter(m => m.salon_id === s.id))
        const falta = ['sillas', 'mesas', 'manteles'].filter(k => tiene[k] < necesario[k])
        let motivo = null
        if (s.reserva_id) motivo = 'Ya está rentado ese día'
        else if (c.personas > s.aforo_maximo) motivo = `Excede el aforo: máximo ${s.aforo_maximo} personas`      // US-39
        else if (falta.length) motivo = `No tiene suficientes ${falta.join(', ')}`
        return {
            id: s.id, nombre: s.nombre, tamano: s.tamano, aforo: s.aforo_maximo, imagen: s.imagen, descripcion: s.descripcion,
            brincolines: s.max_brincolines,                                                                         // US-44
            disponible: !motivo, motivo, tiene, necesario, cotizacion: cotizar(s, c.fecha, c.hoy)
        }
    })
    const disponibles = resultado.filter(s => s.disponible)
    // decir cuál es el máximo
    let aviso = null
    if (!disponibles.length) {
        const [[{ maximo }]] = await conexion.query('SELECT COALESCE(MAX(aforo_maximo), 0) AS maximo FROM salones WHERE activo = 1')
        aviso = c.personas > maximo
            ? `Ningún salón admite ${c.personas} personas: el cupo máximo es de ${maximo}.`
            : 'No hay salones libres con esas condiciones; prueba otra fecha u otro tamaño.'
    }
    return { consulta: c, salones: resultado, disponibles: disponibles.length, aviso }
}

// Próximas reservas para el calendario 
async function proximasReservas(dias = 30) {
    const [filas] = await conexion.query(`
        SELECT r.id, DATE_FORMAT(r.fecha_evento, '%Y-%m-%d') AS fecha, r.personas, r.con_alimentos, r.estado,
               s.nombre AS salon, s.tamano, c.nombre AS cliente
          FROM reservas_salon r
          JOIN salones s ON s.id = r.salon_id
          JOIN clientes c ON c.id = r.cliente_id
         WHERE r.fecha_evento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY) AND r.estado NOT IN ('cancelada', 'realizada')
         ORDER BY r.fecha_evento, s.nombre`, [dias])
    return filas
}

module.exports = {
    TAMANOS, PERSONAS_POR_MESA, DIAS_PAGO_TOTAL, DIAS_ANTES_LIQUIDAR,
    hoyBD, diasEntre, sumarDias, leerConsulta, mobiliarioNecesario, cotizar, disponibilidad, proximasReservas
}
