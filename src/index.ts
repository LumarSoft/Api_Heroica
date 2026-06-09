import express, { Application, Request, Response } from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import dotenv from 'dotenv'
import rateLimit from 'express-rate-limit'
import authRoutes from './routes/authRoutes'
import sucursalesRoutes from './routes/sucursalesRoutes'
import movimientosRoutes from './routes/movimientosRoutes'
import pagosPendientesRoutes from './routes/pagosPendientesRoutes'
import cajaBancoRoutes from './routes/cajaBancoRoutes'
import configuracionRoutes from './routes/configuracionRoutes'
import reportesRoutes from './routes/reportesRoutes'
import healthRoutes from './routes/healthRoutes'
import cuentasBancariasRoutes from './routes/cuentasBancariasRoutes'
import tareasRoutes from './routes/tareasRoutes'
import notificacionesRoutes from './routes/notificacionesRoutes'
import escalasRoutes from './routes/escalasRoutes'
import rrhhCalendarioRoutes from './routes/rrhhCalendarioRoutes'
import rrhhIncentivosRoutes from './routes/rrhhIncentivosRoutes'
import rrhhSolicitudesRoutes from './routes/rrhhSolicitudesRoutes'
import rrhhMotivosBajaRoutes from './routes/rrhhMotivosBajaRoutes'
import personalRoutes from './routes/personalRoutes'
import puestosRoutes from './routes/puestosRoutes'
import areasRoutes from './routes/areasRoutes'
import { syncPermisos } from './config/permisos'
import { securityHeaders, globalErrorHandler, redactSensitiveFields } from './middlewares/securityMiddleware'
import { startDbSyncCron } from './services/dbSyncService'
import { startPeriodoPruebaAlertCron } from './services/rrhhPeriodoPruebaAlertService'
import { startSolicitudesRrhhAlertCron } from './services/rrhhSolicitudesAlertService'
import { startEscalasAlertCron } from './services/escalasAlertService'
import rrhhSueldosRoutes from './routes/rrhhSueldosRoutes'
// Cargar variables de entorno
dotenv.config()

// Verificar variables de entorno críticas al arranque
if (!process.env.JWT_SECRET) {
  console.error('FATAL: La variable de entorno JWT_SECRET no está definida. El servidor no puede iniciar.')
  process.exit(1)
}

// Crear aplicación Express
const app: Application = express()
const PORT = process.env.PORT || 3001

// No revelar que es Express + headers de seguridad en todas las respuestas
app.disable('x-powered-by')
app.use(securityHeaders)

// Detrás de Nginx/Cloudflare: necesario para que req.ip y el rate limit usen la IP real
app.set('trust proxy', 1)

// Rate limiting: máximo 10 intentos de login por IP cada 15 minutos
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Demasiados intentos de inicio de sesión. Intente nuevamente en 15 minutos.',
  },
})

// Rate limiting para verificación 2FA: máximo 10 intentos por IP cada 10 minutos
const verify2FALimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Demasiados intentos de verificación. Intente nuevamente en 10 minutos.',
  },
})

// Middlewares
// CORS: admite múltiples orígenes separados por coma en CORS_ORIGIN.
// En producción es OBLIGATORIO configurar CORS_ORIGIN con el dominio real.
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',').map(o => o.trim())
if (isProductionEnv() && !process.env.CORS_ORIGIN) {
  console.warn('⚠️  CORS_ORIGIN no está definido en producción: solo se aceptará http://localhost:3000')
}
app.use(
  cors({
    origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
    credentials: true,
  }),
)

function isProductionEnv(): boolean {
  return process.env.NODE_ENV === 'production'
}
app.use(cookieParser()) // Parsear cookies (necesario para device_token)
app.use(express.json({ limit: '2mb' })) // Parsear JSON con límite de tamaño
app.use(express.urlencoded({ extended: true, limit: '2mb' })) // Parsear URL-encoded

// Middleware de logging — TODOS los campos sensibles redactados (passwords, tokens,
// códigos 2FA, datos laborales). En producción no se loguean bodies.
const isProduction = process.env.NODE_ENV === 'production'
app.use((req, res, next) => {
  const timestamp = new Date().toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour12: false,
  })
  console.log(`\n[${timestamp}] ${req.method} ${req.url}`)
  if (!isProduction && req.body && Object.keys(req.body).length > 0) {
    console.log(`Body:`, redactSensitiveFields(req.body))
  }
  next()
})

// Rutas
app.use('/api/auth/login', loginLimiter)
app.use('/api/auth/verify-2fa', verify2FALimiter)
app.use('/api/auth', authRoutes)
app.use('/api/sucursales', sucursalesRoutes)
app.use('/api/movimientos', movimientosRoutes)
app.use('/api/pagos-pendientes', pagosPendientesRoutes)
app.use('/api/caja-banco', cajaBancoRoutes)
app.use('/api/configuracion', configuracionRoutes)
app.use('/api/reportes', reportesRoutes)
app.use('/api/cuentas-bancarias', cuentasBancariasRoutes)
app.use('/api/tareas', tareasRoutes)
app.use('/api/notificaciones', notificacionesRoutes)
app.use('/api/escalas-salariales', escalasRoutes)
app.use('/api/rrhh/calendario', rrhhCalendarioRoutes)
app.use('/api/rrhh/incentivos', rrhhIncentivosRoutes)
app.use('/api/rrhh/solicitudes', rrhhSolicitudesRoutes)
app.use('/api/rrhh/motivos-baja', rrhhMotivosBajaRoutes)
app.use('/api/personal', personalRoutes)
app.use('/api/puestos', puestosRoutes)
app.use('/api/areas', areasRoutes)
app.use('/api/rrhh/sueldos', rrhhSueldosRoutes)

// Ruta raíz — no expone información sensible en producción
app.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'heroica-api',
  })
})

// Rutas de health check
app.use('/', healthRoutes)

// Ruta 404
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: 'Ruta no encontrada',
  })
})

// Error handler global: SIEMPRE al final. Nunca expone stack traces al cliente.
app.use(globalErrorHandler)

// Iniciar servidor
app.listen(PORT, async () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║                                       ║
  ║   🍺  API HEROICA - CONTABILIDAD     ║
  ║                                       ║
  ║   🚀 Servidor corriendo en:          ║
  ║   📍 http://localhost:${PORT}           ║
  ║                                       ║
  ╚═══════════════════════════════════════╝
  `)

  // Sincronizar permisos del sistema con la base de datos
  await syncPermisos()

  // Iniciar tareas programadas
  startDbSyncCron()
  startPeriodoPruebaAlertCron()
  startSolicitudesRrhhAlertCron()
  startEscalasAlertCron()
})

export default app
