import { Router } from 'express'
import { getOpcionesFiltros, getPanelVentas } from '../controllers/ventasPanelController'
import { getCoberturaVentas } from '../controllers/ventasCoberturaController'
import { exportarVentasExcel, getDetalleOperacion, getOperaciones } from '../controllers/ventasOperacionesController'
import {
  getEstadoIntegraciones,
  getLocalesExternos,
  getMuestraBistrosoft,
  getSincronizaciones,
  postProcesarPendientes,
  postSincronizar,
  putLocalExterno,
} from '../controllers/ventasIntegracionesController'
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

export default router
