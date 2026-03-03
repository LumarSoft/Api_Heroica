import { Request, Response } from 'express';
import pool from '../config/database';

/**
 * GET /health
 * Liveness check — verifica que el proceso está vivo.
 */
export const liveness = (_req: Request, res: Response): void => {
    res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
    });
};

/**
 * GET /ready
 * Readiness check — verifica que la base de datos está disponible.
 */
export const readiness = async (_req: Request, res: Response): Promise<void> => {
    try {
        await pool.execute('SELECT 1');
        res.status(200).json({
            status: 'ok',
            db: 'ok',
            timestamp: new Date().toISOString(),
        });
    } catch {
        res.status(503).json({
            status: 'error',
            db: 'unavailable',
            timestamp: new Date().toISOString(),
        });
    }
};
