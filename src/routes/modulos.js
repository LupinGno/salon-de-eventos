// Roles del sistema (deben coincidir con la tabla `roles`)
const ROLES = {
    ADMIN: 'Administrador',
    CAJERO: 'Cajero de snacks',
    COCINA: 'Cocina',
    SALONES: 'Encargado de salones',
    BRINCOLINES: 'Encargado de brincolines',
    LIMPIEZA: 'Limpieza',
    CLIENTE: 'Cliente'
}

// Módulos del sistema. QUÉ ROL entra a cada uno ya no está aquí:
// se guarda en la tabla `rol_modulos` y el administrador lo cambia en
// Catálogos → Permisos por puesto (US-20).
const MODULOS = [
    {
        clave: 'usuarios', titulo: 'Usuarios y roles', icono: 'people-fill', ruta: '/usuarios',
        entrega: 'Sprint 0 — jueves 15 oct', listo: true, soloAdmin: true,
        descripcion: 'Alta, modificación y baja de usuarios con su rol.'
    },
    {
        clave: 'catalogos', titulo: 'Administración y catálogos', icono: 'journal-text', ruta: '/catalogos',
        entrega: 'Sprint 2 — jueves 22 oct', listo: true,
        descripcion: 'Recetas, ingredientes fijos y móviles, extras, estilos, temporadas, mesas, salones, brincolines y permisos.'
    },
    {
        clave: 'caja-snacks', titulo: 'Punto de venta (snacks)', icono: 'cart-fill', ruta: '/caja',
        entrega: 'Sprint 4 — jueves 29 oct', listo: true,
        descripcion: 'Comandas en caja, personalización de platillos, para llevar y ticket PDF.'
    },
    {
        clave: 'cocina', titulo: 'Cocina y recepción', icono: 'fire', ruta: '/cocina',
        entrega: 'Sprint 6 — jueves 5 nov', listo: true,
        descripcion: 'Cola FIFO en vivo, aviso a recepción al instante, entregas con hora y control de pendientes.'
    },
    {
        clave: 'salones', titulo: 'Renta de salones', icono: 'building',
        entrega: 'Sprint 8 — jueves 12 nov',
        descripcion: 'Disponibilidad, aforo, con o sin alimentos, contrato y cuotas.'
    },
    {
        clave: 'brincolines', titulo: 'Renta de brincolines', icono: 'balloon-fill',
        entrega: 'Sprint 10 — jueves 19 nov',
        descripcion: 'Catálogo por fecha, instalación, garantías y recolección.'
    },
    {
        clave: 'limpieza', titulo: 'Limpieza', icono: 'stars',
        entrega: 'Sprint 10 — jueves 19 nov',
        descripcion: 'Liberar salones y brincolines después de limpiarlos e inspeccionarlos.'
    },
    {
        clave: 'cajas', titulo: 'Cajas y finanzas', icono: 'cash-stack',
        entrega: 'Sprint 12 — jueves 26 nov',
        descripcion: 'Fondo inicial, movimientos, arqueo, cortes y reportes. Cada cajero ve solo su caja.'
    },
    {
        clave: 'consultas', titulo: 'Consultas', icono: 'search', ruta: '/consultas',
        entrega: 'Sprint 2 — jueves 22 oct', listo: true,
        descripcion: 'Consulta de salones y brincolines del catálogo (solo lectura).'
    }
]

// Ruta de cada módulo: los que aún no están listos usan /modulos/<clave>
MODULOS.forEach(m => { if (!m.ruta) m.ruta = `/modulos/${m.clave}` })

const CLAVES = MODULOS.map(m => m.clave)
const buscarModulo = clave => MODULOS.find(m => m.clave === clave)
const modulosPorClaves = claves => MODULOS.filter(m => claves.includes(m.clave))

module.exports = { ROLES, MODULOS, CLAVES, buscarModulo, modulosPorClaves }
