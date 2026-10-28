import {
  ErrorArchivoProveedores,
  aplicarOperaciones,
  generarExcelProveedores,
  planificarImportacion,
} from '../services/proveedoresExcelService'
import { crearControladoresExcel } from './catalogoExcelController'

/**
 * Exportar / importar el catálogo de proveedores en Excel.
 * La lógica vive en `services/proveedoresExcelService.ts`.
 *
 *   GET  /api/configuracion/proveedores/exportar
 *   POST /api/configuracion/proveedores/importar/preview    (multipart: archivo)
 *   POST /api/configuracion/proveedores/importar/confirmar  (multipart: archivo, archivo_hash, firma)
 */

const controladores = crearControladoresExcel({
  nombre: 'Proveedores',
  generar: generarExcelProveedores,
  planificar: planificarImportacion,
  aplicar: aplicarOperaciones,
  ErrorArchivo: ErrorArchivoProveedores,
})

export const exportarProveedores = controladores.exportar
export const previewImportacionProveedores = controladores.preview
export const confirmarImportacionProveedores = controladores.confirmar
