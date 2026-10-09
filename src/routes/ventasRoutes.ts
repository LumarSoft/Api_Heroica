import { Router } from 'express'
import { getOpcionesFiltros, getPanelVentas } from '../controllers/ventasPanelController'
import { getCoberturaVentas } from '../controllers/ventasCoberturaController'
import { exportarVentasExcel, getDetalleOperacion, getOperaciones } from '../controllers/ventasOperacionesController'
import {
  getConfigHiopos,
  getEstadoIntegraciones,
  getLocalesExternos,
  getMuestraBistrosoft,
  getSincronizaciones,
  postDiagnosticoHiopos,
  postProcesarPendientes,
  postSincronizar,
  putConfigHiopos,
  putLocalExterno,
} from '../controllers/ventasIntegracionesController'
import {
  deleteProgramado,
  deleteReporteGuardado,
  getAnalisisProductos,
  getDefinicionesReportes,
  getMapaCalor,
  getProgramados,
  getReportesGuardados,
  getVendedores,
  postConsultaReporte,
  postEnviarProgramado,
  postExportarReporte,
  postProgramado,
  postReporteGuardado,
  putProgramado,
  putReporteGuardado,
} from '../controllers/ventasReportesController'
import { requireAnyPermission, requireAuth, requireModule, requirePermission } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)
router.use(requireModule('ventas'))

// Panel gerencial y consultas
router.get('/panel', requirePermission('ver_ventas'), getPanelVentas)
router.get('/filtros', requirePermission('ver_ventas'), getOpcionesFiltros)
router.get('/operaciones', requirePermission('ver_ventas'), getOperaciones)
router.get('/operaciones/detalle', requirePermission('ver_ventas'), getDetalleOperacion)
router.get('/exportar', requirePermission('exportar_ventas'), exportarVentasExcel)
router.get(
  '/cobertura',
  requireAnyPermission(['ver_ventas', 'sincronizar_ventas', 'configurar_ventas']),
  getCoberturaVentas,
)

// Análisis y constructor de reportes
const verVentas = requirePermission('ver_ventas')
router.get('/productos', verVentas, getAnalisisProductos)
router.get('/mapa-calor', verVentas, getMapaCalor)
router.get('/vendedores', verVentas, getVendedores)
router.get('/reportes/definiciones', verVentas, getDefinicionesReportes)
router.post('/reportes/consulta', verVentas, postConsultaReporte)
router.post('/reportes/exportar', requirePermission('exportar_ventas'), postExportarReporte)
router.get('/reportes/guardados', verVentas, getReportesGuardados)
router.post('/reportes/guardados', verVentas, postReporteGuardado)
router.put('/reportes/guardados/:id', verVentas, putReporteGuardado)
router.delete('/reportes/guardados/:id', verVentas, deleteReporteGuardado)

// Envíos programados por mail
const gestionarReportes = requirePermission('gestionar_reportes_ventas')
router.get('/reportes/programados', gestionarReportes, getProgramados)
router.post('/reportes/programados', gestionarReportes, postProgramado)
router.put('/reportes/programados/:id', gestionarReportes, putProgramado)
router.delete('/reportes/programados/:id', gestionarReportes, deleteProgramado)
router.post('/reportes/programados/:id/enviar', gestionarReportes, postEnviarProgramado)

// Integraciones (Bistrosoft / Hiopos)
const verIntegraciones = requireAnyPermission(['sincronizar_ventas', 'configurar_ventas'])
router.get('/integraciones/estado', verIntegraciones, getEstadoIntegraciones)
router.get('/integraciones/sincronizaciones', verIntegraciones, getSincronizaciones)
router.post('/integraciones/sincronizar', requirePermission('sincronizar_ventas'), postSincronizar)
router.post(
  '/integraciones/procesar',
  requireAnyPermission(['ver_ventas', 'sincronizar_ventas', 'configurar_ventas']),
  postProcesarPendientes,
)
router.get('/integraciones/locales', verIntegraciones, getLocalesExternos)
router.put('/integraciones/locales/:id', requirePermission('configurar_ventas'), putLocalExterno)
router.get('/integraciones/bistrosoft/muestra', requirePermission('configurar_ventas'), getMuestraBistrosoft)
router.get('/integraciones/hiopos/config', verIntegraciones, getConfigHiopos)
router.put('/integraciones/hiopos/config', requirePermission('configurar_ventas'), putConfigHiopos)
router.post('/integraciones/hiopos/diagnostico', requirePermission('configurar_ventas'), postDiagnosticoHiopos)

export default router
