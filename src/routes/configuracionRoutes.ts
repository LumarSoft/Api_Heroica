import { Router } from 'express'
import {
  // Categorías
  getCategorias,
  createCategoria,
  updateCategoria,
  deleteCategoria,
  // Subcategorías
  getSubcategorias,
  createSubcategoria,
  updateSubcategoria,
  deleteSubcategoria,
  // Bancos
  getBancos,
  createBanco,
  updateBanco,
  deleteBanco,
  // Medios de Pago
  getMediosPago,
  createMedioPago,
  updateMedioPago,
  deleteMedioPago,
  // Descripciones
  getDescripciones,
  createDescripcion,
  updateDescripcion,
  deleteDescripcion,
  // Proveedores
  getProveedores,
  createProveedor,
  updateProveedor,
  deleteProveedor,
  // Usuarios
  getUsuarios,
  createUsuario,
  updateUsuarioRol,
  toggleUsuarioActivo,
  deleteUsuario,
  getUsuarioSucursales,
  updateUsuarioSucursales,
  // Módulos (acceso por usuario)
  getModulos,
  getUsuarioModulos,
  updateUsuarioModulos,
  // Roles
  getRoles,
  createRol,
  updateRol,
  deleteRol,
  // Permisos
  getPermisos,
} from '../controllers/configuracionController'
import { requireAuth, requirePermission, requireAnyPermission } from '../middlewares/authMiddleware'

const router = Router()

// Todas las rutas requieren autenticación
router.use(requireAuth)

// Permisos que habilitan LECTURA de catálogos (categorías, bancos, medios de pago,
// descripciones, proveedores). Estos catálogos no solo se usan en el panel de
// Configuración: también alimentan los selects del formulario "Nuevo movimiento"
// (caja efectivo/banco y pagos pendientes). Por eso, además de ver_configuracion,
// cualquier permiso que habilite crear/aprobar movimientos o pendientes también
// debe poder leerlos — si no, esos selects quedan vacíos sin aviso para roles
// (ej. "admin") que pueden cargar pendientes pero no tienen acceso al panel de
// configuración. La escritura (crear/editar/eliminar) sigue exclusiva de gestionar_roles.
const CATALOGOS_READ_PERMISOS = [
  'ver_configuracion',
  'crear_movimientos',
  'aprobar_movimientos',
  'cargar_pendientes',
  'aprobar_pendientes',
]

// ========== CATEGORÍAS ==========
router.get('/categorias', requireAnyPermission(CATALOGOS_READ_PERMISOS), getCategorias)
router.post('/categorias', requirePermission('gestionar_roles'), createCategoria)
router.put('/categorias/:id', requirePermission('gestionar_roles'), updateCategoria)
router.delete('/categorias/:id', requirePermission('gestionar_roles'), deleteCategoria)

// ========== SUBCATEGORÍAS ==========
router.get('/subcategorias', requireAnyPermission(CATALOGOS_READ_PERMISOS), getSubcategorias)
router.post('/subcategorias', requirePermission('gestionar_roles'), createSubcategoria)
router.put('/subcategorias/:id', requirePermission('gestionar_roles'), updateSubcategoria)
router.delete('/subcategorias/:id', requirePermission('gestionar_roles'), deleteSubcategoria)

// ========== BANCOS ==========
router.get('/bancos', requireAnyPermission(CATALOGOS_READ_PERMISOS), getBancos)
router.post('/bancos', requirePermission('gestionar_roles'), createBanco)
router.put('/bancos/:id', requirePermission('gestionar_roles'), updateBanco)
router.delete('/bancos/:id', requirePermission('gestionar_roles'), deleteBanco)

// ========== MEDIOS DE PAGO ==========
router.get('/medios-pago', requireAnyPermission(CATALOGOS_READ_PERMISOS), getMediosPago)
router.post('/medios-pago', requirePermission('gestionar_roles'), createMedioPago)
router.put('/medios-pago/:id', requirePermission('gestionar_roles'), updateMedioPago)
router.delete('/medios-pago/:id', requirePermission('gestionar_roles'), deleteMedioPago)

// ========== DESCRIPCIONES ==========
router.get('/descripciones', requireAnyPermission(CATALOGOS_READ_PERMISOS), getDescripciones)
router.post('/descripciones', requirePermission('gestionar_roles'), createDescripcion)
router.put('/descripciones/:id', requirePermission('gestionar_roles'), updateDescripcion)
router.delete('/descripciones/:id', requirePermission('gestionar_roles'), deleteDescripcion)

// ========== PROVEEDORES ==========
router.get('/proveedores', requireAnyPermission(CATALOGOS_READ_PERMISOS), getProveedores)
router.post('/proveedores', requirePermission('gestionar_roles'), createProveedor)
router.put('/proveedores/:id', requirePermission('gestionar_roles'), updateProveedor)
router.delete('/proveedores/:id', requirePermission('gestionar_roles'), deleteProveedor)

// ========== USUARIOS ==========
router.get('/usuarios', requirePermission('gestionar_usuarios'), getUsuarios)
router.post('/usuarios', requirePermission('gestionar_usuarios'), createUsuario)
router.put('/usuarios/:id/rol', requirePermission('gestionar_usuarios'), updateUsuarioRol)
router.put('/usuarios/:id/toggle-activo', requirePermission('gestionar_usuarios'), toggleUsuarioActivo)
router.delete('/usuarios/:id', requirePermission('gestionar_usuarios'), deleteUsuario)
router.get('/usuarios/:id/sucursales', requirePermission('gestionar_usuarios'), getUsuarioSucursales)
router.put('/usuarios/:id/sucursales', requirePermission('gestionar_usuarios'), updateUsuarioSucursales)
router.get('/modulos', requirePermission('gestionar_usuarios'), getModulos)
router.get('/usuarios/:id/modulos', requirePermission('gestionar_usuarios'), getUsuarioModulos)
router.put('/usuarios/:id/modulos', requirePermission('gestionar_usuarios'), updateUsuarioModulos)

// ========== ROLES ==========
router.get('/roles', requirePermission('gestionar_roles'), getRoles)
router.post('/roles', requirePermission('gestionar_roles'), createRol)
router.put('/roles/:id', requirePermission('gestionar_roles'), updateRol)
router.delete('/roles/:id', requirePermission('gestionar_roles'), deleteRol)

// ========== PERMISOS ==========
// Visible para quien puede gestionar roles (para poblar el checklist del formulario)
router.get('/permisos', requirePermission('gestionar_roles'), getPermisos)

export default router
