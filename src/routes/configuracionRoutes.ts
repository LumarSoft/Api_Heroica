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
import { requireAuth, requirePermission } from '../middlewares/authMiddleware'

const router = Router()

// Todas las rutas requieren autenticación
router.use(requireAuth)

// ========== CATEGORÍAS ==========
// Los catálogos (categorías, bancos, medios pago) son visibles a quien tiene ver_configuracion
// y modificables solo por superadmin (ver_configuracion con permisos de superadmin).
// Como no hay un permiso granular de "gestionar_categorias", usamos ver_configuracion para read
// y gestionar_usuarios (admin) para write — o simplemente superadmin via el middleware.
// Decisión de diseño: estas secciones internas son solo para superadmin → usamos ver_configuracion
// como mínimo pues el panel ya bloquea en frontend a no-superadmin.
router.get('/categorias', requirePermission('ver_configuracion'), getCategorias)
router.post('/categorias', requirePermission('gestionar_roles'), createCategoria)
router.put('/categorias/:id', requirePermission('gestionar_roles'), updateCategoria)
router.delete('/categorias/:id', requirePermission('gestionar_roles'), deleteCategoria)

// ========== SUBCATEGORÍAS ==========
router.get('/subcategorias', requirePermission('ver_configuracion'), getSubcategorias)
router.post('/subcategorias', requirePermission('gestionar_roles'), createSubcategoria)
router.put('/subcategorias/:id', requirePermission('gestionar_roles'), updateSubcategoria)
router.delete('/subcategorias/:id', requirePermission('gestionar_roles'), deleteSubcategoria)

// ========== BANCOS ==========
router.get('/bancos', requirePermission('ver_configuracion'), getBancos)
router.post('/bancos', requirePermission('gestionar_roles'), createBanco)
router.put('/bancos/:id', requirePermission('gestionar_roles'), updateBanco)
router.delete('/bancos/:id', requirePermission('gestionar_roles'), deleteBanco)

// ========== MEDIOS DE PAGO ==========
router.get('/medios-pago', requirePermission('ver_configuracion'), getMediosPago)
router.post('/medios-pago', requirePermission('gestionar_roles'), createMedioPago)
router.put('/medios-pago/:id', requirePermission('gestionar_roles'), updateMedioPago)
router.delete('/medios-pago/:id', requirePermission('gestionar_roles'), deleteMedioPago)

// ========== DESCRIPCIONES ==========
router.get('/descripciones', requirePermission('ver_configuracion'), getDescripciones)
router.post('/descripciones', requirePermission('gestionar_roles'), createDescripcion)
router.put('/descripciones/:id', requirePermission('gestionar_roles'), updateDescripcion)
router.delete('/descripciones/:id', requirePermission('gestionar_roles'), deleteDescripcion)

// ========== PROVEEDORES ==========
router.get('/proveedores', requirePermission('ver_configuracion'), getProveedores)
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
