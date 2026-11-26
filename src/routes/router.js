const express = require('express')
const router = express.Router()

const authController = require('../controllers/authController')
const usuariosController = require('../controllers/usuariosController')
const productos = require('../controllers/productosController')
const catalogos = require('../controllers/catalogosController')
const inventarioCtl = require('../controllers/inventarioController')
const salonesCtl = require('../controllers/salonesController')
const reservasCtl = require('../controllers/reservasController')
const brincolinesCtl = require('../controllers/brincolinesController')
const limpiezaCtl = require('../controllers/limpiezaController')
const rentas = require('../controllers/rentasCatalogoController')
const api = require('../controllers/apiController')
const cajaCtl = require('../controllers/cajaController')
const cocinaCtl = require('../controllers/cocinaController')
const cajasCtl = require('../controllers/cajasController')
const comprasCtl = require('../controllers/comprasController')
const { autenticado, permitirRoles, permitirModulo, prohibido, soloInvitados } = require('./auth')
const { ROLES, buscarModulo } = require('./modulos')
const { campoImagen } = require('../controllers/subidas')
const formatos = require('../controllers/formatos')
const tiempoReal = require('../controllers/tiempoReal')

const soloAdmin = [autenticado, permitirRoles(ROLES.ADMIN)]
const catalogo = [autenticado, permitirModulo('catalogos')]
const enSalones = [autenticado, permitirModulo('salones')]
const enBrincolines = [autenticado, permitirModulo('brincolines')]
const enLimpieza = [autenticado, permitirModulo('limpieza')]
const enCajas = [autenticado, permitirModulo('cajas')]
const conImagen = campoImagen('archivo')

// Mensajes de éxito comunes
const MENSAJES = {
    creado: 'Se creó correctamente.', guardado: 'Cambios guardados.', eliminado: 'Se eliminó correctamente.',
    baja: 'El producto se dio de baja: ya no se puede vender.', alta: 'El producto volvió a estar a la venta.',
    estilo: 'Estilo guardado.', tamano: 'Tamaño guardado.', mesas: 'Mesas añadidas.', imagen: 'Imagen subida.',
    permisos: 'Permisos actualizados; aplican desde la siguiente página que abra cada usuario.',
    'mesa-liberada': 'Mesa liberada: su cuenta quedó cerrada.',
    cancelada: 'Cancelación aprobada.',
    'cancelada-reembolso': 'Cancelación aprobada con reembolso: devuelve el dinero por el mismo medio con que pagó.',
    movimiento: 'Movimiento de inventario registrado.',
    'reserva-creada': 'Reserva guardada con su contrato firmado.',
    'renta-creada': 'Renta guardada con su contrato firmado.',
    'brincolin-instalado': 'Brincolín instalado en el domicilio.',
    'brincolin-no-instalado': 'No se instaló: la renta no se reembolsa y la garantía se devolvió por el mismo medio.',
    'brincolin-recogido': 'Brincolín recogido: pasa a Limpieza para revisarlo.',
    'falla-resuelta': 'Listo: se aplicó lo que eligió el cliente. Los movimientos de dinero están en los pagos.',
    'modelo-cambiado': 'Modelo cambiado. Si había diferencia, aparece en los pagos.',
    'renta-cancelada': 'Renta cancelada: la renta no se reembolsa; la garantía se devolvió por el mismo medio.',
    'dano-reportado': 'Daño registrado.',
    'dano-reportado-rentas': 'Daño registrado. Sus rentas próximas quedaron en "Fallas por resolver" para que el cliente elija.',
    reparado: 'El brincolín regresó de reparación y pasó a Limpieza.',
    revisado: 'Revisión guardada.',
    'salon-recibido': 'Salón recibido: pasa a Limpieza, que decide la cuota.',
    'turno-abierto': 'Caja abierta con su fondo inicial.',
    'extra-registrado': 'Movimiento registrado en la caja. Si es una salida de un cajero, espera la aprobación del administrador.',
    'arqueo-guardado': 'Arqueo guardado con su diferencia.',
    'turno-cerrado': 'Turno cerrado. Este es el corte.',
    'salida-aprobada': 'Salida aprobada: ya se descontó de la caja.',
    'salida-rechazada': 'Salida rechazada: no se descontó nada.',
    'reserva-liquidada': 'Renta liquidada: ya se puede entregar el salón el día del evento.',
    'alimentos-cancelados': 'Alimentos cancelados. Si hubo devolución, aparece en los pagos con el medio y la persona.',
    'salon-entregado': 'Salón entregado al responsable.',
    'danos-cobrados': 'Cargo por daños cobrado al responsable.',
    'cancelacion-solicitada': 'Solicitud enviada: un administrador debe aprobarla.',
    'cancelacion-rechazada': 'La solicitud de cancelación se rechazó.',
    'no-existe': 'Ese registro no existe.', 'en-uso': 'No se puede eliminar porque ya tiene movimientos; dalo de baja.'
}
// cuando un cobro, devolución o movimiento de caja sale bien, las pantallas de cajas se actualizan solas
const MUEVE_DINERO = /^\/(caja|cajas|salones|brincolines|limpieza)\//
router.use((req, res, next) => {
    if (req.method === 'POST' && MUEVE_DINERO.test(req.path)) {
        res.on('finish', () => { if (res.statusCode < 400) tiempoReal.emitir('cajas', 'cajas:cambio', { ruta: req.path }) })
    }
    next()
})
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
router.get('/', autenticado, async (req, res, next) => {
    try {
        const stockBajo = req.usuario.modulos.includes('catalogos') ? await require('../controllers/inventarioService').alertas() : []
        res.render('index', { titulo: 'Inicio', stockBajo })
    } catch (e) { next(e) }
})

// usuarios
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
//renta de salones 
router.get('/salones', enSalones, salonesCtl.disponibilidad)
router.get('/salones/reservar', enSalones, reservasCtl.formulario)
router.post('/salones/reservas', enSalones, reservasCtl.crear)
router.get('/salones/reservas', enSalones, reservasCtl.lista)
router.get('/salones/reservas/:id', enSalones, reservasCtl.detalle)
router.post('/salones/reservas/:id/liquidar', enSalones, reservasCtl.liquidar)
router.post('/salones/reservas/:id/cancelar-alimentos', enSalones, reservasCtl.cancelarAlimentos)
router.post('/salones/reservas/:id/entregar', enSalones, reservasCtl.entregar)
router.post('/salones/reservas/:id/recibir', enSalones, reservasCtl.recibir)
router.post('/salones/reservas/:id/cobrar-danos', enSalones, reservasCtl.cobrarDanos)
router.get('/salones/reservas/:id/contrato.pdf', enSalones, reservasCtl.contrato)
router.get('/salones/reservas/:id/comprobante.pdf', enSalones, reservasCtl.comprobante)
// renta de brincolines a domicilio
router.get('/brincolines', enBrincolines, brincolinesCtl.catalogo)
router.get('/brincolines/rentar', enBrincolines, brincolinesCtl.formulario)
router.post('/brincolines/rentas', enBrincolines, brincolinesCtl.crear)
router.get('/brincolines/rentas', enBrincolines, brincolinesCtl.lista)
router.get('/brincolines/rentas/:id', enBrincolines, brincolinesCtl.detalle)
router.post('/brincolines/rentas/:id/instalar', enBrincolines, brincolinesCtl.instalar)
router.post('/brincolines/rentas/:id/no-instalar', enBrincolines, brincolinesCtl.noInstalar)
router.post('/brincolines/rentas/:id/recoger', enBrincolines, brincolinesCtl.recoger)
router.get('/brincolines/rentas/:id/contrato.pdf', enBrincolines, brincolinesCtl.contrato)
router.get('/brincolines/rentas/:id/comprobante.pdf', enBrincolines, brincolinesCtl.comprobante)
// Sprint 10: cambios, fallas, equipo y limpieza
router.post('/brincolines/rentas/:id/resolver', enBrincolines, brincolinesCtl.resolver)
router.post('/brincolines/rentas/:id/cambiar', enBrincolines, brincolinesCtl.cambiar)
router.post('/brincolines/rentas/:id/cancelar', enBrincolines, brincolinesCtl.cancelar)
router.get('/brincolines/equipo', enBrincolines, brincolinesCtl.equipo)
router.post('/brincolines/equipo/:id/dano', enBrincolines, brincolinesCtl.reportarDano)
router.post('/brincolines/equipo/:id/reparado', enBrincolines, brincolinesCtl.reparado)
router.get('/limpieza', enLimpieza, limpiezaCtl.pendientes)
router.post('/limpieza/tareas/:id/brincolin', enLimpieza, limpiezaCtl.revisarBrincolin)
router.post('/limpieza/tareas/:id/salon', enLimpieza, limpiezaCtl.revisarSalon)
// cajas y finanzas
router.get('/cajas', enCajas, cajasCtl.panel)
router.get('/cajas/movimientos', enCajas, cajasCtl.movimientos)
// reportes, cortes y lo que solo ve administración
router.get('/cajas/movimientos.pdf', enCajas, cajasCtl.reportePdf)
router.get('/cajas/turnos/:id', enCajas, cajasCtl.corte)
router.get('/cajas/turnos/:id/corte.pdf', enCajas, cajasCtl.cortePdf)
router.get('/cajas/horario', soloAdmin, cajasCtl.horario)
router.post('/cajas/horario', soloAdmin, cajasCtl.guardarHorario)
router.post('/cajas/horario/excepcion', soloAdmin, cajasCtl.forzarHorario)
router.post('/cajas/horario/excepcion/:id/eliminar', soloAdmin, cajasCtl.quitarExcepcion)
router.get('/cajas/bitacora', soloAdmin, cajasCtl.bitacora)
router.get('/cajas/aprobaciones', soloAdmin, cajasCtl.aprobaciones)
router.post('/cajas/extras/:id/aprobar', soloAdmin, cajasCtl.aprobarExtra)
router.post('/cajas/extras/:id/rechazar', soloAdmin, cajasCtl.rechazarExtra)
router.get('/cajas/consolidado', soloAdmin, cajasCtl.consolidado)
router.get('/cajas/graficas', soloAdmin, cajasCtl.graficas)
router.get('/cajas/agenda', soloAdmin, cajasCtl.agenda)
router.get('/cajas/:id', enCajas, cajasCtl.detalle)
router.post('/cajas/:id/turno', enCajas, cajasCtl.abrir)
router.post('/cajas/:id/extras', enCajas, cajasCtl.extra)
router.post('/cajas/:id/arqueo', enCajas, cajasCtl.arqueo)
router.post('/cajas/:id/cerrar', enCajas, cajasCtl.cerrar)
// inventario de ingredientes
router.get('/catalogos/inventario', catalogo, inventarioCtl.vista)
router.get('/catalogos/inventario/:id', catalogo, inventarioCtl.historial)
router.post('/catalogos/inventario/:id/movimiento', catalogo, inventarioCtl.movimiento)
router.post('/catalogos/inventario/:id/configurar', catalogo, inventarioCtl.configurar)

// compras de insumos
router.get('/catalogos/compras', soloAdmin, comprasCtl.lista)
router.post('/catalogos/compras', soloAdmin, comprasCtl.registrar)

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

//API para la caja 
const apiCaja = [autenticado, permitirModulo('caja-snacks', 'catalogos')]
router.get('/api/menu', apiCaja, api.menu)
router.get('/api/mesas', apiCaja, api.mesas)
router.get('/api/productos/:id', apiCaja, api.producto)
router.post('/api/cotizar', apiCaja, api.cotizar)

//Punto de venta y comandas
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

// cocina y recepción
const enCocina = [autenticado, permitirModulo('cocina')]
router.get('/cocina', enCocina, cocinaCtl.monitor)
router.post('/cocina/articulos/:id/:accion', enCocina, cocinaCtl.cambiarArticulo)
router.post('/cocina/comandas/:id/lista', enCocina, cocinaCtl.comandaLista)
router.get('/caja/entregas', enCaja, cocinaCtl.entregas)
router.post('/caja/articulos/:id/entregar', enCaja, cocinaCtl.entregarArticulo)
router.post('/caja/comandas/:id/entregar', enCaja, cocinaCtl.entregarComanda)
//avisos a recepción 
router.get('/caja/avisos', enCaja, cocinaCtl.avisos)
router.post('/caja/avisos/:id/visto', enCaja, cocinaCtl.avisoVisto)
router.get('/caja/pendientes', enCaja, cocinaCtl.pendientes)
router.get('/caja/entregadas', enCaja, cocinaCtl.entregadas)

//Módulos de los siguientes sprints 
router.get('/modulos/:clave', autenticado, (req, res, next) => {
    const modulo = buscarModulo(req.params.clave)
    if (!modulo) return next() // → 404
    if (!req.usuario.modulos.includes(modulo.clave)) return prohibido(req, res)
    res.render('modulo', { titulo: modulo.titulo, modulo })
})

module.exports = router
