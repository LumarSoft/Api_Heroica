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
// En producción usamos memoria, en local usamos disco
const storage = isProduction
    ? multer.memoryStorage() // En producción guardamos en memoria temporalmente
    : multer.diskStorage({
        destination: (req, file, cb) => {
            const uploadDir = path.join(__dirname, '../../uploads/documentacion');

            // Crear directorio si no existe
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }

            cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const ext = path.extname(file.originalname);
            cb(null, `doc-${uniqueSuffix}${ext}`);
        }
    });

const fileFilter = (req: any, file: any, cb: any) => {
    // Aceptar solo PDF y JPG
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
        fileSize: 10 * 1024 * 1024 // 10MB máximo
    }
});

// GET /api/sucursales/:id/documentos - Obtener todos los documentos de una sucursal
export const getDocumentos = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const result: any = await query(
            'SELECT * FROM documentos_sucursal WHERE sucursal_id = ? ORDER BY fecha_subida DESC',
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

// POST /api/sucursales/:id/documentos - Subir nuevo documento
export const uploadDocumento = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { tipo_documento, fecha_vencimiento } = req.body;
        const userId = (req as any).user?.id;

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No se proporcionó ningún archivo'
            });
        }

        // Verificar que la sucursal existe
        const existingResult: any = await query(
            'SELECT id FROM sucursales WHERE id = ?',
            [id]
        );

        if (!Array.isArray(existingResult) || existingResult.length === 0) {
            // Eliminar el archivo subido si la sucursal no existe
            if (!isProduction && req.file.path) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(404).json({
                success: false,
                message: 'Sucursal no encontrada'
            });
        }

        let relativePath: string;
        let fileUrl: string | undefined;

        if (isProduction) {
            // PRODUCCIÓN: Subir a Vercel Blob
            if (!process.env.BLOB_READ_WRITE_TOKEN) {
                throw new Error('BLOB_READ_WRITE_TOKEN no está configurado');
            }

            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const ext = path.extname(req.file.originalname);
            const blobFileName = `documentos/sucursal-${id}/doc-${uniqueSuffix}${ext}`;

            const blob = await put(blobFileName, req.file.buffer, {
                access: 'private',
                token: process.env.BLOB_READ_WRITE_TOKEN,
            });

            relativePath = blob.url; // Guardar la URL de Blob
            fileUrl = blob.url;
        } else {
            // LOCAL: Usar sistema de archivos
            relativePath = `uploads/documentacion/${req.file.filename}`;
            fileUrl = undefined; // En local no tenemos URL pública
        }

        const insertResult: any = await query(
            `INSERT INTO documentos_sucursal 
       (sucursal_id, nombre_archivo, ruta_archivo, tipo_archivo, tamano_bytes, usuario_subida_id, tipo_documento, fecha_vencimiento) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, req.file.originalname, relativePath, req.file.mimetype, req.file.size, userId || null, tipo_documento || null, fecha_vencimiento || null]
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
                tipo: req.file.mimetype,
                tipo_documento: tipo_documento || null,
                fecha_vencimiento: fecha_vencimiento || null
            }
        });

    } catch (error) {
        console.error('Error al subir documento:', error);

        // Eliminar el archivo si hubo error (solo en local)
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

// DELETE /api/sucursales/:sucursalId/documentos/:docId - Eliminar documento específico
export const deleteDocumento = async (req: Request, res: Response) => {
    try {
        const { sucursalId, docId } = req.params;

        // Obtener el documento
        const result: any = await query(
            'SELECT * FROM documentos_sucursal WHERE id = ? AND sucursal_id = ?',
            [docId, sucursalId]
        );

        if (!Array.isArray(result) || result.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Documento no encontrado'
            });
        }

        const documento = result[0];

        if (isProduction) {
            // PRODUCCIÓN: Eliminar de Vercel Blob
            if (documento.ruta_archivo.startsWith('https://')) {
                try {
                    await del(documento.ruta_archivo, {
                        token: process.env.BLOB_READ_WRITE_TOKEN!
                    });
                } catch (error) {
                    console.error('Error al eliminar archivo de Blob:', error);
                    // Continuar aunque falle el borrado del blob
                }
            }
        } else {
            // LOCAL: Eliminar archivo físico
            const filePath = path.join(__dirname, '../../', documento.ruta_archivo);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        // Eliminar registro de la base de datos
        await query(
            'DELETE FROM documentos_sucursal WHERE id = ?',
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

// GET /api/sucursales/:sucursalId/documentos/:docId/download - Descargar documento
export const downloadDocumento = async (req: Request, res: Response) => {
    try {
        const { sucursalId, docId } = req.params;

        const result: any = await query(
            'SELECT * FROM documentos_sucursal WHERE id = ? AND sucursal_id = ?',
            [docId, sucursalId]
        );

        if (!Array.isArray(result) || result.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Documento no encontrado'
            });
        }

        const documento = result[0];

        if (isProduction) {
            // PRODUCCIÓN: Descargar de Vercel Blob (privado) usando get()
            if (documento.ruta_archivo.startsWith('https://')) {
                try {
                    // Usar get() del SDK para obtener blobs privados
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

                    // Configurar headers para la descarga
                    res.setHeader('Content-Type', documento.tipo_archivo || 'application/octet-stream');
                    res.setHeader('Content-Disposition', `attachment; filename="${documento.nombre_archivo}"`);
                    res.setHeader('X-Content-Type-Options', 'nosniff');

                    // Convertir el stream web a stream de Node.js y enviarlo
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
            // LOCAL: Servir desde sistema de archivos
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
