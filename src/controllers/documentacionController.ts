import { Request, Response } from 'express';
import { query } from '../config/database';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Configurar multer para subir archivos
const storage = multer.diskStorage({
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
        const userId = (req as any).user?.id; // Asumiendo que tienes middleware de auth

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
            fs.unlinkSync(req.file.path);
            return res.status(404).json({
                success: false,
                message: 'Sucursal no encontrada'
            });
        }

        // Guardar ruta relativa en la base de datos
        const relativePath = `uploads/documentacion/${req.file.filename}`;

        const insertResult: any = await query(
            `INSERT INTO documentos_sucursal 
       (sucursal_id, nombre_archivo, ruta_archivo, tipo_archivo, tamano_bytes, usuario_subida_id) 
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
                size: req.file.size,
                tipo: req.file.mimetype
            }
        });

    } catch (error) {
        console.error('Error al subir documento:', error);

        // Eliminar el archivo si hubo error
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }

        res.status(500).json({
            success: false,
            message: 'Error al subir documento'
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

        // Eliminar archivo físico
        const filePath = path.join(__dirname, '../../', documento.ruta_archivo);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
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
        const filePath = path.join(__dirname, '../../', documento.ruta_archivo);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                message: 'Archivo no encontrado'
            });
        }

        res.download(filePath, documento.nombre_archivo);

    } catch (error) {
        console.error('Error al descargar documento:', error);
        res.status(500).json({
            success: false,
            message: 'Error al descargar documento'
        });
    }
};
