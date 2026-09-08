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

**Desde la Fase 1 no hay ninguna.** El API corre en Vercel serverless: no existe un proceso
persistente que ejecute `cron.schedule()`, así que los cuatro jobs no tenían ejecución garantizada.
Eso explica que los tres de alertas no estuvieran mandando mails.

Lo que se hizo:

| Job                                       | Antes                            | Ahora                                                     |
| ----------------------------------------- | -------------------------------- | --------------------------------------------------------- |
| Sync `heroica_oficial` → `heroica_prueba` | `0 6,18 * * *` + **al arranque** | **Servicio eliminado** (nadie dependía del refresco)      |
| Alerta de fin de período de prueba        | `0 8 * * *`                      | Desprogramado. Queda `procesarAlertasPeriodoPrueba()`     |
| Alertas de solicitudes RRHH               | `10 8 * * *`                     | Desprogramado. Queda `procesarAlertasSolicitudesRrhh()`   |
| Alertas de escalas salariales             | `20 8 * * *`                     | Desprogramado. Queda `procesarAlertasEscalasSalariales()` |

Las tres funciones `procesarAlertas*` siguen exportadas en `src/services/*AlertService.ts`: la
lógica de detección y armado de mails está intacta. Para reactivar las alertas hay que exponerlas
detrás de un endpoint protegido por `CRON_SECRET` y declararlo en `vercel.json` bajo `"crons"`.

`syncPermisos()` y `syncModulos()` se siguen ejecutando en el callback de `app.listen()`.

> ⚠️ **Sobre el sync eliminado:** `dbSyncService` hacía `DROP TABLE IF EXISTS heroica_prueba.<t>`
> seguido de `CREATE ... LIKE` + `INSERT ... SELECT` para **cada** tabla de `heroica_oficial`, en
> cada arranque, con los nombres de base hardcodeados. Era destructivo por diseño sobre
> `heroica_prueba`. Recuperable del historial git si alguna vez hiciera falta.

> `node-cron` quedó como dependencia sin uso en `package.json`. Se saca en una limpieza aparte.

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

**Agregadas en la Fase 1:**

| Variable               | Default     | Para qué                                                                                                                                                                    |
| ---------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUCURSAL_ACCESS_MODE` | `enforce`   | `enforce`: sin acceso a la sucursal ⇒ 403. `log`: solo escribe `[sucursal-access] …` y deja pasar. Sirve para desplegar unos días observando. **No es un modo permanente.** |
| `CRON_SECRET`          | — (sin uso) | Reservada para cuando se expongan las alertas como endpoints de Vercel Cron. Hoy no la lee nadie.                                                                           |

### Front (`Front_Heroica/.env`)

`NEXT_PUBLIC_API_URL` — **es la única que el código lee**.

> Nota: el `CLAUDE.md` de la raíz dice que el front usa `.env.local` y menciona un
> `ANTHROPIC_API_KEY`. Ninguna de las dos cosas es cierta hoy: el archivo es `.env` y no hay
> ninguna referencia a `ANTHROPIC_API_KEY` en el código. Se corrige en la Fase 6.

---

## 6. Ganchos de git

Ambos repos usan `simple-git-hooks` + `lint-staged` en `pre-commit`.

El hook del API **funciona**. Verificado ejecutándolo: `prettier --write` y `eslint --fix` corren y
terminan bien. Existe `Api_Heroica/eslint.config.mjs` (typescript-eslint + eslint-config-prettier) y
el binario `eslint` v10.2.1 resuelve desde `node_modules/.bin` como dependencia transitiva de
`typescript-eslint`.

`npx eslint src` sobre el API devuelve **389 warnings, 0 errores, exit 0**.

Lo único que falta es el script `"lint"` en `Api_Heroica/package.json` y declarar `eslint` como
devDependency directa en vez de depender de que quede hoisteado.

> Corrige al plan de saneamiento, que afirma en §3.5 que "`lint-staged` invoca `eslint --fix` sin
> que `eslint` esté instalado: el hook de pre-commit está roto". No es así.

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

## 7.2 Plan de deploy de la Fase 1

El orden importa. Salteárselo deja usuarios sin acceso a pantallas que hoy usan.

1. **Backup de `heroica_oficial`.**
2. **Correr la migración `RH-71_add_gestionar_sueldos_y_ver_analitico.sql`** contra
   `heroica_oficial`. Es idempotente (`INSERT IGNORE`). Verificar con el `SELECT` comentado al pie
   del archivo que `gestionar_sueldos` y `ver_analitico_rrhh` quedaron asignados a los mismos roles
   que ya tenían el acceso equivalente.
3. **Revisar los usuarios 34 y 28** (`directivo`, ver §7.1): si tienen que seguir operando sobre las
   sucursales que hoy ven sin tenerlas asignadas, asignárselas ahora. Alternativa: desplegar con
   `SUCURSAL_ACCESS_MODE=log` unos días, mirar el log y recién después pasar a `enforce`.
4. **Desplegar el API.** Recién acá el código empieza a exigir los permisos nuevos y el control por
   sucursal.
5. **Desplegar el front.**

> El arreglo de `DELETE /api/caja-banco/bulk` y `PUT /api/caja-banco/bulk/mover` (que estaban
> accesibles **sin autenticación**) no depende de la migración ni de los pasos 3 a 5. Si hace falta
> puede desplegarse solo y primero.

---

## 8. Pendientes que este runbook todavía no puede responder

- Plataforma de despliegue del front en producción.
- Si el `dbSyncService` llegó a ejecutarse alguna vez en Vercel (en serverless el `app.listen()` no
  corre como en un proceso persistente); no se verificó contra logs de producción.
- Fecha de la última aplicación manual de migraciones sobre `heroica_oficial`. El esquema de
  `DDL.sql` está al día con la última migración, así que se asume que se aplicaron todas.
