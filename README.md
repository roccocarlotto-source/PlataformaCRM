# Plataforma CRM

CRM SaaS multi-tenant para pymes de Uruguay y Latinoamérica, con agentes de IA que
atienden a los clientes por WhatsApp, Messenger, Instagram y un widget web. Backend en
Node.js + Express + TypeScript, Prisma ORM sobre PostgreSQL (Supabase), autenticación
delegada a Supabase Auth. Frontend en `frontend/` (Vite + React).

## Estado

En producción (backend en Render, frontend en Vercel, base y autenticación en Supabase).

- **Rubros:** cada organización es `AUTOMOTORA` o `CLINICA`; el rubro cambia el vocabulario
  y los módulos propios (stock de vehículos, cotizaciones, pagos y entregas en la
  automotora; agenda de profesionales, recordatorios y seguimiento después del turno en la
  clínica). Ver [`docs/rubros.md`](./docs/rubros.md).
- **Ediciones:** `COMPLETA` o `ESENCIAL`, independientes del rubro: definen cuántos módulos
  hay y cuánto participa la IA. Ver [`docs/ediciones.md`](./docs/ediciones.md).
- **Módulo `servicios`:** taller de postventa (órdenes, aprobaciones, aviso del próximo
  service), activable por organización. Ver [`docs/servicios.md`](./docs/servicios.md).
- **Núcleo común:** empresas, contactos, pipelines y oportunidades, actividades y tareas,
  conversaciones con el agente, automatizaciones, ingesta de leads (webhook, Excel/CSV,
  importación), cupones y QR de reseñas, guía de uso y asistente "¿Cómo se hace?".
- **Multi-tenant real:** cada fila pertenece a una organización; el aislamiento se verifica
  con tests de integración en el CI (Supabase local).

## Documentación

| Doc | De qué trata |
|---|---|
| [`docs/project-overview.md`](./docs/project-overview.md) | Diseño original del producto y del modelo de datos (núcleo CRM). Leer primero el aviso de alcance. |
| [`docs/authentication-architecture.md`](./docs/authentication-architecture.md) | Autenticación, onboarding e invitaciones. |
| [`docs/ingestion-architecture.md`](./docs/ingestion-architecture.md) | Fuentes, API keys, webhook de landing, importación. |
| [`docs/ai-agent-architecture.md`](./docs/ai-agent-architecture.md) | Agentes de IA: canales, turnos, tools, derivación. |
| [`docs/automations-architecture.md`](./docs/automations-architecture.md) | Motor de automatizaciones. |
| [`docs/booking-architecture.md`](./docs/booking-architecture.md) | Agenda, turnos y Google Calendar. |
| [`docs/rubros.md`](./docs/rubros.md) · [`docs/ediciones.md`](./docs/ediciones.md) · [`docs/servicios.md`](./docs/servicios.md) | Rubros, ediciones y módulo de taller. |
| [`docs/data-classification.md`](./docs/data-classification.md) | Datos personales, terceros y retención. |
| [`docs/deployment.md`](./docs/deployment.md) · [`docs/supabase-setup.md`](./docs/supabase-setup.md) | Despliegue y configuración de Supabase. |
| [`docs/guia-de-uso/`](./docs/guia-de-uso/) | Guía de uso que se muestra dentro de la app. |
| [`docs/frontend-cambios-pendientes.md`](./docs/frontend-cambios-pendientes.md) · [`docs/matriz-de-datos-crm.md`](./docs/matriz-de-datos-crm.md) | Tareas pendientes. |

## Quickstart (desarrollo local)

Se desarrolla contra el **stack local de Supabase** (Docker + CLI de Supabase), nunca
contra un proyecto real. Requisitos: Node 22, Docker Desktop y la CLI de Supabase.

```bash
npm ci && npx prisma generate      # backend (el cliente de Prisma no está versionado)
npm ci --prefix frontend           # frontend

npm run gen:signing-key            # clave ES256 del GoTrue local (efímera, en .gitignore)
npm run supabase:start             # levanta Postgres + Auth locales
npm run supabase:status            # muestra API_URL, DB_URL, ANON_KEY y SERVICE_ROLE_KEY
```

Con esos valores, armá `.env` desde `.env.example` (para `npm run dev`) y `.env.test` (para
`npm run test:integration`), las dos apuntando al stack local:

```bash
CORS_ORIGIN=http://localhost:5173
DATABASE_URL=<DB_URL>              # postgresql://postgres:postgres@127.0.0.1:54322/postgres
DIRECT_URL=<DB_URL>
SUPABASE_URL=<API_URL>
SUPABASE_ANON_KEY=<ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
```

```bash
npm run migrate:deploy             # migraciones + SQL manual (constraints y RLS)
npm run prisma:seed                # catálogo de roles
npm run dev                        # API en http://localhost:4000 (GET /health)
npm run dev --prefix frontend      # app en http://localhost:5173
```

`frontend/.env` necesita `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y `VITE_API_URL`
apuntando a lo mismo. Al terminar: `npm run supabase:stop`.

**Workers en desarrollo.** Con `NODE_ENV=development` y una `DATABASE_URL` que no es local,
`npm run dev` levanta Express pero **no arranca los workers** ni las automatizaciones, y lo
avisa con un `warn`: una laptop no tiene que procesar las colas reales. Para forzarlos,
`DEV_ALLOW_REMOTE_DB=true`. Contra el Supabase local arrancan como siempre.

**Tests de integración.** `npm run test:integration` carga `.env.test` y aborta si la base
no es local (`src/utils/baseLocal.ts`).

### Scripts

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor en desarrollo (`tsx watch`). |
| `npm run typecheck` | `tsc` sobre src, scripts y tests. |
| `npm run build` / `npm start` | Compila a `dist/` / corre el build compilado. |
| `npm test` | Unitarios `src/**/*.test.ts`, sin base. Requiere `CORS_ORIGIN` en el entorno. |
| `npm run test:integration` | Suite `*.integration-test.ts` contra el Supabase local, un archivo por vez. |
| `npm run lint` / `npm run format:check` | ESLint del backend / Prettier de todo el repo. |
| `npm run prisma:validate` | Valida `schema.prisma` sin conectarse a nada. |
| `npm run prisma:seed` | Siembra el catálogo `Role`. Idempotente. |
| `npm run migrate:deploy` | `prisma migrate deploy` + reaplica `manual_constraints.sql` y `rls_policies.sql`. Es el comando de deploy. |
| `npm run verify:schema` | Verifica que la base tenga todos los objetos del esquema. |
| `npm run supabase:start` / `:stop` / `:status` | Stack local de Supabase. |
| `npm run purge:*` | Limpiezas de retención (ver `docs/data-classification.md`). |

Una migración nueva se genera con `npx prisma migrate dev --name <nombre>` contra el
Supabase local, y después se corre `npm run migrate:deploy` para reaplicar el SQL manual
(triggers, `CHECK`, índices parciales y RLS, que Prisma no soporta en su DSL).

## Estructura de carpetas

```
src/
  config/        env.ts (validación de variables con zod), rubros, ediciones, vocabulario
  lib/           clientes compartidos: prisma, logger, jwt, Supabase
  middlewares/   authenticate, authorize, errores, rate limits
  routes/        routers HTTP, todo bajo /api salvo /health
  controllers/   capa HTTP + schemas de zod de cada endpoint
  services/      lógica de negocio; reciben organizationId explícito
  repositories/  acceso a datos con Prisma (aceptan un `db` para transacciones)
  workers/       colas en segundo plano: agente, ingesta, outbox, seguimientos
  automotora/    código propio del rubro automotora (demo del taller)
  clinicas/      código propio del rubro clínica (agenda, recordatorios, salud)
  servicios/     módulo de taller de postventa
  compartido/    piezas usadas por varios módulos (guía de uso)
  schemas/ types/ utils/
  app.ts         arma Express (no escucha puertos)
  server.ts      punto de entrada y apagado ordenado
frontend/src/features/   una carpeta por pantalla o módulo
prisma/                  schema.prisma, migraciones y SQL manual
scripts/                 migrate:deploy, verify:schema, purgas, semillas
```

Convenciones: los controllers no tocan Prisma; los services no conocen `Request`/`Response`;
toda consulta filtra por `organizationId`.

## Variables de entorno

Ver `.env.example`: cada variable está documentada ahí (de dónde sacarla, para qué se usa).
`src/config/env.ts` valida el entorno al arrancar; solo `CORS_ORIGIN` es obligatoria, y
cada integración (Supabase, Meta, Google, OpenRouter) valida sus propias variables al usarse.

## Docker

`Dockerfile` multi-stage: la etapa de build compila con `devDependencies`
(TypeScript y el CLI de Prisma incluidos), la de runtime instala solo
`dependencies` y recibe el cliente de Prisma ya generado por copia — generarlo
ahí sería imposible, el CLI es una `devDependency`.

Node **22**, la misma versión que declaran los cuatro jobs de
`.github/workflows/ci.yml`. Imagen base `bookworm-slim` y no `alpine`: Prisma
resuelve su motor por `binaryTarget`, y Alpine (musl) exigiría
`linux-musl-openssl-3.0.x`, un target que `schema.prisma` no declara.

```bash
docker build -t plataforma-crm-backend .
docker run --rm -p 4000:4000 --env-file .env plataforma-crm-backend
```

**La imagen no contiene ningún secreto ni ningún valor de `.env`.** `.env` está
en `.dockerignore`, así que ni siquiera llega al contexto de build. Las
credenciales se inyectan en runtime (`--env-file`, o el mecanismo de secretos de
la plataforma donde se despliegue).

### Variables que espera el contenedor en runtime

Son exactamente las de `.env.example` — no hay ninguna variable propia del
contenedor:

| Variable | ¿Requerida? | Notas |
|---|---|---|
| `CORS_ORIGIN` | **Sí** | La única que `src/config/env.ts` valida como obligatoria: sin ella el proceso no arranca. |
| `DATABASE_URL` | En la práctica sí | Conexión pooled (Supavisor en modo sesión, puerto 5432, sin `pgbouncer=true`; ver `docs/deployment.md` §2.3). Opcional en el schema de entorno, pero sin ella `/health` reporta la base como no disponible y toda ruta de negocio falla. |
| `DIRECT_URL` | No, para este contenedor | Solo la usan las migraciones, que **no** corren desde acá. |
| `SUPABASE_URL` | En la práctica sí | De ella sale el JWKS con el que se verifica cada JWT. |
| `SUPABASE_SERVICE_ROLE_KEY` | En la práctica sí | La usa la Admin API (onboarding, invitaciones). |
| `SUPABASE_ANON_KEY` | No | La consume el frontend, no este backend. |
| `PORT` | No | Default `4000`, que es el que declara `EXPOSE`. |
| `NODE_ENV` | No | La imagen ya lo fija en `production`. |
| `LOG_LEVEL` | No | Default `info` en producción. |

`src/config/env.ts` acepta además cinco `INGEST_*` (ventana y tope del rate
limit de ingesta, y los tres del worker) que **no** están en `.env.example`
porque todas tienen default explícito y ninguna hace falta para arrancar.

### Migraciones

No corren desde el contenedor, y es deliberado: `npm run migrate:deploy`
necesita `tsx` y el CLI de Prisma, los dos ausentes a propósito de la imagen de
runtime. Aplicar migraciones es un paso de despliegue con su propio momento, no
algo que cada réplica que arranca deba intentar a la vez.
