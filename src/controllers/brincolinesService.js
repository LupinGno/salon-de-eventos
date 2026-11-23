// Renta de brincolines a domicilio.
const crypto = require('crypto')
const conexion = require('../database/db')
const { ErrorNegocio } = require('./menuService')
const { validarPago } = require('./cajaService')
const salones = require('./salonesService')
const pdf = require('./ticketPdf')

const CAJA_BRINCOLINES = 3          
const MARGEN_ESPACIO = 1            
const NEGOCIO = 'Salón de Eventos y Snacks'
const redondear = n => Math.round(n * 100) / 100
const folio = id => `B-${String(id).padStart(4, '0')}`
const texto = v => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '')
const si = v => v === true || v === 1 || v === '1'
const fechaCorta = iso => iso.split('-').reverse().join('/')
const fechaLarga = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('es-MX', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

const ESTADOS = { reservada: 'Reservada', instalada: 'Instalada', no_instalada: 'No se instaló', recolectada: 'Recogida', cancelada: 'Cancelada' }
const CONCEPTOS = {
    renta: 'Renta del día', garantia: 'Garantía', devolucion_garantia: 'Devolución de la garantía',
    reembolso_renta: 'Reembolso de la renta', diferencia_cambio: 'Diferencia por cambio', cobro_cambio: 'Cobro por cambio'
}

// echa que se consulta o se renta
async function leerFecha(valor) {
    const fecha = String(valor || '').trim()
    const hoy = await salones.hoyBD()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) throw new ErrorNegocio('Elige una fecha válida.', 422)
    if (fecha <= hoy) throw new ErrorNegocio('Los brincolines se reservan con anticipación: elige a partir de mañana.', 422)
    if (salones.diasEntre(hoy, fecha) > 365) throw new ErrorNegocio('Solo se reserva hasta con un año de anticipación.', 422)
    return { fecha, hoy }
}

// ¿Por qué un brincolín no se puede rentar ese día? 
async function motivoOcupado(db, b, fecha, excluirRenta = 0, permitirReparacion = false) {
    if (b.estado === 'baja') return 'Dado de baja'
    if (b.estado === 'en_reparacion' && !permitirReparacion) return 'En reparación'
    const ayer = salones.sumarDias(fecha, -1)
    const [[renta]] = await db.query(
        `SELECT DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha FROM rentas_brincolin
          WHERE brincolin_id = ? AND activa = 1 AND fecha IN (?, ?) AND id <> ? LIMIT 1`, [b.id, fecha, ayer, excluirRenta])
    if (renta) return renta.fecha === fecha ? 'Ya está rentado ese día' : 'Ese día se recoge de la renta anterior'
    const [[fiesta]] = await db.query(
        `SELECT 1 FROM reserva_brincolines rb JOIN reservas_salon r ON r.id = rb.reserva_id
          WHERE rb.brincolin_id = ? AND r.fecha_evento = ? AND r.estado <> 'cancelada' LIMIT 1`, [b.id, fecha])
    if (fiesta) return 'Está apartado para una fiesta del salón ese día'
    return null
}

async function catalogoPorFecha(valorFecha) {
    const { fecha, hoy } = await leerFecha(valorFecha)
    const [filas] = await conexion.query(
        `SELECT b.*, i.archivo AS imagen FROM brincolines b LEFT JOIN imagenes i ON i.id = b.imagen_id
          WHERE b.estado <> 'baja' ORDER BY b.precio_dia, b.nombre`)
    const brincolines = []
    for (const b of filas) {
        const motivo = await motivoOcupado(conexion, b, fecha)
        brincolines.push({
            id: b.id, nombre: b.nombre, descripcion: b.descripcion, imagen: b.imagen, estado: b.estado,
            largo: Number(b.largo_m), ancho: Number(b.ancho_m), alto: Number(b.alto_m),
            precio: Number(b.precio_dia), garantia: Number(b.garantia),
            espacio: { largo: redondear(Number(b.largo_m) + MARGEN_ESPACIO), ancho: redondear(Number(b.ancho_m) + MARGEN_ESPACIO) },
            disponible: !motivo, motivo
        })
    }
    return { fecha, hoy, recoger: salones.sumarDias(fecha, 1), brincolines, disponibles: brincolines.filter(b => b.disponible).length }
}

// términos y condiciones
function terminos(r) {
    const $ = n => `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    return [
        `La renta es por el día completo (${r.fecha_texto}). El personal instala el brincolín ese día en el domicilio indicado; el cliente no lo puede mover, desconectar ni instalar en otro lugar.`,
        `El sitio debe ser factible: toma de corriente eléctrica cerca, terreno plano y firme (pasto, tierra compactada o piso, sin piedras ni pendiente) y un espacio libre de al menos ${r.espacio_largo} × ${r.espacio_ancho} m, sin cables ni ramas encima (el brincolín mide ${r.largo} × ${r.ancho} × ${r.alto} m).`,
        `Si al llegar el sitio no cumple, el brincolín no se instala y la renta no se reembolsa; la garantía sí se devuelve.`,
        `No hay devoluciones el mismo día: el brincolín se recoge al día siguiente (${r.recoger_texto}) en el mismo domicilio y lugar donde se instaló.`,
        `Garantía de ${$(r.garantia)}: se devuelve si el brincolín regresa limpio de basura y sin daños, después de que Limpieza lo revise. Si tiene daños, la garantía no se devuelve.`,
        `Si el cliente cancela, no hay reembolso de la renta. Mientras haya disponibilidad, puede cambiar el brincolín por otro modelo; si es más barato se le devuelve la diferencia.`,
        `Si el brincolín se daña antes de la fecha por causa de la empresa, el cliente elige: reembolso completo, cambiar la fecha o cambiar a otro modelo disponible.`,
        `Las devoluciones se hacen a quien pagó (${r.cliente}) y por el mismo medio con que pagó.`
    ]
}

function datosTerminos(b, fecha, cliente) {
    return {
        fecha_texto: fechaLarga(fecha), recoger_texto: fechaLarga(salones.sumarDias(fecha, 1)),
        largo: Number(b.largo_m), ancho: Number(b.ancho_m), alto: Number(b.alto_m),
        espacio_largo: redondear(Number(b.largo_m) + MARGEN_ESPACIO), espacio_ancho: redondear(Number(b.ancho_m) + MARGEN_ESPACIO),
        garantia: Number(b.garantia), cliente
    }
}

// Validación de lo que captura el encargado 
function numero(v) { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : NaN }

function validarDatos(datos, b) {
    const errores = []
    const c = datos.cliente || {}
    const cliente = { nombre: texto(c.nombre), telefono: String(c.telefono || '').replace(/[\s()-]/g, ''), correo: texto(c.correo).toLowerCase() }
    if (cliente.nombre.length < 3 || cliente.nombre.length > 100) errores.push('Escribe el nombre completo de quien renta y paga.')
    if (!/^\d{10}$/.test(cliente.telefono)) errores.push('El teléfono debe tener 10 dígitos.')
    if (cliente.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cliente.correo)) errores.push('Revisa el correo.')
    const direccion = texto(datos.direccion), referencias = texto(datos.referencias)
    if (direccion.length < 10 || direccion.length > 255) errores.push('Escribe el domicilio completo donde se instala (calle, número, colonia y ciudad).')
    if (referencias.length > 255) errores.push('Las referencias son de máximo 255 caracteres.')

    //el sitio tiene que ser factible
    const largo = numero(datos.espacio_largo), ancho = numero(datos.espacio_ancho)
    if (!(largo > 0 && largo <= 100) || !(ancho > 0 && ancho <= 100)) {
        errores.push('Escribe el largo y el ancho del espacio libre, en metros.')
    } else {
        const minL = redondear(Number(b.largo_m) + MARGEN_ESPACIO), minA = redondear(Number(b.ancho_m) + MARGEN_ESPACIO)
        const cabe = (largo >= minL && ancho >= minA) || (largo >= minA && ancho >= minL)
        if (!cabe) errores.push(`El espacio no es suficiente: ${b.nombre} necesita al menos ${minL} × ${minA} m libres.`)
    }
    if (!si(datos.toma_corriente)) errores.push('Sin toma de corriente cerca no se puede instalar: el brincolín necesita conectarse.')
    if (!si(datos.terreno_habil)) errores.push('El terreno debe ser plano y firme para instalarlo.')

    const firma = String(datos.firma || '')
    const base64 = firma.startsWith('data:image/png;base64,') ? firma.slice(22) : ''
    let png = null
    if (base64 && base64.length < 400000 && /^[A-Za-z0-9+/=]+$/.test(base64)) png = Buffer.from(base64, 'base64')
    if (!png || png.length < 100 || png.slice(1, 4).toString() !== 'PNG') errores.push('Falta la firma del cliente.')
    if (!si(datos.acepta_terminos)) errores.push('El cliente debe aceptar los términos y condiciones.')
    return { errores, cliente, direccion, referencias: referencias || null, largo, ancho, firma: png ? firma : null }
}

// Datos para el PDF
function datosPdf(r, tipo) {
    return {
        tipo, negocio: NEGOCIO, folio: r.folio, emitido: new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }),
        brincolin: { nombre: r.brincolin, largo: Number(r.largo_m), ancho: Number(r.ancho_m), alto: Number(r.alto_m) },
        fecha: fechaLarga(r.fecha), recoger: fechaLarga(r.recoger), direccion: r.direccion, referencias: r.referencias,
        espacio: `${Number(r.espacio_largo)} × ${Number(r.espacio_ancho)} m`,
        cliente: { nombre: r.cliente_nombre, telefono: r.cliente_telefono, correo: r.cliente_correo },
        importes: { precio: Number(r.precio), garantia: Number(r.garantia) }, medio: r.medio_pago, encargado: r.encargado,
        firma: tipo === 'contrato' ? r.firma_imagen : null, estado: r.estado_texto, garantia_estado: r.estado_garantia,
        pagos: r.pagos.map(p => ({ fecha: p.creado_texto, concepto: p.concepto_texto, medio: p.medio, monto: Number(p.monto), persona: p.persona })),
        terminos: terminos({ ...datosTerminos(r, r.fecha, r.cliente_nombre) })
    }
}

// rentar en una sola transacción
async function crearRenta(datos, usuario) {
    datos = datos || {}
    const { fecha } = await leerFecha(datos.fecha)
    const brincolinId = Number(datos.brincolin_id)
    const [[b]] = await conexion.query('SELECT * FROM brincolines WHERE id = ?', [Number.isInteger(brincolinId) ? brincolinId : 0])
    if (!b) throw new ErrorNegocio('Ese brincolín no existe.', 404)
    const v = validarDatos(datos, b)
    if (v.errores.length) throw Object.assign(new ErrorNegocio(v.errores[0], 422), { errores: v.errores })
    const total = redondear(Number(b.precio_dia) + Number(b.garantia))
    const pago = validarPago(datos.pago, total)

    const db = await conexion.getConnection()
    try {
        await db.beginTransaction()
        // Bloquea el brincolín
        const [[bloqueado]] = await db.query('SELECT * FROM brincolines WHERE id = ? FOR UPDATE', [b.id])
        const motivo = await motivoOcupado(db, bloqueado, fecha)
        if (motivo) throw new ErrorNegocio(`${b.nombre}: ${motivo.toLowerCase()}.`, 409)

        const [cli] = await db.query('INSERT INTO clientes (nombre, telefono, correo) VALUES (?, ?, ?)',
            [v.cliente.nombre, v.cliente.telefono, v.cliente.correo || null])
        const [ins] = await db.query(
            `INSERT INTO rentas_brincolin (brincolin_id, cliente_id, usuario_id, fecha, direccion, referencias, espacio_largo, espacio_ancho,
                                           toma_corriente, terreno_habil, precio, garantia, medio_pago, firma_imagen, tyc_aceptados_en)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, NOW())`,
            [b.id, cli.insertId, usuario.id, fecha, v.direccion, v.referencias, v.largo, v.ancho, b.precio_dia, b.garantia, pago.medio, v.firma])
        const id = ins.insertId
        const pagar = (concepto, monto, extra = {}) => db.query(
            `INSERT INTO pagos_renta (renta_id, caja_id, usuario_id, concepto, monto, medio, recibido, cambio, referencia, persona)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, CAJA_BRINCOLINES, usuario.id, concepto, monto, pago.medio, extra.recibido ?? null, extra.cambio ?? 0, pago.referencia, v.cliente.nombre])
        await pagar('renta', Number(b.precio_dia), { recibido: pago.recibido, cambio: pago.cambio })
        await pagar('garantia', Number(b.garantia))

        //el contrato se genera antes de confirmar
        const r = await detalleRenta(id, db, { conFirma: true })
        const archivo = await pdf.generar(datosPdf(r, 'contrato'), 'brincolin_pdf.py')
        await db.query('INSERT INTO contratos_brincolin (renta_id, pdf, sha256) VALUES (?, ?, ?)',
            [id, archivo, crypto.createHash('sha256').update(archivo).digest('hex')])
        await db.commit()
        return { id, folio: folio(id), cobrado: total, cambio: pago.cambio }
    } catch (e) {
        await db.rollback()
        if (e.code === 'ER_DUP_ENTRY') throw new ErrorNegocio(`${b.nombre} ya está rentado ese día.`, 409)
        if (!(e instanceof ErrorNegocio) && /Python|reportlab|PDF/i.test(e.message)) {
            throw new ErrorNegocio(`No se guardó la renta porque no se pudo generar el contrato: ${e.message}`, 503)
        }
        throw e
    } finally {
        db.release()
    }
}

//Detalles, con lo pagado y qué se puede hacer
async function detalleRenta(id, db = conexion, opciones = {}) {
    const [[r]] = await db.query(
        `SELECT r.*, DATE_FORMAT(r.fecha, '%Y-%m-%d') AS fecha, DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoy,
                b.nombre AS brincolin, b.largo_m, b.ancho_m, b.alto_m, b.estado AS estado_brincolin, i.archivo AS imagen,
                c.nombre AS cliente_nombre, c.telefono AS cliente_telefono, c.correo AS cliente_correo,
                u.nombre AS encargado, ui.nombre AS instalo, ur.nombre AS recogio,
                (r.firma_imagen IS NOT NULL) AS firmado, ${opciones.conFirma ? '' : 'NULL AS'} firma_imagen,
                (SELECT sha256 FROM contratos_brincolin k WHERE k.renta_id = r.id) AS contrato_sha256
           FROM rentas_brincolin r
           JOIN brincolines b ON b.id = r.brincolin_id
           LEFT JOIN imagenes i ON i.id = b.imagen_id
           JOIN clientes c ON c.id = r.cliente_id
           JOIN usuarios u ON u.id = r.usuario_id
           LEFT JOIN usuarios ui ON ui.id = r.instalado_por
           LEFT JOIN usuarios ur ON ur.id = r.recolectado_por
          WHERE r.id = ?`, [id])
    if (!r) return null
    const [pagos] = await db.query(
        `SELECT p.*, DATE_FORMAT(p.creado_en, '%d/%m/%Y %H:%i') AS creado_texto, u.nombre AS usuario
           FROM pagos_renta p JOIN usuarios u ON u.id = p.usuario_id WHERE p.renta_id = ? ORDER BY p.id`, [id])
    pagos.forEach(p => { p.monto = Number(p.monto); p.concepto_texto = CONCEPTOS[p.concepto] })
    r.pagos = pagos
    r.precio = Number(r.precio)
    r.garantia = Number(r.garantia)
    r.folio = folio(r.id)
    r.estado_texto = ESTADOS[r.estado]
    r.recoger = salones.sumarDias(r.fecha, 1)
    r.neto = redondear(pagos.reduce((t, p) => t + p.monto, 0))
    r.es_hoy = r.fecha === r.hoy
    r.puede = {
        instalar: r.estado === 'reservada' && r.es_hoy,
        recoger: r.estado === 'instalada' && r.hoy > r.fecha
    }
    return r
}

async function listaRentas(filtro = 'proximas') {
    const condiciones = {
        proximas: "r.fecha >= CURDATE() AND r.estado = 'reservada'",
        atencion: "EXISTS (SELECT 1 FROM incidencias i WHERE i.renta_id = r.id AND i.accion = 'pendiente')",
        hoy: "r.fecha = CURDATE()",
        por_recoger: "r.estado = 'instalada'",
        terminadas: "r.estado IN ('recolectada', 'no_instalada', 'cancelada')",
        todas: '1 = 1'
    }
    const [filas] = await conexion.query(`
        SELECT r.id, DATE_FORMAT(r.fecha, '%Y-%m-%d') AS fecha, r.estado, r.estado_garantia, r.direccion, r.precio, r.garantia,
               b.nombre AS brincolin, c.nombre AS cliente, c.telefono,
               EXISTS (SELECT 1 FROM incidencias i WHERE i.renta_id = r.id AND i.accion = 'pendiente') AS pendiente
          FROM rentas_brincolin r JOIN brincolines b ON b.id = r.brincolin_id JOIN clientes c ON c.id = r.cliente_id
         WHERE ${condiciones[filtro] || condiciones.proximas}
         ORDER BY ${filtro === 'terminadas' ? 'r.fecha DESC' : 'r.fecha, b.nombre'} LIMIT 300`)
    filas.forEach(f => { f.folio = folio(f.id); f.estado_texto = ESTADOS[f.estado]; f.recoger = salones.sumarDias(f.fecha, 1) })
    return filas
}

// Toma la renta bloqueada para cambiarla dentro de una transacción
async function conRenta(id, accion) {
    const db = await conexion.getConnection()
    try {
        await db.beginTransaction()
        const [[bloqueo]] = await db.query('SELECT id, brincolin_id FROM rentas_brincolin WHERE id = ? FOR UPDATE', [Number(id) || 0])
        if (!bloqueo) throw new ErrorNegocio('Esa renta no existe.', 404)
        await db.query('SELECT id FROM brincolines WHERE id = ? FOR UPDATE', [bloqueo.brincolin_id])
        const r = await detalleRenta(bloqueo.id, db)
        const resultado = await accion(db, r)
        await db.commit()
        return resultado
    } catch (e) {
        await db.rollback()
        throw e
    } finally {
        db.release()
    }
}

const registrarPago = (db, r, usuarioId, concepto, monto, medio, persona, extra = {}) => db.query(
    `INSERT INTO pagos_renta (renta_id, caja_id, usuario_id, concepto, monto, medio, recibido, cambio, referencia, persona)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [r.id, CAJA_BRINCOLINES, usuarioId, concepto, monto, medio, extra.recibido ?? null, extra.cambio ?? 0, extra.referencia ?? null, persona])

// US-55/56: el día de la renta el personal revisa el sitio y lo instala
async function instalar(id, datos, usuario) {
    datos = datos || {}
    return conRenta(id, async (db, r) => {
        if (r.estado !== 'reservada') throw new ErrorNegocio(`No se puede instalar: la renta está ${r.estado_texto.toLowerCase()}.`, 409)
        if (!r.es_hoy) throw new ErrorNegocio(`Se instala el día de la renta (${fechaCorta(r.fecha)}).`, 409)
        if (!(si(datos.corriente) && si(datos.terreno) && si(datos.espacio))) {
            throw new ErrorNegocio('Para instalar, confirma la toma de corriente, el terreno y el espacio. Si algo no cumple, usa "No se puede instalar".', 422)
        }
        if (!['disponible', 'en_limpieza'].includes(r.estado_brincolin)) {
            throw new ErrorNegocio(`El brincolín está ${r.estado_brincolin.replace('_', ' ')}: no se puede instalar.`, 409)
        }
        await db.query("UPDATE rentas_brincolin SET estado = 'instalada', instalado_en = NOW(), instalado_por = ? WHERE id = ?", [usuario.id, r.id])
        await db.query("UPDATE brincolines SET estado = 'rentado' WHERE id = ?", [r.brincolin_id])
        return { estado: 'instalada' }
    })
}

// el sitio no cumple, no se instala; se devuelve la garantía y se registra el motivo
async function noInstalar(id, datos, usuario) {
    datos = datos || {}
    const fallas = ['corriente', 'terreno', 'espacio'].filter(k => si(datos[`falla_${k}`]))
    const nombres = { corriente: 'sin toma de corriente', terreno: 'terreno no apto', espacio: 'espacio insuficiente' }
    const nota = texto(datos.motivo)
    if (!fallas.length) throw new ErrorNegocio('Marca qué no cumplió el sitio.', 422)
    const motivo = [fallas.map(f => nombres[f]).join(', '), nota].filter(Boolean).join('. ')
    return conRenta(id, async (db, r) => {
        if (r.estado !== 'reservada') throw new ErrorNegocio(`La renta está ${r.estado_texto.toLowerCase()}.`, 409)
        if (!r.es_hoy) throw new ErrorNegocio(`El sitio se revisa el día de la renta (${fechaCorta(r.fecha)}).`, 409)
        await db.query(
            "UPDATE rentas_brincolin SET estado = 'no_instalada', estado_garantia = 'devuelta', motivo_no_instalado = ?, instalado_por = ? WHERE id = ?",
            [motivo.slice(0, 255), usuario.id, r.id])
        await registrarPago(db, r, usuario.id, 'devolucion_garantia', -r.garantia, r.medio_pago, r.cliente_nombre)
        return { devuelto: r.garantia, medio: r.medio_pago, a: r.cliente_nombre, motivo }
    })
}

//se recoge al día siguiente pasa a limpieza
async function recoger(id, usuario) {
    return conRenta(id, async (db, r) => {
        if (r.estado !== 'instalada') throw new ErrorNegocio('Solo se recoge un brincolín instalado.', 409)
        if (r.hoy <= r.fecha) throw new ErrorNegocio(`No hay devoluciones el mismo día: se recoge a partir del ${fechaCorta(r.recoger)}.`, 409)
        await db.query("UPDATE rentas_brincolin SET estado = 'recolectada', recolectado_en = NOW(), recolectado_por = ? WHERE id = ?", [usuario.id, r.id])
        await db.query("UPDATE brincolines SET estado = 'en_limpieza' WHERE id = ?", [r.brincolin_id])
        await db.query("INSERT INTO tareas_limpieza (tipo, renta_id, brincolin_id, origen, creada_por) VALUES ('brincolin', ?, ?, ?, ?)",
            [r.id, r.brincolin_id, `Recogido de la renta ${r.folio}`, usuario.id])
        return { estado: 'recolectada' }
    })
}

async function contrato(id) {
    const [[k]] = await conexion.query('SELECT pdf, sha256 FROM contratos_brincolin WHERE renta_id = ?', [Number(id) || 0])
    return k || null
}

async function comprobante(id) {
    const r = await detalleRenta(Number(id) || 0)
    if (!r) return null
    return { r, pdf: await pdf.generar(datosPdf(r, 'comprobante'), 'brincolin_pdf.py') }
}

// incidencias, cambios y equipo
const TIPOS_INCIDENCIA = { falla_empresa: 'Falla de la empresa', dano_cliente: 'Daño al regresar', cancelacion_cliente: 'Cancelación del cliente', cambio_cliente: 'Cambio de modelo' }
const ACCIONES = { pendiente: 'Esperando la decisión del cliente', reembolso: 'Reembolso completo', reagenda: 'Se cambió la fecha', cambio: 'Se cambió el modelo', ninguna: 'Sin cambio de dinero' }

// brincolín dañado o dado de baja deja pendientes las rentas futuras para que el cliente elija
async function marcarRentasAfectadas(db, brincolinId, descripcion, usuarioId) {
    const [rentas] = await db.query(
        `SELECT r.id FROM rentas_brincolin r
          WHERE r.brincolin_id = ? AND r.estado = 'reservada' AND r.fecha >= CURDATE()
            AND NOT EXISTS (SELECT 1 FROM incidencias i WHERE i.renta_id = r.id AND i.accion = 'pendiente')`, [brincolinId])
    for (const r of rentas) {
        await db.query(
            "INSERT INTO incidencias (renta_id, brincolin_id, usuario_id, tipo, descripcion, accion) VALUES (?, ?, ?, 'falla_empresa', ?, 'pendiente')",
            [r.id, brincolinId, usuarioId, descripcion.slice(0, 255)])
    }
    return rentas.length
}

// Pantalla estado de cada brincolín y sus próximas rentas
async function equipo() {
    const [filas] = await conexion.query(`
        SELECT b.id, b.nombre, b.estado, b.precio_dia, b.garantia, b.largo_m, b.ancho_m, b.alto_m, i.archivo AS imagen,
               (SELECT COUNT(*) FROM rentas_brincolin r WHERE r.brincolin_id = b.id AND r.estado = 'reservada' AND r.fecha >= CURDATE()) AS proximas,
               (SELECT COUNT(*) FROM incidencias x WHERE x.brincolin_id = b.id AND x.accion = 'pendiente') AS pendientes
          FROM brincolines b LEFT JOIN imagenes i ON i.id = b.imagen_id
         ORDER BY b.estado = 'baja', b.nombre`)
    return filas
}

// Reportar que un brincolín se dañó antes de tiempo
async function reportarDano(brincolinId, datos, usuario) {
    datos = datos || {}
    const estado = datos.estado === 'baja' ? 'baja' : datos.estado === 'en_reparacion' ? 'en_reparacion' : null
    const motivo = texto(datos.motivo)
    if (!estado) throw new ErrorNegocio('Elige si va a reparación o se da de baja.', 422)
    if (motivo.length < 5) throw new ErrorNegocio('Describe el daño (5 caracteres o más).', 422)
    const db = await conexion.getConnection()
    try {
        await db.beginTransaction()
        const [[b]] = await db.query('SELECT * FROM brincolines WHERE id = ? FOR UPDATE', [Number(brincolinId) || 0])
        if (!b) throw new ErrorNegocio('Ese brincolín no existe.', 404)
        if (b.estado === 'rentado') throw new ErrorNegocio('Está instalado en casa de un cliente: el daño se revisa cuando se recoja.', 409)
        if (b.estado === 'baja') throw new ErrorNegocio('Ya está dado de baja.', 409)
        await db.query('UPDATE brincolines SET estado = ? WHERE id = ?', [estado, b.id])
        const afectadas = await marcarRentasAfectadas(db, b.id, `${b.nombre} ${estado === 'baja' ? 'se dio de baja' : 'está en reparación'}: ${motivo}`, usuario.id)
        await db.commit()
        return { estado, afectadas }
    } catch (e) {
        await db.rollback(); throw e
    } finally { db.release() }
}

// Regresa de reparación pasa a Limpieza para revisarlo 
async function terminarReparacion(brincolinId, usuario) {
    const db = await conexion.getConnection()
    try {
        await db.beginTransaction()
        const [[b]] = await db.query('SELECT * FROM brincolines WHERE id = ? FOR UPDATE', [Number(brincolinId) || 0])
        if (!b) throw new ErrorNegocio('Ese brincolín no existe.', 404)
        if (b.estado !== 'en_reparacion') throw new ErrorNegocio('Ese brincolín no está en reparación.', 409)
        await db.query("UPDATE brincolines SET estado = 'en_limpieza' WHERE id = ?", [b.id])
        await db.query("INSERT INTO tareas_limpieza (tipo, brincolin_id, origen, creada_por) VALUES ('brincolin', ?, 'Regresó de reparación', ?)", [b.id, usuario.id])
        await db.commit()
        return { estado: 'en_limpieza' }
    } catch (e) {
        await db.rollback(); throw e
    } finally { db.release() }
}

//modelos libres ese día que caben en el espacio que declaró el cliente
async function sugerencias(r, fecha = r.fecha, db = conexion) {
    const [filas] = await db.query(
        `SELECT b.*, i.archivo AS imagen FROM brincolines b LEFT JOIN imagenes i ON i.id = b.imagen_id
          WHERE b.id <> ? AND b.estado NOT IN ('baja', 'en_reparacion')`, [r.brincolin_id])
    const actual = r.precio + r.garantia
    const lista = []
    for (const b of filas) {
        if (await motivoOcupado(db, b, fecha, r.id)) continue
        const minL = redondear(Number(b.largo_m) + MARGEN_ESPACIO), minA = redondear(Number(b.ancho_m) + MARGEN_ESPACIO)
        const L = Number(r.espacio_largo), A = Number(r.espacio_ancho)
        const cabe = (L >= minL && A >= minA) || (L >= minA && A >= minL)
        const total = redondear(Number(b.precio_dia) + Number(b.garantia))
        lista.push({ id: b.id, nombre: b.nombre, precio: Number(b.precio_dia), garantia: Number(b.garantia), total, cabe,
            medidas: `${Number(b.largo_m)} × ${Number(b.ancho_m)} m`, diferencia: redondear(total - actual) })
    }
    return lista.sort((a, b) => (b.cabe - a.cabe) || Math.abs(a.precio - r.precio) - Math.abs(b.precio - r.precio))
}

// Mueve la renta a otra fecha y/o a otro modelo y cuadra el dinero 
async function reprogramar(db, r, { fecha, brincolinId, permitirReparacion = false }, datosPago, usuario) {
    const [[b]] = await db.query('SELECT * FROM brincolines WHERE id = ? FOR UPDATE', [brincolinId])
    if (!b) throw new ErrorNegocio('Ese brincolín no existe.', 404)
    const motivo = await motivoOcupado(db, b, fecha, r.id, permitirReparacion)
    if (motivo) throw new ErrorNegocio(`${b.nombre}: ${motivo.toLowerCase()}.`, 409)
    const minL = redondear(Number(b.largo_m) + MARGEN_ESPACIO), minA = redondear(Number(b.ancho_m) + MARGEN_ESPACIO)
    const L = Number(r.espacio_largo), A = Number(r.espacio_ancho)
    if (!((L >= minL && A >= minA) || (L >= minA && A >= minL))) {
        throw new ErrorNegocio(`El espacio que declaró el cliente (${L} × ${A} m) no alcanza para ${b.nombre}: necesita ${minL} × ${minA} m.`, 422)
    }
    const dRenta = redondear(Number(b.precio_dia) - r.precio), dGarantia = redondear(Number(b.garantia) - r.garantia)
    const cobrar = redondear(Math.max(dRenta, 0) + Math.max(dGarantia, 0))
    let pago = null
    if (cobrar > 0) pago = validarPago({ ...(datosPago || {}), medio: r.medio_pago }, cobrar)   // mismo medio que el pago original
    const persona = r.cliente_nombre
    if (dRenta < 0) await registrarPago(db, r, usuario.id, 'diferencia_cambio', dRenta, r.medio_pago, persona)
    if (dGarantia < 0) await registrarPago(db, r, usuario.id, 'devolucion_garantia', dGarantia, r.medio_pago, persona)
    if (dRenta > 0) await registrarPago(db, r, usuario.id, 'cobro_cambio', dRenta, r.medio_pago, persona, pago)
    if (dGarantia > 0) await registrarPago(db, r, usuario.id, 'garantia', dGarantia, r.medio_pago, persona, dRenta > 0 ? {} : pago)
    await db.query('UPDATE rentas_brincolin SET brincolin_id = ?, fecha = ?, precio = ?, garantia = ? WHERE id = ?',
        [b.id, fecha, b.precio_dia, b.garantia, r.id])
    const devuelto = redondear(-Math.min(dRenta, 0) - Math.min(dGarantia, 0))
    return { brincolin: b.nombre, fecha, devuelto, cobrado: cobrar, diferencia_renta: dRenta, cambio: pago ? pago.cambio : 0 }
}

const pendienteDe = async (db, rentaId) => {
    const [[i]] = await db.query("SELECT * FROM incidencias WHERE renta_id = ? AND accion = 'pendiente' ORDER BY id LIMIT 1 FOR UPDATE", [rentaId])
    return i || null
}

//falla es de la empresa
async function resolverFalla(id, datos, usuario) {
    datos = datos || {}
    const accion = String(datos.accion || '')
    if (!['reembolso', 'reagenda', 'cambio', 'sigue'].includes(accion)) throw new ErrorNegocio('Elige reembolso, otra fecha u otro modelo.', 422)
    return conRenta(id, async (db, r) => {
        const inc = await pendienteDe(db, r.id)
        if (!inc) throw new ErrorNegocio('Esta renta no tiene una falla pendiente.', 409)
        if (r.estado !== 'reservada') throw new ErrorNegocio(`La renta está ${r.estado_texto.toLowerCase()}.`, 409)
        let resultado, devuelto = 0, cobrado = 0, reemplazo = null, fechaNueva = null, accionFinal = accion
        if (accion === 'reembolso') {
            await registrarPago(db, r, usuario.id, 'reembolso_renta', -r.precio, r.medio_pago, r.cliente_nombre)
            await registrarPago(db, r, usuario.id, 'devolucion_garantia', -r.garantia, r.medio_pago, r.cliente_nombre)
            await db.query("UPDATE rentas_brincolin SET estado = 'cancelada', estado_garantia = 'devuelta' WHERE id = ?", [r.id])
            devuelto = redondear(r.precio + r.garantia)
            resultado = { devuelto, medio: r.medio_pago, a: r.cliente_nombre }
        } else if (accion === 'reagenda') {
            const { fecha } = await leerFecha(datos.fecha)
            if (fecha === r.fecha) throw new ErrorNegocio('Elige una fecha distinta.', 422)
            resultado = await reprogramar(db, r, { fecha, brincolinId: r.brincolin_id, permitirReparacion: true }, datos, usuario)
            fechaNueva = fecha
        } else if (accion === 'cambio') {
            const nuevo = Number(datos.brincolin_id)
            if (!nuevo || nuevo === r.brincolin_id) throw new ErrorNegocio('Elige otro modelo.', 422)
            resultado = await reprogramar(db, r, { fecha: r.fecha, brincolinId: nuevo }, datos, usuario)
            reemplazo = nuevo
        } else {
            const [[b]] = await db.query('SELECT estado FROM brincolines WHERE id = ?', [r.brincolin_id])
            if (['baja', 'en_reparacion'].includes(b.estado)) throw new ErrorNegocio('El brincolín sigue sin estar listo: elige reembolso, otra fecha u otro modelo.', 409)
            accionFinal = 'ninguna'
            resultado = { sigue: true }
        }
        if (resultado.devuelto !== undefined) devuelto = resultado.devuelto
        if (resultado.cobrado !== undefined) cobrado = resultado.cobrado
        await db.query(
            `UPDATE incidencias SET accion = ?, brincolin_reemplazo_id = ?, fecha_nueva = ?, monto_devuelto = ?, monto_cobrado = ?,
                    resuelta_en = NOW(), resuelta_por = ? WHERE id = ?`,
            [accionFinal, reemplazo, fechaNueva, devuelto, cobrado, usuario.id, inc.id])
        return { accion: accionFinal, ...resultado }
    })
}

//mientras haya disponibilidad, el cliente puede cambiar de modelo
async function cambiarModelo(id, datos, usuario) {
    datos = datos || {}
    const nuevo = Number(datos.brincolin_id)
    return conRenta(id, async (db, r) => {
        if (r.estado !== 'reservada') throw new ErrorNegocio(`La renta está ${r.estado_texto.toLowerCase()}.`, 409)
        if (r.hoy >= r.fecha) throw new ErrorNegocio('El cambio de modelo se pide a más tardar un día antes de la renta.', 409)
        if (await pendienteDe(db, r.id)) throw new ErrorNegocio('Hay una falla pendiente: resuélvela con la opción que elija el cliente.', 409)
        if (!nuevo || nuevo === r.brincolin_id) throw new ErrorNegocio('Elige otro modelo.', 422)
        const resultado = await reprogramar(db, r, { fecha: r.fecha, brincolinId: nuevo }, datos, usuario)
        await db.query(
            `INSERT INTO incidencias (renta_id, brincolin_id, usuario_id, tipo, descripcion, accion, brincolin_reemplazo_id, monto_devuelto, monto_cobrado, resuelta_en, resuelta_por)
             VALUES (?, ?, ?, 'cambio_cliente', ?, 'cambio', ?, ?, ?, NOW(), ?)`,
            [r.id, r.brincolin_id, usuario.id, `El cliente cambió ${r.brincolin} por ${resultado.brincolin}`, nuevo, resultado.devuelto, resultado.cobrado, usuario.id])
        return resultado
    })
}

//Si el cliente cancela no hay reembolso de la renta pero la garantía sí se devuelve porque no se usó
async function cancelarCliente(id, datos, usuario) {
    const motivo = texto((datos || {}).motivo)
    if (motivo.length < 5) throw new ErrorNegocio('Escribe el motivo de la cancelación.', 422)
    return conRenta(id, async (db, r) => {
        if (r.estado !== 'reservada') throw new ErrorNegocio(`La renta está ${r.estado_texto.toLowerCase()}.`, 409)
        if (r.hoy >= r.fecha) throw new ErrorNegocio('Ya es el día de la renta: no se puede cancelar.', 409)
        if (await pendienteDe(db, r.id)) throw new ErrorNegocio('Hay una falla de la empresa pendiente: al cliente le toca reembolso completo.', 409)
        await registrarPago(db, r, usuario.id, 'devolucion_garantia', -r.garantia, r.medio_pago, r.cliente_nombre)
        await db.query("UPDATE rentas_brincolin SET estado = 'cancelada', estado_garantia = 'devuelta' WHERE id = ?", [r.id])
        await db.query(
            `INSERT INTO incidencias (renta_id, brincolin_id, usuario_id, tipo, descripcion, accion, monto_devuelto, resuelta_en, resuelta_por)
             VALUES (?, ?, ?, 'cancelacion_cliente', ?, 'ninguna', ?, NOW(), ?)`,
            [r.id, r.brincolin_id, usuario.id, motivo, r.garantia, usuario.id])
        return { devuelto: r.garantia, sin_reembolso: r.precio, medio: r.medio_pago }
    })
}

// Lo que el detalle necesita además de la renta
async function extrasDetalle(r) {
    const [incidencias] = await conexion.query(
        `SELECT i.*, DATE_FORMAT(i.registrada_en, '%d/%m/%Y %H:%i') AS fecha_texto, DATE_FORMAT(i.fecha_nueva, '%Y-%m-%d') AS fecha_nueva,
                u.nombre AS usuario, b.nombre AS reemplazo
           FROM incidencias i JOIN usuarios u ON u.id = i.usuario_id LEFT JOIN brincolines b ON b.id = i.brincolin_reemplazo_id
          WHERE i.renta_id = ? ORDER BY i.id`, [r.id])
    incidencias.forEach(i => { i.tipo_texto = TIPOS_INCIDENCIA[i.tipo]; i.accion_texto = ACCIONES[i.accion] })
    const pendiente = incidencias.find(i => i.accion === 'pendiente') || null
    const antesDelDia = r.estado === 'reservada' && r.hoy < r.fecha
    const puede = {
        resolver: Boolean(pendiente) && r.estado === 'reservada',
        cambiar: antesDelDia && !pendiente,
        cancelar: antesDelDia && !pendiente
    }
    const [[b]] = await conexion.query('SELECT estado FROM brincolines WHERE id = ?', [r.brincolin_id])
    return {
        incidencias, pendiente, puede, estadoBrincolin: b.estado,
        sugerencias: (puede.resolver || puede.cambiar) ? await sugerencias(r) : []
    }
}

module.exports = {
    CAJA_BRINCOLINES, MARGEN_ESPACIO, ESTADOS, CONCEPTOS, folio, fechaLarga, leerFecha, motivoOcupado, catalogoPorFecha,
    terminos, datosTerminos, validarDatos, crearRenta, detalleRenta, listaRentas, conRenta, registrarPago,
    instalar, noInstalar, recoger, contrato, comprobante,
    TIPOS_INCIDENCIA, ACCIONES, marcarRentasAfectadas, equipo, reportarDano, terminarReparacion, sugerencias,
    resolverFalla, cambiarModelo, cancelarCliente, extrasDetalle
}
