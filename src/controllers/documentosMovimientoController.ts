import { Request, Response } from 'express';
import { query } from '../config/database';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { put, del, get } from '@vercel/blob';
import { Readable } from 'stream';

// Detectar si estamos en producción (Vercel)
const isProduction = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

// Configurar multer para subir archivos
const storage = isProduction
    ? multer.memoryStorage()
    : multer.diskStorage({
        destination: (req, file, cb) => {
            const uploadDir = path.join(__dirname, '../../uploads/comprobantes');

            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }

            cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const ext = path.extname(file.originalname);
            cb(null, `comprobante-${uniqueSuffix}${ext}`);
        }
    });

const fileFilter = (req: any, file: any, cb: any) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg'];

    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Solo se permiten archivos PDF y JPG'), false);
    }
};

export const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024
    }
});

// GET /api/movimientos/:id/documentos - Obtener todos los documentos de un movimiento
export const getDocumentos = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const result: any = await query(
            'SELECT * FROM documentos_movimiento WHERE movimiento_id = ? ORDER BY fecha_subida DESC',
            [id]
        );

        res.json({
            success: true,
            data: result || []
        });

    } catch (error) {
        console.error('Error al obtener documentos:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener documentos'
        });
    }
};

// POST /api/movimientos/:id/documentos - Subir nuevo documento
export const uploadDocumento = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as any).user?.id;

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No se proporcionó ningún archivo'
            });
        }

        // Verificar que el movimiento existe
        const existingResult: any = await query(
            'SELECT id FROM movimientos WHERE id = ?',
            [id]
        );

        if (!Array.isArray(existingResult) || existingResult.length === 0) {
            if (!isProduction && req.file.path) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(404).json({
                success: false,
                message: 'Movimiento no encontrado'
            });
        }

        let relativePath: string;
        let fileUrl: string | undefined;

        if (isProduction) {
            if (!process.env.BLOB_READ_WRITE_TOKEN) {
                throw new Error('BLOB_READ_WRITE_TOKEN no está configurado');
            }

            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const ext = path.extname(req.file.originalname);
            const blobFileName = `comprobantes/movimiento-${id}/doc-${uniqueSuffix}${ext}`;

            const blob = await put(blobFileName, req.file.buffer, {
                access: 'private',
                token: process.env.BLOB_READ_WRITE_TOKEN,
            });

            relativePath = blob.url;
            fileUrl = blob.url;
        } else {
            relativePath = `uploads/comprobantes/${req.file.filename}`;
            fileUrl = undefined;
        }

        const insertResult: any = await query(
            `INSERT INTO documentos_movimiento 
       (movimiento_id, nombre_archivo, ruta_archivo, tipo_archivo, tamano_bytes, usuario_subida_id) 
       VALUES (?, ?, ?, ?, ?, ?)`,
            [id, req.file.originalname, relativePath, req.file.mimetype, req.file.size, userId || null]
        );

        res.json({
            success: true,
            message: 'Documento subido exitosamente',
            data: {
                id: insertResult.insertId,
                nombre: req.file.originalname,
                path: relativePath,
                url: fileUrl,
                size: req.file.size,
                tipo: req.file.mimetype
            }
        });

    } catch (error) {
        console.error('Error al subir documento:', error);

        if (!isProduction && req.file && (req.file as any).path) {
            fs.unlinkSync((req.file as any).path);
        }

        res.status(500).json({
            success: false,
            message: 'Error al subir documento',
            error: error instanceof Error ? error.message : 'Error desconocido'
        });
    }
};

// DELETE /api/movimientos/:movimientoId/documentos/:docId - Eliminar documento específico
export const deleteDocumento = async (req: Request, res: Response) => {
    try {
        const { movimientoId, docId } = req.params;

        const result: any = await query(
            'SELECT * FROM documentos_movimiento WHERE id = ? AND movimiento_id = ?',
            [docId, movimientoId]
        );

        if (!Array.isArray(result) || result.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Documento no encontrado'
            });
        }

        const documento = result[0];

        if (isProduction) {
            if (documento.ruta_archivo.startsWith('https://')) {
                try {
                    await del(documento.ruta_archivo, {
                        token: process.env.BLOB_READ_WRITE_TOKEN!
                    });
                } catch (error) {
                    console.error('Error al eliminar archivo de Blob:', error);
                }
            }
        } else {
            const filePath = path.join(__dirname, '../../', documento.ruta_archivo);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        await query(
            'DELETE FROM documentos_movimiento WHERE id = ?',
            [docId]
        );

        res.json({
            success: true,
            message: 'Documento eliminado exitosamente'
        });

    } catch (error) {
        console.error('Error al eliminar documento:', error);
        res.status(500).json({
            success: false,
            message: 'Error al eliminar documento'
        });
    }
};

// GET /api/movimientos/:movimientoId/documentos/:docId/download - Descargar documento
export const downloadDocumento = async (req: Request, res: Response) => {
    try {
        const { movimientoId, docId } = req.params;

        const result: any = await query(
            'SELECT * FROM documentos_movimiento WHERE id = ? AND movimiento_id = ?',
            [docId, movimientoId]
        );

        if (!Array.isArray(result) || result.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Documento no encontrado'
            });
        }

        const documento = result[0];

        if (isProduction) {
            if (documento.ruta_archivo.startsWith('https://')) {
                try {
                    const blobResult = await get(documento.ruta_archivo, {
                        access: 'private',
                        token: process.env.BLOB_READ_WRITE_TOKEN,
                    });

                    if (!blobResult || blobResult.statusCode !== 200) {
                        return res.status(404).json({
                            success: false,
                            message: 'Archivo no encontrado en el almacenamiento'
                        });
                    }

                    res.setHeader('Content-Type', documento.tipo_archivo || 'application/octet-stream');
                    res.setHeader('Content-Disposition', `attachment; filename="${documento.nombre_archivo}"`);
                    res.setHeader('X-Content-Type-Options', 'nosniff');

                    if (blobResult.stream) {
                        Readable.fromWeb(blobResult.stream as any).pipe(res);
                    } else {
                        throw new Error('No se pudo obtener el stream del archivo');
                    }
                } catch (error) {
                    console.error('Error al descargar desde Blob:', error);
                    return res.status(500).json({
                        success: false,
                        message: 'Error al descargar archivo desde el almacenamiento'
                    });
                }
            } else {
                return res.status(404).json({
                    success: false,
                    message: 'URL del archivo no válida'
                });
            }
        } else {
            const filePath = path.join(__dirname, '../../', documento.ruta_archivo);

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({
                    success: false,
                    message: 'Archivo no encontrado'
                });
            }

            res.download(filePath, documento.nombre_archivo);
        }

    } catch (error) {
        console.error('Error al descargar documento:', error);
        res.status(500).json({
            success: false,
            message: 'Error al descargar documento'
        });
    }
};
