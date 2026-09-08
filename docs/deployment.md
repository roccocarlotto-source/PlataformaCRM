# Despliegue

Estado: **esqueleto** (Fase 4b del módulo SaaS, preparación — 2026-09-08).
Reúne lo que el repo ya sabe de sí mismo sobre cómo se despliega; la sección
final, "Cómo se desplegó la primera vez", está vacía a propósito y se completa
con los datos reales cuando el despliegue exista. Nada de este documento
inventa una URL, un nombre de proyecto ni un proveedor que todavía no esté
decidido.

Lo que sí está decidido y en el repo:

- el backend se despliega como **contenedor** (`Dockerfile`, ver README
  "Docker");
- las migraciones se aplican con **un único comando**, `npm run migrate:deploy`,
  desde fuera del contenedor;
- el frontend es una **SPA estática** (`frontend/`, Vite) con un rewrite
  catch-all a `index.html` (`frontend/vercel.json`);
- la base, la autenticación y el storage viven en un **proyecto de Supabase**
  (`docs/supabase-setup.md`).

---

## 1. Topología

```
navegador ──► frontend (estático, Vercel)
   │               │  VITE_API_URL
   │               ▼
   │          backend (contenedor Node 22, Express)  ──► Postgres  (Supabase, pooler 6543)
   │               │                                 ──► Auth      (Supabase GoTrue, Admin API)
   │               │                                 ──► Storage   (Supabase, bucket vehicle-photos)
   │               ▼
   │          workers in-process: ingesta, outbox, canales de Google Calendar, cotizaciones
   │
   └──► Supabase Auth directo (login, reset de contraseña, link de invitación)
```

Cuarta pieza, fuera de este documento: el **Cloudflare Worker** que hace de
gate delante de `/qr/resolve/:qrId` (repo `plataforma-qr`,
`docs/qr-integration.md` Fase 4). Comparte con el backend el secreto
`QR_RESOLVE_PROXY_SECRET` y es lo que apunta `VITE_QR_PUBLIC_BASE_URL`.

Supuesto que atraviesa todo el backend y que la plataforma tiene que respetar:
**una sola instancia del proceso**. Los rate limiters usan `MemoryStore` (estado
por proceso) y los cuatro workers corren dentro del mismo proceso HTTP. Escalar
a más de una réplica exige, antes, un store compartido para los limiters y una
revisión de cada worker — está dicho en `src/middlewares/rateLimit.ts` y en
`docs/project-overview.md`, no es una decisión de este documento.

---

## 2. Backend

### 2.1 Artefacto: la imagen de `Dockerfile`

Multi-stage (README, sección "Docker"): la etapa `build` compila con
`devDependencies`; la etapa `runtime` instala solo `dependencies`, recibe el
cliente de Prisma ya generado por copia y corre `node dist/server.js` como
usuario `node`.

| Contrato de la imagen | Valor |
|---|---|
| Node | **22** (`node:22-bookworm-slim`), la misma versión que los jobs de `ci.yml` |
| Puerto | `PORT`, default `4000` (`EXPOSE 4000` es documentación, no publicación) |
| Health check | `GET /health` — sin prefijo `/api`. Responde **503** cuando no alcanza la base; el `HEALTHCHECK` de la imagen solo exige que responda, no un status concreto |
| Apagado | Forma exec: node es PID 1 y recibe `SIGTERM`; `src/shutdown.ts` frena workers, cierra el servidor y desconecta Prisma dentro de `SHUTDOWN_TIMEOUT_MS` (default 8 s) |
| Secretos | Ninguno horneado: `.env` está en `.dockerignore`; todo se inyecta en runtime |

Dos cosas que conviene saber antes de apretar "deploy":

- **El CI nunca construye la imagen.** `ci.yml` corre `npm run build` (tsc) y
  descarta el artefacto; `docker build` no aparece en ningún job. La primera vez
  que la imagen se construye de verdad es en la plataforma de despliegue (o a
  mano con `docker build -t plataforma-crm-backend .`).
- **`SHUTDOWN_TIMEOUT_MS` tiene que ser menor que el grace period de la
  plataforma** (el tiempo entre `SIGTERM` y `SIGKILL`). El default de 8 s está
  pensado para los 10 s de Docker; si la plataforma da más, se puede subir; si
  da menos, hay que bajarlo o el apagado ordenado nunca actúa.

### 2.2 Migraciones: `npm run migrate:deploy`, y nada más

Es el **único** comando de migración en producción (`scripts/apply-manual-sql.ts`).
Encadena, en orden y abortando al primer fallo:

1. `prisma migrate deploy` — aplica las migraciones pendientes de
   `prisma/migrations/`. No interactúa ni genera nada; es el comando de Prisma
   para CI/producción.
2. reaplica `prisma/sql/manual_constraints.sql` — triggers e índices únicos
   parciales que el DSL de Prisma no expresa;
3. reaplica `prisma/sql/rls_policies.sql` — políticas RLS.

Los dos `.sql` son idempotentes: correrlo cuando no cambió nada es un no-op
seguro. **Nunca** `prisma migrate deploy` a secas: dejaría la base sin los
objetos manuales (README, "Migraciones").

Restricciones que fijan *desde dónde* se corre:

- **Necesita `DIRECT_URL`** (conexión directa, puerto 5432 — no el pooler de
  `DATABASE_URL`). El script falla explícitamente si falta.
- **Necesita `tsx` y el CLI de Prisma**, que son `devDependencies` y **no están
  en la imagen de runtime**, a propósito: aplicar migraciones es un paso de
  despliegue con su propio momento, no algo que cada réplica que arranca deba
  intentar. Por lo tanto se corre desde una máquina de desarrollo con el repo
  clonado y el `.env` de producción cargado, o desde un job de CI/CD que hoy
  **no existe**.
- Después de la **primera** aplicación: `npm run prisma:seed` (catálogo `Role`
  ADMIN/USER, idempotente — sin él ningún alta de organización funciona) y
  `npm run verify:schema` (confirma que triggers, índices parciales, CHECKs y
  RLS quedaron; sale con código 1 diciendo qué faltó).

Orden respecto de la imagen: **migrar primero, desplegar la imagen nueva
después**, que es el orden correcto para una migración aditiva (columna o
tabla nueva: el código viejo la ignora). Una migración que borra o renombra
algo que el código viejo todavía lee —ya hubo una,
`20260904120000_remove_qr_claim_and_single_use`— pide el orden inverso o una
ventana de indisponibilidad, y merece una nota propia acá cuando ocurra en
producción.

### 2.3 Variables de entorno del backend

Lista completa de `src/config/env.ts`, agrupada por lo que pasa si falta. El
esquema de entorno declara casi todo como opcional a propósito —para que el
proceso arranque y `/health` responda aunque falte una integración—, así que
"opcional para bootear" y "necesaria para funcionar" son cosas distintas y esta
tabla distingue las dos.

**A. Sin esto el backend no sirve para nada** (arranca o no, pero ninguna ruta
de negocio funciona):

| Variable | Qué pasa si falta | Notas |
|---|---|---|
| `CORS_ORIGIN` | **El proceso no arranca** — la única que Zod exige | Lista separada por comas con los orígenes del frontend. **El primero** es el que la invitación de platform admin usa como `redirectTo` (`<primero>/reset-password`, Fase 4a): el dominio real del frontend va primero |
| `DATABASE_URL` | `/health` reporta la base caída; toda ruta de negocio falla | Conexión **pooled** (PgBouncer, 6543) con `?pgbouncer=true` |
| `SUPABASE_URL` | Ningún JWT se puede verificar (el JWKS sale de acá) | Sin barra final |
| `SUPABASE_SERVICE_ROLE_KEY` | Invitaciones, alta de organización por platform admin, purgas y el bucket de fotos fallan con 500 | Exclusiva del backend. Nunca con prefijo `VITE_` |
| `NODE_ENV` | — | La imagen ya lo fija en `production` |

**B. Solo migraciones** (no va al contenedor):

| Variable | Notas |
|---|---|
| `DIRECT_URL` | Conexión directa (5432). La exige `npm run migrate:deploy`; el runtime no la lee |

**C. Necesarias para una función concreta** — sin ellas el resto del sistema
anda y esa función falla con un error que dice qué falta (en el log, no en la
respuesta):

| Variable | Función que habilita | Si falta |
|---|---|---|
| `SUPABASE_ANON_KEY` | `POST /api/onboarding/otp` y `POST /api/onboarding` (registro público, **sin uso desde la Fase 4a**: el alta la hace el platform admin) | Esos dos endpoints responden 500. Nada más la usa |
| `SECRET_ENCRYPTION_KEY` | Cifrado del refresh token de Google Calendar y firma del `state` OAuth | Toda operación de Google Calendar → 500. Se genera con `npm run gen:encryption-key`. **Cambiarla deja ilegible todo lo ya cifrado** |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Conexión OAuth con Google Calendar | El flujo de conexión falla. `GOOGLE_REDIRECT_URI` apunta al **backend** público (`/api/integrations/google-calendar/callback`) y tiene que coincidir carácter por carácter con la consola de Google |
| `GOOGLE_WEBHOOK_URL` | Sincronización inversa (notificaciones push de Google) | El worker de canales se apaga solo y lo avisa; el resto de la agenda sigue. Exige dominio verificado en Google y HTTPS real |
| `MERCADOPAGO_WEBHOOK_SECRET`, `MERCADOPAGO_ACCESS_TOKEN` | Webhook de MercadoPago del módulo QR | Un webhook real responde 500 |
| `QR_RESOLVE_PROXY_SECRET` (+ `_PREVIOUS` durante una rotación) | Gate de `/qr/resolve/:qrId` con el Cloudflare Worker | **Falla cerrado: el endpoint responde 404 a todo el mundo.** Si el módulo QR está en uso, en la práctica es del grupo A. Mismo valor que `INTERNAL_PROXY_SECRET` en el Worker |

**D. Con default explícito** — no hace falta definirlas; se listan para que se
sepa que existen y qué tocan:

| Variable | Default | Qué ajusta |
|---|---|---|
| `PORT` | `4000` | Puerto HTTP |
| `LOG_LEVEL` | `info` en producción | Nivel de pino |
| `INGEST_RATE_LIMIT_WINDOW_MS`, `INGEST_RATE_LIMIT_MAX` | 60 000 / 60 | Cupo del webhook de ingesta, por API key |
| `INGEST_WORKER_ENABLED`, `INGEST_WORKER_POLL_MS`, `INGEST_WORKER_BATCH_SIZE` | `true` / 5 000 / 50 | Worker de ingesta |
| `INGEST_MAX_ATTEMPTS`, `INGEST_BACKOFF_BASE_MS`, `INGEST_BACKOFF_MAX_MS` | 5 / 30 000 / 900 000 | Reintentos de la promoción |
| `OUTBOX_WORKER_ENABLED`, `OUTBOX_WORKER_POLL_MS`, `OUTBOX_WORKER_BATCH_SIZE` | `true` / 5 000 / 20 | Worker de eventos salientes |
| `OUTBOX_MAX_ATTEMPTS`, `OUTBOX_BACKOFF_BASE_MS`, `OUTBOX_BACKOFF_MAX_MS`, `OUTBOX_HANDLER_TIMEOUT_MS` | 5 / 30 000 / 900 000 / 10 000 | Reintentos y tope por entrega |
| `GOOGLE_CHANNEL_WORKER_ENABLED`, `GOOGLE_CHANNEL_WORKER_POLL_MS`, `GOOGLE_CHANNEL_RENEW_MARGIN_MS`, `GOOGLE_CHANNEL_TTL_SECONDS` | `true` / 3 600 000 / 86 400 000 / 604 800 | Renovación de canales de Google |
| `EXCHANGE_RATE_WORKER_ENABLED`, `EXCHANGE_RATE_WORKER_POLL_MS` | `true` / 86 400 000 | Worker de cotizaciones (open.er-api.com, sin clave) |
| `SHUTDOWN_TIMEOUT_MS` | 8 000 | Tope del apagado ordenado — ver 2.1 |

Los booleanos son el string `"true"` o `"false"` literal: cualquier otro valor
es rechazado al arrancar (no se usa `z.coerce.boolean()` a propósito).

### 2.4 Lo que la plataforma tiene que saber del backend

- **`trust proxy` no está configurado**, deliberadamente (`rateLimit.ts`).
  Detrás del proxy de cualquier PaaS, `req.ip` es la IP del proxy para todos
  los clientes. Ningún limiter depende de la IP (keyean por userId, apiKeyId o
  email), así que no es un agujero — pero los logs mienten sobre el origen
  hasta que se configure `trust proxy` **a la topología real** (cuántos saltos),
  nunca `true` a ciegas. Queda como ajuste pendiente de la primera vez.
- **Health check** en `/health`. Un 503 significa "la base no responde", no
  "el proceso está muerto": si la plataforma reinicia el contenedor ante un
  503, va a reiniciarlo en bucle durante una caída de la base sin arreglar
  nada.
- **Una sola instancia** (sección 1).
- El **bucket de Storage** `vehicle-photos` lo crea el propio backend, de
  forma idempotente, la primera vez que lo necesita — no hay paso manual, pero
  sí necesita `SUPABASE_SERVICE_ROLE_KEY`.

---

## 3. Frontend

### 3.1 Build y hosting

- Paquete `frontend/`, `npm run build` = `tsc -b && vite build`, salida en
  `frontend/dist/`. En Vercel el **Root Directory** del proyecto tiene que ser
  `frontend`.
- **`frontend/vercel.json`** manda cualquier ruta a `index.html`:

  ```json
  {
    "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
  }
  ```

  Sin esto, refrescar o abrir directo cualquier ruta que no sea `/`
  (`/companies`, `/vehicles/<id>/edit`, y sobre todo los links que llegan por
  mail: `/reset-password#access_token=…`, `/invite/accept`) responde `404` de
  Vercel, porque el ruteo es de React Router (`createBrowserRouter`) y Vercel
  busca un archivo real en cada path. Los archivos que sí existen (`/assets/*`)
  se siguen sirviendo tal cual: Vercel resuelve el filesystem antes que los
  rewrites.

### 3.2 Variables del build (`VITE_*`)

Las cuatro son **obligatorias en tiempo de build** y Vite las **hornea en el
bundle**: cambiar una exige reconstruir, y si falta cualquiera la app arranca
en blanco con "Falta la variable de entorno …" (`frontend/src/config/env.ts`
falla temprano a propósito). Tienen que estar cargadas para **cada** entorno
en el que Vercel construya (Production y Preview).

| Variable | Valor | Notas |
|---|---|---|
| `VITE_SUPABASE_URL` | Project URL del proyecto de Supabase | URL absoluta http(s) |
| `VITE_SUPABASE_ANON_KEY` | anon public key | Pública por diseño. **Jamás la service_role**: Vite expone al navegador todo lo que lleve `VITE_` |
| `VITE_API_URL` | URL pública del backend | Sin barra final (se normaliza igual). La relación inversa es la que hay que cuidar: el **origen del frontend** tiene que figurar en `CORS_ORIGIN` del backend, o cada request falla por CORS |
| `VITE_QR_PUBLIC_BASE_URL` | Dominio público del Cloudflare Worker de QR | Base de todos los links de QR; nunca `VITE_API_URL` |

Las variables **sin** prefijo `VITE_` (las del backend) no le sirven de nada al
build del frontend: Vite no las expone, y cargarlas en el proyecto del frontend
solo confunde.

---

## 4. Proyecto de Supabase

`docs/supabase-setup.md` describe la configuración completa (pensada para
desarrollo). Lo que cambia o se vuelve obligatorio en producción:

| Panel | Valor en producción | Por qué |
|---|---|---|
| Authentication → URL Configuration → Site URL | dominio real del frontend | Destino por defecto de los mails de Auth |
| … → Redirect URLs | `https://<frontend>/**` | Sin esto GoTrue ignora el `redirectTo` del reset de contraseña y de la invitación de platform admin (`/reset-password`) y manda al Site URL |
| Providers → Email → **Confirm email** | **ON** | Requisito de seguridad (ALTO-2/ALTO-3), no de conveniencia |
| Email Templates → Magic Link con `{{ .Token }}` | solo si se usa el registro público `/api/onboarding` | Sin uso desde la Fase 4a; con la plantilla por defecto ese flujo no completa |
| **SMTP propio** | **obligatorio** | El servidor por defecto de Supabase limita a ~2 mails/hora: alcanza para probar, no para invitar clientes |
| JWT | firma asimétrica (ES256) | El backend verifica contra el JWKS público (`src/lib/jwt.ts`); no hay `SUPABASE_JWT_SECRET` |
| Conexiones | `DATABASE_URL` = pooler (6543, `?pgbouncer=true`); `DIRECT_URL` = directa (5432) | Ver 2.2 y 2.3 |

Dos filas de tabla que se cargan a mano, por SQL, y no tienen UI a propósito:

- `platform_admins` — el user id del operador de la plataforma
  (`docs/qr-integration.md`, "Dar de alta el primer platform admin"; el SQL
  completo está también en el cuerpo del PR #179). Sin esto no existe nadie que
  pueda dar de alta organizaciones.
- `roles` — no es a mano: `npm run prisma:seed` (2.2).

---

## 5. Orden de un despliegue

**Primera vez** (esqueleto; los pasos manuales de paneles se anotan en la
sección 6 cuando se hagan):

1. Proyecto de Supabase configurado según la sección 4; anotar `ref`, URL,
   anon key, service role key, y las dos connection strings.
2. `.env` de producción en la máquina desde la que se migra (**no** se
   commitea): `DIRECT_URL` + `DATABASE_URL` como mínimo.
3. `npm run migrate:deploy` → `npm run prisma:seed` → `npm run verify:schema`.
4. Backend: crear el servicio a partir del `Dockerfile` de la raíz, cargar las
   variables del grupo A (2.3) más las del grupo C que correspondan, health
   check en `/health`, una instancia.
5. Con la URL pública del backend: cargar las cuatro `VITE_*` (3.2) en el
   proyecto del frontend, Root Directory `frontend`, y desplegar.
6. Con la URL pública del frontend: ponerla **primera** en `CORS_ORIGIN` del
   backend (redeploy del backend), y en Site URL / Redirect URLs de Supabase.
7. `insert into platform_admins …` con el user id del operador.
8. Verificar: `GET <backend>/health` → 200; login en el frontend; `GET /api/me`
   con `isPlatformAdmin: true`; abrir directo `<frontend>/companies` (rewrite);
   dar de alta una organización de prueba y recibir el mail de invitación.

**Cada vez siguiente**:

1. Si el PR trae migraciones: `npm run migrate:deploy` (y `verify:schema` si
   tocó DDL manual) **antes** de la imagen nueva.
2. Backend: build + deploy de la imagen desde `master`.
3. Frontend: build + deploy desde `master`. Si cambió alguna `VITE_*`, cargarla
   antes del build.
4. Si el PR agregó una variable del grupo C, cargarla antes o junto con el
   deploy (el caso de `QR_RESOLVE_PROXY_SECRET` es el que falla cerrado).

Nada de esto está automatizado hoy: el CI valida (`ci.yml`), no despliega.

---

## 6. Cómo se desplegó la primera vez

_(Pendiente — completar con los datos reales cuando exista el despliegue.)_

| Dato | Valor |
|---|---|
| Fecha | |
| Supabase: nombre del proyecto / `ref` / región | |
| Supabase: SMTP configurado (proveedor) | |
| Backend: proveedor / nombre del servicio / URL pública | |
| Backend: plan / región / grace period de apagado | |
| Backend: variables cargadas (nombres, no valores) | |
| Backend: `trust proxy` configurado a | |
| Frontend: proveedor / nombre del proyecto / dominio | |
| Frontend: Root Directory / comando de build | |
| Frontend: `VITE_*` cargadas en Production y Preview | |
| `CORS_ORIGIN` final (orden) | |
| Site URL / Redirect URLs finales en Supabase | |
| Platform admin dado de alta (email; nunca el id acá) | |
| Verificación del paso 5.8: qué se probó y resultado | |
| Desvíos respecto de este documento | |
