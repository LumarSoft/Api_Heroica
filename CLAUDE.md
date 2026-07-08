# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (hot reload via tsx watch)
pnpm dev

# Build
pnpm build

# Start production build
pnpm start

# Format code
pnpm format

# Check formatting
pnpm format:check

# Generate password hash (utility)
pnpm hash
```

There are no automated tests. Linting runs automatically on commit via `simple-git-hooks` + `lint-staged` (Prettier + ESLint fix on staged `.ts`/`.js` files).

## Architecture

Express + TypeScript REST API backed by **MySQL** (mysql2 pool). The database URL is **not** a single `DATABASE_URL` string — it uses separate env vars: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE`.

**Two databases are maintained**: `heroica_oficial` (production data) and `heroica_prueba` (test copy). A cron job in `src/services/dbSyncService.ts` syncs oficial → prueba at 06:00 and 18:00 daily (also runs at startup).

### Entry point

`src/index.ts` — mounts all route modules, applies rate limiters on auth endpoints, and calls four startup tasks:

- `syncPermisos()` — upserts permission definitions into the `permisos` table
- `syncModulos()` — upserts module definitions into the `modulos` table
- `startDbSyncCron()` — DB sync cron
- Background alert crons (periodo de prueba, solicitudes RRHH, escalas salariales)

### Authorization model (two-layer)

1. **Módulos** (`requireModule('clave')`) — high-level area access assigned _per user_ in `usuarios_modulos`. Two modules exist: `tesoreria` and `recursos_humanos`.
2. **Permisos** (`requirePermission('clave')`) — fine-grained action permissions assigned _per role_ in `roles_permisos`.

`requireAuth` validates the JWT. `requireAnyPermission([...])` is an OR variant. `superadmin` role bypasses all checks. Middleware is in `src/middlewares/authMiddleware.ts`.

**To add a new module or permission**: add it to `MODULOS_DEL_SISTEMA` in `src/config/modulos.ts` or `PERMISOS_DEL_SISTEMA` in `src/config/permisos.ts`. The API syncs them to the DB on next startup — no manual migration needed.

### Route/controller pattern

- `src/routes/` — one file per feature area, wires middleware + controller functions
- `src/controllers/` — business logic, direct SQL via `query()` from `src/config/database.ts`
- `src/services/` — cross-controller logic and background cron jobs
- `src/config/` — database pool, permission definitions, module definitions, constants

Routes always apply `requireAuth` then `requireModule` (on the router level), then `requirePermission` per individual route.

### Key domain areas

- **Tesorería**: movimientos (efectivo + banco), pagos pendientes, caja-banco, cuentas bancarias, sucursales, reportes, exportación Excel (exceljs)
- **RRHH**: personal/legajos, puestos, áreas, escalas salariales, incentivos, calendario, solicitudes (with workflow + historial), sueldos, analítico, motivos de baja
- **Transversal**: tareas, notificaciones, configuración (usuarios/roles/permisos), autenticación con 2FA (speakeasy) + trusted devices, file uploads to Vercel Blob

### Database access pattern

All queries use the `query(sql, params)` helper from `src/config/database.ts`. For transactions, use `getConnection()` from the same module and manage the connection lifecycle manually.

### File uploads

Multer handles multipart uploads; files are stored in **Vercel Blob** (`@vercel/blob`). The `personalArchivosService.ts` and `rrhhSolicitudesArchivosController.ts` handle the upload/delete lifecycle.

### Email

Transactional email is sent via **Resend** (`resend` package), wrapped in `src/services/emailService.ts` and `src/services/notificacionesEmailService.ts`.

### Auth flow

JWT (24h expiry) returned on login. 2FA via TOTP (speakeasy); trusted devices stored as `device_token` cookie (30-day TTL, set by the API). The `must_change_password` flag on users forces a password change on next login.
