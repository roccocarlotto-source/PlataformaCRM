# Plataforma CRM — Backend

CRM SaaS multi-tenant. Backend en Node.js + Express + TypeScript, Prisma ORM sobre
PostgreSQL (Supabase), autenticación delegada a Supabase Auth.

Para el diseño completo del producto y del modelo de datos, ver
[`docs/project-overview.md`](./docs/project-overview.md). Para el diseño del sistema
de autenticación y onboarding, ver
[`docs/authentication-architecture.md`](./docs/authentication-architecture.md).

> Estado actual: infraestructura base + infraestructura de autenticación
> (`authenticate`/`authorize`, reutilizables) + conexión real a Supabase (migración
> inicial, `manual_constraints.sql` y RLS aplicados, catálogo `Role` sembrado) +
> `POST /api/onboarding` (único registro público del sistema). Sin invitaciones ni
> endpoints de negocio del CRM todavía — ver la sección "Estado de implementación" al
> inicio de `docs/authentication-architecture.md`.

## Quickstart

```bash
npm install
cp .env.example .env   # completar con las credenciales reales de Supabase
npm run prisma:generate
npm run dev             # levanta el servidor con recarga automática
```

Con el servidor corriendo, `GET /health` responde `200` con `database: "ok"` si el
`.env` tiene credenciales válidas de un proyecto de Supabase real, o `503` si no.

### Scripts

| Script | Qué hace |
|---|---|
| `npm run dev` | Levanta el servidor en desarrollo (`tsx watch`), recarga en cada cambio. |
| `npm run build` | Compila TypeScript a `dist/` (`tsc`). |
| `npm start` | Corre el build compilado (`node dist/server.js`) — uso en producción. |
| `npm run prisma:generate` | Regenera el cliente de Prisma a partir de `schema.prisma`. |
| `npm run prisma:validate` | Valida que `schema.prisma` sea correcto. |
| `npm run prisma:studio` | Abre Prisma Studio para explorar la base visualmente. |
| `npm run prisma:seed` | Siembra el catálogo `Role` (`ADMIN`, `USER`) — idempotente, se puede correr de nuevo. |

`prisma migrate dev` no reaplica automáticamente `prisma/sql/manual_constraints.sql`
ni `prisma/sql/rls_policies.sql` — Prisma no soporta triggers, `CHECK` constraints,
índices únicos parciales ni RLS en su DSL. Después de generar una migración nueva que
toque las tablas afectadas, reaplicar ambos a mano:

```bash
npx prisma db execute --file prisma/sql/manual_constraints.sql --url "$DIRECT_URL"
npx prisma db execute --file prisma/sql/rls_policies.sql --url "$DIRECT_URL"
```

## Estructura de carpetas

```
src/
  config/
  lib/
  types/
  utils/
  middlewares/
  controllers/
  services/
  repositories/
  routes/
  app.ts
  server.ts
```

- **`src/config/`** — configuración de arranque de la aplicación. Hoy contiene
  `env.ts`, que valida `process.env` con `zod` al levantar el proceso y exporta un
  objeto tipado (`env`) — si falta una variable requerida, el servidor no arranca y
  el error indica exactamente cuál.

- **`src/lib/`** — clientes e instancias compartidas por toda la aplicación:
  `prisma.ts` (instancia única de `PrismaClient`, exporta también el tipo `Db =
  PrismaClient | Prisma.TransactionClient` que usan los repositorios para poder
  participar de una transacción), `logger.ts` (instancia de `pino`), `jwt.ts`
  (verifica firma/expiración de un JWT de Supabase Auth), y `supabaseAdmin.ts`
  (cliente de Supabase con `service_role` — únicamente para operaciones
  administrativas como crear/borrar usuarios; nunca la `anon` key). Todo lo que en
  el resto del código se importa como "la conexión a X" vive acá.

- **`src/types/`** — tipos compartidos que no pertenecen a ninguna capa en
  particular. Hoy contiene `auth.ts`: `RoleName`, `JwtPayload`, `AuthContext`,
  `AuthenticatedRequest`, y la ampliación global de `Express.Request` (agrega
  `req.auth?: AuthContext` a todos los requests).

- **`src/utils/`** — utilidades genéricas sin estado propio: `AppError.ts` (clase de
  error operacional con `statusCode`), `asyncHandler.ts` (wrapper para que los
  errores de handlers `async` lleguen al middleware de errores), y `slug.ts`
  (`slugify` — normaliza un nombre a un slug, sin lógica de sufijo por colisión: una
  colisión se resuelve como error, no generando una variante).

- **`src/middlewares/`** — middlewares de Express transversales a toda la app:
  `notFound.ts` (404 consistente para rutas no definidas), `errorHandler.ts`
  (formatea cualquier error, esperado o no, a una respuesta JSON consistente),
  `authenticate.ts` (verifica el JWT y adjunta `req.auth`) y `authorize.ts`
  (factory `authorize(...roles)` para restringir una ruta por rol — se usa después
  de `authenticate`). Todavía no están montados sobre ninguna ruta propia (el único
  endpoint real, onboarding, es público por diseño) — son infraestructura
  reutilizable a la espera del primer endpoint protegido.

- **`src/controllers/`** — capa HTTP: reciben `Request`/`Response`, delegan en un
  `service` y traducen su resultado a una respuesta. No contienen lógica de negocio
  ni acceden a Prisma directamente. El schema de validación de Zod de cada endpoint
  vive acá (co-ubicado con quien lo usa, igual que `config/env.ts` usa Zod inline).

- **`src/services/`** — lógica de aplicación: orquestan reglas de negocio y llaman a
  `repositories` (o, para infraestructura como el health check, hablan directo con
  `lib/prisma`). No conocen `Request`/`Response`. Ejemplos reales: `auth.service.ts`
  (`resolveAuthContext`, usado por `middlewares/authenticate.ts`) y
  `onboarding.service.ts` (`onboardOrganization` — coordina Supabase Auth + una
  transacción de Prisma, con compensación si la transacción falla).

- **`src/repositories/`** — capa de acceso a datos: cada entidad tiene acá sus
  funciones de consulta/escritura sobre Prisma. Todas aceptan un parámetro `db`
  opcional (tipo `Db` de `lib/prisma.ts`) para poder correr dentro de una
  transacción. Archivos reales: `user.repository.ts` (`findUserForAuth`,
  `createUser`), `organization.repository.ts` (`findOrganizationBySlug`,
  `createOrganization`), `role.repository.ts` (`findRoleByName`).

- **`src/routes/`** — define las rutas HTTP y las conecta con su `controller`.
  `index.ts` agrega todos los routers de la aplicación en uno solo.

- **`src/app.ts`** — arma la instancia de Express: registra middlewares (seguridad,
  CORS, compresión, parseo de body, logging de requests), monta las rutas, y al
  final los middlewares de 404 y de errores. No escucha ningún puerto.

- **`src/server.ts`** — único punto de entrada del proceso: levanta `app` en el
  puerto configurado y maneja el apagado ordenado (`SIGTERM`/`SIGINT`), cerrando el
  servidor HTTP y desconectando Prisma antes de salir.

## Variables de entorno

Ver `.env.example` — cada variable está documentada ahí mismo (de dónde sacarla, para
qué se usa). Hoy las variables de Supabase (`DATABASE_URL`, `SUPABASE_*`) pueden estar
vacías: el servidor arranca igual, pero `/health` va a reportar la base como no
disponible hasta que se complete `.env` con un proyecto de Supabase real.
