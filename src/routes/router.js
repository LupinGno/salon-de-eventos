const express = require('express')
const router = express.Router()

const authController = require('../controllers/authController')
const usuariosController = require('../controllers/usuariosController')
const productos = require('../controllers/productosController')
const catalogos = require('../controllers/catalogosController')
const rentas = require('../controllers/rentasCatalogoController')
const api = require('../controllers/apiController')
const cajaCtl = require('../controllers/cajaController')
const cocinaCtl = require('../controllers/cocinaController')
const { autenticado, permitirRoles, permitirModulo, prohibido, soloInvitados } = require('./auth')
const { ROLES, buscarModulo } = require('./modulos')
const { campoImagen } = require('../controllers/subidas')
const formatos = require('../controllers/formatos')

const soloAdmin = [autenticado, permitirRoles(ROLES.ADMIN)]
const catalogo = [autenticado, permitirModulo('catalogos')]
const conImagen = campoImagen('archivo')

// Mensajes de éxito comunes 
const MENSAJES = {
    creado: 'Se creó correctamente.', guardado: 'Cambios guardados.', eliminado: 'Se eliminó correctamente.',
    baja: 'El producto se dio de baja: ya no se puede vender.', alta: 'El producto volvió a estar a la venta.',
    estilo: 'Estilo guardado.', tamano: 'Tamaño guardado.', mesas: 'Mesas añadidas.', imagen: 'Imagen subida.',
    permisos: 'Permisos actualizados; aplican desde la siguiente página que abra cada usuario.',
    'mesa-liberada': 'Mesa liberada: su cuenta quedó cerrada.',
    cancelada: 'Cancelación aprobada. No hay reembolso.',
    'cancelacion-solicitada': 'Solicitud enviada: un administrador debe aprobarla.',
    'cancelacion-rechazada': 'La solicitud de cancelación se rechazó.',
    'mesa-liberada': 'Mesa liberada: su cuenta quedó cerrada.',
    cancelada: 'Cancelación aprobada. No hay reembolso.',
    'cancelacion-solicitada': 'Solicitud enviada: un administrador debe aprobarla.',
    'cancelacion-rechazada': 'La solicitud de cancelación se rechazó.',
    'no-existe': 'Ese registro no existe.', 'en-uso': 'No se puede eliminar porque ya tiene movimientos; dalo de baja.'
}
router.use((req, res, next) => {
    res.locals.f = formatos
    const ok = MENSAJES[req.query.ok]
    if (ok) {
        const aviso = ['no-existe', 'en-uso'].includes(req.query.ok)
        res.locals.alerta = { titulo: aviso ? 'Atención' : 'Listo', mensaje: ok, icono: aviso ? 'warning' : 'success' }
    }
    next()
})

// Públicas
router.get('/login', soloInvitados, authController.vistaLogin)
router.post('/login', authController.login)
router.get('/register', soloInvitados, authController.vistaRegistro)
router.post('/register', authController.registro)
router.get('/logout', authController.logout)

// Inicio 
router.get('/', autenticado, (req, res) => res.render('index', { titulo: 'Inicio' }))

//  usuarios
router.get('/usuarios', soloAdmin, usuariosController.lista)
router.get('/usuarios/nuevo', soloAdmin, usuariosController.formNuevo)
router.post('/usuarios', soloAdmin, usuariosController.crear)
router.get('/usuarios/:id/editar', soloAdmin, usuariosController.formEditar)
router.post('/usuarios/:id', soloAdmin, usuariosController.actualizar)
router.post('/usuarios/:id/eliminar', soloAdmin, usuariosController.eliminar)

// administración y catálogos
router.get('/catalogos', catalogo, catalogos.inicio)

// Recetas
router.get('/catalogos/productos', catalogo, productos.lista)
router.get('/catalogos/productos/nuevo', catalogo, productos.formNuevo)
router.post('/catalogos/productos', catalogo, conImagen, productos.crear)
router.get('/catalogos/productos/:id', catalogo, productos.detalle)
router.get('/catalogos/productos/:id/editar', catalogo, productos.formEditar)
router.post('/catalogos/productos/:id', catalogo, conImagen, productos.actualizar)
router.post('/catalogos/productos/:id/estado', catalogo, productos.cambiarEstado)
router.post('/catalogos/productos/:id/eliminar', catalogo, productos.eliminar)
router.post('/catalogos/productos/:id/estilos', catalogo, conImagen, productos.crearEstilo)
router.post('/catalogos/productos/:id/estilos/:estiloId', catalogo, conImagen, productos.actualizarEstilo)
router.post('/catalogos/productos/:id/estilos/:estiloId/eliminar', catalogo, productos.eliminarEstilo)
router.post('/catalogos/productos/:id/tamanos', catalogo, productos.guardarTamano)
router.post('/catalogos/productos/:id/tamanos/:tamanoId', catalogo, productos.guardarTamano)
router.post('/catalogos/productos/:id/tamanos/:tamanoId/eliminar', catalogo, productos.eliminarTamano)

// Ingredientes
router.get('/catalogos/ingredientes', catalogo, catalogos.ingredientes)
router.post('/catalogos/ingredientes', catalogo, catalogos.guardarIngrediente)
router.post('/catalogos/ingredientes/:id', catalogo, catalogos.guardarIngrediente)
router.post('/catalogos/ingredientes/:id/eliminar', catalogo, catalogos.eliminarIngrediente)

// Temporadas
router.get('/catalogos/temporadas', catalogo, catalogos.temporadas)
router.post('/catalogos/temporadas', catalogo, catalogos.guardarTemporada)
router.post('/catalogos/temporadas/:id', catalogo, catalogos.guardarTemporada)
router.post('/catalogos/temporadas/:id/eliminar', catalogo, catalogos.eliminarTemporada)

// Mesas
router.get('/catalogos/mesas', catalogo, catalogos.mesas)
router.post('/catalogos/mesas', catalogo, catalogos.agregarMesas)
router.post('/catalogos/mesas/:id', catalogo, catalogos.actualizarMesa)
router.post('/catalogos/mesas/:id/eliminar', catalogo, catalogos.eliminarMesa)

// Salones y mobiliario
router.get('/catalogos/salones', catalogo, rentas.salones)
router.get('/catalogos/salones/nuevo', catalogo, rentas.formSalon)
router.post('/catalogos/salones', catalogo, conImagen, rentas.guardarSalon)
router.get('/catalogos/salones/:id/editar', catalogo, rentas.formSalon)
router.post('/catalogos/salones/:id', catalogo, conImagen, rentas.guardarSalon)
router.post('/catalogos/salones/:id/eliminar', catalogo, rentas.eliminarSalon)
router.post('/catalogos/mobiliario', catalogo, rentas.guardarMobiliario)
router.post('/catalogos/mobiliario/:id', catalogo, rentas.guardarMobiliario)
router.post('/catalogos/mobiliario/:id/eliminar', catalogo, rentas.eliminarMobiliario)

// Brincolines
router.get('/catalogos/brincolines', catalogo, rentas.brincolines)
router.get('/catalogos/brincolines/nuevo', catalogo, rentas.formBrincolin)
router.post('/catalogos/brincolines', catalogo, conImagen, rentas.guardarBrincolin)
router.get('/catalogos/brincolines/:id/editar', catalogo, rentas.formBrincolin)
router.post('/catalogos/brincolines/:id', catalogo, conImagen, rentas.guardarBrincolin)
router.post('/catalogos/brincolines/:id/estado', catalogo, rentas.cambiarEstadoBrincolin)
router.post('/catalogos/brincolines/:id/eliminar', catalogo, rentas.eliminarBrincolin)

// Imágenes, permisos y vista del menú
router.get('/catalogos/imagenes', catalogo, catalogos.imagenes)
router.post('/catalogos/imagenes', catalogo, conImagen, catalogos.subirImagen)
router.post('/catalogos/imagenes/:id/eliminar', catalogo, catalogos.eliminarImagen)
router.get('/catalogos/permisos', soloAdmin, catalogos.permisos)
router.post('/catalogos/permisos', soloAdmin, catalogos.guardarPermisos)
router.get('/catalogos/menu', catalogo, catalogos.vistaMenu)

//Consultas
router.get('/consultas', autenticado, permitirModulo('consultas'), rentas.consultas)

// API para la caja 
const apiCaja = [autenticado, permitirModulo('caja-snacks', 'catalogos')]
router.get('/api/menu', apiCaja, api.menu)
router.get('/api/mesas', apiCaja, api.mesas)
router.get('/api/productos/:id', apiCaja, api.producto)
router.post('/api/cotizar', apiCaja, api.cotizar)

// Punto de venta y comandas 
const enCaja = [autenticado, permitirModulo('caja-snacks')]
router.get('/caja', enCaja, cajaCtl.puntoDeVenta)
router.post('/caja/comandas', enCaja, cajaCtl.registrar)
router.get('/caja/comandas', enCaja, cajaCtl.comandas)
router.get('/caja/comandas/:id', enCaja, cajaCtl.detalle)
router.post('/caja/comandas/:id/cancelar', enCaja, cajaCtl.cancelar)
router.get('/caja/cancelaciones', enCaja, cajaCtl.cancelaciones)
router.post('/caja/cancelaciones/:id/aprobar', soloAdmin, cajaCtl.resolver(true))
router.post('/caja/cancelaciones/:id/rechazar', soloAdmin, cajaCtl.resolver(false))
router.post('/caja/cuentas/:id/cerrar', enCaja, cajaCtl.cerrarCuenta)
router.get('/caja/tickets/:id', enCaja, cajaCtl.ticket)
router.get('/caja/tickets/:id/pdf', enCaja, cajaCtl.ticketPdf)

// Cocina y recepción 
const enCocina = [autenticado, permitirModulo('cocina')]
router.get('/cocina', enCocina, cocinaCtl.monitor)
router.post('/cocina/articulos/:id/:accion', enCocina, cocinaCtl.cambiarArticulo)
router.post('/cocina/comandas/:id/lista', enCocina, cocinaCtl.comandaLista)
router.get('/caja/entregas', enCaja, cocinaCtl.entregas)
router.post('/caja/articulos/:id/entregar', enCaja, cocinaCtl.entregarArticulo)
router.post('/caja/comandas/:id/entregar', enCaja, cocinaCtl.entregarComanda)

//Módulos de los siguientes sprints 
router.get('/modulos/:clave', autenticado, (req, res, next) => {
    const modulo = buscarModulo(req.params.clave)
    if (!modulo) return next() // → 404
    if (!req.usuario.modulos.includes(modulo.clave)) return prohibido(req, res)
    res.render('modulo', { titulo: modulo.titulo, modulo })
})

module.exports = router
