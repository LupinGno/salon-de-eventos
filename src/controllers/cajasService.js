// Cajas y finanzas
const conexion = require('../database/db')
const { ErrorNegocio } = require('./menuService')
const formatos = require('./formatos')
const { ROLES } = require('../routes/modulos')
const horario = require('./horarioService')

const MEDIOS = ['efectivo', 'tarjeta', 'transferencia']
const TIPOS = { venta: 'Venta', devolucion: 'Devolución', cuota: 'Cuota', garantia: 'Garantía', cargo: 'Cargo por daños', extra: 'Extra' }
const CLASES = { prestamo: 'Préstamo a empleado', vale: 'Vale a empleado', gasto: 'Gasto', ingreso: 'Ingreso extra' }
const CONCEPTOS = {
    venta_snacks: 'Venta de snacks', reembolso_snacks: 'Reembolso por cancelación',
    apartado: 'Apartado del salón', pago_total: 'Pago total del salón', liquidacion: 'Liquidación del salón',
    cuota: 'Cuota de garantía', devolucion_cuota: 'Devolución de cuota', cargo_danos: 'Cargo por daños',
    reembolso_alimentos: 'Reembolso de alimentos',
    renta: 'Renta de brincolín', garantia: 'Garantía de brincolín', devolucion_garantia: 'Devolución de garantía',
    reembolso_renta: 'Reembolso de renta', diferencia_cambio: 'Diferencia por cambio de modelo', cobro_cambio: 'Cobro por cambio de modelo',
    ...CLASES
}
// Módulo que da acceso a cada caja 
const MODULO_DE_SERVICIO = { snacks: 'caja-snacks', salones: 'salones', brincolines: 'brincolines' }
const MAX_FONDO = 50000
const MAX_EXTRA = 20000

const esAdmin = u => u.rol === ROLES.ADMIN
const redondear = n => Math.round(Number(n) * 100) / 100
const texto = v => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '')

// cada quien ve solo la caja de su servicio
async function cajasDe(usuario, db = conexion) {
    const [cajas] = await db.query('SELECT id, nombre, servicio FROM cajas WHERE activo = 1 ORDER BY id')
    if (esAdmin(usuario)) return cajas
    return cajas.filter(c => usuario.modulos.includes(MODULO_DE_SERVICIO[c.servicio]))
}

async function cajaDe(usuario, id, db = conexion) {
    const caja = (await cajasDe(usuario, db)).find(c => c.id === Number(id))
    if (!caja) {
        const [[existe]] = await db.query('SELECT id FROM cajas WHERE id = ?', [Number(id) || 0])
        throw existe ? new ErrorNegocio('Esa caja es de otro servicio: solo ves la tuya.', 403) : new ErrorNegocio('Esa caja no existe.', 404)
    }
    return caja
}

async function turnoAbierto(cajaId, db = conexion) {
    const [[t]] = await db.query(
        `SELECT t.*, u.nombre AS cajero FROM turnos_caja t JOIN usuarios u ON u.id = t.usuario_id
          WHERE t.caja_id = ? AND t.estado = 'abierto'`, [cajaId])
    return t || null
}

// Suma de los movimientos de un periodo por medio y por tipo
async function sumar(cajaId, desde, hasta, db = conexion) {
    const [filas] = await db.query(
        `SELECT medio, tipo, COUNT(*) AS n, SUM(monto) AS total FROM v_movimientos_caja
          WHERE caja_id = ? AND creado_en >= ? AND (? IS NULL OR creado_en <= ?)
          GROUP BY medio, tipo`, [cajaId, desde, hasta, hasta])
    const porMedio = Object.fromEntries(MEDIOS.map(m => [m, 0]))
    const porTipo = Object.fromEntries(Object.keys(TIPOS).map(t => [t, 0]))
    let entradas = 0, salidas = 0, n = 0
    filas.forEach(f => {
        const total = Number(f.total)
        porMedio[f.medio] = redondear(porMedio[f.medio] + total)
        porTipo[f.tipo] = redondear(porTipo[f.tipo] + total)
        n += f.n
    })
    // Entradas y salidas 
    const [[es]] = await db.query(
        `SELECT COALESCE(SUM(GREATEST(monto, 0)), 0) AS entradas, COALESCE(SUM(LEAST(monto, 0)), 0) AS salidas
           FROM v_movimientos_caja WHERE caja_id = ? AND creado_en >= ? AND (? IS NULL OR creado_en <= ?)`,
        [cajaId, desde, hasta, hasta])
    entradas = redondear(es.entradas); salidas = redondear(es.salidas)
    return { porMedio, porTipo, entradas, salidas, neto: redondear(entradas + salidas), movimientos: n }
}

// Saldo de la caja en su turno abierto, por medio
async function saldoTurno(t, db = conexion) {
    const s = await sumar(t.caja_id, t.abierto_en, t.cerrado_en || null, db)
    const fondo = Number(t.fondo_inicial)
    const saldo = {
        efectivo: redondear(fondo + s.porMedio.efectivo),
        tarjeta: s.porMedio.tarjeta,
        transferencia: s.porMedio.transferencia
    }
    saldo.total = redondear(saldo.efectivo + saldo.tarjeta + saldo.transferencia)
    return { ...s, fondo, saldo }
}

const hoyBD = async (db = conexion) => (await db.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoy"))[0][0].hoy

// Panel de "Mis cajas"
async function panel(usuario) {
    const hoy = await hoyBD()
    const cajas = await cajasDe(usuario)
    for (const c of cajas) {
        c.turno = await turnoAbierto(c.id)
        c.resumen = c.turno ? await saldoTurno(c.turno) : null
        c.hoy = await sumar(c.id, `${hoy} 00:00:00`, `${hoy} 23:59:59`)
    }
    return { cajas, hoy }
}

// Bloquea la caja dentro de una transacción para que dos personas no abran turno a la vez
async function conCaja(usuario, cajaId, accion) {
    const db = await conexion.getConnection()
    try {
        await db.beginTransaction()
        const caja = await cajaDe(usuario, cajaId, db)
        const { permitido, mensaje } = await horario.puedeOperarHoy(usuario, caja.id, db)
        if (!permitido) throw new ErrorNegocio(mensaje, 403)
        await db.query('SELECT id FROM cajas WHERE id = ? FOR UPDATE', [caja.id])
        const resultado = await accion(db, caja)
        await db.commit()
        return resultado
    } catch (e) {
        await db.rollback()
        throw e
    } finally {
        db.release()
    }
}

// abrir la caja con el fondo inicial, contado físicamente
async function abrirTurno(cajaId, datos, usuario) {
    datos = datos || {}
    const fondo = formatos.decimal(datos.fondo, 0, MAX_FONDO)
    if (fondo === null) throw new ErrorNegocio(`Escribe el fondo inicial (de $0 a ${formatos.dinero(MAX_FONDO)}).`, 422)
    if (String(datos.confirmo) !== '1') throw new ErrorNegocio('Cuenta el fondo físicamente y confirma que coincide antes de abrir.', 422)
    return conCaja(usuario, cajaId, async (db, caja) => {
        if (await turnoAbierto(caja.id, db)) throw new ErrorNegocio('Esta caja ya tiene un turno abierto.', 409)
        const [r] = await db.query('INSERT INTO turnos_caja (caja_id, usuario_id, fondo_inicial) VALUES (?, ?, ?)', [caja.id, usuario.id, fondo])
        return { id: r.insertId, caja_id: caja.id, caja: caja.nombre, fondo }
    })
}

// Empleados que pueden recibir un préstamo o un vale
async function empleados() {
    const [filas] = await conexion.query(
        `SELECT u.id, u.nombre, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id
          WHERE u.activo = 1 AND r.nombre <> 'Cliente' ORDER BY u.nombre`)
    return filas
}

//préstamos, vales, gastos e ingresos extras con su responsable
function leerExtra(datos) {
    datos = datos || {}
    const errores = []
    const clase = String(datos.clase || '')
    if (!CLASES[clase]) errores.push('Elige el tipo de movimiento: préstamo, vale, gasto o ingreso.')
    const monto = formatos.decimal(datos.monto, 0.01, MAX_EXTRA)
    if (monto === null) errores.push(`Escribe un monto mayor a $0 y hasta ${formatos.dinero(MAX_EXTRA)}.`)
    const medio = MEDIOS.includes(datos.medio) ? datos.medio : 'efectivo'
    const concepto = texto(datos.concepto)
    if (concepto.length < 5 || concepto.length > 150) errores.push('Escribe para qué es (5 a 150 letras), por ejemplo: gasolina para el reparto.')
    const responsableId = formatos.entero(datos.responsable_id, 1) || null
    if (['prestamo', 'vale'].includes(clase) && !responsableId) errores.push('Elige al empleado que recibe el dinero.')
    if (errores.length) throw Object.assign(new ErrorNegocio(errores[0], 422), { errores })
    return { clase, monto: clase === 'ingreso' ? monto : -monto, medio, concepto, responsableId }
}

// las salidas que registra un cajero 
async function registrarExtra(cajaId, datos, usuario) {
    const m = leerExtra(datos)
    const admin = esAdmin(usuario)
    const pendiente = m.monto < 0 && !admin
    return conCaja(usuario, cajaId, async (db, caja) => {
        const t = await turnoAbierto(caja.id, db)
        if (!t) throw new ErrorNegocio('Abre el turno de la caja antes de registrar movimientos.', 409)
        if (m.responsableId) {
            const [[r]] = await db.query(
                `SELECT u.id FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ? AND u.activo = 1 AND r.nombre <> 'Cliente'`, [m.responsableId])
            if (!r) throw new ErrorNegocio('Ese responsable no es un empleado activo.', 422)
        }
        if (!pendiente) await alcanzaEfectivo(db, t, m)
        const [r] = await db.query(
            `INSERT INTO movimientos_caja (caja_id, turno_id, usuario_id, clase, monto, medio, concepto, responsable_id, estado, autorizado_por, autorizado_en)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${admin ? 'NOW()' : 'NULL'})`,
            [caja.id, t.id, usuario.id, m.clase, m.monto, m.medio, m.concepto, m.responsableId,
             pendiente ? 'pendiente' : 'aprobado', admin ? usuario.id : null])
        return { id: r.insertId, caja_id: caja.id, turno_id: t.id, clase: m.clase, monto: m.monto, medio: m.medio, estado: pendiente ? 'pendiente' : 'aprobado' }
    })
}

// No se puede sacar más efectivo del que hay en el cajón
async function alcanzaEfectivo(db, turno, m) {
    if (m.monto >= 0 || m.medio !== 'efectivo') return
    const { saldo } = await saldoTurno(turno, db)
    if (saldo.efectivo + m.monto < 0) throw new ErrorNegocio(`No alcanza el efectivo de la caja: hay ${formatos.dinero(saldo.efectivo)}.`, 409)
}

//libro de movimientos con filtros
function leerFiltros(q, hoy) {
    q = q || {}
    const f = {
        caja: formatos.entero(q.caja, 1) || null,
        desde: formatos.fecha(q.desde) || hoy,
        hasta: formatos.fecha(q.hasta) || hoy,
        tipo: TIPOS[q.tipo] ? q.tipo : '',
        medio: MEDIOS.includes(q.medio) ? q.medio : ''
    }
    if (f.hasta < f.desde) [f.desde, f.hasta] = [f.hasta, f.desde]
    return f
}

async function movimientos(q, usuario, limite = 500) {
    const hoy = await hoyBD()
    const f = leerFiltros(q, hoy)
    const cajas = await cajasDe(usuario)
    if (f.caja && !cajas.some(c => c.id === f.caja)) await cajaDe(usuario, f.caja)   // 403 o 404
    const ids = f.caja ? [f.caja] : cajas.map(c => c.id)
    if (!ids.length) return { filtros: f, cajas, filas: [], totales: { entradas: 0, salidas: 0, neto: 0, porMedio: {} }, hoy }

    const donde = ['m.caja_id IN (?)', 'm.creado_en >= ?', 'm.creado_en < DATE_ADD(?, INTERVAL 1 DAY)']
    const params = [ids, f.desde, f.hasta]
    if (f.tipo) { donde.push('m.tipo = ?'); params.push(f.tipo) }
    if (f.medio) { donde.push('m.medio = ?'); params.push(f.medio) }
    const [filas] = await conexion.query(
        `SELECT m.*, ca.nombre AS caja, u.nombre AS usuario
           FROM v_movimientos_caja m
           JOIN cajas ca ON ca.id = m.caja_id
           LEFT JOIN usuarios u ON u.id = m.usuario_id
          WHERE ${donde.join(' AND ')}
          ORDER BY m.creado_en DESC, m.origen, m.origen_id DESC
          LIMIT ${Number(limite) + 1}`, params)
    const [[tot]] = await conexion.query(
        `SELECT COUNT(*) AS n, COALESCE(SUM(GREATEST(m.monto, 0)), 0) AS entradas, COALESCE(SUM(LEAST(m.monto, 0)), 0) AS salidas,
                COALESCE(SUM(IF(m.medio = 'efectivo', m.monto, 0)), 0) AS efectivo,
                COALESCE(SUM(IF(m.medio = 'tarjeta', m.monto, 0)), 0) AS tarjeta,
                COALESCE(SUM(IF(m.medio = 'transferencia', m.monto, 0)), 0) AS transferencia
           FROM v_movimientos_caja m WHERE ${donde.join(' AND ')}`, params)
    const recortado = filas.length > limite
    return {
        filtros: f, cajas, hoy, recortado,
        filas: filas.slice(0, limite).map(describir),
        totales: {
            n: tot.n, entradas: redondear(tot.entradas), salidas: redondear(tot.salidas), neto: redondear(tot.entradas + tot.salidas),
            porMedio: { efectivo: redondear(tot.efectivo), tarjeta: redondear(tot.tarjeta), transferencia: redondear(tot.transferencia) }
        }
    }
}

const describir = m => ({
    ...m, monto: Number(m.monto),
    tipo_texto: TIPOS[m.tipo] || m.tipo,
    concepto_texto: CONCEPTOS[m.concepto] || m.concepto
})

// Detalle de una caja
async function detalleCaja(id, usuario) {
    const caja = await cajaDe(usuario, id)
    const turno = await turnoAbierto(caja.id)
    let resumen = null, filas = []
    if (turno) {
        resumen = await saldoTurno(turno)
        const [movs] = await conexion.query(
            `SELECT m.*, u.nombre AS usuario FROM v_movimientos_caja m LEFT JOIN usuarios u ON u.id = m.usuario_id
              WHERE m.caja_id = ? AND m.creado_en >= ? ORDER BY m.creado_en DESC, m.origen_id DESC LIMIT 300`,
            [caja.id, turno.abierto_en])
        filas = movs.map(describir)
    }
    // arqueos del turno, salidas esperando aprobación y cortes anteriores
    const [arqueos] = turno ? await conexion.query(
        'SELECT a.*, u.nombre AS usuario FROM arqueos a JOIN usuarios u ON u.id = a.usuario_id WHERE a.turno_id = ? ORDER BY a.id DESC', [turno.id]) : [[]]
    const [pendientes] = turno ? await conexion.query(
        `SELECT m.*, r.nombre AS responsable FROM movimientos_caja m LEFT JOIN usuarios r ON r.id = m.responsable_id
          WHERE m.turno_id = ? AND m.estado = 'pendiente' ORDER BY m.id`, [turno.id]) : [[]]
    return {
        caja, turno, resumen, filas, arqueos,
        pendientes: pendientes.map(m => ({ ...m, monto: Number(m.monto), clase_texto: CLASES[m.clase] })),
        cortes: await turnosCerrados(caja.id)
    }
}

// el administrador aprueba o rechaza las salidas pendientes
async function resolverExtra(id, aprobar, datos, admin) {
    const db = await conexion.getConnection()
    try {
        await db.beginTransaction()
        const [[m]] = await db.query('SELECT * FROM movimientos_caja WHERE id = ? FOR UPDATE', [Number(id) || 0])
        if (!m) throw new ErrorNegocio('Ese movimiento no existe.', 404)
        if (m.estado !== 'pendiente') throw new ErrorNegocio('Ese movimiento ya se resolvió.', 409)
        const [[t]] = await db.query('SELECT * FROM turnos_caja WHERE id = ? FOR UPDATE', [m.turno_id])
        if (aprobar) {
            if (t.estado !== 'abierto') throw new ErrorNegocio('El turno de esa caja ya se cerró: recházalo y que lo registren en el turno nuevo.', 409)
            await alcanzaEfectivo(db, t, m)
            await db.query("UPDATE movimientos_caja SET estado = 'aprobado', autorizado_por = ?, autorizado_en = NOW() WHERE id = ?", [admin.id, m.id])
        } else {
            const motivo = texto((datos || {}).motivo).slice(0, 150) || null
            await db.query("UPDATE movimientos_caja SET estado = 'rechazado', autorizado_por = ?, autorizado_en = NOW(), motivo_rechazo = ? WHERE id = ?", [admin.id, motivo, m.id])
        }
        await db.commit()
        return { id: m.id, estado: aprobar ? 'aprobado' : 'rechazado', monto: Number(m.monto), caja_id: m.caja_id }
    } catch (e) {
        await db.rollback()
        throw e
    } finally {
        db.release()
    }
}

// vista de los administradores: pendientes de aprobación y resueltos recientes
async function pendientesAprobacion() {
    const [extras] = await conexion.query(`
        SELECT m.*, ca.nombre AS caja, u.nombre AS registro, r.nombre AS responsable, t.estado AS turno_estado
          FROM movimientos_caja m
          JOIN cajas ca ON ca.id = m.caja_id
          JOIN usuarios u ON u.id = m.usuario_id
          JOIN turnos_caja t ON t.id = m.turno_id
          LEFT JOIN usuarios r ON r.id = m.responsable_id
         WHERE m.estado = 'pendiente' ORDER BY m.creado_en`)
    const [resueltos] = await conexion.query(`
        SELECT m.*, ca.nombre AS caja, u.nombre AS registro, r.nombre AS responsable, a.nombre AS autorizo
          FROM movimientos_caja m
          JOIN cajas ca ON ca.id = m.caja_id
          JOIN usuarios u ON u.id = m.usuario_id
          LEFT JOIN usuarios r ON r.id = m.responsable_id
          LEFT JOIN usuarios a ON a.id = m.autorizado_por
         WHERE m.estado <> 'pendiente' AND m.autorizado_en >= DATE_SUB(NOW(), INTERVAL 7 DAY)
         ORDER BY m.autorizado_en DESC LIMIT 30`)
    const cancelaciones = (await require('./cajaService').listaCancelaciones()).filter(k => k.estado === 'solicitada')
    const extra = m => ({ ...m, monto: Number(m.monto), clase_texto: CLASES[m.clase] })
    return { extras: extras.map(extra), resueltos: resueltos.map(extra), cancelaciones }
}

// Conteo del efectivo para un arqueo o un corte
function leerConteo(datos, esperado) {
    datos = datos || {}
    const contado = formatos.decimal(datos.contado, 0, 1000000)
    if (contado === null) throw new ErrorNegocio('Escribe cuánto efectivo contaste en la caja.', 422)
    const diferencia = redondear(contado - esperado)
    const observaciones = texto(datos.observaciones).slice(0, 255)
    if (diferencia !== 0 && observaciones.length < 5) {
        throw new ErrorNegocio(`Hay ${diferencia < 0 ? 'un faltante' : 'un sobrante'} de ${formatos.dinero(Math.abs(diferencia))}: escribe qué pasó.`, 422)
    }
    return { contado, diferencia, observaciones: observaciones || null }
}

//arqueo durante el turno 
async function arqueo(cajaId, datos, usuario) {
    return conCaja(usuario, cajaId, async (db, caja) => {
        const t = await turnoAbierto(caja.id, db)
        if (!t) throw new ErrorNegocio('La caja está cerrada: no hay nada que contar.', 409)
        const { saldo } = await saldoTurno(t, db)
        const c = leerConteo(datos, saldo.efectivo)
        const [r] = await db.query(
            `INSERT INTO arqueos (turno_id, usuario_id, tipo, efectivo_esperado, efectivo_contado, diferencia, observaciones)
             VALUES (?, ?, 'parcial', ?, ?, ?, ?)`, [t.id, usuario.id, saldo.efectivo, c.contado, c.diferencia, c.observaciones])
        return { id: r.insertId, turno_id: t.id, esperado: saldo.efectivo, contado: c.contado, diferencia: c.diferencia }
    })
}

// cerrar el turno con el arqueo final y guardar el corte por medio
async function cerrarTurno(cajaId, datos, usuario) {
    return conCaja(usuario, cajaId, async (db, caja) => {
        const t = await turnoAbierto(caja.id, db)
        if (!t) throw new ErrorNegocio('Esta caja no tiene un turno abierto.', 409)
        const forzado = t.usuario_id !== usuario.id
        if (forzado && !esAdmin(usuario)) throw new ErrorNegocio('Solo quien abrió el turno o un administrador puede hacer el corte.', 403)
        let motivoForzado = null
        if (forzado) {
            motivoForzado = texto((datos || {}).motivo_forzado).slice(0, 255)
            if (motivoForzado.length < 5) throw new ErrorNegocio('Es un cierre forzado (el turno lo abrió otra persona): escribe el motivo.', 422)
        }
        const [[{ pendientes }]] = await db.query("SELECT COUNT(*) AS pendientes FROM movimientos_caja WHERE turno_id = ? AND estado = 'pendiente'", [t.id])
        if (pendientes) throw new ErrorNegocio(`Hay ${pendientes} salida(s) esperando la aprobación del administrador: resuélvelas antes del corte.`, 409)
        const r = await saldoTurno(t, db)
        const c = leerConteo(datos, r.saldo.efectivo)
        await db.query(
            `INSERT INTO arqueos (turno_id, usuario_id, tipo, efectivo_esperado, efectivo_contado, diferencia, observaciones)
             VALUES (?, ?, 'cierre', ?, ?, ?, ?)`, [t.id, usuario.id, r.saldo.efectivo, c.contado, c.diferencia, c.observaciones])
        await db.query(
            `UPDATE turnos_caja SET estado = 'cerrado', cerrado_en = NOW(), cerrado_por = ?, efectivo_esperado = ?, efectivo_contado = ?,
                    diferencia = ?, total_tarjeta = ?, total_transferencia = ?, observaciones = ? WHERE id = ?`,
            [usuario.id, r.saldo.efectivo, c.contado, c.diferencia, r.saldo.tarjeta, r.saldo.transferencia, c.observaciones, t.id])
        if (forzado) {
            await horario.registrarBitacora(db, usuario, 'cerrar_turno_forzado', 'turnos_caja', t.id, `${caja.nombre} · ${folioTurno(t.id)}: ${motivoForzado}`)
        }
        return { turno_id: t.id, esperado: r.saldo.efectivo, contado: c.contado, diferencia: c.diferencia, saldo: r.saldo, forzado }
    })
}

const folioTurno = id => `T-${String(id).padStart(4, '0')}`

// corte de un turno 
async function corte(turnoId, usuario) {
    const [[t]] = await conexion.query(
        `SELECT t.*, ca.nombre AS caja, u.nombre AS cajero, c.nombre AS cerro
           FROM turnos_caja t JOIN cajas ca ON ca.id = t.caja_id JOIN usuarios u ON u.id = t.usuario_id
           LEFT JOIN usuarios c ON c.id = t.cerrado_por WHERE t.id = ?`, [Number(turnoId) || 0])
    if (!t) throw new ErrorNegocio('Ese turno no existe.', 404)
    await cajaDe(usuario, t.caja_id)
    const resumen = await saldoTurno(t)
    const hasta = t.cerrado_en || '9999-12-31'
    const [porUsuario] = await conexion.query(
        `SELECT COALESCE(u.nombre, '—') AS usuario,
                SUM(IF(m.medio = 'efectivo', m.monto, 0)) AS efectivo, SUM(IF(m.medio = 'tarjeta', m.monto, 0)) AS tarjeta,
                SUM(IF(m.medio = 'transferencia', m.monto, 0)) AS transferencia, SUM(m.monto) AS total, COUNT(*) AS n
           FROM v_movimientos_caja m LEFT JOIN usuarios u ON u.id = m.usuario_id
          WHERE m.caja_id = ? AND m.creado_en >= ? AND m.creado_en <= ?
          GROUP BY m.usuario_id, u.nombre ORDER BY total DESC`, [t.caja_id, t.abierto_en, hasta])
    const [arqueos] = await conexion.query(
        `SELECT a.*, u.nombre AS usuario FROM arqueos a JOIN usuarios u ON u.id = a.usuario_id WHERE a.turno_id = ? ORDER BY a.id`, [t.id])
    const [movs] = await conexion.query(
        `SELECT m.*, u.nombre AS usuario FROM v_movimientos_caja m LEFT JOIN usuarios u ON u.id = m.usuario_id
          WHERE m.caja_id = ? AND m.creado_en >= ? AND m.creado_en <= ? ORDER BY m.creado_en, m.origen_id`, [t.caja_id, t.abierto_en, hasta])
    const num = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v]))
    return {
        turno: { ...t, folio: folioTurno(t.id), fondo_inicial: Number(t.fondo_inicial) }, resumen,
        porUsuario: porUsuario.map(num), arqueos, filas: movs.map(describir)
    }
}

// Últimos cortes de una caja
async function turnosCerrados(cajaId, limite = 10) {
    const [filas] = await conexion.query(
        `SELECT t.*, u.nombre AS cajero FROM turnos_caja t JOIN usuarios u ON u.id = t.usuario_id
          WHERE t.caja_id = ? AND t.estado = 'cerrado' ORDER BY t.cerrado_en DESC LIMIT ?`, [cajaId, limite])
    return filas.map(t => ({ ...t, folio: folioTurno(t.id) }))
}

// Primer y último día de un mes 'YYYY-MM'
function rangoMes(mes, hoy) {
    const m = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes || '')) ? mes : hoy.slice(0, 7)
    const [a, n] = m.split('-').map(Number)
    const ultimo = new Date(Date.UTC(a, n, 0)).getUTCDate()
    return { mes: m, desde: `${m}-01`, hasta: `${m}-${String(ultimo).padStart(2, '0')}` }
}

//cada devolución salió por el mismo medio con que se pagó
async function verificarMedios(desde, hasta) {
    const rango = [`${desde} 00:00:00`, `${hasta} 23:59:59`]
    const [filas] = await conexion.query(`
        SELECT 1 AS caja_id, CONCAT('Comanda #', co.folio) AS referencia, k.resuelta_en AS fecha, 'Reembolso por cancelación' AS concepto,
               -k.monto_reembolso AS monto, co.medio_pago AS pagado, k.medio_reembolso AS devuelto
          FROM cancelaciones k JOIN comandas co ON co.id = k.comanda_id
         WHERE k.estado = 'aprobada' AND k.monto_reembolso > 0 AND k.resuelta_en BETWEEN ? AND ?
        UNION ALL
        SELECT p.caja_id, CONCAT('R-', LPAD(p.reserva_id, 4, '0')), p.creado_en, p.concepto, p.monto,
               IF(p.concepto = 'devolucion_cuota',
                  COALESCE((SELECT c.medio FROM pagos_reserva c WHERE c.reserva_id = p.reserva_id AND c.concepto = 'cuota' ORDER BY c.id LIMIT 1), rs.medio_pago),
                  rs.medio_pago), p.medio
          FROM pagos_reserva p JOIN reservas_salon rs ON rs.id = p.reserva_id
         WHERE p.monto < 0 AND p.creado_en BETWEEN ? AND ?
        UNION ALL
        SELECT p.caja_id, CONCAT('B-', LPAD(p.renta_id, 4, '0')), p.creado_en, p.concepto, p.monto, rb.medio_pago, p.medio
          FROM pagos_renta p JOIN rentas_brincolin rb ON rb.id = p.renta_id
         WHERE p.monto < 0 AND p.creado_en BETWEEN ? AND ?`, [...rango, ...rango, ...rango])
    const distintas = filas.filter(f => f.pagado !== f.devuelto)
        .map(f => ({ ...f, monto: Number(f.monto), concepto_texto: CONCEPTOS[f.concepto] || f.concepto }))
    return { revisadas: filas.length, distintas }
}

//consolidado mensual por caja para administración
async function consolidado(mes) {
    const hoy = await hoyBD()
    const r = rangoMes(mes, hoy)
    const [cajas] = await conexion.query('SELECT id, nombre, servicio FROM cajas WHERE activo = 1 ORDER BY id')
    const total = { entradas: 0, salidas: 0, neto: 0, porMedio: Object.fromEntries(MEDIOS.map(m => [m, 0])), porTipo: Object.fromEntries(Object.keys(TIPOS).map(t => [t, 0])) }
    for (const c of cajas) {
        c.suma = await sumar(c.id, `${r.desde} 00:00:00`, `${r.hasta} 23:59:59`)
        const [[tu]] = await conexion.query(
            `SELECT COUNT(*) AS turnos, COALESCE(SUM(diferencia), 0) AS diferencias, COALESCE(SUM(diferencia < 0), 0) AS faltantes
               FROM turnos_caja WHERE caja_id = ? AND estado = 'cerrado' AND cerrado_en BETWEEN ? AND ?`,
            [c.id, `${r.desde} 00:00:00`, `${r.hasta} 23:59:59`])
        c.turnos = { cerrados: tu.turnos, diferencias: redondear(tu.diferencias), faltantes: Number(tu.faltantes) }
        total.entradas = redondear(total.entradas + c.suma.entradas)
        total.salidas = redondear(total.salidas + c.suma.salidas)
        MEDIOS.forEach(m => { total.porMedio[m] = redondear(total.porMedio[m] + c.suma.porMedio[m]) })
        Object.keys(TIPOS).forEach(t => { total.porTipo[t] = redondear(total.porTipo[t] + c.suma.porTipo[t]) })
    }
    total.neto = redondear(total.entradas + total.salidas)
    // compras de insumos del mes, siempre con cargo a administración
    const [[ci]] = await conexion.query(
        "SELECT COALESCE(SUM(costo_total), 0) AS total FROM compras_insumos WHERE creado_en BETWEEN ? AND ?",
        [`${r.desde} 00:00:00`, `${r.hasta} 23:59:59`])
    const comprasInsumos = redondear(ci.total)
    return {
        ...r, cajas, total, comprasInsumos, ganancia: redondear(total.neto - comprasInsumos),
        verificacion: await verificarMedios(r.desde, r.hasta), hoy
    }
}

// datos para las gráficas del negocio
const VENTA_SQL = "IF(m.tipo IN ('venta','cargo') AND m.monto > 0, m.monto, 0)"
async function graficas(q) {
    q = q || {}
    const hoy = await hoyBD()
    let hasta = formatos.fecha(q.hasta) || hoy
    let desde = formatos.fecha(q.desde) || new Date(Date.parse(hasta) - 29 * 864e5).toISOString().slice(0, 10)
    if (hasta < desde) [desde, hasta] = [hasta, desde]
    const dias = Math.round((Date.parse(hasta) - Date.parse(desde)) / 864e5) + 1
    const agrupar = ['dia', 'mes'].includes(q.agrupar) ? q.agrupar : (dias > 62 ? 'mes' : 'dia')
    const formato = agrupar === 'mes' ? '%Y-%m' : '%Y-%m-%d'
    const rango = [`${desde} 00:00:00`, `${hasta} 23:59:59`]
    const [cajas] = await conexion.query('SELECT id, nombre, servicio FROM cajas WHERE activo = 1 ORDER BY id')
    const [porCaja] = await conexion.query(
        `SELECT m.caja_id, SUM(${VENTA_SQL}) AS ventas, SUM(IF(m.tipo = 'devolucion', -m.monto, 0)) AS devoluciones,
                SUM(IF(m.tipo = 'devolucion', 1, 0)) AS n_devoluciones, SUM(m.monto) AS neto
           FROM v_movimientos_caja m WHERE m.creado_en BETWEEN ? AND ? GROUP BY m.caja_id`, rango)
    const [serie] = await conexion.query(
        `SELECT DATE_FORMAT(m.creado_en, '${formato}') AS periodo, m.caja_id,
                SUM(${VENTA_SQL}) AS ventas, SUM(IF(m.tipo = 'devolucion', -m.monto, 0)) AS devoluciones
           FROM v_movimientos_caja m WHERE m.creado_en BETWEEN ? AND ? GROUP BY periodo, m.caja_id ORDER BY periodo`, rango)
    // Todos los periodos del rango
    const periodos = []
    if (agrupar === 'mes') {
        for (let [a, n] = desde.slice(0, 7).split('-').map(Number); `${a}-${String(n).padStart(2, '0')}` <= hasta.slice(0, 7); n === 12 ? (a++, n = 1) : n++) {
            periodos.push(`${a}-${String(n).padStart(2, '0')}`)
        }
    } else {
        for (let d = Date.parse(desde); d <= Date.parse(hasta); d += 864e5) periodos.push(new Date(d).toISOString().slice(0, 10))
    }
    const serieDe = campo => Object.fromEntries(cajas.map(c => [c.id, periodos.map(p => {
        const f = serie.find(x => x.periodo === p && x.caja_id === c.id)
        return f ? redondear(f[campo]) : 0
    })]))
    const servicio = cajas.map(c => {
        const f = porCaja.find(x => x.caja_id === c.id) || {}
        return { caja_id: c.id, caja: c.nombre, servicio: c.servicio, ventas: redondear(f.ventas || 0), devoluciones: redondear(f.devoluciones || 0),
                 n_devoluciones: Number(f.n_devoluciones || 0), neto: redondear(f.neto || 0) }
    })
    return { filtros: { desde, hasta, agrupar }, hoy, cajas, periodos, ventas: serieDe('ventas'), devoluciones: serieDe('devoluciones'), porServicio: servicio }
}

// datos del reporte para el PDF
async function datosReporte(q, usuario) {
    const d = await movimientos(q, usuario, 1500)
    const f = d.filtros
    const caja = f.caja ? d.cajas.find(c => c.id === f.caja).nombre : (d.cajas.length > 1 ? 'Todas las cajas' : d.cajas[0] ? d.cajas[0].nombre : '')
    const partes = [caja, `del ${f.desde.split('-').reverse().join('/')} al ${f.hasta.split('-').reverse().join('/')}`]
    if (f.tipo) partes.push(`tipo: ${TIPOS[f.tipo]}`)
    if (f.medio) partes.push(`medio: ${f.medio}`)
    const porCaja = []
    for (const c of (f.caja ? d.cajas.filter(x => x.id === f.caja) : d.cajas)) {
        const s = await movimientos({ ...q, caja: c.id }, usuario, 0)
        porCaja.push({ caja: c.nombre, entradas: s.totales.entradas, salidas: s.totales.salidas, neto: s.totales.neto })
    }
    return {
        tipo: 'reporte', negocio: 'Salón de Eventos y Snacks', titulo: 'Reporte de movimientos de caja', filtros_texto: partes.join(' · '),
        usuario: usuario.nombre, emitido: new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }),
        totales: d.totales, porCaja, recortado: d.recortado,
        filas: d.filas.map(m => ({ fecha: formatos.fechaCorta(m.creado_en), caja: m.caja.split('—')[0].trim(), tipo: m.tipo_texto, concepto: m.concepto_texto,
                                    referencia: m.referencia, persona: m.persona, medio: m.medio, usuario: m.usuario || '', monto: m.monto }))
    }
}

function datosCorte(c) {
    const t = c.turno
    return {
        tipo: 'corte', negocio: 'Salón de Eventos y Snacks', folio: t.folio, caja: t.caja, cajero: t.cajero,
        abierto: formatos.fechaCorta(t.abierto_en), cerrado: t.cerrado_en ? formatos.fechaCorta(t.cerrado_en) : 'sigue abierto', cerro: t.cerro || '—',
        fondo: t.fondo_inicial, esperado: t.efectivo_esperado ?? c.resumen.saldo.efectivo, contado: t.efectivo_contado ?? 0,
        diferencia: t.diferencia ?? 0, observaciones: t.observaciones,
        emitido: new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }),
        porMedio: c.resumen.saldo,
        porTipo: Object.entries(c.resumen.porTipo).filter(([, v]) => v !== 0).map(([k, v]) => [TIPOS[k], v]),
        porUsuario: c.porUsuario,
        arqueos: c.arqueos.map(a => ({ hora: String(a.creado_en).slice(11, 16), tipo: a.tipo === 'cierre' ? 'Cierre' : 'Parcial', usuario: a.usuario,
                                       esperado: a.efectivo_esperado, contado: a.efectivo_contado, diferencia: a.diferencia })),
        filas: c.filas.map(m => ({ fecha: String(m.creado_en).slice(11, 16), tipo: m.tipo_texto, concepto: m.concepto_texto, referencia: m.referencia,
                                    persona: m.persona, medio: m.medio, usuario: m.usuario || '', monto: m.monto }))
    }
}

// agenda de todas las rentas y catálogos 
async function agenda(q) {
    q = q || {}
    const hoy = await hoyBD()
    const dias = formatos.entero(q.dias, 7, 365) || 60
    const [reservas] = await conexion.query(`
        SELECT rs.id, DATE_FORMAT(rs.fecha_evento, '%Y-%m-%d') AS fecha, s.nombre AS lugar, c.nombre AS cliente, c.telefono, rs.estado,
               rs.personas, rs.precio_total AS importe
          FROM reservas_salon rs JOIN salones s ON s.id = rs.salon_id JOIN clientes c ON c.id = rs.cliente_id
         WHERE rs.fecha_evento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY) AND rs.estado <> 'cancelada'`, [dias])
    const [rentas] = await conexion.query(`
        SELECT rb.id, DATE_FORMAT(rb.fecha, '%Y-%m-%d') AS fecha, b.nombre AS lugar, c.nombre AS cliente, c.telefono, rb.estado,
               rb.direccion, rb.precio AS importe
          FROM rentas_brincolin rb JOIN brincolines b ON b.id = rb.brincolin_id JOIN clientes c ON c.id = rb.cliente_id
         WHERE rb.fecha BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY) AND rb.estado NOT IN ('cancelada','no_instalada')`, [dias])
    const eventos = [
        ...reservas.map(r => ({ ...r, servicio: 'salon', folio: `R-${String(r.id).padStart(4, '0')}`, url: `/salones/reservas/${r.id}`, importe: Number(r.importe) })),
        ...rentas.map(r => ({ ...r, servicio: 'brincolin', folio: `B-${String(r.id).padStart(4, '0')}`, url: `/brincolines/rentas/${r.id}`, importe: Number(r.importe) }))
    ].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.servicio.localeCompare(b.servicio))
    const [salones] = await conexion.query('SELECT id, nombre, tamano, aforo_maximo, precio_renta, cuota_garantia, activo FROM salones ORDER BY nombre')
    const [brincolines] = await conexion.query('SELECT id, nombre, largo_m, ancho_m, precio_dia, garantia, estado FROM brincolines ORDER BY nombre')
    return { hoy, dias, eventos, salones, brincolines }
}

module.exports = {
    MEDIOS, TIPOS, CLASES, CONCEPTOS, MODULO_DE_SERVICIO,
    cajasDe, cajaDe, turnoAbierto, sumar, saldoTurno, panel, abrirTurno, empleados, registrarExtra,
    movimientos, detalleCaja, hoyBD, redondear, conCaja, describir, esAdmin,
    resolverExtra, pendientesAprobacion, arqueo, cerrarTurno, corte, turnosCerrados, folioTurno,
    consolidado, verificarMedios, graficas, datosReporte, datosCorte, agenda
}
