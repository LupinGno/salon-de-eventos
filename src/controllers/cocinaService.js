// cocina y receepcion
const conexion = require('../database/db')
const { ErrorNegocio } = require('./menuService')

// A qué estado se puede llegar 
const DESDE = {
    en_preparacion: ['pendiente'],
    lista: ['pendiente', 'en_preparacion'],
    entregada: ['lista'],
}
// Hora y responsable 
const SELLO = {
    en_preparacion: 'preparacion_en = NOW()',
    lista: 'lista_en = NOW(), lista_por = ?',
    entregada: 'entregado_en = NOW(), entregado_por = ?',
}
const usaUsuario = nuevo => nuevo !== 'en_preparacion'

const SIN_CANCELACION = `NOT EXISTS (SELECT 1 FROM cancelaciones k
                                      WHERE k.estado = 'solicitada' AND k.comanda_id = a.comanda_id
                                        AND (k.articulo_id IS NULL OR k.articulo_id = a.id))`
const CANCELACION_PENDIENTE = `EXISTS (SELECT 1 FROM cancelaciones k
                                       WHERE k.estado = 'solicitada' AND k.comanda_id = a.comanda_id
                                         AND (k.articulo_id IS NULL OR k.articulo_id = a.id)) AS cancelacion_pendiente`

// Junta artículos con sus cambios 
async function conCambios(articulos) {
    if (!articulos.length) return []
    const [mods] = await conexion.query(
        'SELECT articulo_id, tipo, nombre FROM articulo_modificaciones WHERE articulo_id IN (?) ORDER BY tipo DESC, id',
        [articulos.map(a => a.id)])
    articulos.forEach(a => {
        a.quitar = mods.filter(m => m.articulo_id === a.id && m.tipo === 'quitar').map(m => m.nombre)
        a.extras = mods.filter(m => m.articulo_id === a.id && m.tipo === 'extra').map(m => m.nombre)
    })

    const comandas = []

    for (const a of articulos) {
        let c = comandas.find(x => x.id === a.comanda_id)
        if (!c) {
            c = { id: a.comanda_id, folio: a.folio, mesa: a.mesa, para_llevar: a.para_llevar, cliente: a.cliente_nombre,
                  creada_en: a.creada_en, minutos: a.minutos, articulos: [] }
            comandas.push(c)
        }
        c.articulos.push(a)
    }
    return comandas
}

// creacion cola
async function colaCocina() {
    const [articulos] = await conexion.query(`
        SELECT a.id, a.comanda_id, a.descripcion, a.piezas, a.estado, ${CANCELACION_PENDIENTE},
               c.folio, c.para_llevar, c.cliente_nombre, c.creada_en, m.numero AS mesa,
               TIMESTAMPDIFF(MINUTE, c.creada_en, NOW()) AS minutos
          FROM comanda_articulos a
          JOIN comandas c ON c.id = a.comanda_id
          LEFT JOIN mesas m ON m.id = c.mesa_id
         WHERE a.va_a_cocina = 1 AND a.estado IN ('pendiente', 'en_preparacion') AND c.estado = 'pagada'
         ORDER BY c.creada_en, c.id, a.id`)
    return conCambios(articulos)
}

async function paraEntregar() {
    const [articulos] = await conexion.query(`
        SELECT a.id, a.comanda_id, a.descripcion, a.piezas, a.estado, a.lista_en, ${CANCELACION_PENDIENTE},
               c.folio, c.para_llevar, c.cliente_nombre, c.creada_en, m.numero AS mesa,
               TIMESTAMPDIFF(MINUTE, a.lista_en, NOW()) AS minutos
          FROM comanda_articulos a
          JOIN comandas c ON c.id = a.comanda_id
          LEFT JOIN mesas m ON m.id = c.mesa_id
         WHERE a.estado = 'lista' AND c.estado = 'pagada'
         ORDER BY a.lista_en, c.id, a.id`)
    const comandas = await conCambios(articulos)
    // Cuántos artículos de cada comanda siguen en cocina 
    if (comandas.length) {
        const [faltan] = await conexion.query(`
            SELECT comanda_id, COUNT(*) AS n FROM comanda_articulos
             WHERE comanda_id IN (?) AND estado IN ('pendiente', 'en_preparacion') GROUP BY comanda_id`,
            [comandas.map(c => c.id)])
        comandas.forEach(c => { c.en_cocina = (faltan.find(f => f.comanda_id === c.id) || { n: 0 }).n })
    }
    return comandas
}

// Explica por qué no se pudo mover un artículo 
async function motivoRechazo(articuloId, nuevo) {
    const [[a]] = await conexion.query(
        `SELECT a.estado, a.va_a_cocina, c.estado AS comanda_estado
           FROM comanda_articulos a JOIN comandas c ON c.id = a.comanda_id WHERE a.id = ?`, [articuloId])
    if (!a) return new ErrorNegocio('Ese artículo no existe.', 404)
    if (a.comanda_estado === 'cancelada' || a.estado === 'cancelada') return new ErrorNegocio('Ese artículo está cancelado.', 409)
    if (!a.va_a_cocina && nuevo !== 'entregada') return new ErrorNegocio('Ese artículo no se prepara en cocina.', 409)
    const [[pendiente]] = await conexion.query(
        `SELECT k.id FROM cancelaciones k JOIN comanda_articulos a ON a.comanda_id = k.comanda_id
          WHERE a.id = ? AND k.estado = 'solicitada' AND (k.articulo_id IS NULL OR k.articulo_id = a.id) LIMIT 1`, [articuloId])
    if (pendiente) return new ErrorNegocio('Tiene una cancelación pendiente: espera a que el administrador la resuelva.', 409)
    return new ErrorNegocio(`No se puede pasar de "${a.estado}" a "${nuevo}".`, 409)
}

// creacion del texto del aviso
function resumen(descripciones) {
    const cuenta = new Map()
    descripciones.forEach(d => cuenta.set(d, (cuenta.get(d) || 0) + 1))
    return [...cuenta].map(([d, n]) => `${n} x ${d}`).join(', ').slice(0, 500)
}

// guarda el aviso a recepción con número de comanda y contenido
async function crearAviso(db, comandaId, articuloIds, usuarioId) {
    const [[c]] = await db.query(
        `SELECT c.id, c.folio, c.para_llevar, m.numero AS mesa
           FROM comandas c LEFT JOIN mesas m ON m.id = c.mesa_id WHERE c.id = ?`, [comandaId])
    const [arts] = await db.query('SELECT descripcion FROM comanda_articulos WHERE id IN (?) ORDER BY id', [articuloIds])
    const [[{ faltan }]] = await db.query(
        "SELECT COUNT(*) AS faltan FROM comanda_articulos WHERE comanda_id = ? AND estado IN ('pendiente','en_preparacion')", [comandaId])
    const aviso = {
        comanda_id: c.id, folio: c.folio,
        destino: c.para_llevar ? 'PARA LLEVAR' : `Mesa ${c.mesa}`,
        contenido: resumen(arts.map(a => a.descripcion)),
        parcial: faltan > 0 ? 1 : 0,
    }
    const [r] = await db.query(
        'INSERT INTO avisos_recepcion (comanda_id, folio, destino, contenido, parcial, creado_por) VALUES (?, ?, ?, ?, ?, ?)',
        [aviso.comanda_id, aviso.folio, aviso.destino, aviso.contenido, aviso.parcial, usuarioId || null])
    const [[fila]] = await db.query('SELECT * FROM avisos_recepcion WHERE id = ?', [r.insertId])
    return fila
}

//manda lista de avisos a recepcion
async function cerrarAvisosAtendidos(db, comandaId, usuarioId) {
    const [[{ quedan }]] = await db.query(
        "SELECT COUNT(*) AS quedan FROM comanda_articulos WHERE comanda_id = ? AND estado = 'lista'", [comandaId])
    if (quedan) return []
    const [abiertos] = await db.query(
        'SELECT id FROM avisos_recepcion WHERE comanda_id = ? AND visto_en IS NULL FOR UPDATE', [comandaId])
    if (!abiertos.length) return []
    const ids = abiertos.map(a => a.id)
    await db.query('UPDATE avisos_recepcion SET visto_en = NOW(), visto_por = ? WHERE id IN (?)', [usuarioId || null, ids])
    return ids
}

// Mueve un artículo respetando el orden de estados
async function cambiarEstado(articuloId, nuevo, usuarioId) {
    if (!DESDE[nuevo]) throw new ErrorNegocio('Estado no válido.', 422)
    const db = await conexion.getConnection()
    try {
        await db.beginTransaction()
        // update
        const params = usaUsuario(nuevo) ? [nuevo, usuarioId || null, articuloId, DESDE[nuevo]] : [nuevo, articuloId, DESDE[nuevo]]
        const [r] = await db.query(
            `UPDATE comanda_articulos a JOIN comandas c ON c.id = a.comanda_id
                SET a.estado = ?, ${SELLO[nuevo].replace(/(\w+) =/g, 'a.$1 =')}
              WHERE a.id = ? AND a.estado IN (?) AND c.estado = 'pagada' AND ${SIN_CANCELACION}
                ${nuevo === 'entregada' ? '' : 'AND a.va_a_cocina = 1'}`, params)
        if (!r.affectedRows) throw await motivoRechazo(articuloId, nuevo)

        const [[{ comanda_id }]] = await db.query('SELECT comanda_id FROM comanda_articulos WHERE id = ?', [articuloId])
        let aviso = null, avisos_cerrados = []
        if (nuevo === 'lista') aviso = await crearAviso(db, comanda_id, [articuloId], usuarioId)
        if (nuevo === 'entregada') avisos_cerrados = await cerrarAvisosAtendidos(db, comanda_id, usuarioId)
        await db.commit()
        return { comanda_id, aviso, avisos_cerrados }
    } catch (e) {
        await db.rollback()
        throw e
    } finally {
        db.release()
    }
}

// comandas de jalon
async function cambiarEstadoComanda(comandaId, nuevo, usuarioId) {
    if (nuevo !== 'lista' && nuevo !== 'entregada') throw new ErrorNegocio('Estado no válido.', 422)
    const db = await conexion.getConnection()
    try {
        await db.beginTransaction()
        const [filas] = await db.query(
            `SELECT a.id FROM comanda_articulos a JOIN comandas c ON c.id = a.comanda_id
              WHERE a.comanda_id = ? AND a.estado IN (?) AND c.estado = 'pagada' AND ${SIN_CANCELACION}
                ${nuevo === 'lista' ? 'AND a.va_a_cocina = 1' : ''}
              FOR UPDATE`, [comandaId, DESDE[nuevo]])
        if (!filas.length) throw new ErrorNegocio('No hay artículos de esa comanda para cambiar.', 409)
        const ids = filas.map(f => f.id)
        await db.query(
            `UPDATE comanda_articulos SET estado = ?, ${SELLO[nuevo]} WHERE id IN (?)`, [nuevo, usuarioId || null, ids])

        let aviso = null, avisos_cerrados = []
        if (nuevo === 'lista') aviso = await crearAviso(db, comandaId, ids, usuarioId)
        else avisos_cerrados = await cerrarAvisosAtendidos(db, comandaId, usuarioId)
        await db.commit()
        return { comanda_id: comandaId, cambiados: ids.length, aviso, avisos_cerrados }
    } catch (e) {
        await db.rollback()
        throw e
    } finally {
        db.release()
    }
}

// avisos que recepción todavía no atiende
async function avisosPendientes() {
    const [filas] = await conexion.query(
        `SELECT * FROM avisos_recepcion
          WHERE visto_en IS NULL AND creado_en >= NOW() - INTERVAL 12 HOUR
          ORDER BY creado_en, id LIMIT 50`)
    return filas
}

async function marcarAvisoVisto(id, usuarioId) {
    const [r] = await conexion.query(
        'UPDATE avisos_recepcion SET visto_en = NOW(), visto_por = ? WHERE id = ? AND visto_en IS NULL', [usuarioId, id])
    if (!r.affectedRows) throw new ErrorNegocio('Ese aviso no existe o ya se atendió.', 404)
}

// control de pendientes del día 
async function controlPendientes() {
    const [filas] = await conexion.query(`
        SELECT c.id, c.folio, c.para_llevar, c.cliente_nombre, c.creada_en, m.numero AS mesa,
               SUM(a.estado <> 'cancelada')                         AS total,
               SUM(a.estado = 'entregada')                          AS entregados,
               SUM(a.estado = 'lista')                              AS listos,
               SUM(a.estado IN ('pendiente','en_preparacion'))      AS en_cocina,
               TIMESTAMPDIFF(MINUTE, c.creada_en, NOW())            AS minutos
          FROM comandas c
          JOIN comanda_articulos a ON a.comanda_id = c.id
          LEFT JOIN mesas m ON m.id = c.mesa_id
         WHERE c.estado = 'pagada' AND DATE(c.creada_en) = CURDATE()
         GROUP BY c.id
        HAVING entregados < total
         ORDER BY c.creada_en, c.id`)
    if (!filas.length) return []
    // Qué artículos faltan
    const [faltan] = await conexion.query(`
        SELECT comanda_id, descripcion, estado FROM comanda_articulos
         WHERE comanda_id IN (?) AND estado IN ('pendiente','en_preparacion','lista')
         ORDER BY id`, [filas.map(f => f.id)])
    const [dados] = await conexion.query(`
        SELECT comanda_id, descripcion FROM comanda_articulos
         WHERE comanda_id IN (?) AND estado = 'entregada' ORDER BY id`, [filas.map(f => f.id)])
    filas.forEach(f => {
        f.faltan = faltan.filter(x => x.comanda_id === f.id)
        f.dados = resumen(dados.filter(x => x.comanda_id === f.id).map(x => x.descripcion))
    })
    return filas
}

//entregas del día con hora
async function entregadasHoy() {
    const [filas] = await conexion.query(`
        SELECT a.id, a.descripcion, a.va_a_cocina, a.lista_en, a.entregado_en,
               c.folio, c.para_llevar, m.numero AS mesa, u.nombre AS entrego,
               TIMESTAMPDIFF(MINUTE, c.creada_en, a.entregado_en) AS espera
          FROM comanda_articulos a
          JOIN comandas c ON c.id = a.comanda_id
          LEFT JOIN mesas m ON m.id = c.mesa_id
          LEFT JOIN usuarios u ON u.id = a.entregado_por
         WHERE a.estado = 'entregada' AND DATE(a.entregado_en) = CURDATE()
         ORDER BY a.entregado_en DESC, a.id DESC
         LIMIT 100`)
    return filas
}

// Números para la cabecera de la cocina
async function resumenCocina() {
    const [[r]] = await conexion.query(`
        SELECT SUM(a.estado = 'pendiente')       AS pendientes,
               SUM(a.estado = 'en_preparacion')  AS preparando,
               SUM(a.estado IN ('lista','entregada') AND DATE(a.lista_en) = CURDATE()) AS listas_hoy,
               ROUND(AVG(CASE WHEN DATE(a.lista_en) = CURDATE() THEN TIMESTAMPDIFF(SECOND, c.creada_en, a.lista_en) END) / 60) AS promedio_min
          FROM comanda_articulos a JOIN comandas c ON c.id = a.comanda_id
         WHERE a.va_a_cocina = 1 AND c.estado = 'pagada'`)
    return {
        pendientes: Number(r.pendientes || 0), preparando: Number(r.preparando || 0),
        listas_hoy: Number(r.listas_hoy || 0), promedio_min: r.promedio_min === null ? null : Number(r.promedio_min)
    }
}

module.exports = {
    DESDE, colaCocina, paraEntregar, cambiarEstado, cambiarEstadoComanda,
    avisosPendientes, marcarAvisoVisto, controlPendientes, entregadasHoy, resumenCocina, resumen
}
