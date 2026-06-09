import { Request, Response, NextFunction } from 'express'

/**
 * Headers de seguridad HTTP (equivalente a helmet() para una API JSON).
 * Sin dependencias externas.
 */
export const securityHeaders = (_req: Request, res: Response, next: NextFunction): void => {
  // Evita que el browser interprete respuestas con otro content-type (sniffing)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // La API nunca debe renderizarse dentro de un iframe
  res.setHeader('X-Frame-Options', 'DENY')
  // No filtrar la URL de origen hacia otros sitios
  res.setHeader('Referrer-Policy', 'no-referrer')
  // Fuerza HTTPS por 6 meses (solo tiene efecto detrás de TLS)
  res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
  // CSP restrictiva para respuestas de API (bloquea cualquier ejecución si algo se renderiza)
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
  res.setHeader('X-DNS-Prefetch-Control', 'off')
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none')
  next()
}

/**
 * Error handler global. Loguea el detalle internamente y devuelve un mensaje
 * genérico al cliente (nunca stack traces, sin importar NODE_ENV).
 */
export const globalErrorHandler = (err: any, req: Request, res: Response, _next: NextFunction): void => {
  console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, err)

  if (res.headersSent) return

  // Errores de parseo de JSON del body
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    res.status(400).json({ success: false, message: 'Cuerpo de la petición inválido' })
    return
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ success: false, message: 'Cuerpo de la petición demasiado grande' })
    return
  }

  res.status(500).json({ success: false, message: 'Error interno del servidor' })
}

// Campos que jamás deben aparecer en logs (independiente de mayúsculas/minúsculas)
const SENSITIVE_FIELD_PATTERN =
  /pass|token|code|secret|otp|pin|cbu|cuil|dni|sueldo|salario|monto_neto|authorization/i

/**
 * Devuelve una copia del body con todos los campos sensibles redactados
 * (recursivo, hasta 3 niveles).
 */
export function redactSensitiveFields(value: unknown, depth = 0): unknown {
  if (depth > 3 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.length > 20 ? `[Array(${value.length})]` : value.map(v => redactSensitiveFields(v, depth + 1))

  const redacted: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_FIELD_PATTERN.test(key)) {
      redacted[key] = '[REDACTED]'
    } else {
      redacted[key] = redactSensitiveFields(val, depth + 1)
    }
  }
  return redacted
}
