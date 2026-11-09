// Módulo 2 — Punto de venta y comandas (Sprint 4): US-21 a US-31
const conexion = require('../database/db')
const menu = require('./menuService')
const caja = require('./cajaService')
const ticketPdf = require('./ticketPdf')
const tiempoReal = require('./tiempoReal')
const { entero, fecha, fechaCorta } = require('./formatos')
const { ROLES } = require('../routes/modulos')

const esAdmin = req => req.usuario.rol === ROLES.ADMIN

// Lo cancelado sale de la cola de cocina y de "Para entregar" sin recargar la página
function avisarCancelacion() {
    tiempoReal.emitir('cocina', 'cocina:cambio', { motivo: 'cancelacion' })
    tiempoReal.emitir('recepcion', 'recepcion:cambio', { motivo: 'cancelacion' })
}

// Pantalla de la caja: menú vendible hoy, mesas activas y cuentas abiertas
exports.puntoDeVenta = async (req, res, next) => {
    try {
        const productos = (await menu.menuCompleto()).filter(p => p.vendible).map(p => ({
            id: p.id, nombre: p.nombre, categoria: p.categoria, imagen: p.imagen, descripcion: p.descripcion,
            precio_base: p.precio_base, precio_desde: p.precio_desde, piezas: p.piezas_por_orden,
            va_a_cocina: Boolean(p.requiere_preparacion), permite_quitar: Boolean(p.permite_quitar),
            fijos: p.fijos.map(i => ({ id: i.id, nombre: i.nombre })),
            moviles: p.moviles.map(i => ({ id: i.id, nombre: i.nombre })),
            extras: p.extras.map(i => ({ id: i.id, nombre: i.nombre, precio: i.precio })),
            tamanos: p.tamanos.map(t => ({ id: t.id, nombre: t.nombre, precio: t.precio })),
            estilos: p.estilos.filter(e => e.disponible).map(e => ({ id: e.id, nombre: e.nombre, precio_extra: e.precio_extra, imagen: e.imagen }))
        }))
        const [mesas] = await conexion.query('SELECT id, numero, capacidad FROM mesas WHERE activo = 1 ORDER BY numero')
        const cuentas = await caja.cuentasAbiertas()
        const cajaActual = await caja.cajaSnacks()
        res.render('caja/punto_venta', { titulo: 'Punto de venta', productos, mesas, cuentas, cajaActual })
    } catch (e) { next(e) }
}

// Registra la comanda (JSON). El servidor vuelve a validar y a calcular TODO.
exports.registrar = async (req, res, next) => {
    try {
        const resultado = await caja.registrarComanda(req.body || {}, req.usuario.id)
        // Sprint 5: la cocina se entera al instante (US-32); las nuevas se forman al final
        if (resultado.a_cocina) tiempoReal.emitir('cocina', 'cocina:nueva', { folio: resultado.folio, articulos: resultado.a_cocina })
        res.status(201).json(resultado)
    } catch (e) {
        if (e instanceof caja.ErrorNegocio) return res.status(e.status).json({ error: e.message })
        next(e)
    }
}

// Historial del día
exports.comandas = async (req, res, next) => {
    try {
        const [[{ hoy }]] = await conexion.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoy")
        const dia = fecha(req.query.fecha) || hoy
        const comandas = await caja.comandasDelDia(dia)
        const vigentes = comandas.filter(c => c.estado === 'pagada')
        const resumen = {
            total: vigentes.reduce((s, c) => s + c.total, 0),
            porMedio: caja.MEDIOS_PAGO.map(m => ({ medio: m, total: comandas.filter(c => c.medio_pago === m).reduce((s, c) => s + c.total, 0) })),
            pendientes: comandas.reduce((s, c) => s + Number(c.pendientes || 0), 0)
        }
        res.render('caja/comandas', { titulo: 'Comandas', comandas, dia, hoy, resumen })
    } catch (e) { next(e) }
}

exports.detalle = async (req, res, next) => {
    try {
        const id = entero(req.params.id, 1)
        const c = id && await caja.detalleComanda(id)
        if (!c) return res.redirect('/caja/comandas?ok=no-existe')
        const errores = req.query.error ? [String(req.query.error).slice(0, 200)] : []
        res.render('caja/detalle', { titulo: `Comanda ${c.folio}`, c, errores, esAdmin: esAdmin(req) })
    } catch (e) { next(e) }
}

// US-30: solicitar cancelación (sin reembolso)
exports.cancelar = async (req, res, next) => {
    const id = entero(req.params.id, 1)
    try {
        const articuloId = req.body.articulo_id ? entero(req.body.articulo_id, 1) : null
        const r = await caja.solicitarCancelacion(
            { comandaId: id, articuloId, motivo: req.body.motivo },
            { id: req.usuario.id, esAdmin: esAdmin(req) })
        if (r.aprobada) avisarCancelacion()
        res.redirect(`/caja/comandas/${id}?ok=${r.aprobada ? 'cancelada' : 'cancelacion-solicitada'}`)
    } catch (e) {
        if (e instanceof caja.ErrorNegocio) return res.redirect(`/caja/comandas/${id}?error=${encodeURIComponent(e.message)}`)
        next(e)
    }
}

exports.cancelaciones = async (req, res, next) => {
    try {
        const cancelaciones = await caja.listaCancelaciones()
        res.render('caja/cancelaciones', { titulo: 'Cancelaciones', cancelaciones, esAdmin: esAdmin(req) })
    } catch (e) { next(e) }
}

// Solo administrador (la ruta lo exige)
exports.resolver = aprobar => async (req, res, next) => {
    try {
        await caja.resolverCancelacion(entero(req.params.id, 1), aprobar, req.usuario.id)
        if (aprobar) avisarCancelacion()
        res.redirect(`/caja/cancelaciones?ok=${aprobar ? 'cancelada' : 'cancelacion-rechazada'}`)
    } catch (e) {
        if (e instanceof caja.ErrorNegocio) return res.redirect('/caja/cancelaciones?ok=no-existe')
        next(e)
    }
}

// Liberar la mesa: cierra su cuenta (la siguiente comanda abre una nueva)
exports.cerrarCuenta = async (req, res, next) => {
    try {
        await caja.cerrarCuenta(entero(req.params.id, 1))
        res.redirect('/caja?ok=mesa-liberada')
    } catch (e) {
        if (e instanceof caja.ErrorNegocio) return res.redirect('/caja?ok=no-existe')
        next(e)
    }
}

// US-28: ticket en pantalla (imprimible)
exports.ticket = async (req, res, next) => {
    try {
        const c = await comandaDeTicket(req.params.id)
        if (!c) return res.status(404).render('error', { codigo: 404, titulo: 'Ticket no encontrado', mensaje: 'Ese ticket no existe.' })
        res.render('caja/ticket', { titulo: `Ticket ${c.ticket_folio}`, c, aviso: req.query.pdf === 'error' ? String(req.query.motivo || '') : '' })
    } catch (e) { next(e) }
}

// US-28: ticket en PDF, generado con Python (ticket_pdf.py)
exports.ticketPdf = async (req, res, next) => {
    try {
        const c = await comandaDeTicket(req.params.id)
        if (!c) return res.status(404).render('error', { codigo: 404, titulo: 'Ticket no encontrado', mensaje: 'Ese ticket no existe.' })
        let pdf
        try {
            pdf = await ticketPdf.generar(datosTicket(c))
        } catch (error) {
            console.error('[ticket PDF]', error.message)
            return res.redirect(`/caja/tickets/${c.ticket_id}?pdf=error&motivo=${encodeURIComponent(error.message)}`)
        }
        const nombre = `ticket-${c.ticket_folio}.pdf`
        await conexion.query('UPDATE tickets SET archivo_pdf = ? WHERE id = ?', [nombre, c.ticket_id])
        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Content-Disposition', `inline; filename="${nombre}"`)
        res.send(pdf)
    } catch (e) { next(e) }
}

async function comandaDeTicket(ticketId) {
    const id = entero(ticketId, 1)
    if (!id) return null
    const [[t]] = await conexion.query('SELECT comanda_id FROM tickets WHERE id = ?', [id])
    return t ? caja.detalleComanda(t.comanda_id) : null
}

// Lo que necesita el script de Python: solo texto y números
function datosTicket(c) {
    return {
        negocio: 'Salón de Eventos y Snacks',
        ticket: c.ticket_folio, comanda: c.folio, caja: `${c.caja} (No. ${c.caja_numero})`,
        atendio: c.atendio, fecha: fechaCorta(c.creada_en),
        destino: c.para_llevar ? 'PARA LLEVAR' : `Mesa ${c.mesa}`, cliente: c.cliente_nombre,
        articulos: c.grupos.map(g => ({
            cantidad: g.cantidad, descripcion: g.descripcion, piezas: g.piezas, importe: g.importe,
            estado: g.estado,
            cambios: [...g.quitar.map(m => ({ texto: `Sin ${m.nombre}`, importe: 0 })),
                      ...g.extras.map(m => ({ texto: `Extra ${m.nombre}`, importe: m.precio }))]
        })),
        total: c.total, medio: c.medio_pago, recibido: c.recibido, cambio: c.cambio, referencia: c.referencia,
        estado: c.estado,
        cuenta: c.cuenta.length > 1 ? { comandas: c.cuenta.length, total: c.cuenta_total } : null
    }
}
