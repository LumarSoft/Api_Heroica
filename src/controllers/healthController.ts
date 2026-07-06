import { Request, Response } from 'express'
import pool from '../config/database'
import { sendMail } from '../config/mailer'

/**
 * GET /health
 * Liveness check — verifica que el proceso está vivo.
 */
export const liveness = (_req: Request, res: Response): void => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })
}

/**
 * GET /email-check
 * Diagnóstico de email — verifica config de Resend y envía un mail de prueba.
 * Usar solo para debugging. Protegido por query param ?secret=
 */
export const emailCheck = async (req: Request, res: Response): Promise<void> => {
  const secret = req.query.secret
  if (!secret || secret !== process.env.JWT_SECRET) {
    res.status(401).json({ error: 'No autorizado' })
    return
  }

  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM
  const aprobacion = process.env.EMAIL_APROBACION

  const config = {
    RESEND_API_KEY: apiKey ? `✓ presente (${apiKey.slice(0, 8)}...)` : '✗ FALTA',
    EMAIL_FROM: from ?? '✗ FALTA',
    EMAIL_APROBACION: aprobacion ?? '✗ FALTA',
  }

  if (!apiKey || !from || !aprobacion) {
    res.status(500).json({ config, error: 'Variables de entorno incompletas' })
    return
  }

  const { data, error } = await sendMail({
    from,
    to: aprobacion,
    subject: '[Heroica] Email de prueba — diagnóstico',
    html: '<p>Este es un email de prueba del sistema Heroica. Si lo recibiste, el envío funciona correctamente.</p>',
  })

  if (error) {
    res.status(500).json({ config, resend_error: error })
    return
  }

  res.status(200).json({ config, resend_response: data, status: 'Email enviado correctamente' })
}

/**
 * GET /ready
 * Readiness check — verifica que la base de datos está disponible.
 */
export const readiness = async (_req: Request, res: Response): Promise<void> => {
  try {
    await pool.execute('SELECT 1')
    res.status(200).json({
      status: 'ok',
      db: 'ok',
      timestamp: new Date().toISOString(),
    })
  } catch {
    res.status(503).json({
      status: 'error',
      db: 'unavailable',
      timestamp: new Date().toISOString(),
    })
  }
}
