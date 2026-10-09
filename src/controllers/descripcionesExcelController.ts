import { NextFunction, Request, Response } from 'express'
import multer from 'multer'
import {
  ErrorArchivoDescripciones,
  aplicarOperaciones,
  generarExcelDescripciones,
  planificarImportacion,
} from '../services/descripcionesExcelService'

/**
 * Exportar / importar el catálogo de descripciones en Excel.
 * La lógica vive en `services/descripcionesExcelService.ts`.
 *
 *   GET  /api/configuracion/descripciones/exportar
 *   POST /api/configuracion/descripciones/importar/preview    (multipart: archivo)
 *   POST /api/configuracion/descripciones/importar/confirmar  (multipart: archivo, archivo_hash, firma)
 */

const MAX_BYTES = 5 * 1024 * 1024

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!/\.xlsx$/i.test(file.originalname)) {
      return cb(new Error('Solo se aceptan archivos .xlsx. Usá el Excel exportado desde el sistema.'))
    }
    cb(null, true)
  },
}).single('archivo')

/** Envuelve multer para devolver 400 con un mensaje claro en vez del 500 genérico. */
export const subirExcelDescripciones = (req: Request, res: Response, next: NextFunction) => {
  upload(req, res, (err: unknown) => {
    if (!err) return next()
    const message =
      err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
        ? 'El archivo supera los 5 MB.'
        : err instanceof Error
          ? err.message
          : 'No se pudo subir el archivo.'
    res.status(400).json({ success: false, message })
  })
}

function fechaHoy(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// GET /api/configuracion/descripciones/exportar
export const exportarDescripciones = async (_req: Request, res: Response) => {
  try {
    const workbook = await generarExcelDescripciones()
    const filename = `Descripciones_${fechaHoy()}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    await workbook.xlsx.write(res)
    res.end()
  } catch (error) {
    console.error('Error al exportar descripciones:', error)
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Error al exportar descripciones' })
    } else {
      res.end()
    }
  }
}

// POST /api/configuracion/descripciones/importar/preview
export const previewImportacionDescripciones = async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No se recibió ningún archivo.' })
    const { preview } = await planificarImportacion(req.file.buffer)
    res.json({ success: true, data: preview })
  } catch (error) {
    if (error instanceof ErrorArchivoDescripciones) {
      return res.status(400).json({ success: false, message: error.message })
    }
    console.error('Error en preview de importación de descripciones:', error)
    res.status(500).json({ success: false, message: 'Error al procesar el archivo' })
  }
}

// POST /api/configuracion/descripciones/importar/confirmar
export const confirmarImportacionDescripciones = async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No se recibió ningún archivo.' })
    const { archivo_hash, firma } = req.body as { archivo_hash?: string; firma?: string }

    const { preview, operaciones } = await planificarImportacion(req.file.buffer)

    if (!archivo_hash || archivo_hash !== preview.archivo_hash) {
      return res.status(400).json({
        success: false,
        message: 'El archivo no es el mismo que se revisó en la vista previa. Volvé a subirlo.',
      })
    }
    if (preview.resumen.errores > 0) {
      return res.status(400).json({
        success: false,
        message: 'El archivo tiene errores. Corregilos y volvé a subirlo; no se aplicó ningún cambio.',
      })
    }
    if (!firma || firma !== preview.firma) {
      return res.status(409).json({
        success: false,
        message:
          'Las descripciones cambiaron en el sistema desde la vista previa. Revisá la vista previa nuevamente antes de aplicar.',
        data: preview,
      })
    }

    await aplicarOperaciones(operaciones)

    res.json({
      success: true,
      message: `Importación aplicada: ${preview.resumen.altas} altas, ${preview.resumen.modificaciones} modificaciones, ${preview.resumen.bajas} bajas.`,
      data: preview.resumen,
    })
  } catch (error) {
    if (error instanceof ErrorArchivoDescripciones) {
      return res.status(400).json({ success: false, message: error.message })
    }
    console.error('Error al confirmar importación de descripciones:', error)
    res.status(500).json({ success: false, message: 'Error al aplicar la importación. No se guardó ningún cambio.' })
  }
}
