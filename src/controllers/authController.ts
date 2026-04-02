import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import { query } from "../config/database";

interface User {
  id: number;
  email: string;
  password: string;
  nombre: string;
  rol_id: number;
  rol_nombre: string;
  two_factor_enabled: boolean;
  two_factor_secret: string | null;
}

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email y contraseña son requeridos",
      });
    }

    const result: any = await query(
      `SELECT u.*, r.nombre as rol_nombre 
       FROM usuarios u 
       LEFT JOIN roles r ON u.rol_id = r.id 
       WHERE u.email = ? AND u.activo = TRUE AND u.deleted_at IS NULL`,
      [email],
    );

    if (!Array.isArray(result) || result.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Credenciales inválidas",
      });
    }

    const user = result[0];

    const passwordValida = await bcrypt.compare(password, user.password);

    if (!passwordValida) {
      return res.status(401).json({
        success: false,
        message: "Credenciales inválidas",
      });
    }

    if (!user.two_factor_enabled) {
      return res.json({
        success: true,
        needsSetup2FA: true,
        userId: user.id,
        userData: {
          id: user.id,
          email: user.email,
          nombre: user.nombre,
          rol: user.rol_nombre,
          rol_id: user.rol_id,
        },
        message: "Debes configurar autenticación de doble factor",
      });
    }

    const tempToken = jwt.sign(
      { id: user.id, email: user.email, temp2fa: true },
      process.env.JWT_SECRET as string,
      { expiresIn: "5m" },
    );

    return res.json({
      success: true,
      requires2FA: true,
      tempToken,
      message: "Se requiere código de verificación",
    });
  } catch (error) {
    console.error("Error en login:", error);
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    });
  }
};

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

export const verify2FA = async (req: Request, res: Response) => {
  try {
    const { tempToken, code } = req.body;

    if (!tempToken || !code) {
      return res.status(400).json({
        success: false,
        message: "Token temporal y código son requeridos",
      });
    }

    const decoded: any = jwt.verify(
      tempToken,
      process.env.JWT_SECRET as string,
    );

    if (!decoded.temp2fa) {
      return res.status(401).json({
        success: false,
        message: "Token inválido",
      });
    }

    const result: any = await query(
      `SELECT u.*, r.nombre as rol_nombre 
       FROM usuarios u 
       LEFT JOIN roles r ON u.rol_id = r.id 
       WHERE u.id = ? AND u.activo = TRUE`,
      [decoded.id],
    );

    if (!Array.isArray(result) || result.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Usuario no encontrado",
      });
    }

    const user = result[0];

    if (!user.two_factor_enabled || !user.two_factor_secret) {
      return res.status(400).json({
        success: false,
        message: "2FA no está habilitado para este usuario",
      });
    }

    const verified = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: "base32",
      token: code,
      window: 2,
    });

    if (!verified) {
      return res.status(401).json({
        success: false,
        message: "Código de verificación inválido",
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        rol_id: user.rol_id,
        rol: user.rol_nombre,
      },
      process.env.JWT_SECRET as string,
      { expiresIn: "24h" },
    );

    res.json({
      success: true,
      message: "Verificación exitosa",
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          nombre: user.nombre,
          rol: user.rol_nombre,
          rol_id: user.rol_id,
        },
      },
    });
  } catch (error) {
    console.error("Error en verify2FA:", error);
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    });
  }
};

export const enable2FA = async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId es requerido",
      });
    }

    const secret = speakeasy.generateSecret({
      name: `Heroica (${userId})`,
      length: 32,
    });

    await query(`UPDATE usuarios SET two_factor_secret = ? WHERE id = ?`, [
      secret.base32,
      userId,
    ]);

    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url as string);

    res.json({
      success: true,
      data: {
        secret: secret.base32,
        qrCode: qrCodeUrl,
      },
    });
  } catch (error) {
    console.error("Error en enable2FA:", error);
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    });
  }
};

export const confirm2FA = async (req: Request, res: Response) => {
  try {
    const { userId, code } = req.body;

    if (!userId || !code) {
      return res.status(400).json({
        success: false,
        message: "userId y código son requeridos",
      });
    }

    const result: any = await query(
      `SELECT u.*, r.nombre as rol_nombre 
       FROM usuarios u 
       LEFT JOIN roles r ON u.rol_id = r.id 
       WHERE u.id = ?`,
      [userId],
    );

    if (!Array.isArray(result) || result.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Usuario no encontrado",
      });
    }

    const user = result[0];

    if (!user.two_factor_secret) {
      return res.status(400).json({
        success: false,
        message: "2FA no está configurado",
      });
    }

    const verified = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: "base32",
      token: code,
      window: 2,
    });

    if (!verified) {
      return res.status(401).json({
        success: false,
        message: "Código de verificación inválido",
      });
    }

    await query(`UPDATE usuarios SET two_factor_enabled = 1 WHERE id = ?`, [
      userId,
    ]);

    const tempToken = jwt.sign(
      { id: user.id, email: user.email, temp2fa: true },
      process.env.JWT_SECRET as string,
      { expiresIn: "5m" },
    );

    res.json({
      success: true,
      message: "2FA habilitado exitosamente",
      tempToken,
    });
  } catch (error) {
    console.error("Error en confirm2FA:", error);
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    });
  }
};

export const disable2FA = async (req: Request, res: Response) => {
  try {
    const { userId, password } = req.body;

    if (!userId || !password) {
      return res.status(400).json({
        success: false,
        message: "userId y contraseña son requeridos",
      });
    }

    const result: any = await query(
      `SELECT password FROM usuarios WHERE id = ?`,
      [userId],
    );

    if (!Array.isArray(result) || result.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Usuario no encontrado",
      });
    }

    const user = result[0];
    const passwordValida = await bcrypt.compare(password, user.password);

    if (!passwordValida) {
      return res.status(401).json({
        success: false,
        message: "Contraseña incorrecta",
      });
    }

    await query(
      `UPDATE usuarios SET two_factor_enabled = 0, two_factor_secret = NULL WHERE id = ?`,
      [userId],
    );

    res.json({
      success: true,
      message: "2FA deshabilitado exitosamente",
    });
  } catch (error) {
    console.error("Error en disable2FA:", error);
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    });
  }
};

export const reset2FA = async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId es requerido",
      });
    }

    await query(
      `UPDATE usuarios SET two_factor_enabled = 0, two_factor_secret = NULL WHERE id = ?`,
      [userId],
    );

    res.json({
      success: true,
      message:
        "2FA reseteado. El usuario deberá configurarlo en su próximo login",
    });
  } catch (error) {
    console.error("Error en reset2FA:", error);
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    });
  }
};
