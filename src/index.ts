import express, { Application, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes";
import sucursalesRoutes from "./routes/sucursalesRoutes";
import movimientosRoutes from "./routes/movimientosRoutes";
import pagosPendientesRoutes from "./routes/pagosPendientesRoutes";
import cajaBancoRoutes from "./routes/cajaBancoRoutes";

// Cargar variables de entorno
dotenv.config();

// Crear aplicación Express
const app: Application = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors()); // Permitir CORS
app.use(express.json()); // Parsear JSON
app.use(express.urlencoded({ extended: true })); // Parsear URL-encoded

// Middleware de logging para ver todas las peticiones
app.use((req, res, next) => {
  const timestamp = new Date().toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour12: false,
  });
  console.log(`\n[${timestamp}] ${req.method} ${req.url}`);
  console.log(`Body:`, req.body);
  next();
});

// Rutas
app.use("/api/auth", authRoutes);
app.use("/api/sucursales", sucursalesRoutes);
app.use("/api/movimientos", movimientosRoutes);
app.use("/api/pagos-pendientes", pagosPendientesRoutes);
app.use("/api/caja-banco", cajaBancoRoutes);

// Ruta de prueba
app.get("/", (req: Request, res: Response) => {
  res.json({
    message: "🍺 API de Heroica - Sistema de Contabilidad",
    version: "1.0.0",
    endpoints: {
      auth: {
        login: "/api/auth/login",
        verify: "/api/auth/verify",
      },
      sucursales: {
        getAll: "/api/sucursales",
        getById: "/api/sucursales/:id",
        create: "/api/sucursales",
      },
      movimientos: {
        getBySucursal: "/api/movimientos/:sucursalId",
        getTotales: "/api/movimientos/:sucursalId/totales",
        create: "/api/movimientos/efectivo",
        update: "/api/movimientos/:id",
        moverAReal: "/api/movimientos/efectivo/:id/mover-a-real",
        updateEstado: "/api/movimientos/:id/estado",
        delete: "/api/movimientos/:id",
      },
      pagosPendientes: {
        getBySucursal: "/api/pagos-pendientes/:sucursalId",
        create: "/api/pagos-pendientes",
        aprobar: "/api/pagos-pendientes/:id/aprobar",
        rechazar: "/api/pagos-pendientes/:id/rechazar",
        delete: "/api/pagos-pendientes/:id",
      },
      cajaBanco: {
        getBySucursal: "/api/caja-banco/:sucursalId",
        getTotales: "/api/caja-banco/:sucursalId/totales",
        create: "/api/caja-banco",
        update: "/api/caja-banco/:id",
        moverAReal: "/api/caja-banco/:id/mover-a-real",
        updateEstado: "/api/caja-banco/:id/estado",
        delete: "/api/caja-banco/:id",
      },
    },
  });
});

// Ruta 404
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: "Ruta no encontrada",
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
