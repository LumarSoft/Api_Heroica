import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query } from "../config/database";

// Interface para el usuario
interface User {
  id: number;
  email: string;
  password: string;
  nombre: string;
  rol_id: number;
  rol_nombre: string;
  must_change_password: boolean;
}

// POST /api/auth/login
export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // Validación básica
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email y contraseña son requeridos",
      });
    }

    // Buscar usuario en la base de datos con su rol
    const result: any = await query(
      `SELECT u.*, r.nombre as rol_nombre 
       FROM usuarios u 
       LEFT JOIN roles r ON u.rol_id = r.id 
       WHERE u.email = ? AND u.activo = TRUE`,
      [email]
    );

    // Verificar si el usuario existe
    if (!Array.isArray(result) || result.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Credenciales inválidas",
      });
    }

    const user = result[0];

    // Verificar contraseña
    const passwordValida = await bcrypt.compare(password, user.password);

    if (!passwordValida) {
      return res.status(401).json({
        success: false,
        message: "Credenciales inválidas",
      });
    }

    // Generar JWT
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        rol_id: user.rol_id,
        rol: user.rol_nombre,
      },
      process.env.JWT_SECRET as string,
      { expiresIn: "24h" }
    );

    // Obtener permisos del rol
    const permisosResult: any = await query(
      `SELECT p.clave 
       FROM permisos p
       INNER JOIN roles_permisos rp ON p.id = rp.permiso_id
       WHERE rp.rol_id = ?`,
      [user.rol_id]
    );
    const permisos: string[] = permisosResult.map((p: any) => p.clave);

    // Respuesta exitosa
    res.json({
      success: true,
      message: "Login exitoso",
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          nombre: user.nombre,
          rol: user.rol_nombre,
          rol_id: user.rol_id,
          must_change_password: Boolean(user.must_change_password),
          permisos,
        },
      },
    });
  } catch (error) {
    console.error("Error en login:", error);
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    });
  }
};

// POST /api/auth/verify
export const verifyToken = async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Token no proporcionado",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET as string);

    res.json({
      success: true,
      data: decoded,
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      message: "Token inválido o expirado",
    });
  }
};

// PUT /api/auth/change-password
// El usuario autenticado cambia su propia contraseña
export const changePassword = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Token no proporcionado",
      });
    }

    const token = authHeader.split(" ")[1];
    let decoded: any;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET as string);
    } catch {
      return res.status(401).json({
        success: false,
        message: "Token inválido o expirado",
      });
    }

    const userId = decoded.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "La contraseña actual y la nueva son requeridas",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "La nueva contraseña debe tener al menos 6 caracteres",
      });
    }

    // Obtener contraseña actual del usuario
    const result: any = await query(
      "SELECT password FROM usuarios WHERE id = ? AND activo = TRUE",
      [userId]
    );

    if (!result || result.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Usuario no encontrado",
      });
    }

    const passwordValida = await bcrypt.compare(currentPassword, result[0].password);
    if (!passwordValida) {
      return res.status(400).json({
        success: false,
        message: "La contraseña actual es incorrecta",
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: "La nueva contraseña debe ser diferente a la actual",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await query(
      "UPDATE usuarios SET password = ?, must_change_password = 0 WHERE id = ?",
      [hashedPassword, userId]
    );

    res.json({
      success: true,
      message: "Contraseña actualizada exitosamente",
    });
  } catch (error) {
    console.error("Error al cambiar contraseña:", error);
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    });
  }
};
