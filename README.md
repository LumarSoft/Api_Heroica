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

### Despliegue en producción (VPS de Lumarsoft)

Producción corre en el VPS de Lumarsoft con PM2 (`heroica_api`), detrás de nginx en
`https://api.adminheroica.com`. Un merge a `main` no despliega solo: hay que correr el despliegue
desde una copia de `main` al día.

```bash
git switch main && git pull
pnpm deploy:vps
```

El script compila, sube el resultado, instala dependencias en el servidor, reinicia la API y
comprueba que responda. Se niega a desplegar si hay cambios sin commitear o si tu copia no coincide
con `origin/main`. La versión anterior queda en `dist.anterior` para volver atrás (ver
`scripts/deploy-vps.sh`).

Variables propias del servidor (definidas en `ecosystem.config.cjs`, salvo los secretos, que van en
el `.env` del servidor):

| Variable         | Para qué sirve                                                                 |
| ---------------- | ------------------------------------------------------------------------------ |
| `STORAGE_DRIVER` | `local` guarda los archivos en `uploads/`; `blob` en Vercel Blob               |
| `TRUST_PROXY`    | Saltos de proxy a confiar (1 detrás de nginx), para ver la IP real del cliente |
| `HOST`           | `127.0.0.1` para aceptar solo conexiones locales                               |
| `CRONS_DISABLED` | `true` apaga las tareas programadas (sincronización y alertas por email)       |
| `CORS_ORIGIN`    | Uno o varios orígenes permitidos, separados por coma                           |
| `TZ`             | `UTC`, para que las fechas se comporten igual que antes en Vercel              |

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
