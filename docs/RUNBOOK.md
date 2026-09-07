# RUNBOOK — Heroica

Estado operativo del sistema al **2026-09-07**, escrito durante la Fase 0 del saneamiento.

Este documento describe **cómo funciona hoy**, no cómo debería funcionar. Los cambios previstos se
marcan explícitamente como pendientes y ninguno se aplicó todavía.

---

## 1. Repositorios

| Repo             | Remoto                               | Visibilidad     |
| ---------------- | ------------------------------------ | --------------- |
| `Api_Heroica/`   | `github.com/LumarSoft/Api_Heroica`   | **Público**     |
| `Front_Heroica/` | `github.com/LumarSoft/Front_Heroica` | (sin confirmar) |

La carpeta raíz `/Heroica` **no es un repositorio git** y no debe serlo: contiene los dos repos
como subdirectorios y un `git init` en la raíz los anidaría dentro de un tercero. El `.gitignore`
de la raíz existe solo como red de seguridad por si alguien lo hace igual.

Ramas de trabajo del saneamiento: `saneamiento/fase-N` en cada repo. El merge a `main` lo hace una
persona; el agente no hace `push`.

### 1.1 Riesgo abierto: documentación de empleados en el historial público

Hasta la Fase 0, el repo del API versionaba **8 archivos reales** bajo `uploads/` (PDF y fotos de
legajos, más adjuntos de solicitudes). La Fase 0 los des-versionó (`git rm --cached`, siguen en
disco), pero **el historial de `origin/main` en GitHub todavía los contiene** y el repositorio es
público.

Limpiarlo requiere `git filter-repo` + `force push` + que todo el equipo re-clone. **Decisión
tomada por el responsable del proyecto: no se limpia el historial** (pregunta 5 de §5 del plan).
El riesgo queda aceptado y documentado acá.

---

## 2. Despliegue

### API

- **Producción: Vercel serverless** — `https://api-heroica.vercel.app/`
- `vercel.json` declara un único build `@vercel/node` sobre `src/index.ts` y rutea `/(.*)` ahí.
- Por eso `typescript` y `tsx` viven en `dependencies`, no en `devDependencies`: el build de Vercel
  los necesita. **No moverlos.**
- Scripts: `pnpm dev` (`tsx watch`), `pnpm build` (`tsc` a `dist/`), `pnpm start` (`node dist/index.js`).
- El código detecta el entorno con `process.env.VERCEL`: cuando está seteado, Multer usa
  `memoryStorage()` y los archivos van a **Vercel Blob**. En local, van al disco en `uploads/`.

### Front

- Next.js 16, `pnpm build` / `pnpm start`. No tiene `vercel.json` propio.
- Plataforma de despliegue de producción: **sin confirmar** (pendiente).

### Entorno TFI

Entorno de la universidad, fuera del alcance operativo de este sistema. Se ignora en este runbook.

---

## 3. Bases de datos

Configuración por variables sueltas (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE`),
no por una `DATABASE_URL` única. Pool `mysql2/promise`, máximo 10 conexiones
(`src/config/database.ts`).

| Base              | Rol                                              |
| ----------------- | ------------------------------------------------ |
| `heroica_oficial` | **Producción**                                   |
| `heroica_prueba`  | Copia de pruebas, refrescada por el cron de sync |

El esquema real de producción está exportado en `/Heroica/DDL.sql` (45 tablas, 2026-09-07, sin
datos). Es la fuente de verdad del esquema. Todavía **no existe** un `baseline.sql` versionado ni un
runner de migraciones: las 68 migraciones de `database/migrations/` se aplican a mano y no hay tabla
de control. Eso es la Fase 2.

`Backups/dump-heroica-202604272150.sql` (raíz, fuera de git) es un dump viejo (2026-04-27) de una
base local `heroica` con solo 24 tablas: **no sirve como baseline**, le falta todo RRHH.

---

## 4. Tareas programadas

Los cuatro `cron.schedule` se registran en el callback de `app.listen()` (`src/index.ts:170-192`),
junto con `syncPermisos()` y `syncModulos()`.

| Job                                       | Archivo                                         | Horario                          | Estado real                                          |
| ----------------------------------------- | ----------------------------------------------- | -------------------------------- | ---------------------------------------------------- |
| Sync `heroica_oficial` → `heroica_prueba` | `services/dbSyncService.ts:43`                  | `0 6,18 * * *` + **al arranque** | Corre. Nadie depende de él. **A eliminar (Fase 1).** |
| Alerta de fin de período de prueba        | `services/rrhhPeriodoPruebaAlertService.ts:153` | `0 8 * * *`                      | **No está mandando mails hoy. A eliminar (Fase 1).** |
| Alertas de solicitudes RRHH               | `services/rrhhSolicitudesAlertService.ts:297`   | `10 8 * * *`                     | **No está mandando mails hoy. A eliminar (Fase 1).** |
| Alertas de escalas salariales             | `services/escalasAlertService.ts:109`           | `20 8 * * *`                     | **No está mandando mails hoy. A eliminar (Fase 1).** |

> ⚠️ **Sobre el sync:** `dbSyncService` hace `DROP TABLE IF EXISTS heroica_prueba.<t>` seguido de
> `CREATE ... LIKE` + `INSERT ... SELECT` para **cada** tabla de `heroica_oficial`, y se ejecuta
> también en cada arranque del proceso. Los nombres de base están hardcodeados. Es destructivo por
> diseño sobre `heroica_prueba`.

> ⚠️ **Sobre Vercel:** en serverless no hay proceso persistente, así que estos `cron.schedule`
> **no tienen ejecución garantizada** en producción. Eso es coherente con que los tres jobs de
> alertas no estén mandando mails. Se resuelve en la Fase 1.2.

---

## 5. Variables de entorno

Ninguna se versiona. Las plantillas sin valores son `.env.example` en cada repo.

### API (`Api_Heroica/.env`)

`PORT`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE`, `JWT_SECRET`,
`RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_APROBACION`, `BLOB_READ_WRITE_TOKEN`, `CORS_ORIGIN`,
`NODE_ENV`, `VERCEL` (la setea Vercel), y las de ajuste de alertas RRHH:
`RRHH_ALERTA_VENCIMIENTOS_DIAS_ANTES`, `RRHH_ALERTA_PERIODO_PRUEBA_DIAS_ANTES`,
`RRHH_ALERTA_LEGAJOS_DIAS_ANTES`, `RRHH_ALERTA_ESCALAS_MESES_SIN_ACTUALIZAR`,
`RRHH_PERIODO_PRUEBA_DIAS`, `RRHH_RESPONSABLE_EMAIL`.

### Front (`Front_Heroica/.env`)

`NEXT_PUBLIC_API_URL` — **es la única que el código lee**.

> Nota: el `CLAUDE.md` de la raíz dice que el front usa `.env.local` y menciona un
> `ANTHROPIC_API_KEY`. Ninguna de las dos cosas es cierta hoy: el archivo es `.env` y no hay
> ninguna referencia a `ANTHROPIC_API_KEY` en el código. Se corrige en la Fase 6.

---

## 6. Ganchos de git

Ambos repos usan `simple-git-hooks` + `lint-staged` en `pre-commit`.

En el API el hook está **roto**: `lint-staged` invoca `eslint --fix` y `eslint` no está instalado en
`Api_Heroica`. Se arregla en la Fase 3.5.

---

## 7. Preguntas abiertas y decisiones tomadas

Corresponden a §5 del plan de saneamiento (`/Heroica/PLAN_OPUS_SANEAMIENTO.md`).

| #   | Pregunta                                                          | Respuesta                                                                             |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | ¿Dónde corre el API en producción?                                | **Vercel serverless**, `https://api-heroica.vercel.app/`. TFI queda fuera de alcance. |
| 2   | ¿Qué base es producción?                                          | **`heroica_oficial`**.                                                                |
| 3   | ¿Alguien depende del refresco de `heroica_prueba`?                | **No. Eliminar el sync.**                                                             |
| 4   | ¿Los tres cron de alertas mandan mails hoy?                       | **No. Eliminarlos también.**                                                          |
| 5   | ¿El repo del API es privado? ¿Limpiar el historial de `uploads/`? | **Es público. No se limpia el historial.** Ver §1.1.                                  |
| 6   | ¿Qué roles ven el analítico global de RRHH?                       | Todos los que tengan permisos sobre los módulos de RRHH.                              |
| 7   | ¿Hay no-superadmin que operan sobre todas las sucursales?         | Ver §7.1.                                                                             |

### 7.1 Usuarios activos y sucursales asignadas (consulta corrida en producción)

De 11 sucursales activas, ningún usuario tiene las 11 asignadas:

| usuario_id | rol           | sucursales asignadas |
| ---------- | ------------- | -------------------- |
| 1          | superadmin    | 0                    |
| 31         | superadmin    | 0                    |
| 13         | superadmin    | 1                    |
| 15         | superadmin    | 1                    |
| 36         | superadmin    | 1                    |
| 14         | superadmin    | 2                    |
| **34**     | **directivo** | **5**                |
| **28**     | **directivo** | **6**                |
| 29         | superadmin    | 6                    |
| 26         | superadmin    | 7                    |
| 30         | superadmin    | 7                    |
| 38         | superadmin    | 7                    |

Los superadmin no se ven afectados: bypassean todo control de acceso. **Los dos `directivo`
(ids 34 y 28) sí**: cuando la Fase 1.3 haga cumplir el control por sucursal, van a perder el acceso
a las 6 y 5 sucursales que hoy ven sin tenerlas asignadas.

> **Acción requerida antes del deploy de la Fase 1:** decidir si a los usuarios 34 y 28 se les
> asignan las sucursales que les faltan, o si el recorte es intencional. Existe
> `SUCURSAL_ACCESS_MODE=log` para desplegar en modo observación primero.

---

## 8. Pendientes que este runbook todavía no puede responder

- Plataforma de despliegue del front en producción.
- Si el `dbSyncService` llegó a ejecutarse alguna vez en Vercel (en serverless el `app.listen()` no
  corre como en un proceso persistente); no se verificó contra logs de producción.
- Fecha de la última aplicación manual de migraciones sobre `heroica_oficial`. El esquema de
  `DDL.sql` está al día con la última migración, así que se asume que se aplicaron todas.
