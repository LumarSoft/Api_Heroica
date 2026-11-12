import express, { Application, NextFunction, Request, Response } from 'express'
import path from 'path'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import dotenv from 'dotenv'
import rateLimit from 'express-rate-limit'
import authRoutes from './routes/authRoutes'
import sucursalesRoutes from './routes/sucursalesRoutes'
import movimientosRoutes from './routes/movimientosRoutes'
import pagosPendientesRoutes from './routes/pagosPendientesRoutes'
import cajaBancoRoutes from './routes/cajaBancoRoutes'
import importacionBancariaRoutes from './routes/importacionBancariaRoutes'
import prestamosRoutes from './routes/prestamosRoutes'
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
import { syncModulos } from './config/modulos'
import { startDbSyncCron } from './services/dbSyncService'
import { startPeriodoPruebaAlertCron } from './services/rrhhPeriodoPruebaAlertService'
import { startSolicitudesRrhhAlertCron } from './services/rrhhSolicitudesAlertService'
import { startEscalasAlertCron } from './services/escalasAlertService'
import rrhhSueldosRoutes from './routes/rrhhSueldosRoutes'
import rrhhAnaliticoRoutes from './routes/rrhhAnaliticoRoutes'
import { createOps } from '@lumarsoft/ops'
// Cargar variables de entorno
dotenv.config()

// Verificar variables de entorno críticas al arranque
if (!process.env.JWT_SECRET) {
  console.error('FATAL: La variable de entorno JWT_SECRET no está definida. El servidor no puede iniciar.')
  process.exit(1)
}

// Lumarsoft Console: latidos, errores y acciones rápidas
const ops = createOps().start()

ops
  .action('sync-permisos', {
    label: 'Sincronizar permisos',
    description: 'Vuelve a cargar en la base los permisos definidos en el código.',
    run: async () => {
      await syncPermisos()
      return 'Permisos sincronizados'
    },
  })
  .action('sync-modulos', {
    label: 'Sincronizar módulos',
    description: 'Vuelve a cargar en la base los módulos definidos en el código.',
    run: async () => {
      await syncModulos()
      return 'Módulos sincronizados'
    },
  })

// Crear aplicación Express
const app: Application = express()
const PORT = process.env.PORT || 3001

// Detrás de un proxy inverso (nginx) hay que indicar cuántos saltos confiar para que req.ip
// y los rate limiters vean la IP real del cliente y no la del proxy. En el VPS: TRUST_PROXY=1.
const saltosProxy = Number(process.env.TRUST_PROXY)
if (process.env.TRUST_PROXY && Number.isInteger(saltosProxy) && saltosProxy > 0) {
  app.set('trust proxy', saltosProxy)
}
const isProduction = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'

// Rate limiting: máximo 10 intentos fallidos de login por IP cada 15 minutos.
// Los ingresos correctos no cuentan: varias personas de una misma oficina comparten IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Demasiados intentos de inicio de sesión. Intente nuevamente en 15 minutos.',
  },
})

// Rate limiting para verificación 2FA: máximo 10 intentos fallidos por IP cada 10 minutos
const verify2FALimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Demasiados intentos de verificación. Intente nuevamente en 10 minutos.',
  },
})

const origenesPermitidos = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map(origen => origen.trim())
  .filter(Boolean)

// Middlewares
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
app.use(compression())
app.use(
  cors({
    // Permite credenciales (cookies) solo desde el origen del frontend.
    // En producción configurar CORS_ORIGIN con el dominio real.
    // Admite varios orígenes separados por coma (p. ej. el front real y uno de pruebas).
    origin: origenesPermitidos.length === 1 ? origenesPermitidos[0] : origenesPermitidos,
    credentials: true,
  }),
)
app.use(cookieParser()) // Parsear cookies (necesario para device_token)
app.use(express.json()) // Parsear JSON
app.use(express.urlencoded({ extended: true })) // Parsear URL-encoded
app.use(ops.actionsHandler()) // Acciones rápidas de Lumarsoft Console
if (!isProduction) {
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')))
}

// Middleware de logging — campos sensibles redactados
const CAMPOS_REDACTADOS = ['password', 'newPassword', 'currentPassword', 'token', 'two_factor_secret']

app.use((req, res, next) => {
  const timestamp = new Date().toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour12: false,
  })

  console.log(`\n[${timestamp}] ${req.method} ${req.url}`)

  if (!isProduction) {
    const sanitizedBody = { ...req.body }
    for (const campo of CAMPOS_REDACTADOS) {
      if (sanitizedBody[campo]) sanitizedBody[campo] = '[REDACTED]'
    }
    console.log(`Body:`, sanitizedBody)
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
app.use('/api/importacion-bancaria', importacionBancariaRoutes)
app.use('/api/prestamos', prestamosRoutes)
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
app.use('/api/rrhh/analitico', rrhhAnaliticoRoutes)

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

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Unhandled error]', err)
  if (res.headersSent) return
  res.status(500).json({ success: false, message: 'Error interno del servidor' })
})

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[Unhandled rejection]', reason)
})

// Iniciar servidor
const alIniciar = async () => {
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

  // Sincronizar módulos del sistema con la base de datos
  await syncModulos()

  // Iniciar tareas programadas.
  // CRONS_DISABLED=true las apaga: sirve mientras conviven dos instancias de la API contra la misma base,
  // para que la sincronización y las alertas por email no corran dos veces.
  if (process.env.CRONS_DISABLED === 'true') {
    console.log('⏸️  Tareas programadas desactivadas (CRONS_DISABLED=true).')
    return
  }
  startDbSyncCron()
  startPeriodoPruebaAlertCron()
  startSolicitudesRrhhAlertCron()
  startEscalasAlertCron()
}

// HOST=127.0.0.1 hace que la API solo acepte conexiones locales (las que le pasa nginx).
if (process.env.HOST) {
  app.listen(Number(PORT), process.env.HOST, alIniciar)
} else {
  app.listen(PORT, alIniciar)
}

export default app
