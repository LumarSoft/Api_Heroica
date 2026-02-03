# 🍺 Heroica API - Sistema de Contabilidad

API REST para el sistema de contabilidad del bar Heroica.

## 🚀 Instalación

```bash
# Instalar dependencias
pnpm install
# o
npm install
```

## ⚙️ Configuración

1. Copia el archivo `.env.example` a `.env`:
```bash
cp .env.example .env
```

2. Edita el archivo `.env` con tus credenciales de base de datos:
```env
PORT=3001
DATABASE_URL=postgresql://usuario:contraseña@localhost:5432/heroica
JWT_SECRET=tu_secret_super_seguro
```

## 🗄️ Base de Datos

Ejecuta el script SQL en `database/schema.sql` para crear las tablas necesarias:

```bash
psql -U usuario -d heroica -f database/schema.sql
```

## 🏃‍♂️ Ejecutar

### Modo desarrollo (con hot reload)
```bash
pnpm dev
# o
npm run dev
```

### Modo producción
```bash
# Compilar TypeScript
pnpm build

# Ejecutar
pnpm start
```

## 📡 Endpoints

### Autenticación

#### POST `/api/auth/login`
Login de usuario

**Request:**
```json
{
  "email": "admin@heroica.com",
  "password": "admin123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Login exitoso",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 1,
      "email": "admin@heroica.com",
      "nombre": "Administrador",
      "rol": "admin"
    }
  }
}
```

#### POST `/api/auth/verify`
Verificar token JWT

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "email": "admin@heroica.com",
    "rol": "admin"
  }
}
```

## 🧪 Usuario de Prueba

Por defecto, la API incluye un usuario de prueba (eliminar en producción):

- **Email:** admin@heroica.com
- **Password:** admin123

## 🛠️ Stack Tecnológico

- **Node.js** + **TypeScript**
- **Express** - Framework web
- **PostgreSQL** - Base de datos
- **JWT** - Autenticación
- **bcrypt** - Hash de contraseñas
- **dotenv** - Variables de entorno
- **cors** - CORS middleware

## 📁 Estructura del Proyecto

```
api/
├── src/
│   ├── config/
│   │   └── database.ts      # Configuración de PostgreSQL
│   ├── controllers/
│   │   └── authController.ts # Lógica de autenticación
│   ├── routes/
│   │   └── authRoutes.ts    # Rutas de autenticación
│   └── index.ts             # Punto de entrada
├── database/
│   └── schema.sql           # Schema de la base de datos
├── .env                     # Variables de entorno (no commitear)
├── .env.example             # Ejemplo de variables de entorno
├── package.json
└── tsconfig.json
```

## 🔐 Seguridad

- Las contraseñas se hashean con bcrypt
- Autenticación basada en JWT
- Variables sensibles en `.env`
- CORS habilitado para el frontend

## 📝 Notas

- El puerto por defecto es `3001`
- Los tokens JWT expiran en 24 horas
- Asegúrate de cambiar `JWT_SECRET` en producción
