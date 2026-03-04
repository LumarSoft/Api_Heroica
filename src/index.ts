import express, { Application, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes";
import sucursalesRoutes from "./routes/sucursalesRoutes";
import movimientosRoutes from "./routes/movimientosRoutes";
import pagosPendientesRoutes from "./routes/pagosPendientesRoutes";
import cajaBancoRoutes from "./routes/cajaBancoRoutes";
import configuracionRoutes from "./routes/configuracionRoutes";
import reportesRoutes from "./routes/reportesRoutes";
import healthRoutes from "./routes/healthRoutes";
import cuentasBancariasRoutes from "./routes/cuentasBancariasRoutes";

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
app.use("/api/configuracion", configuracionRoutes);
app.use("/api/reportes", reportesRoutes);
app.use("/api/cuentas-bancarias", cuentasBancariasRoutes);

// Ruta raíz — no expone información sensible en producción
app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    service: "heroica-api",
  });
});

// Rutas de health check
app.use("/", healthRoutes);

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
