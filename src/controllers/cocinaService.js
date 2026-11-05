//  Cocina y recepción 
const conexion = require('../database/db')
const { ErrorNegocio } = require('./menuService')

// Estados que puede tener un artículo y a cuál puede pasar
const SIGUIENTE = {
    pendiente: ['en_preparacion', 'lista'],
    en_preparacion: ['lista'],
    lista: ['entregada'],
}

// Junta artículos con sus cambios dentro de su comanda
async function conCambios(articulos) {
    if (!articulos.length) return []
    const [mods] = await conexion.query(
        'SELECT articulo_id, tipo, nombre FROM articulo_modificaciones WHERE articulo_id IN (?) ORDER BY tipo DESC, id',
        [articulos.map(a => a.id)])
    articulos.forEach(a => {
        a.quitar = mods.filter(m => m.articulo_id === a.id && m.tipo === 'quitar').map(m => m.nombre)
        a.extras = mods.filter(m => m.articulo_id === a.id && m.tipo === 'extra').map(m => m.nombre)
    })
    // Agrupar por comanda
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

// primero en llegar, primero en atenderse
async function colaCocina() {
    const [articulos] = await conexion.query(`
        SELECT a.id, a.comanda_id, a.descripcion, a.piezas, a.estado,
               c.folio, c.para_llevar, c.cliente_nombre, c.creada_en, m.numero AS mesa,
               TIMESTAMPDIFF(MINUTE, c.creada_en, NOW()) AS minutos
          FROM comanda_articulos a
          JOIN comandas c ON c.id = a.comanda_id
          LEFT JOIN mesas m ON m.id = c.mesa_id
         WHERE a.va_a_cocina = 1 AND a.estado IN ('pendiente', 'en_preparacion') AND c.estado = 'pagada'
         ORDER BY c.creada_en, c.id, a.id`)
    return conCambios(articulos)
}

// lo que cocina ya liberó y recepción debe llevar a la mesa 
async function paraEntregar() {
    const [articulos] = await conexion.query(`
        SELECT a.id, a.comanda_id, a.descripcion, a.piezas, a.estado, a.lista_en,
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

// Cambia el estado de un artículo respetando el orden pendiente a preparación a lista a entregada
async function cambiarEstado(articuloId, nuevo) {
    const [[a]] = await conexion.query(
        `SELECT a.id, a.estado, a.va_a_cocina, c.estado AS comanda_estado
           FROM comanda_articulos a JOIN comandas c ON c.id = a.comanda_id WHERE a.id = ?`, [articuloId])
    if (!a) throw new ErrorNegocio('Ese artículo no existe.', 404)
    if (a.comanda_estado === 'cancelada' || a.estado === 'cancelada') throw new ErrorNegocio('Ese artículo está cancelado.', 409)
    if (!(SIGUIENTE[a.estado] || []).includes(nuevo)) {
        throw new ErrorNegocio(`No se puede pasar de "${a.estado}" a "${nuevo}".`, 409)
    }
    const fecha = nuevo === 'lista' ? ', lista_en = NOW()' : nuevo === 'entregada' ? ', entregado_en = NOW()' : ''
    await conexion.query(`UPDATE comanda_articulos SET estado = ?${fecha} WHERE id = ?`, [nuevo, articuloId])
}

// Toda la comanda de un jalón
async function cambiarEstadoComanda(comandaId, nuevo) {
    const desde = nuevo === 'lista' ? ['pendiente', 'en_preparacion'] : ['lista']
    const fecha = nuevo === 'lista' ? 'lista_en = NOW()' : 'entregado_en = NOW()'
    const [r] = await conexion.query(
        `UPDATE comanda_articulos SET estado = ?, ${fecha}
          WHERE comanda_id = ? AND estado IN (?) AND (va_a_cocina = 1 OR ? = 'entregada')`,
        [nuevo, comandaId, desde, nuevo])
    if (!r.affectedRows) throw new ErrorNegocio('No hay artículos de esa comanda para cambiar.', 409)
    return r.affectedRows
}

module.exports = { colaCocina, paraEntregar, cambiarEstado, cambiarEstadoComanda }
