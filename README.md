# Plataforma CRM — Backend

CRM SaaS multi-tenant. Backend en Node.js + Express + TypeScript, Prisma ORM sobre
PostgreSQL (Supabase), autenticación delegada a Supabase Auth.

Para el diseño completo del producto y del modelo de datos, ver
[`docs/project-overview.md`](./docs/project-overview.md). Para el diseño del sistema
de autenticación y onboarding, ver
[`docs/authentication-architecture.md`](./docs/authentication-architecture.md).

> Estado actual: infraestructura base + autenticación (`authenticate`/`authorize`,
> verificados contra logins reales de Supabase vía JWKS/ES256) + conexión real a
> Supabase (migraciones, `manual_constraints.sql` y RLS aplicados, catálogo `Role`
> sembrado) + `POST /api/onboarding` + **módulos `Company`, `Contact`, `Pipeline`,
> `Stage`, `Opportunity`, `Activity` e `Invitation` completos** (CRUD, soft delete,
> paginación) + **administración acotada de `User`** — cierra el conjunto de
> entidades de negocio del modelo de datos actual. `Opportunity` valida
> `pipelineId`/`stageId` contra la organización y entre sí (el stage debe
> pertenecer al pipeline indicado), exige `companyId` y/o `contactId`, y reutiliza
> `resolveOwnerId`. `Activity` exige al menos una de `companyId`/`contactId`/
> `opportunityId` (validado también contra el estado final en `PATCH`, no solo
> contra el body aislado), `authorId` sale exclusivamente de `req.auth.userId`
> (nunca del cliente, nunca editable), y `assigneeId` es opcional sin default al
> creador. `Invitation` transiciona de estado por **compare-and-swap**
> (`updateMany` condicionado a `status: "PENDING"`, nunca un `UPDATE` ciego) —
> verificado históricamente (sesión manual H3/H4, no test persistente) con tres
> carreras concurrentes reales (`Promise.all` genuino contra Supabase real: crear
> vs. crear, aceptar vs. aceptar, aceptar vs. revocar), no de manera uniforme
> entre las tres — ver el desglose exacto por tramo y la cobertura persistente
> actual en `docs/project-overview.md` sección 4. Verificado end-to-end contra un
> proyecto real de Supabase (aislamiento multi-tenant, relaciones cruzadas,
> filtros/orden/paginación, autorización por rol) para el resto de los módulos de
> negocio. Sin endpoint de login propio
> (decisión de diseño estable, no pendiente) — ver la sección "Estado de
> implementación" al inicio de `docs/authentication-architecture.md`.

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

## Frontend

`frontend/` — aplicación Vite + React + TypeScript independiente (paquete
npm propio, `node_modules`/`dist` propios, sin workspaces). M0 implementado:
scaffold e infraestructura únicamente (cliente de Supabase, wrapper de
`fetch`, `QueryClient`, router con rutas placeholder) — sin login ni
pantallas funcionales todavía, ver `docs/project-overview.md` sección 7.

```bash
cd frontend
npm install
cp .env.example .env   # completar con las credenciales reales de Supabase y la URL de esta API
npm run dev             # sirve en http://localhost:5173 — coincide con CORS_ORIGIN por defecto de abajo
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
  (verifica firma/expiración de un JWT de Supabase Auth contra el JWKS público del
  proyecto — `jose`, ES256, sin secreto compartido), y `supabaseAdmin.ts` (cliente
  de Supabase con `service_role` — únicamente para operaciones administrativas
  como crear/borrar usuarios; nunca la `anon` key). Todo lo que en el resto del
  código se importa como "la conexión a X" vive acá.

- **`src/types/`** — tipos compartidos que no pertenecen a ninguna capa en
  particular. Hoy contiene `auth.ts`: `RoleName`, `JwtPayload`, `AuthContext`,
  `AuthenticatedRequest`, y la ampliación global de `Express.Request` (agrega
  `req.auth?: AuthContext` a todos los requests).

- **`src/utils/`** — utilidades genéricas sin estado propio: `AppError.ts` (clase de
  error operacional con `statusCode`), `asyncHandler.ts` (wrapper para que los
  errores de handlers `async` lleguen al middleware de errores — genérico sobre el
  tipo de `Request`, así un controller puede tipar su handler con
  `AuthenticatedRequest` en vez de `Request` y usar `req.auth` sin chequeos
  redundantes), `validation.ts` (`parseOrThrow` — parsea con un schema de Zod o
  lanza `AppError(400)`, compartido por todos los controllers), `slug.ts`
  (`slugify` — normaliza un nombre a un slug, sin lógica de sufijo por colisión: una
  colisión se resuelve como error, no generando una variante), y `bearerToken.ts`
  (`extractBearerToken` — extrae el token del header `Authorization`; usado
  únicamente por el flujo de aceptación de invitaciones, que no puede pasar por
  `authenticate.ts` porque exige una fila en `public.users` que todavía no existe
  para quien está aceptando; no se reutilizó dentro de `authenticate.ts` para no
  tocar código de auth ya verificado en producción).

- **`src/middlewares/`** — middlewares de Express transversales a toda la app:
  `notFound.ts` (404 consistente para rutas no definidas), `errorHandler.ts`
  (formatea cualquier error, esperado o no, a una respuesta JSON consistente),
  `authenticate.ts` (verifica el JWT y adjunta `req.auth`) y `authorize.ts`
  (factory `authorize(...roles)` para restringir una ruta por rol — se usa después
  de `authenticate`). Montados sobre rutas reales (`/api/companies`) y verificados
  contra logins reales de Supabase.

- **`src/controllers/`** — capa HTTP: reciben `Request`/`Response`, delegan en un
  `service` y traducen su resultado a una respuesta. No contienen lógica de negocio
  ni acceden a Prisma directamente. El schema de validación de Zod de cada endpoint
  vive acá (co-ubicado con quien lo usa, igual que `config/env.ts` usa Zod inline).
  Archivos reales: `onboarding.controller.ts`, `company.controller.ts` (módulo de
  referencia — 5 endpoints, create/update tipados con `AuthenticatedRequest`),
  `contact.controller.ts`, `pipeline.controller.ts`, `stage.controller.ts`,
  `opportunity.controller.ts`, `activity.controller.ts`, `invitation.controller.ts`,
  `user.controller.ts` y `me.controller.ts` (`GET /api/me` — el único sin
  service ni repository propios: serializa `req.auth`, ya resuelto por
  `authenticate`, al contrato `{id, email, fullName, organizationId, role}`;
  no recibe input, así que tampoco tiene schema de Zod) (mismo esqueleto en
  la mayoría de los demás; `currency` en
  `Opportunity` se valida como código ISO 4217 de 3 letras mayúsculas sin enum en
  Prisma; `type` en `Activity` y `status` en `Invitation` usan `z.nativeEnum(...)`
  sobre el enum real de Prisma en vez de duplicar sus valores a mano;
  `invitation.controller.ts` es el único cuyo endpoint de aceptación no usa
  `AuthenticatedRequest` — ver `src/utils/bearerToken.ts`; `user.controller.ts`
  no es un CRUD genérico, solo expone las acciones acotadas del caso de uso real:
  listar el roster, `PATCH` de `isActive`/`role`, remover).

- **`src/services/`** — lógica de aplicación: orquestan reglas de negocio y llaman a
  `repositories` (o, para infraestructura como el health check, hablan directo con
  `lib/prisma`). No conocen `Request`/`Response`, y reciben `organizationId` como
  parámetro obligatorio explícito — nunca lo derivan de otra fuente. Ejemplos
  reales: `auth.service.ts` (`resolveAuthContext`, usado por
  `middlewares/authenticate.ts`), `onboarding.service.ts` (`onboardOrganization` —
  coordina Supabase Auth + una transacción de Prisma, con compensación si la
  transacción falla), `ownership.service.ts` (`resolveOwnerId` — validación de
  `ownerId` compartida entre `Company` y `Contact`, extraída para no duplicarla),
  `company.service.ts` y `contact.service.ts` (CRUD + paginación; `contact.service.ts`
  además valida `companyId` reutilizando `findCompanyById` de
  `company.repository.ts`, y normaliza el email a minúsculas antes de guardar),
  `pipeline.service.ts` (maneja `isDefault`: desmarca el anterior antes de marcar el
  nuevo, nunca al revés), `stage.service.ts` (reordenamiento automático de `order`
  — ver `stage.repository.ts` para el detalle del algoritmo), `opportunity.service.ts`
  (valida `companyId`/`contactId`/`pipelineId`/`stageId` contra la organización
  reutilizando los repositories de esas entidades, exige que el `stageId` pertenezca
  al `pipelineId`, y si el `PATCH` cambia `pipelineId` exige que también se envíe
  `stageId` en la misma operación — nunca mueve una oportunidad de pipeline
  implícitamente), `activity.service.ts` (`authorId` nunca es un parámetro
  aceptado desde el cliente — lo fija el controller a partir de `req.auth.userId`;
  `assigneeId` valida con la misma consulta que `resolveOwnerId`
  (`findUserByIdInOrganization`) pero sin su default "si no viene, asigna a quien
  crea" — una `Activity` sin `assigneeId` queda `null`, nunca autoasignada; la
  invariante "al menos `companyId`, `contactId` u `opportunityId`" se revalida en
  cada `PATCH` contra el estado final combinando el registro actual con las claves
  realmente presentes en el body, no solo contra el body aislado), `invitation.service.ts`
  (transiciones de estado por compare-and-swap — `updateMany` condicionado a
  `status: "PENDING"`, verificando `count`, nunca un `UPDATE` ciego — para
  `accept` y `revoke` por igual; `createInvitation` traduce la violación del
  índice único parcial a `409` en vez de dejarla subir como `500`; la aceptación
  usa una verificación de identidad propia, sin pasar por `authenticate.ts`) y
  `user.service.ts` (`updateUser`/`deleteUser` bloquean auto-modificación y dejar
  a la organización sin ningún `ADMIN` activo — `countActiveAdmins`, mismo patrón
  que la protección del último `Pipeline` activo).

- **`src/repositories/`** — capa de acceso a datos: cada entidad tiene acá sus
  funciones de consulta/escritura sobre Prisma. Todas aceptan un parámetro `db`
  opcional (tipo `Db` de `lib/prisma.ts`) para poder correr dentro de una
  transacción. Archivos reales: `user.repository.ts` (`findUserForAuth`,
  `createUser`, `findUserByIdInOrganization` — excluye `deletedAt != null` además
  de exigir `isActive`, `findUserByEmail` para la unicidad global de email que usa
  `Invitation`, `countActiveAdmins`, `findManyUsers`/`updateUser`/`softDeleteUser`
  para la administración acotada), `organization.repository.ts`
  (`findOrganizationBySlug`, `createOrganization`), `role.repository.ts`
  (`findRoleByName`), `company.repository.ts` (CRUD + `findMany`/`count` con
  filtros de búsqueda/industria/owner y orden, siempre con `organizationId` +
  `deletedAt: null`), `contact.repository.ts` (mismo esqueleto; el filtro `search`
  arma un `OR` entre firstName/lastName/email que convive con los filtros
  específicos en el mismo `where` — Prisma los combina con AND implícito),
  `pipeline.repository.ts` (incluye `unsetDefaultPipeline`,
  `findOldestActivePipeline` para la promoción automática de default),
  `stage.repository.ts` (`shiftUpFrom`/`shiftDownAfter`/`reindexStages` — sin
  `db` por default a propósito, siempre corren dentro de una transacción del
  service, nunca sueltas), `opportunity.repository.ts` (mismo esqueleto que
  `company`/`contact`; filtros por `companyId`/`contactId`/`ownerId`/`pipelineId`/
  `stageId`/`status`/`currency`/rango de `amount`, orden por
  `createdAt`/`updatedAt`/`amount`/`title`), `activity.repository.ts` (filtros por
  `type`/`authorId`/`assigneeId`/`companyId`/`contactId`/`opportunityId`/rango de
  `dueDate`/rango de `completedAt`, búsqueda `search` con `OR` entre
  `subject`/`body`, orden por `createdAt`/`updatedAt`/`dueDate`/`completedAt`/
  `subject`) e `invitation.repository.ts` (`revokeInvitationConditional`/
  `acceptInvitationRowConditional` — `updateMany` condicionado a
  `status: "PENDING"`, la única forma de transicionar el estado de una
  `Invitation`; `expireDueInvitations` centraliza la transición perezosa
  `PENDING → EXPIRED`, usada por los cuatro puntos de entrada que dependen del
  estado real de una invitación).

- **`src/routes/`** — define las rutas HTTP y las conecta con su `controller`.
  `index.ts` agrega todos los routers de la aplicación en uno solo. `/health` sin
  prefijo; `onboarding.routes.ts` (público), `company.routes.ts`,
  `contact.routes.ts`, `pipeline.routes.ts`, `stage.routes.ts`,
  `opportunity.routes.ts` y `activity.routes.ts` (protegidos, lectura con
  `authenticate`, escritura con `authenticate` + `authorize("ADMIN")`),
  `invitation.routes.ts` (lectura **y** escritura ADMIN-only, a diferencia del
  resto — expone emails de gente que todavía no es miembro; `POST
  /invitations/accept` es la única ruta de todo el proyecto que no monta
  `authenticate`), `user.routes.ts` (las tres rutas ADMIN-only) y
  `me.routes.ts` (`GET /me`, solo `authenticate` — sin `authorize`: cualquier
  rol autenticado tiene una necesidad legítima de conocer su propia
  identidad) — todo bajo `/api`.

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
