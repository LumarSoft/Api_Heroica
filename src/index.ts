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
import personalRoutes from './routes/personalRoutes'
import puestosRoutes from './routes/puestosRoutes'
import { syncPermisos } from './config/permisos'
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
app.use(
  cors({
    // Permite credenciales (cookies) solo desde el origen del frontend.
    // En producción configurar CORS_ORIGIN con el dominio real.
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  }),
)
app.use(cookieParser()) // Parsear cookies (necesario para device_token)
app.use(express.json()) // Parsear JSON
app.use(express.urlencoded({ extended: true })) // Parsear URL-encoded

// Middleware de logging — campos sensibles redactados
app.use((req, res, next) => {
  const timestamp = new Date().toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour12: false,
  })
  const sanitizedBody = { ...req.body }
  if (sanitizedBody.password) sanitizedBody.password = '[REDACTED]'
  if (sanitizedBody.token) sanitizedBody.token = '[REDACTED]'
  console.log(`\n[${timestamp}] ${req.method} ${req.url}`)
  console.log(`Body:`, sanitizedBody)
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
app.use('/api/personal', personalRoutes)
app.use('/api/puestos', puestosRoutes)
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
