import { NextFunction, Request, Response } from 'express'
import ExcelJS from 'exceljs'
import multer from 'multer'

/**
 * Exportar / importar un catálogo en Excel (descripciones, proveedores). Cada catálogo
 * aporta su servicio; acá están la subida del archivo y el flujo de dos pasos:
 * preview (no escribe) y confirmar (vuelve a planificar el mismo archivo y aplica).
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
export const subirExcelCatalogo = (req: Request, res: Response, next: NextFunction) => {
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

interface PreviewBase {
  archivo_hash: string
  firma: string
  resumen: { altas: number; modificaciones: number; bajas: number; unificaciones: number; errores: number }
}

interface CatalogoExcel<P extends PreviewBase, O> {
  /** Para el nombre del archivo y los mensajes, en plural: "Descripciones", "Proveedores" */
  nombre: string
  generar: () => Promise<ExcelJS.Workbook>
  planificar: (buffer: Buffer) => Promise<{ preview: P; operaciones: O }>
  aplicar: (operaciones: O) => Promise<void>
  /** Error del archivo en sí: se responde 400 con su mensaje */
  ErrorArchivo: new (...args: any[]) => Error
}

export function crearControladoresExcel<P extends PreviewBase, O>(catalogo: CatalogoExcel<P, O>) {
  const entidad = catalogo.nombre.toLowerCase()

  const exportar = async (_req: Request, res: Response) => {
    try {
      const workbook = await catalogo.generar()
      const filename = `${catalogo.nombre}_${fechaHoy()}.xlsx`
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
      await workbook.xlsx.write(res)
      res.end()
    } catch (error) {
      console.error(`Error al exportar ${entidad}:`, error)
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: `Error al exportar ${entidad}` })
      } else {
        res.end()
      }
    }
  }

  const preview = async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, message: 'No se recibió ningún archivo.' })
      const { preview } = await catalogo.planificar(req.file.buffer)
      res.json({ success: true, data: preview })
    } catch (error) {
      if (error instanceof catalogo.ErrorArchivo) {
        return res.status(400).json({ success: false, message: error.message })
      }
      console.error(`Error en preview de importación de ${entidad}:`, error)
      res.status(500).json({ success: false, message: 'Error al procesar el archivo' })
    }
  }

  const confirmar = async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, message: 'No se recibió ningún archivo.' })
      const { archivo_hash, firma } = req.body as { archivo_hash?: string; firma?: string }

      const { preview, operaciones } = await catalogo.planificar(req.file.buffer)

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
          message: `El catálogo de ${entidad} cambió en el sistema desde la vista previa. Revisá la vista previa nuevamente antes de aplicar.`,
          data: preview,
        })
      }

      await catalogo.aplicar(operaciones)

      const r = preview.resumen
      res.json({
        success: true,
        message: `Importación aplicada: ${r.altas} altas, ${r.modificaciones} modificaciones, ${r.unificaciones} unificaciones, ${r.bajas} bajas.`,
        data: r,
      })
    } catch (error) {
      if (error instanceof catalogo.ErrorArchivo) {
        return res.status(400).json({ success: false, message: error.message })
      }
      console.error(`Error al confirmar importación de ${entidad}:`, error)
      res.status(500).json({ success: false, message: 'Error al aplicar la importación. No se guardó ningún cambio.' })
    }
  }

  return { exportar, preview, confirmar }
}
