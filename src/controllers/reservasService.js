// Renta de salones
const crypto = require('crypto')
const conexion = require('../database/db')
const { ErrorNegocio } = require('./menuService')
const { validarPago, MEDIOS_PAGO } = require('./cajaService')
const salones = require('./salonesService')
const pdf = require('./ticketPdf')

const CAJA_SALONES = 2                 // segunda caja
const NEGOCIO = 'Salón de Eventos y Snacks'
const redondear = n => Math.round(n * 100) / 100
const folio = id => `R-${String(id).padStart(4, '0')}`
const texto = v => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '')
const soloDigitos = v => String(v || '').replace(/[\s()-]/g, '')

// Términos y condiciones
function terminos(r) {
    const $ = n => `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    const lista = [
        `El salón solo se entrega con el responsable presente, quien se identifica con su INE. Sin responsable no se entrega el salón ni se recibe nada.`,
        `El responsable responde por el evento y por los menores: ningún menor sale solo del salón.`,
        `El cupo máximo es de ${r.aforo} personas. No se permite meter a más personas de las contratadas (${r.personas}) en este contrato.`,
        `No se permiten vendedores externos ni grupos musicales. Se incluye una bocina con música basica pero usted como el cliente puede poner su música. No se cobra descorche.`,
        r.con_alimentos
            ? `Eligio renta con alimentos por lo que está limitado a pizza entera, refresco en botella grande y hamburguesas con todo, sin carta especial, pastel ni alimentos de temporada. Incluye desechables. Los alimentos se pueden cancelar hasta un día antes del evento; lo pagado de ellos se devuelve por el mismo medio de pago para que lo tenga en cuenta.`
            : `Eligio la renta sin alimentos por lo que usted trae su comida, no incluye desechables y el salón se deja sin basura y con las mesas recogidas.`,
        r.pago_total
            ? `Faltan ${salones.DIAS_PAGO_TOTAL} días o menos para el evento: la renta se paga completa hoy.`
            : `Se aparta con el 50% y el resto se liquida a más tardar el ${r.fecha_limite_texto}. El salon no se le prestara a menos que se haya liquidado la renta completa.`,
        `Cuota de garantía de ${$(r.cuota)} esta se devuelve completa si el salón se entrega limpio y sin daños. Si se entrega sucio la cuota no se le devuelvera. Si hay daños graves se queda la cuota y el responsable paga lo que falte para repararlo.`,
        `La cuota se devuelve solo a quien pagó la renta (${r.cliente}) y firme el contrato, por el mismo medio con que pagó, no se le regresara alguien si no es el responsable puesto en este contrato.`
    ]
    return lista
}

// menú de eventos 
async function menuEventos(db = conexion) {
    const [productos] = await db.query(
        `SELECT p.id, p.nombre, p.precio_base, i.archivo AS imagen
           FROM productos p LEFT JOIN imagenes i ON i.id = p.imagen_id
          WHERE p.en_eventos = 1 AND p.activo = 1 AND p.temporada_id IS NULL
            AND (p.vigente_hasta IS NULL OR p.vigente_hasta > NOW())
          ORDER BY p.categoria_id, p.nombre`)
    if (!productos.length) return []
    const ids = productos.map(p => p.id)
    const [estilos] = await db.query(
        `SELECT id, producto_id, nombre, precio_extra FROM estilos
          WHERE producto_id IN (?) AND activo = 1 AND temporada_id IS NULL ORDER BY id`, [ids])
    const [tamanos] = await db.query(
        `SELECT id, producto_id, nombre, precio FROM tamanos
          WHERE producto_id IN (?) AND en_eventos = 1 ORDER BY orden, precio`, [ids])
    return productos.map(p => ({
        ...p,
        precio_base: Number(p.precio_base),
        estilos: estilos.filter(e => e.producto_id === p.id).map(e => ({ ...e, precio_extra: Number(e.precio_extra) })),
        tamanos: tamanos.filter(t => t.producto_id === p.id).map(t => ({ ...t, precio: Number(t.precio) }))
    }))
}

// Validacion de las líneas de alimentos y calcular su precio 
async function armarAlimentos(lineas, db = conexion) {
    const menu = await menuEventos(db)
    const resultado = []
    for (const l of (Array.isArray(lineas) ? lineas : [])) {
        const p = menu.find(m => m.id === Number(l.producto_id))
        if (!p) throw new ErrorNegocio('Ese alimento no está en el menú de eventos', 422)
        const cantidad = Number(l.cantidad)
        if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 500) throw new ErrorNegocio(`Escribe cuántos(as) ${p.nombre} (1 a 500).`, 422)
        let precio = p.precio_base, tamano = null, estilo = null
        if (p.tamanos.length) {
            tamano = p.tamanos.find(t => t.id === Number(l.tamano_id))
            if (!tamano && l.tamano_id) throw new ErrorNegocio(`Ese tamaño de ${p.nombre} no se ofrece en eventos (solo ${p.tamanos.map(t => t.nombre).join(', ')}).`, 422)
            if (!tamano) throw new ErrorNegocio(`Elige el tamaño de ${p.nombre}.`, 422)
            precio = tamano.precio
        }
        if (p.estilos.length) {
            estilo = p.estilos.find(e => e.id === Number(l.estilo_id))
            if (!estilo) throw new ErrorNegocio(`Elige el sabor de ${p.nombre}.`, 422)
            precio += estilo.precio_extra
        }
        // Las hamburguesas van con todo
        const descripcion = [p.nombre + (tamano ? ` ${tamano.nombre}` : ''), estilo && estilo.nombre, !tamano && !estilo && 'con todo'].filter(Boolean).join(' · ')
        resultado.push({ producto_id: p.id, estilo_id: estilo ? estilo.id : null, tamano_id: tamano ? tamano.id : null,
            descripcion, cantidad, precio_unitario: redondear(precio), subtotal: redondear(precio * cantidad) })
    }
    return resultado
}

// brincolines que se pueden incluir ese día 
async function brincolinesLibres(fecha, db = conexion, bloquear = false) {
    const hoy = await salones.hoyBD()
    const [filas] = await db.query(
        `SELECT b.id, b.nombre, b.descripcion, b.largo_m, b.ancho_m, b.alto_m, b.estado, i.archivo AS imagen
           FROM brincolines b LEFT JOIN imagenes i ON i.id = b.imagen_id
          WHERE b.estado ${fecha === hoy ? "= 'disponible'" : "IN ('disponible', 'rentado', 'en_limpieza')"}
            AND NOT EXISTS (SELECT 1 FROM reserva_brincolines rb JOIN reservas_salon r ON r.id = rb.reserva_id
                             WHERE rb.brincolin_id = b.id AND r.fecha_evento = ? AND r.estado <> 'cancelada')
            -- Sprint 9: tampoco si está rentado a domicilio ese día o se recoge ese día
            AND NOT EXISTS (SELECT 1 FROM rentas_brincolin rd
                             WHERE rd.brincolin_id = b.id AND rd.activa = 1 AND rd.fecha IN (?, DATE_SUB(?, INTERVAL 1 DAY)))
          ORDER BY b.nombre ${bloquear ? 'FOR UPDATE' : ''}`, [fecha, fecha, fecha])
    return filas
}

// Validación de quien paga y del responsable 
function edadEn(nacimiento, fecha) {
    const [a1, m1, d1] = nacimiento.split('-').map(Number)
    const [a2, m2, d2] = fecha.split('-').map(Number)
    return a2 - a1 - (m2 < m1 || (m2 === m1 && d2 < d1) ? 1 : 0)
}

function validarPersonas(datos, fechaEvento) {
    const errores = []
    const c = datos.cliente || {}, r = datos.responsable || {}
    const cliente = { nombre: texto(c.nombre), telefono: soloDigitos(c.telefono), correo: texto(c.correo).toLowerCase() }
    if (cliente.nombre.length < 3 || cliente.nombre.length > 100) errores.push('Escribe el nombre completo de quien renta y paga.')
    if (!/^\d{10}$/.test(cliente.telefono)) errores.push('El teléfono de quien paga debe tener 10 dígitos.')
    if (cliente.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cliente.correo)) errores.push('Revisa el correo de quien paga.')

    const mismo = r.es_cliente === true || r.es_cliente === '1'
    const responsable = {
        nombre: mismo ? cliente.nombre : texto(r.nombre),
        celular: mismo ? cliente.telefono : soloDigitos(r.celular),
        ine: String(r.ine || '').toUpperCase().replace(/\s/g, ''),
        fecha_nacimiento: String(r.fecha_nacimiento || ''),
        direccion: texto(r.direccion)
    }
    if (responsable.nombre.length < 3 || responsable.nombre.length > 100) errores.push('Escribe el nombre completo del responsable.')
    if (!/^[A-Z0-9]{18}$/.test(responsable.ine)) errores.push('La clave de elector del INE tiene 18 letras y números.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(responsable.fecha_nacimiento) || Number.isNaN(Date.parse(responsable.fecha_nacimiento))) {
        errores.push('Escribe la fecha de nacimiento del responsable.')
    } else if (edadEn(responsable.fecha_nacimiento, fechaEvento) < 18) {
        errores.push('El responsable debe ser mayor de edad el día del evento.')
    } else if (edadEn(responsable.fecha_nacimiento, fechaEvento) > 110) {
        errores.push('Revisa la fecha de nacimiento del responsable.')
    }
    if (!/^\d{10}$/.test(responsable.celular)) errores.push('El celular del responsable debe tener 10 dígitos.')
    if (responsable.direccion.length < 10 || responsable.direccion.length > 255) errores.push('Escribe la dirección completa del responsable (calle, número, colonia y ciudad).')

    // firma del responsable
    const firma = String(datos.firma || '')
    const base64 = firma.startsWith('data:image/png;base64,') ? firma.slice(22) : ''
    let png = null
    if (base64 && base64.length < 400000 && /^[A-Za-z0-9+/=]+$/.test(base64)) png = Buffer.from(base64, 'base64')
    if (!png || png.length < 100 || png.slice(1, 4).toString() !== 'PNG') errores.push('Falta la firma del responsable.')
    if (!(datos.acepta_terminos === true || datos.acepta_terminos === '1')) errores.push('El responsable debe aceptar los términos y condiciones.')

    return { errores, cliente, responsable, firma: png ? firma : null }
}

//  Datos del PDF 
const fechaTexto = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('es-MX', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

function datosPdf(r, tipo) {
    return {
        tipo, negocio: NEGOCIO, folio: folio(r.id),
        emitido: new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }),
        salon: r.salon, tamano: r.tamano, aforo: r.aforo, fecha: fechaTexto(r.fecha_evento),
        personas: r.personas, con_alimentos: Boolean(r.con_alimentos), fiesta_menores: Boolean(r.fiesta_menores),
        mobiliario: r.mobiliario, brincolines: r.brincolines.map(b => b.nombre),
        alimentos: r.alimentos.map(a => ({ descripcion: a.descripcion, cantidad: a.cantidad, precio: Number(a.precio_unitario), estado: a.estado })),
        cliente: { nombre: r.cliente_nombre, telefono: r.cliente_telefono, correo: r.cliente_correo },
        responsable: { nombre: r.responsable_nombre, ine: r.responsable_ine, nacimiento: r.responsable_nacimiento,
            celular: r.responsable_celular, direccion: r.responsable_direccion },
        firma: tipo === 'contrato' ? r.firma_imagen : null,
        importes: { renta: Number(r.precio_renta), alimentos: Number(r.total_alimentos), precio: Number(r.precio_total),
            cuota: Number(r.cuota_garantia), pagado: r.pagado_renta, saldo: r.saldo, fecha_limite: r.fecha_limite_texto },
        medio: r.medio_pago, encargado: r.encargado,
        pagos: r.pagos.map(p => ({ fecha: p.creado_texto, concepto: p.concepto_texto, medio: p.medio, monto: Number(p.monto), persona: p.persona })),
        estado: r.estado_texto, cuota_estado: r.estado_cuota, resultado: r.resultado,
        terminos: terminos({ ...r, aforo: r.aforo, cliente: r.cliente_nombre, cuota: r.cuota_garantia,
            pago_total: r.pago_total_inicial, fecha_limite_texto: r.fecha_limite_texto })
    }
}

// crear la reserva completa en una sola transacción
async function crearReserva(datos, usuario) {
    datos = datos || {}
    const si = v => v === true || v === 1 || v === '1'
    const consulta = await salones.leerConsulta({ fecha: datos.fecha, personas: datos.personas, con_alimentos: si(datos.con_alimentos) ? '1' : '0' })
    const salonId = Number(datos.salon_id)
    if (!Number.isInteger(salonId) || salonId < 1) throw new ErrorNegocio('Elige el salón.', 422)

    //requisitos de reserva
    const disp = await salones.disponibilidad({ fecha: consulta.fecha, personas: consulta.personas, con_alimentos: consulta.conAlimentos ? '1' : '0' })
    const s = disp.salones.find(x => x.id === salonId)
    if (!s) throw new ErrorNegocio('Ese salón no existe o no está activo.', 404)
    if (!s.disponible) throw new ErrorNegocio(`${s.nombre}: ${s.motivo}.`, 409)

    let alimentos = []
    if (consulta.conAlimentos) {
        if (consulta.fecha === consulta.hoy) throw new ErrorNegocio('Los alimentos se piden con anticipación', 422)
        alimentos = await armarAlimentos(datos.alimentos)
        if (!alimentos.length) throw new ErrorNegocio('Con alimentos, agrega al menos un platillo del menú de eventos.', 422)
    } else if (Array.isArray(datos.alimentos) && datos.alimentos.length) {
        throw new ErrorNegocio('Sin alimentos no se piden platillos', 422)
    }
    const totalAlimentos = redondear(alimentos.reduce((t, a) => t + a.subtotal, 0))

    // brincolines elegidos del catálogo
    const elegidos = [...new Set((Array.isArray(datos.brincolines) ? datos.brincolines : []).map(Number))]
    if (elegidos.length > s.brincolines) throw new ErrorNegocio(`${s.nombre} incluye máximo ${s.brincolines} brincolín(es).`, 422)

    const personas = validarPersonas(datos, consulta.fecha)
    if (personas.errores.length) throw Object.assign(new ErrorNegocio(personas.errores[0], 422), { errores: personas.errores })

    const [[salon]] = await conexion.query('SELECT * FROM salones WHERE id = ?', [salonId])
    const k = salones.cotizar(salon, consulta.fecha, consulta.hoy, totalAlimentos)
    const pago = validarPago(datos.pago, k.anticipo)                  

    const db = await conexion.getConnection()
    try {
        await db.beginTransaction()
        // Bloqueo del salón
        await db.query('SELECT id FROM salones WHERE id = ? FOR UPDATE', [salonId])
        const [[ocupado]] = await db.query(
            "SELECT id FROM reservas_salon WHERE salon_id = ? AND fecha_evento = ? AND estado <> 'cancelada' FOR UPDATE", [salonId, consulta.fecha])
        if (ocupado) throw new ErrorNegocio(`${salon.nombre} ya está rentado ese día.`, 409)

        if (elegidos.length) {
            const libres = await brincolinesLibres(consulta.fecha, db, true)
            const noLibre = elegidos.find(id => !libres.some(b => b.id === id))
            if (noLibre) {
                const [[b]] = await db.query('SELECT nombre FROM brincolines WHERE id = ?', [noLibre])
                throw new ErrorNegocio(b ? `El brincolín "${b.nombre}" no está disponible ese día.` : 'Ese brincolín no existe.', 409)
            }
        }

        const [cli] = await db.query('INSERT INTO clientes (nombre, telefono, correo) VALUES (?, ?, ?)',
            [personas.cliente.nombre, personas.cliente.telefono, personas.cliente.correo || null])
        const r = personas.responsable
        const [resp] = await db.query(
            `INSERT INTO responsables (nombre, ine, fecha_nacimiento, celular, direccion, firma_imagen) VALUES (?, ?, ?, ?, ?, ?)`,
            [r.nombre, r.ine, r.fecha_nacimiento, r.celular, r.direccion, personas.firma])
        const [res] = await db.query(
            `INSERT INTO reservas_salon (salon_id, cliente_id, responsable_id, usuario_id, fecha_evento, personas, con_alimentos, fiesta_menores,
                                         precio_renta, total_alimentos, precio_total, anticipo, fecha_limite_pago, cuota_garantia, medio_pago,
                                         tyc_aceptados_en, estado)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
            [salonId, cli.insertId, resp.insertId, usuario.id, consulta.fecha, consulta.personas, consulta.conAlimentos ? 1 : 0,
             si(datos.fiesta_menores) ? 1 : 0,
             k.renta, k.alimentos, k.precio, k.pago_renta, k.fecha_limite, k.cuota, pago.medio, k.pago_total ? 'liquidada' : 'apartada'])
        const reservaId = res.insertId

        for (const id of elegidos) await db.query('INSERT INTO reserva_brincolines (reserva_id, brincolin_id) VALUES (?, ?)', [reservaId, id])
        for (const a of alimentos) {
            await db.query(
                `INSERT INTO reserva_alimentos (reserva_id, producto_id, estilo_id, tamano_id, descripcion, cantidad, precio_unitario)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`, [reservaId, a.producto_id, a.estilo_id, a.tamano_id, a.descripcion, a.cantidad, a.precio_unitario])
        }

        //Dos movimientos en la caja 
        const insertarPago = (concepto, monto, extra = {}) => db.query(
            `INSERT INTO pagos_reserva (reserva_id, caja_id, usuario_id, concepto, monto, medio, recibido, cambio, referencia, persona)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [reservaId, CAJA_SALONES, usuario.id, concepto, monto, pago.medio, extra.recibido ?? null, extra.cambio ?? 0, pago.referencia, personas.cliente.nombre])
        await insertarPago(k.pago_total ? 'pago_total' : 'apartado', k.pago_renta, { recibido: pago.recibido, cambio: pago.cambio })
        await insertarPago('cuota', k.cuota)

        // Contrato PDF con la firma se genera ANTES de confirmar
        const completa = await detalleReserva(reservaId, db, { conFirma: true })
        const archivo = await pdf.generar(datosPdf(completa, 'contrato'), 'salon_pdf.py')
        await db.query('INSERT INTO contratos_salon (reserva_id, pdf, sha256) VALUES (?, ?, ?)',
            [reservaId, archivo, crypto.createHash('sha256').update(archivo).digest('hex')])
        await db.query('UPDATE reservas_salon SET contrato_pdf = ? WHERE id = ?', [`contrato-${folio(reservaId)}.pdf`, reservaId])

        await db.commit()
        return { id: reservaId, folio: folio(reservaId), cambio: pago.cambio, cobrado: k.anticipo, estado: k.pago_total ? 'liquidada' : 'apartada' }
    } catch (e) {
        await db.rollback()
        if (e.code === 'ER_DUP_ENTRY') throw new ErrorNegocio(`${salon.nombre} ya está rentado ese día.`, 409)
        if (!(e instanceof ErrorNegocio) && /Python|reportlab|PDF/i.test(e.message)) {
            throw new ErrorNegocio(`No se guardó la reserva porque no se pudo generar el contrato: ${e.message}`, 503)
        }
        throw e
    } finally {
        db.release()
    }
}

// Detalle de una reserva, con lo pagado, el saldo y qué se puede hacer con ella
const CONCEPTOS = {
    apartado: 'Apartado un 50%', pago_total: 'Pago total', liquidacion: 'Liquidación', cuota: 'Cuota de garantía',
    devolucion_cuota: 'Devolución de la cuota', cargo_danos: 'Cargo por daños', reembolso_alimentos: 'Reembolso de alimentos'
}
const ESTADOS = { apartada: 'Apartada', liquidada: 'Liquidada', en_curso: 'Salón entregado', en_revision: 'En revisión (Limpieza)', realizada: 'Terminada', cancelada: 'Cancelada' }
const RENTA = ['apartado', 'pago_total', 'liquidacion', 'reembolso_alimentos']

async function detalleReserva(id, db = conexion, opciones = {}) {
    const [[r]] = await db.query(
        `SELECT r.*, DATE_FORMAT(r.fecha_evento, '%Y-%m-%d') AS fecha_evento, DATE_FORMAT(r.fecha_limite_pago, '%Y-%m-%d') AS fecha_limite,
                DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoy,
                s.nombre AS salon, s.tamano, s.aforo_maximo AS aforo, s.max_brincolines,
                c.nombre AS cliente_nombre, c.telefono AS cliente_telefono, c.correo AS cliente_correo,
                p.nombre AS responsable_nombre, p.ine AS responsable_ine, DATE_FORMAT(p.fecha_nacimiento, '%Y-%m-%d') AS responsable_nacimiento,
                p.celular AS responsable_celular, p.direccion AS responsable_direccion, (p.firma_imagen IS NOT NULL) AS firmado,
                ${opciones.conFirma ? 'p.firma_imagen,' : ''}
                u.nombre AS encargado, ue.nombre AS entrego, ur.nombre AS recibio,
                (SELECT sha256 FROM contratos_salon k WHERE k.reserva_id = r.id) AS contrato_sha256
           FROM reservas_salon r
           JOIN salones s ON s.id = r.salon_id
           JOIN clientes c ON c.id = r.cliente_id
           JOIN responsables p ON p.id = r.responsable_id
           JOIN usuarios u ON u.id = r.usuario_id
           LEFT JOIN usuarios ue ON ue.id = r.entregado_por
           LEFT JOIN usuarios ur ON ur.id = r.recibido_por
          WHERE r.id = ?`, [id])
    if (!r) return null
    const [brincolines] = await db.query(
        `SELECT b.id, b.nombre, b.estado FROM reserva_brincolines rb JOIN brincolines b ON b.id = rb.brincolin_id WHERE rb.reserva_id = ? ORDER BY b.nombre`, [id])
    const [alimentos] = await db.query('SELECT * FROM reserva_alimentos WHERE reserva_id = ? ORDER BY id', [id])
    const [pagos] = await db.query(
        `SELECT pr.*, DATE_FORMAT(pr.creado_en, '%d/%m/%Y %H:%i') AS creado_texto, u.nombre AS usuario
           FROM pagos_reserva pr JOIN usuarios u ON u.id = pr.usuario_id WHERE pr.reserva_id = ? ORDER BY pr.id`, [id])
    pagos.forEach(p => { p.monto = Number(p.monto); p.concepto_texto = CONCEPTOS[p.concepto] })

    const suma = conceptos => redondear(pagos.filter(p => conceptos.includes(p.concepto)).reduce((t, p) => t + p.monto, 0))
    r.precio_total = Number(r.precio_total)
    r.cuota_garantia = Number(r.cuota_garantia)
    r.cargo_danos = Number(r.cargo_danos)
    r.pagado_renta = suma(RENTA)
    r.saldo = redondear(Math.max(0, r.precio_total - r.pagado_renta))
    r.cargo_pendiente = redondear(Math.max(0, r.cargo_danos - suma(['cargo_danos'])))
    r.pago_total_inicial = pagos.some(p => p.concepto === 'pago_total')
    r.brincolines = brincolines
    r.alimentos = alimentos
    r.pagos = pagos
    r.folio = folio(r.id)
    r.estado_texto = ESTADOS[r.estado]
    r.fecha_limite_texto = r.fecha_limite.split('-').reverse().join('/')
    r.mobiliario = salones.mobiliarioNecesario(r.personas, Boolean(r.con_alimentos))
    r.medio_cuota = (pagos.find(p => p.concepto === 'cuota') || {}).medio || r.medio_pago
    r.vencida = r.estado === 'apartada' && r.saldo > 0 && r.hoy > r.fecha_limite
    r.es_hoy = r.fecha_evento === r.hoy

    r.puede = {
        liquidar: r.estado === 'apartada' && r.saldo > 0,
        cancelarAlimentos: Boolean(r.con_alimentos) && !r.alimentos_cancelados_en && ['apartada', 'liquidada'].includes(r.estado) && r.hoy < r.fecha_evento,
        entregar: ['apartada', 'liquidada'].includes(r.estado) && r.es_hoy,
        recibir: r.estado === 'en_curso',
        cobrarDanos: r.cargo_pendiente > 0
    }
    return r
}

// Lista con filtro
async function listaReservas(filtro = 'proximas') {
    const condiciones = {
        proximas: "((r.fecha_evento >= CURDATE() AND r.estado IN ('apartada', 'liquidada', 'en_curso')) OR r.estado = 'en_revision')",
        hoy: "r.fecha_evento = CURDATE() AND r.estado <> 'cancelada'",
        por_liquidar: "r.estado = 'apartada'",
        terminadas: "r.estado IN ('realizada', 'cancelada')",
        todas: '1 = 1'
    }
    const donde = condiciones[filtro] || condiciones.proximas
    const [filas] = await conexion.query(`
        SELECT r.id, DATE_FORMAT(r.fecha_evento, '%Y-%m-%d') AS fecha, DATE_FORMAT(r.fecha_limite_pago, '%Y-%m-%d') AS fecha_limite,
               r.personas, r.con_alimentos, r.fiesta_menores, r.estado, r.estado_cuota, r.precio_total, r.cargo_danos,
               s.nombre AS salon, s.tamano, c.nombre AS cliente, p.nombre AS responsable,
               r.precio_total - COALESCE((SELECT SUM(pr.monto) FROM pagos_reserva pr
                                           WHERE pr.reserva_id = r.id AND pr.concepto IN ('apartado','pago_total','liquidacion','reembolso_alimentos')), 0) AS saldo,
               r.fecha_limite_pago < CURDATE() AS limite_pasado
          FROM reservas_salon r
          JOIN salones s ON s.id = r.salon_id
          JOIN clientes c ON c.id = r.cliente_id
          JOIN responsables p ON p.id = r.responsable_id
         WHERE ${donde}
         ORDER BY ${filtro === 'terminadas' ? 'r.fecha_evento DESC' : 'r.fecha_evento, s.nombre'}
         LIMIT 300`)
    filas.forEach(f => {
        f.folio = folio(f.id)
        f.saldo = redondear(Math.max(0, Number(f.saldo)))
        f.vencida = f.estado === 'apartada' && f.saldo > 0 && Boolean(f.limite_pasado)
        f.estado_texto = ESTADOS[f.estado]
    })
    return filas
}

// ve la reserva con bloqueo de fila para evitar que se modifique mientras se hace un pago o se cancela alimentos
async function conReserva(id, accion) {
    const db = await conexion.getConnection()
    try {
        await db.beginTransaction()
        const [[bloqueo]] = await db.query('SELECT id FROM reservas_salon WHERE id = ? FOR UPDATE', [Number(id) || 0])
        if (!bloqueo) throw new ErrorNegocio('Esa reserva no existe.', 404)
        const r = await detalleReserva(bloqueo.id, db)
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
    `INSERT INTO pagos_reserva (reserva_id, caja_id, usuario_id, concepto, monto, medio, recibido, cambio, referencia, persona)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [r.id, CAJA_SALONES, usuarioId, concepto, monto, medio, extra.recibido ?? null, extra.cambio ?? 0, extra.referencia ?? null, persona])

// liquidar el resto 
async function liquidar(id, datosPago, usuario) {
    return conReserva(id, async (db, r) => {
        if (!r.puede.liquidar) throw new ErrorNegocio(r.saldo <= 0 ? 'Esta reserva ya está liquidada.' : 'Esta reserva ya no se puede liquidar.', 409)
        const pago = validarPago(datosPago, r.saldo)
        await registrarPago(db, r, usuario.id, 'liquidacion', r.saldo, pago.medio, r.cliente_nombre, pago)
        await db.query("UPDATE reservas_salon SET estado = 'liquidada' WHERE id = ?", [r.id])
        return { monto: r.saldo, cambio: pago.cambio, medio: pago.medio }
    })
}

// cancelar los alimentos del evento antes de prepararlos 
async function cancelarAlimentos(id, motivo, usuario) {
    motivo = texto(motivo)
    if (motivo.length < 5 || motivo.length > 255) throw new ErrorNegocio('Escribe el motivo de la cancelación maximo 255 caracteres.', 422)
    return conReserva(id, async (db, r) => {
        if (!r.con_alimentos || r.alimentos_cancelados_en) throw new ErrorNegocio('Esta reserva no tiene alimentos que cancelar.', 409)
        if (!['apartada', 'liquidada'].includes(r.estado)) throw new ErrorNegocio('El evento ya empezó.', 409)
        if (r.hoy >= r.fecha_evento) throw new ErrorNegocio('hoy ya se están preparando. No puede cancelarse.', 409)
        const nuevoPrecio = redondear(r.precio_total - Number(r.total_alimentos))
        const devolver = redondear(Math.max(0, r.pagado_renta - nuevoPrecio))
        if (devolver > 0) await registrarPago(db, r, usuario.id, 'reembolso_alimentos', -devolver, r.medio_pago, r.cliente_nombre)
        const pagadoDespues = redondear(r.pagado_renta - devolver)
        await db.query("UPDATE reserva_alimentos SET estado = 'cancelado' WHERE reserva_id = ?", [r.id])
        await db.query(
            `UPDATE reservas_salon SET precio_total = ?, con_alimentos = 0, alimentos_cancelados_en = NOW(), motivo_alimentos = ?,
                    estado = IF(estado = 'apartada' AND ? >= ?, 'liquidada', estado)
              WHERE id = ?`, [nuevoPrecio, motivo, pagadoDespues, nuevoPrecio, r.id])
        return { devuelto: devolver, medio: r.medio_pago, a: r.cliente_nombre }
    })
}

//entregar el salón el día del evento
async function entregarSalon(id, datos, usuario) {
    datos = datos || {}
    return conReserva(id, async (db, r) => {
        if (!['apartada', 'liquidada'].includes(r.estado)) throw new ErrorNegocio(`No se puede entregar la reserva está ${r.estado_texto.toLowerCase()}.`, 409)
        if (!r.es_hoy) throw new ErrorNegocio(`El salón se debe entregar el día del evento (${r.fecha_evento.split('-').reverse().join('/')}).`, 409)
        if (r.saldo > 0) throw new ErrorNegocio(`Falta liquidar $${r.saldo.toFixed(2)}: el salon no está pagado.`, 409)
        if (!(datos.responsable_presente === true || datos.responsable_presente === '1')) {
            throw new ErrorNegocio('Sin el responsable presente no se entrega el salón.', 409)
        }
        const ine = String(datos.ine || '').toUpperCase().replace(/\s/g, '')
        if (ine.length < 4 || !r.responsable_ine.endsWith(ine)) {
            throw new ErrorNegocio('Los últimos 4 caracteres del INE no coinciden con los del responsable del contrato.', 409)
        }
        if (r.fiesta_menores && !(datos.menores === true || datos.menores === '1')) {
            throw new ErrorNegocio('Es fiesta de menores confirma que el responsable se queda a cargo y que ningún menor sale solo.', 422)
        }
        if (!(datos.reglas === true || datos.reglas === '1')) {
            throw new ErrorNegocio('Confirma que no entran vendedores externos ni grupos musicales y que se entregó la bocina.', 422)
        }
        await db.query("UPDATE reservas_salon SET estado = 'en_curso', entregado_en = NOW(), entregado_por = ? WHERE id = ?", [usuario.id, r.id])
        return { responsable: r.responsable_nombre }
    })
}

// al terminar, el encargado recibe el salón y lo pasa a Limpieza
async function recibirSalon(id, datos, usuario) {
    return conReserva(id, async (db, r) => {
        if (r.estado !== 'en_curso') throw new ErrorNegocio('Fiesta sin terminar.', 409)
        await db.query("UPDATE reservas_salon SET estado = 'en_revision', recibido_en = NOW(), recibido_por = ? WHERE id = ?", [usuario.id, r.id])
        await db.query("INSERT INTO tareas_limpieza (tipo, reserva_id, origen, creada_por) VALUES ('salon', ?, ?, ?)",
            [r.id, `Fin del evento ${r.folio}`, usuario.id])
        return { estado: 'en_revision', salon: r.salon }
    })
}

// Valida lo que anota Limpieza al revisar el salón
function leerRevisionSalon(datos) {
    datos = datos || {}
    const resultado = String(datos.resultado || '')
    if (!['limpio', 'sucio', 'danos'].includes(resultado)) throw new ErrorNegocio('Elige cómo se entregó el salón: limpio, sucio o con daños ;p.', 422)
    const descripcion = texto(datos.descripcion)
    const costo = resultado === 'danos' ? Number(datos.costo) : 0
    if (resultado === 'danos') {
        if (descripcion.length < 5) throw new ErrorNegocio('Describe los daños.', 422)
        if (!Number.isFinite(costo) || costo <= 0 || costo > 500000) throw new ErrorNegocio('Escribe cuánto cuesta reparar los daños.', 422)
    }
    if (resultado === 'sucio' && descripcion.length < 5) throw new ErrorNegocio('Anota qué se dejó sucio.', 422)
    return { resultado, descripcion, costo }
}

// Con la revisión de Limpieza se decide la cuota 
async function revisarSalon(db, reservaId, revision, usuario) {
    await db.query('SELECT id FROM reservas_salon WHERE id = ? FOR UPDATE', [reservaId])
    const r = await detalleReserva(reservaId, db)
    if (!r || r.estado !== 'en_revision') throw new ErrorNegocio('Ese salón no está esperando revisión.', 409)
    const { resultado, descripcion, costo } = revision
    let devuelto = 0, cargo = 0
    if (resultado === 'limpio') {
        devuelto = r.cuota_garantia
        if (devuelto > 0) await registrarPago(db, r, usuario.id, 'devolucion_cuota', -devuelto, r.medio_cuota, r.cliente_nombre)
    } else if (resultado === 'danos') {
        cargo = redondear(Math.max(0, costo - r.cuota_garantia))
    }
    await db.query(
        `UPDATE reservas_salon SET estado = 'realizada', resultado = ?, danos_descripcion = ?, costo_danos = ?, cargo_danos = ?, estado_cuota = ? WHERE id = ?`,
        [resultado, descripcion || null, redondear(costo), cargo, resultado === 'limpio' ? 'devuelta' : 'cobrada', r.id])
    return { resultado, devuelto, medio: r.medio_cuota, a: r.cliente_nombre, cargo, responsable: r.responsable_nombre, folio: r.folio }
}

// responsable paga el excedente de los daños
async function cobrarDanos(id, datosPago, usuario) {
    return conReserva(id, async (db, r) => {
        if (r.cargo_pendiente <= 0) throw new ErrorNegocio('Esta reserva no tiene cargos por daños pendientes.', 409)
        const pago = validarPago(datosPago, r.cargo_pendiente)
        await registrarPago(db, r, usuario.id, 'cargo_danos', r.cargo_pendiente, pago.medio, r.responsable_nombre, pago)
        return { monto: r.cargo_pendiente, cambio: pago.cambio }
    })
}

//contrato tal como se firmó
async function contrato(id) {
    const [[k]] = await conexion.query('SELECT pdf, sha256 FROM contratos_salon WHERE reserva_id = ?', [Number(id) || 0])
    return k || null
}

// comprobante con quién rentó, quién responde y cada pago con su medio
async function comprobante(id) {
    const r = await detalleReserva(Number(id) || 0)
    if (!r) return null
    return { r, pdf: await pdf.generar(datosPdf(r, 'comprobante'), 'salon_pdf.py') }
}

module.exports = {
    CAJA_SALONES, MEDIOS_PAGO, CONCEPTOS, terminos, folio, menuEventos, armarAlimentos, brincolinesLibres, validarPersonas,
    crearReserva, detalleReserva, listaReservas, liquidar, cancelarAlimentos, entregarSalon, recibirSalon, leerRevisionSalon, revisarSalon, cobrarDanos,
    contrato, comprobante, datosPdf
}
