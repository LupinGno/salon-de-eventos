const ROLES = {
    ADMIN: 'Administrador',
    CAJERO: 'Cajero de snacks',
    COCINA: 'Cocina',
    SALONES: 'Encargado de salones',
    BRINCOLINES: 'Encargado de brincolines',
    LIMPIEZA: 'Limpieza',
    CLIENTE: 'Cliente'
}


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
        entrega: 'Sprint 4 ', listo: true,
        descripcion: 'Comandas en caja, personalización de platillos, para llevar y ticket PDF.'
    },
    {
        clave: 'cocina', titulo: 'Cocina y recepción', icono: 'fire', ruta: '/cocina',
        entrega: 'Sprint 6 — jueves 5 nov', adelanto: true,
        descripcion: 'Cocina en proceso de desarollo'
    },
       {
        clave: 'salones', titulo: 'Renta de salones', icono: 'building',
        entrega: 'Sprint 8 ',
        descripcion: 'Aun no disponible.'
    },
    {
        clave: 'brincolines', titulo: 'Renta de brincolines', icono: 'balloon-fill',
        entrega: 'Sprint 10 ',
        descripcion: 'Aun no disponible.'
    },
    {
        clave: 'limpieza', titulo: 'Limpieza', icono: 'stars',
        entrega: 'Sprint 10 ',
        descripcion: 'Aun no disponible.'
    },
    {
        clave: 'cajas', titulo: 'Cajas y finanzas', icono: 'cash-stack',
        entrega: 'Sprint 12 ',
        descripcion: 'Aun no disponible'
    },
    {
        clave: 'consultas', titulo: 'Consultas', icono: 'search', ruta: '/consultas',
        entrega: 'hecho', listo: true,
        descripcion: 'consultas para clientes'
    }
]

// Ruta de cada módulo
MODULOS.forEach(m => { if (!m.ruta) m.ruta = `/modulos/${m.clave}` })

const CLAVES = MODULOS.map(m => m.clave)
const buscarModulo = clave => MODULOS.find(m => m.clave === clave)
const modulosPorClaves = claves => MODULOS.filter(m => claves.includes(m.clave))

module.exports = { ROLES, MODULOS, CLAVES, buscarModulo, modulosPorClaves }