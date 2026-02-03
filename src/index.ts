import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes';
import sucursalesRoutes from './routes/sucursalesRoutes';
import movimientosRoutes from './routes/movimientosRoutes';

// Cargar variables de entorno
dotenv.config();

// Crear aplicación Express
const app: Application = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors()); // Permitir CORS
app.use(express.json()); // Parsear JSON
app.use(express.urlencoded({ extended: true })); // Parsear URL-encoded

// Rutas
app.use('/api/auth', authRoutes);
app.use('/api/sucursales', sucursalesRoutes);
app.use('/api/movimientos', movimientosRoutes);

// Ruta de prueba
app.get('/', (req: Request, res: Response) => {
  res.json({
    message: '🍺 API de Heroica - Sistema de Contabilidad',
    version: '1.0.0',
    endpoints: {
      auth: {
        login: '/api/auth/login',
        verify: '/api/auth/verify'
      },
      sucursales: {
        getAll: '/api/sucursales',
        getById: '/api/sucursales/:id',
        create: '/api/sucursales'
      },
      movimientos: {
        getBySucursal: '/api/movimientos/:sucursalId',
        update: '/api/movimientos/:id',
        updateEstado: '/api/movimientos/:id/estado',
        delete: '/api/movimientos/:id'
      }
    }
  });
});

// Ruta 404
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: 'Ruta no encontrada'
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║                                       ║
  ║   🍺  API HEROICA - CONTABILIDAD     ║
  ║                                       ║
  ║   🚀 Servidor corriendo en:          ║
  ║   📍 http://localhost:${PORT}           ║
  ║                                       ║
  ╚═══════════════════════════════════════╝
  `);
});

export default app;
