import {
  ErrorArchivoDescripciones,
  aplicarOperaciones,
  generarExcelDescripciones,
  planificarImportacion,
} from '../services/descripcionesExcelService'
import { crearControladoresExcel } from './catalogoExcelController'

/**
 * Exportar / importar el catálogo de descripciones en Excel.
 * La lógica vive en `services/descripcionesExcelService.ts`.
 *
 *   GET  /api/configuracion/descripciones/exportar
 *   POST /api/configuracion/descripciones/importar/preview    (multipart: archivo)
 *   POST /api/configuracion/descripciones/importar/confirmar  (multipart: archivo, archivo_hash, firma)
 */

const controladores = crearControladoresExcel({
  nombre: 'Descripciones',
  generar: generarExcelDescripciones,
  planificar: planificarImportacion,
  aplicar: aplicarOperaciones,
  ErrorArchivo: ErrorArchivoDescripciones,
})

export const exportarDescripciones = controladores.exportar
export const previewImportacionDescripciones = controladores.preview
export const confirmarImportacionDescripciones = controladores.confirmar
