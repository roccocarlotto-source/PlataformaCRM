# Plataforma CRM — Backend

CRM SaaS multi-tenant. Backend en Node.js + Express + TypeScript, Prisma ORM sobre
PostgreSQL (Supabase), autenticación delegada a Supabase Auth.

Para el diseño completo del producto y del modelo de datos, ver
[`docs/project-overview.md`](./docs/project-overview.md). Para el diseño del sistema
de autenticación y onboarding, ver
[`docs/authentication-architecture.md`](./docs/authentication-architecture.md).

> Estado actual: infraestructura base + infraestructura de autenticación
> (`authenticate`/`authorize`, reutilizables) + conexión real a Supabase (migración
> inicial, `manual_constraints.sql` y RLS aplicados, catálogo `Role` sembrado). Sin
> endpoints de negocio ni de login/registro/invitación implementados todavía — ver la
> sección "Estado de implementación" al inicio de
> `docs/authentication-architecture.md`.

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
  `prisma.ts` (instancia única de `PrismaClient`), `logger.ts` (instancia de
  `pino`), y `jwt.ts` (verifica firma/expiración de un JWT de Supabase Auth — no
  toca Postgres, no emite tokens propios). Todo lo que en el resto del código se
  importa como "la conexión a X" vive acá.

- **`src/types/`** — tipos compartidos que no pertenecen a ninguna capa en
  particular. Hoy contiene `auth.ts`: `RoleName`, `JwtPayload`, `AuthContext`,
  `AuthenticatedRequest`, y la ampliación global de `Express.Request` (agrega
  `req.auth?: AuthContext` a todos los requests).

- **`src/utils/`** — utilidades genéricas sin estado propio: `AppError.ts` (clase de
  error operacional con `statusCode`) y `asyncHandler.ts` (wrapper para que los
  errores de handlers `async` lleguen al middleware de errores).

- **`src/middlewares/`** — middlewares de Express transversales a toda la app:
  `notFound.ts` (404 consistente para rutas no definidas), `errorHandler.ts`
  (formatea cualquier error, esperado o no, a una respuesta JSON consistente),
  `authenticate.ts` (verifica el JWT y adjunta `req.auth`) y `authorize.ts`
  (factory `authorize(...roles)` para restringir una ruta por rol — se usa después
  de `authenticate`). Ninguno de los dos últimos está montado sobre una ruta
  todavía; son infraestructura reutilizable a la espera del primer endpoint
  protegido.

- **`src/controllers/`** — capa HTTP: reciben `Request`/`Response`, delegan en un
  `service` y traducen su resultado a una respuesta. No contienen lógica de negocio
  ni acceden a Prisma directamente.

- **`src/services/`** — lógica de aplicación: orquestan reglas de negocio y llaman a
  `repositories` (o, para infraestructura como el health check, hablan directo con
  `lib/prisma`). No conocen `Request`/`Response`. Ejemplo real: `auth.service.ts`
  (`resolveAuthContext`), usado por `middlewares/authenticate.ts`.

- **`src/repositories/`** — capa de acceso a datos: cada entidad del CRM tiene acá
  sus funciones de consulta/escritura sobre Prisma. Primer archivo real:
  `user.repository.ts` (`findUserForAuth`), usado por `services/auth.service.ts`.

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
