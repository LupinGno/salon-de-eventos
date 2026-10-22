// Roles del sistema 
const ROLES = {
    ADMIN: 'Administrador',
    CAJERO: 'Cajero de snacks',
    COCINA: 'Cocina',
    SALONES: 'Encargado de salones',
    BRINCOLINES: 'Encargado de brincolines',
    LIMPIEZA: 'Limpieza',
    CLIENTE: 'Cliente'
}

// Módulos del sistema con roles
const MODULOS = [
    {
        clave: 'usuarios', titulo: 'Administración de usuarios', icono: 'people-fill', ruta: '/usuarios',
        entrega: 'hecho', listo: true, soloAdmin: true,
        descripcion: 'Crud de usuarios.'
    },
    {
        clave: 'catalogos', titulo: 'Administración y catálogos', icono: 'journal-text', ruta: '/catalogos',
        entrega: 'hecho', listo: true,
        descripcion: 'Crud de salones, brincolines, alimentos y bebidas, y catálogos de precios.'
    },
    {
        clave: 'caja-snacks', titulo: 'Punto de venta', icono: 'cart-fill',
        entrega: 'Sprint 4',
        descripcion: 'Aun no disponible.'
    },
    {
        clave: 'cocina', titulo: 'Cocina y recepción', icono: 'fire',
        entrega: 'Sprint 6 ',
        descripcion: 'Aun no disponible.'
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
