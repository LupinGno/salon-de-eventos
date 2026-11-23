// Revisa al arrancar que la base tenga todas las migraciones del programa
const conexion = require('./db')

// Lo último que agrega cada migración
const MIGRACIONES = [
    { archivo: '004_modulo2_punto_de_venta.sql', tabla: 'cancelaciones' },
    { archivo: '005_modulo3_cocina.sql', tabla: 'avisos_recepcion' },
    { archivo: '005_modulo3_cocina.sql', tabla: 'comanda_articulos', columna: 'entregado_por' },
    { archivo: '006_sprint7_inventario_reembolso_salones.sql', tabla: 'movimientos_inventario' },
    { archivo: '006_sprint7_inventario_reembolso_salones.sql', tabla: 'cancelaciones', columna: 'monto_reembolso' },
    { archivo: '006_sprint7_inventario_reembolso_salones.sql', tabla: 'reservas_salon' },
    { archivo: '007_modulo4_renta_salones.sql', tabla: 'pagos_reserva' },
    { archivo: '007_modulo4_renta_salones.sql', tabla: 'contratos_salon' },
    { archivo: '007_modulo4_renta_salones.sql', tabla: 'reservas_salon', columna: 'entregado_en' },
    { archivo: '008_sprint9_renta_brincolines.sql', tabla: 'rentas_brincolin' },
    { archivo: '008_sprint9_renta_brincolines.sql', tabla: 'pagos_renta' },
    { archivo: '009_modulo5_limpieza_incidencias.sql', tabla: 'tareas_limpieza' },
    { archivo: '009_modulo5_limpieza_incidencias.sql', tabla: 'incidencias' },
]

async function revisar() {
    const faltan = new Set()
    for (const m of MIGRACIONES) {
        const [[{ n }]] = m.columna
            ? await conexion.query(
                `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [m.tabla, m.columna])
            : await conexion.query(
                `SELECT COUNT(*) AS n FROM information_schema.TABLES
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [m.tabla])
        if (!n) faltan.add(m.archivo)
    }
    if (faltan.size) {
        console.warn('\n⚠  A la base de datos le faltan migraciones. Aplica estos archivos de')
        console.warn('   salon-eventos-extras/base_de_datos/instalar/ (en orden) y reinicia:')
        faltan.forEach(a => console.warn(`     - ${a}`))
        console.warn('   Mientras tanto, cobrar, usar la cocina o rentar salones puede dar error.\n')
    }
    return [...faltan]
}

module.exports = { revisar }
