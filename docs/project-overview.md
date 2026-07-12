# Plataforma CRM — Project Overview

> Última actualización: 2026-07-11.
> Este documento es la fuente de verdad del estado del proyecto. Cualquier sesión nueva
> (humana o de Claude) debería poder entender el proyecto completo leyendo solo este
> archivo, sin depender del historial de chat.
>
> **Convención de este documento**: todo lo marcado como "✅ Implementado" existe hoy en
> el repositorio y se puede verificar leyendo el código. Todo lo marcado como
> "🧭 Diseñado / no implementado" es una decisión que se desprende del schema o de los
> comentarios del código, pero **no tiene código de aplicación todavía** — no asumir que
> funciona.

---

## 1. Objetivo del proyecto

**Producto**: un CRM (Customer Relationship Management) multi-tenant para equipos de
ventas. Permite gestionar empresas (`Company`), contactos (`Contact`), oportunidades de
venta (`Opportunity`) organizadas en un pipeline de etapas (`Pipeline` → `Stage`), y un
registro unificado de interacciones (`Activity`: llamadas, reuniones, emails, tareas,
notas) asociadas a cualquiera de esas entidades.

**Público objetivo**: equipos de ventas B2B de organizaciones que necesitan un CRM
propio — el modelo de datos está pensado para que **múltiples organizaciones (tenants)
convivan en la misma base de datos**, cada una con sus propios usuarios, empresas,
contactos y oportunidades, completamente aisladas entre sí.

**Objetivo comercial**: por el diseño multi-tenant (una tabla `Organization` como raíz
de todo lo demás), el proyecto apunta a ser un **SaaS B2B** — se vende por
organización/cuenta, no una instalación single-tenant por cliente. Es un CRM tipo
mini-HubSpot/Pipedrive: pipeline de ventas + gestión de contactos/empresas + timeline de
actividades.

**Filosofía de arquitectura** (se desprende de las decisiones ya tomadas en el schema):

- **Integridad de datos a nivel de base, no solo de aplicación.** El schema usa `CHECK`
  constraints, índices únicos parciales y triggers en Postgres para reglas de negocio
  que no dependen de que el código de la aplicación las respete (ver [sección 5](#5-decisiones-de-arquitectura-tomadas)).
- **No reinventar lo que un proveedor ya resuelve bien.** Auth delegada 100% a Supabase
  Auth en vez de tablas/lógica de contraseñas propia.
- **Un solo modelo por concepto, no una tabla por sub-tipo.** `Activity` es un ejemplo
  claro: en vez de `Call`, `Meeting`, `Email`, `Task`, `Note` como tablas separadas, hay
  un solo modelo con un enum `type`.
- **Preparar el terreno para crecer sin over-engineering hoy.** Ejemplo explícito en el
  comentario del modelo `Role`: hoy es un catálogo simple (`ADMIN`/`USER`, sin scope por
  organización), pero el diseño deja espacio para agregar `Permission`/`RolePermission`
  más adelante sin tocar `User` ni `Role`.

---

## 2. Stack tecnológico

| Tecnología | Rol | Por qué (evidencia en el repo) |
|---|---|---|
| **TypeScript** (`strict: true`) | Lenguaje del backend | `tsconfig.json` fuerza modo estricto — tipado fuerte de punta a punta, incluso antes de que exista código de aplicación. |
| **Node.js** | Runtime | Implícito por `package.json`/`tsconfig`. |
| **tsx** | Runner de desarrollo TS | Dependencia de desarrollo (`devDependencies`), pensado para correr TS sin compilar en cada cambio. |
| **Prisma ORM 5.20** (`@prisma/client`, `prisma`) | Acceso a datos type-safe + migraciones | Es la única capa de aplicación que existe hoy: `prisma/schema.prisma` define 9 modelos. Scripts en `package.json`: `prisma:generate`, `prisma:validate`, `prisma:studio`. |
| **PostgreSQL** | Motor de base de datos | `datasource db { provider = "postgresql" }` en el schema. |
| **Supabase** (Auth + Postgres hosting) | Autenticación gestionada + hosting de la DB | Proyecto real provisionado y conectado (`.env` completo). El modelo `User` está diseñado para compartir `id` con `auth.users` (tabla gestionada por Supabase). |
| **PgBouncer** | Pooling de conexiones para runtime | `.env.example` distingue `DATABASE_URL` (puerto 6543, `?pgbouncer=true`, la usa la app) de `DIRECT_URL` (puerto 5432, solo para `prisma migrate`) — patrón estándar de Supabase + Prisma, porque Prisma Migrate no funciona bien a través de PgBouncer en modo transacción. |
| **dotenv** | Carga de variables de entorno | Dependencia declarada en `package.json`. |
| **SQL manual** (`prisma/sql/manual_constraints.sql`) | Constraints/triggers que Prisma no soporta nativamente | Prisma no expresa índices únicos parciales (`WHERE`), `CHECK` constraints ni triggers en el DSL de `schema.prisma` — se completan a mano. |
| **Express 4** | Framework HTTP del backend | `src/app.ts` — middlewares estándar (helmet, cors, compression), manejo de errores centralizado, health check. Ver `README.md` para el detalle de cada carpeta de `src/`. |
| **pino** / **pino-http** | Logging estructurado | `src/lib/logger.ts` — JSON en producción, `pino-pretty` en desarrollo. |
| **zod** | Validación de `process.env` al arrancar | `src/config/env.ts` — falla rápido y claro si falta una variable requerida. |
| **jose** | Verificación del JWT emitido por Supabase Auth | `src/lib/jwt.ts` — valida firma contra el JWKS público del proyecto (`createRemoteJWKSet` + `jwtVerify`, ES256) y expiración; no emite tokens propios. Reemplazó a `jsonwebtoken`+`SUPABASE_JWT_SECRET` (HS256) cuando se descubrió, probando contra un login real, que este proyecto firma con clave asimétrica. |
| **@supabase/supabase-js** | Cliente de Supabase para operaciones administrativas | `src/lib/supabaseAdmin.ts` — únicamente con `service_role`, nunca la `anon` key (crear/borrar usuarios de `auth.users`). |

**Lo que todavía NO está en el stack**:
- Ningún framework de frontend.
- Ningún framework de testing.
- Ningún linter/formatter (ESLint, Prettier).

---

## 3. Estructura del proyecto

```
Plataforma CRM/
├── .env / .env.example           # Variables de entorno. Todas las de Supabase/DB
│                                  #   completas y conectadas contra un proyecto real.
├── .gitignore
├── package.json                  # Scripts dev/build/start + los de Prisma (incluye
│                                  #   prisma:seed) + config "prisma.seed".
├── tsconfig.json                 # strict, rootDir "src" — solo incluye src/**/*.ts
│                                  #   (prisma/*.ts se ejecuta con tsx, no con tsc).
├── README.md                     # Quickstart + explicación de cada carpeta de src/.
├── prisma/
│   ├── schema.prisma               # 10 modelos + 4 enums (ver sección 4).
│   ├── seed.ts                     # Seed idempotente del catálogo Role (ADMIN/USER).
│   ├── migrations/                  # Inicial + la que agrega organizationId/deletedAt
│   │                                 #   a Stage + la que agrega el índice
│   │                                 #   (organizationId, pipelineId) a Opportunity +
│   │                                 #   la que agrega el índice (authorId) a Activity +
│   │                                 #   la que agrega Invitation y User.deletedAt.
│   └── sql/
│       ├── manual_constraints.sql   # Triggers de sync de email, constraints manuales,
│       │                             #   índices únicos parciales (incluye los 4 de
│       │                             #   Stage, el fix de pipelines_org_default_unique,
│       │                             #   y el de invitations_org_email_pending_unique).
│       └── rls_policies.sql         # Row Level Security — ver sección 7 y
│                                     #   authentication-architecture.md sección 5.
└── src/
    ├── config/env.ts               # Validación de process.env con zod.
    ├── lib/                        # prisma.ts (singleton + tipo Db), logger.ts
    │                                #   (pino), jwt.ts (JWT de Supabase vía JWKS,
    │                                #   jose), supabaseAdmin.ts (cliente service_role).
    ├── types/auth.ts                # RoleName, JwtPayload, AuthContext,
    │                                 #   AuthenticatedRequest, ampliación de Express.Request.
    ├── utils/                       # AppError.ts, asyncHandler.ts (genérico sobre
    │                                 #   el tipo de Request), validation.ts
    │                                 #   (parseOrThrow), slug.ts, bearerToken.ts
    │                                 #   (extractBearerToken, usado por el flujo de
    │                                 #   aceptación de invitaciones, ver sección 4).
    ├── middlewares/                 # notFound.ts, errorHandler.ts, authenticate.ts,
    │                                 #   authorize.ts.
    ├── controllers/                 # onboarding.controller.ts, company.controller.ts,
    │                                 #   contact.controller.ts, pipeline.controller.ts,
    │                                 #   stage.controller.ts, opportunity.controller.ts,
    │                                 #   activity.controller.ts, invitation.controller.ts,
    │                                 #   user.controller.ts.
    ├── services/                    # auth.service.ts, onboarding.service.ts,
    │                                 #   ownership.service.ts (resolveOwnerId,
    │                                 #   compartido entre Company, Contact y Opportunity —
    │                                 #   Activity/Invitation NO lo usan para
    │                                 #   assigneeId/reactivar, ver sección 4),
    │                                 #   company.service.ts, contact.service.ts,
    │                                 #   pipeline.service.ts, stage.service.ts,
    │                                 #   opportunity.service.ts, activity.service.ts,
    │                                 #   invitation.service.ts, user.service.ts.
    ├── repositories/                # user.repository.ts, organization.repository.ts,
    │                                 #   role.repository.ts, company.repository.ts,
    │                                 #   contact.repository.ts, pipeline.repository.ts,
    │                                 #   stage.repository.ts (reindexado de order),
    │                                 #   opportunity.repository.ts, activity.repository.ts,
    │                                 #   invitation.repository.ts (compare-and-swap) —
    │                                 #   ver README.md para el patrón de tres capas.
    ├── routes/                      # health.routes.ts (sin prefijo), index.ts
    │                                 #   agregador, onboarding.routes.ts,
    │                                 #   company.routes.ts, contact.routes.ts,
    │                                 #   pipeline.routes.ts, stage.routes.ts,
    │                                 #   opportunity.routes.ts, activity.routes.ts,
    │                                 #   invitation.routes.ts y user.routes.ts
    │                                 #   (bajo /api).
    ├── app.ts                       # arma Express, no escucha puerto.
    └── server.ts                    # entry point + graceful shutdown.
```

Detalle carpeta por carpeta (propósito, qué va en cada una) en `README.md` — no se
duplica acá para no tener dos fuentes de verdad que se puedan desincronizar.

**Lo que sigue faltando:**
- Nada del modelo de datos actual queda sin exponer vía API — `Company`, `Contact`,
  `Pipeline`, `Stage`, `Opportunity`, `Activity`, `Invitation` y la administración
  acotada de `User` ya están todos implementados y verificados end-to-end contra
  Supabase real. Lo que sigue pendiente es de otra naturaleza: endpoint de login
  propio (el login en sí no pasa por Express, ver `authentication-architecture.md`
  sección 3) y un frontend que ejercite todo esto — ver sección 8.

---

## 4. Modelo de datos

Todas las entidades viven en `prisma/schema.prisma`. Todas las tablas (salvo `Role`) se
mapean a snake_case en Postgres vía `@map`/`@@map`.

### `Organization`
- **Propósito**: raíz del aislamiento multi-tenant. Cada organización es un cliente de
  la plataforma.
- **Relaciones**: 1:N con `User`, `Company`, `Contact`, `Opportunity`, `Pipeline`,
  `Activity` — todas las entidades de negocio cuelgan directamente de una organización.
- **Decisiones importantes**: `slug` único (probablemente para URLs/subdominios por
  tenant). Tiene `deletedAt` (soft delete). Índice en `deletedAt` para filtrar
  organizaciones activas eficientemente.

### `Role`
- **Propósito**: catálogo global de roles (`ADMIN`, `USER` implícitos por el nombre del
  campo, aunque no hay seed en el repo que confirme los valores exactos).
- **Relaciones**: 1:N con `User`.
- **Decisiones importantes**: **sin scope por organización** — es un catálogo global,
  no un rol distinto por tenant. El comentario en el schema es explícito: esto deja
  espacio para agregar `Permission`/`RolePermission` a futuro sin tocar `User` ni
  `Role`. No tiene `deletedAt`.

### `User`
- **Propósito**: perfil de negocio del usuario autenticado por Supabase Auth.
- **Relaciones**: pertenece a una `Organization` y a un `Role`. Es dueño (`owner`) de
  `Company`, `Contact`, `Opportunity`; autor (`author`) y/o asignado (`assignee`) de
  `Activity`.
- **Decisiones importantes**: **`id` comparte valor literal con `auth.users.id`** de
  Supabase — no es una FK declarada a `auth.users` (esa tabla vive en otro schema de
  Postgres, fuera del alcance de Prisma), sino una convención: el `id` de negocio *es*
  el `id` de auth. El campo `email` **nunca se escribe desde la aplicación** — se
  sincroniza automáticamente por trigger (ver [sección 6](#6-flujo-de-autenticación)).
  `isActive` y `deletedAt` tienen semánticas distintas, no redundantes: `isActive:
  false` con `deletedAt: null` es una suspensión reversible (`PATCH /api/users/:id`
  puede volver a activarlo); `deletedAt` seteado es remoción de la organización —
  soft delete terminal, sin undelete implementado. Un hard delete real ya está
  bloqueado de hecho por integridad referencial: `Opportunity.ownerId` y
  `Activity.authorId` son obligatorios y no declaran `onDelete`, así que Postgres
  rechazaría borrar un `User` referenciado por cualquiera de los dos.

### `Company`
- **Propósito**: empresa cliente o prospecto.
- **Relaciones**: pertenece a `Organization`, dueño opcional (`owner: User?`). Tiene
  `Contact[]`, `Opportunity[]`, `Activity[]`.
- **Decisiones importantes**: `ownerId` es opcional y con `onDelete: SetNull` — si se
  borra el usuario dueño, la empresa no se borra, solo pierde el dueño. Soft delete.
  Índices pensados para las consultas típicas de un CRM: por organización, por dueño,
  por dominio, y compuesto `(organizationId, name)`.

### `Contact`
- **Propósito**: persona física (lead/cliente).
- **Relaciones**: pertenece a `Organization`, opcionalmente a una `Company` y a un
  `owner` (`User`). Tiene `Opportunity[]` y `Activity[]`.
- **Decisiones importantes**: **`lifecycleStage` (enum `LifecycleStage`:
  `LEAD → MQL → SQL → CUSTOMER → CHURNED`) reemplaza a una entidad `Lead` separada** —
  un lead no es un tipo de objeto distinto, es un *estado* de un contacto. Único
  `(organizationId, email)` **parcial** (solo aplica si `email IS NOT NULL AND
  deletedAt IS NULL`), implementado a mano en `manual_constraints.sql` porque Prisma no
  soporta índices únicos parciales.

### `Pipeline`
- **Propósito**: proceso de ventas de una organización. ✅ Módulo completo
  (`POST/GET/GET :id/PATCH/DELETE /api/pipelines`).
- **Relaciones**: pertenece a `Organization`. Tiene `Stage[]` y `Opportunity[]`.
- **Decisiones importantes**: el comentario dice "MVP: uno por organización", pero **el
  modelo ya soporta múltiples pipelines por organización** (`@@unique([organizationId,
  name])`, no un único pipeline). `isDefault` con índice único parcial (`WHERE
  is_default = true AND deleted_at IS NULL`) garantiza a lo sumo un pipeline default
  por organización — **corregido** durante la implementación de `Pipeline`/`Stage`:
  originalmente no excluía filas borradas, lo que dejaba a una organización sin poder
  tener nunca más un default si el que tenía se borraba. Marcar un pipeline como
  default desmarca automáticamente el anterior (mismo orden: desmarcar primero,
  marcar después, para no violar el índice ni por un instante). No se permite
  eliminar el último pipeline activo de una organización; si se elimina el pipeline
  default (quedando otros), se promueve automáticamente el más antiguo restante.
  `pipeline.service.ts` traduce la violación de cualquiera de sus dos índices
  únicos (`@@unique([organizationId, name])` o el parcial de `isDefault`) a
  `409` en vez de dejarla subir como `500` crudo — mismo patrón ya usado en
  `contact.service.ts`/`stage.service.ts`/`invitation.service.ts` (H2, cerrado).

### `Stage`
- **Propósito**: etapa ordenada dentro de un `Pipeline` (ej. "Prospecto", "Negociación",
  "Cerrado ganado"). ✅ Módulo completo (`POST/GET/GET :id/PATCH/DELETE /api/stages`).
- **Relaciones**: pertenece a `Organization` y a `Pipeline` (`onDelete: Cascade` — si
  se borra el pipeline en la base, se borran sus etapas). Tiene `Opportunity[]`.
- **Decisiones importantes**:
  - `organizationId` **agregado** (denormalizado desde `pipeline.organizationId`)
    durante la implementación de este módulo — antes era la única entidad de negocio
    sin `organizationId` propio, lo que obligaba a resolver el aislamiento
    multi-tenant vía join a `Pipeline` en cada query y en la política de RLS. Un stage
    nunca cambia de organización (no se permite mover un stage a otro pipeline vía la
    API), así que la denormalización no puede desincronizarse en la práctica.
  - `deletedAt` **agregado** (antes no tenía soft delete) — necesario porque
    `Opportunity.stageId` es obligatorio: un hard delete de un `Stage` referenciado
    por una `Opportunity` violaría integridad referencial. Resuelve el riesgo que ya
    estaba señalado en este documento.
  - Único `(pipelineId, order)` y `(pipelineId, name)`, y **nuevo**: único
    `(pipelineId) WHERE is_won = true` y `(pipelineId) WHERE is_lost = true` — a lo
    sumo una etapa ganada y una perdida por pipeline. Los cuatro son índices únicos
    parciales `WHERE deleted_at IS NULL` (`manual_constraints.sql`) — antes `(pipelineId,
    order)` y `(pipelineId, name)` eran constraints nativas de Prisma; se convirtieron
    a parciales para que una etapa borrada libere su `order`/`name`.
  - `probability` (probabilidad de cierre por etapa), `isWon`/`isLost` con `CHECK`
    que impide que ambos sean `true` a la vez (`stages_won_lost_exclusive_check`).
  - **Reordenamiento automático**: crear, actualizar el `order`, o borrar una etapa
    recalcula el `order` de sus hermanas para no dejar huecos ni duplicados — ver
    `src/repositories/stage.repository.ts` (`shiftUpFrom`, `shiftDownAfter`,
    `reindexStages`). El caso general (mover una etapa existente) usa un reindexado en
    dos fases (offset negativo, después el valor final) dentro de una transacción,
    porque la constraint única se evalúa por statement — un intercambio directo entre
    dos filas chocaría contra ella a mitad de camino.
  - **Nota resuelta al construir `Opportunity`**: esta sección señalaba que un
    `Pipeline` debería tener al menos un `Stage` antes de poder usarse para crear
    una `Opportunity`. No hizo falta agregar una validación explícita: como
    `stageId` es obligatorio en `Opportunity` y se valida que pertenezca al
    `pipelineId` indicado, un pipeline sin stages simplemente no tiene ningún
    `stageId` válido que enviar — la restricción queda garantizada por
    construcción, sin código adicional en `Pipeline`/`Stage`.

### `Opportunity`
- **Propósito**: una venta en curso (deal). ✅ Módulo completo
  (`POST/GET/GET :id/PATCH/DELETE /api/opportunities`), verificado end-to-end
  contra un proyecto real de Supabase.
- **Relaciones**: pertenece a `Organization`, `Pipeline`, `Stage`, tiene un `owner`
  obligatorio (`User`), y opcionalmente una `Company` y/o `Contact`. Tiene
  `Activity[]`.
- **Decisiones importantes**: `CHECK (company_id IS NOT NULL OR contact_id IS NOT
  NULL)` — una oportunidad necesita estar ligada a al menos una empresa o un contacto
  (`opportunities_company_or_contact_check`), reforzado también en la capa de
  aplicación (`refine` de Zod en `opportunity.controller.ts`) para no depender
  únicamente de que Postgres rechace el insert. `CHECK (amount >= 0)`
  (`opportunities_amount_non_negative_check`). `status` enum `OPEN/WON/LOST` con
  `lostReason` opcional — `lostReason`, `expectedCloseDate` y `actualCloseDate` se
  pueden limpiar explícitamente vía `PATCH` (`null`), pensado para reabrir una
  oportunidad `WON`/`LOST` de vuelta a `OPEN`. Soft delete. `pipelineId` y
  `stageId` son obligatorios y se validan contra la organización; además se valida
  que el `stageId` pertenezca al `pipelineId` indicado (un stage es de un solo
  pipeline, pero nada lo garantiza a nivel de base). Si un `PATCH` cambia
  `pipelineId`, exige que también se envíe `stageId` en la misma operación — nunca
  mueve una oportunidad de pipeline implícitamente. `currency` sigue siendo
  `String` (sin enum en Prisma/Postgres — ISO 4217 tiene ~180 códigos), validado en
  Zod como 3 letras mayúsculas y normalizado a mayúsculas antes de guardar.
  `ownerId` reutiliza `resolveOwnerId` de `ownership.service.ts`, igual que
  `Company`/`Contact`. Índice `(organizationId, pipelineId)` agregado para los
  filtros de listado por pipeline. La validación pendiente que señalaba una
  versión anterior de este documento ("un `Pipeline` debería tener al menos un
  `Stage` antes de poder usarse") queda resuelta de hecho: como `stageId` es
  obligatorio y debe pertenecer al `pipelineId`, un pipeline sin stages no tiene
  ningún `stageId` válido que enviar.

### `Activity`
- **Propósito**: registro unificado de cualquier interacción — llamada, reunión, email,
  tarea o nota (`enum ActivityType`). ✅ Módulo completo
  (`POST/GET/GET :id/PATCH/DELETE /api/activities`), verificado end-to-end contra un
  proyecto real de Supabase.
- **Relaciones**: pertenece a `Organization`, tiene un `author` obligatorio (`User`) y
  un `assignee` opcional (`User`). Opcionalmente ligada a `Company`, `Contact` y/o
  `Opportunity`.
- **Decisiones importantes**: **un solo modelo para 5 tipos de interacción** en vez de
  5 tablas separadas — trade-off consciente: menos duplicación de esquema, a costa de
  columnas que solo aplican a algunos tipos (`dueDate`/`completedAt` tienen sentido
  para `TASK`, menos para `NOTE`) — no hay ninguna regla de negocio ni constraint que
  ate esas columnas a un `ActivityType` específico, y el módulo no inventó ninguna al
  implementarse. `CHECK` que exige que esté ligada a *al menos* una de
  `Company`/`Contact`/`Opportunity` (`activities_related_entity_check`), reforzado
  también en Zod (create) y revalidado contra el **estado final** en cada `PATCH`
  (registro actual + claves realmente presentes en el body, distinguiendo "clave
  ausente" de "`null` explícito") — un `PATCH` no puede dejar la actividad sin
  ninguna de las tres relaciones, aunque el body en sí sea válido en aislamiento.
  `authorId` sale exclusivamente de `req.auth.userId`: no existe como campo en
  ningún schema de Zod (ni create ni update), así que un cliente no puede
  establecerlo ni modificarlo, ni por error. `assigneeId` es opcional y **no**
  reutiliza `resolveOwnerId` de `ownership.service.ts` — ese helper por diseño
  asigna por default a quien crea el registro, semántica correcta para "owner" pero
  incorrecta para "assignee" (una actividad sin asignar debe quedar `null`, nunca
  autoasignada al autor); en cambio reutiliza la misma consulta que `resolveOwnerId`
  usa internamente (`findUserByIdInOrganization` de `user.repository.ts`) con un
  validador local (`validateAssigneeId`) sin comportamiento de default. `dueDate`,
  `completedAt`, `body`, `companyId`, `contactId`, `assigneeId` y `opportunityId` se
  pueden limpiar explícitamente con `null` vía `PATCH` — mismo criterio que
  `Opportunity` con `lostReason`/`expectedCloseDate`/`actualCloseDate`, evitando el
  mismo bug de `z.coerce.date()` convirtiendo un `null` explícito en `1970-01-01`.
  Filtros de fecha (`dueDateFrom`/`dueDateTo`/`completedAtFrom`/`completedAtTo`) por
  **rango**, no por igualdad exacta de timestamp — validado en Zod que el límite
  inferior no sea posterior al superior. Búsqueda `search` con `OR` entre
  `subject`/`body`. Índice `@@index([authorId])` agregado (antes solo `assigneeId`
  tenía índice propio entre las dos FK a `User` — asimetría real corregida, mismo
  criterio que `ownerId` en `Company`/`Contact`/`Opportunity`). Soft delete.

### `Invitation`
- **Propósito**: invitación pendiente de un `ADMIN` a un nuevo miembro de su
  organización. ✅ Módulo completo (`POST/GET /api/invitations`,
  `DELETE /api/invitations/:id`, `POST /api/invitations/accept`), verificado
  end-to-end contra un proyecto real de Supabase, incluidas tres carreras
  concurrentes reales (ver más abajo).
- **Relaciones**: pertenece a `Organization` y a `Role` (el rol que tendrá al
  aceptar), `invitedBy` obligatorio (`User`, quien la creó).
- **Decisiones importantes**: `status` (`enum InvitationStatus`:
  `PENDING | ACCEPTED | REVOKED | EXPIRED`) es la fuente de verdad del ciclo de
  vida — deliberadamente **sin** `deletedAt` propio: acá "removido" ya tiene
  nombre propio (`REVOKED`/`EXPIRED`), agregar `deletedAt` encima obligaría a
  explicar en qué se diferencia de esos dos estados, sin buena respuesta. La
  transición `PENDING → EXPIRED` es perezosa (sin cron): se recalcula antes de
  cualquier operación cuyo resultado dependa del estado real (crear, listar,
  aceptar, revocar) — necesario porque el índice único parcial de abajo exige
  que "pending" sea un valor de columna literal, no algo derivado de comparar
  `expiresAt` contra `now()` (los predicados de índices parciales de Postgres
  deben ser `IMMUTABLE`).
  - Único `(organizationId, email) WHERE status = 'PENDING'` — índice único
    parcial (`manual_constraints.sql`) — a lo sumo una invitación pendiente por
    email y organización a la vez.
  - **Ambas transiciones de estado (`accept`, `revoke`) son compare-and-swap**,
    no un `UPDATE` ciego: `db.invitation.updateMany({ where: { id, status:
    "PENDING" }, data: {...} })`, verificando `count`. Ninguna transición
    depende de un `SELECT` previo como defensa real — el `SELECT` que hace cada
    service antes es solo un mensaje de UX rápido para el caso común, no
    concurrente. Esto resuelve tres carreras reales, verificadas con
    `Promise.all` genuino contra Supabase real:
    - **crear vs. crear** (mismo `organizationId`+`email`): el índice único
      parcial permite un solo `INSERT`; el segundo choca con `P2002`, traducido
      a `409` (antes: `500` crudo).
    - **aceptar vs. aceptar** (misma invitación): la escritura condicional es
      el primer paso dentro de la transacción, antes de crear el `User` — si
      pierde, nunca llega a intentar crear el `User` (cero riesgo de huérfanos).
    - **aceptar vs. revocar** (misma invitación, ganador no determinista):
      exactamente una transición gana; si gana `accept`, `User` creado y
      `Invitation` `ACCEPTED`; si gana `revoke`, `Invitation` `REVOKED` y
      **ningún** `User` creado — nunca ambos efectos a la vez. Verificado
      empíricamente en ambos sentidos (no solo el que "gana" más seguido en un
      entorno de baja latencia — ver riesgos, sección 9).
  - `email` normalizado a minúsculas. `roleId` se resuelve server-side desde
    `role: "ADMIN" | "USER"` (nunca un `roleId` crudo del cliente). `expiresAt`
    calculado server-side (7 días), nunca enviado por el cliente.
  - Aceptación: no pasa por `authenticate` (exige `public.users` ya existente,
    justo lo que todavía no existe para quien acepta) — usa una verificación
    liviana propia (`extractBearerToken` + `verifySupabaseJwt`, sin
    `resolveAuthContext`). `organizationId`/`roleId` del nuevo `User` salen
    exclusivamente de la `Invitation` encontrada, nunca del cliente. Si no se
    envía `invitationId`, se busca por email entre las `PENDING` — si hay más
    de una (un mismo email invitado a más de una organización, caso posible
    solo insertando filas directo, ver sección 9), `409` pidiendo
    `invitationId` explícito.
  - Límite real de la plataforma (no de este código): el email de
    `auth.users` es único en todo el proyecto de Supabase, no por
    organización — invitar un email que ya es identidad de Supabase en
    cualquier organización falla al llamar a `inviteUserByEmail`, traducido a
    `409`. Una vez invitado, ese email no se libera aunque la invitación se
    revoque o venza (Supabase no borra la identidad en esos casos) — ver
    riesgos.
  - Estrategia de consistencia con Supabase (no "atómica" — dos sistemas sin
    transacción compartida): se crea la `Invitation` en Prisma primero, se
    llama a `inviteUserByEmail` después; si Supabase falla, se hace **hard
    delete** de la `Invitation` (deliberado, no una revocación — esa fila
    nunca llegó a existir funcionalmente), con el mismo criterio de riesgo
    residual documentado que `onboarding.service.ts` para su propia
    compensación.

### Enums
- `ActivityType`: `CALL | MEETING | EMAIL | TASK | NOTE`
- `LifecycleStage`: `LEAD | MQL | SQL | CUSTOMER | CHURNED`
- `OpportunityStatus`: `OPEN | WON | LOST`
- `InvitationStatus`: `PENDING | ACCEPTED | REVOKED | EXPIRED`

---

## 5. Decisiones de arquitectura tomadas

- **Multi-tenant por columna (`organizationId`), no schema-per-tenant ni
  DB-per-tenant.** Todas las tablas de negocio llevan `organization_id` y lo indexan.
  Es el enfoque más simple de operar (un solo schema, una sola migración para todos los
  tenants) pero **las lecturas (`findMany`/`findFirst`/`count`) dependen 100% de que el
  código de aplicación filtre correctamente por `organizationId` en cada query** —
  sin cambios. Las **escrituras tenant-scoped** (`update`/soft-delete de `Company`,
  `Contact`, `Pipeline`, `Stage`, `Opportunity`, `Activity`, `User`, y la revocación de
  `Invitation`) ya no dependen únicamente de eso: desde la corrección de M4, el `WHERE`
  efectivo de cada una de esas escrituras exige `organizationId` (o `pipelineId` en el
  reindexado interno de `Stage`) en la propia escritura del repository, no solo en el
  pre-check del service — ver `src/repositories/*.repository.ts` y el test de
  integración `src/repositories/tenant-isolation.integration-test.ts`. Row Level
  Security de Postgres **sí está habilitado** (`prisma/sql/rls_policies.sql`, ver
  sección 7), pero es una defensa secundaria, no la principal — el rol con el que
  Prisma se conecta tiene `BYPASSRLS`, así que esas políticas no se evalúan para
  ninguna query de este backend (ver [riesgos](#9-riesgos-o-puntos-a-vigilar) para el
  detalle de qué superficies sí protege).

- **Supabase Auth en vez de autenticación propia.** Delega passwords, tokens, reset de
  contraseña, y potencialmente OAuth, a un proveedor especializado. Reduce
  significativamente la superficie de riesgo de seguridad y el tiempo de desarrollo
  comparado con implementar auth desde cero.

- **Prisma como ORM + SQL manual complementario.** Prisma da type-safety y migraciones
  versionadas en TypeScript, pero no soporta índices únicos parciales, `CHECK`
  constraints ni triggers en su DSL. La solución elegida es un archivo SQL separado
  (`manual_constraints.sql`) que se aplica después de cada migración — mantiene el
  schema principal declarativo y en Prisma, y aísla lo "no estándar" en un solo lugar
  documentado.

- **Soft delete (`deletedAt`) en la mayoría de las entidades, pero no en todas.**
  `Organization`, `Company`, `Contact`, `Pipeline`, `Stage`, `Opportunity`, `Activity`
  lo tienen; `User` y `Role` no. `Stage` lo agregó durante la implementación de
  `Pipeline`/`Stage` — antes era la única excepción entre las entidades con
  `organizationId` propio (ver sección 4), y quedaba señalado como riesgo en la
  sección 9. La asimetría restante (`User`, `Role`) sigue siendo un pendiente, no
  resuelto en esta tarea.

- **Roles simples y globales, no permisos granulares.** `Role` es un catálogo sin scope
  por organización, explícitamente diseñado para poder agregar
  `Permission`/`RolePermission` más adelante sin migrar `User` ni `Role`.

- **`Activity` unificada en vez de tablas por tipo de interacción.** Ver
  [sección 4](#4-modelo-de-datos). Trade-off: menos tablas y joins, más columnas
  nullable.

- **`Contact.lifecycleStage` en vez de una entidad `Lead`.** Un lead es un estado del
  ciclo de vida de un contacto, no un tipo de objeto distinto — evita duplicar el
  modelo de datos entre "lead" y "contacto" cuando en la práctica es la misma entidad
  con distinto estado.

- **Pipeline con `Stage` ordenado (`order: Int`).** Modelo estándar de pipeline
  kanban de ventas: cada oportunidad vive en una etapa de un pipeline, con
  `probability` de cierre y flags mutuamente excluyentes `isWon`/`isLost`.

- **Separación `DATABASE_URL` (pooled vía PgBouncer, puerto 6543) vs. `DIRECT_URL`
  (directo, puerto 5432).** Patrón requerido por Supabase + Prisma: las migraciones de
  Prisma necesitan una conexión directa a Postgres porque PgBouncer en modo
  transacción rompe algunas operaciones de `prisma migrate`; el runtime de la app usa
  la conexión pooled para escalar mejor bajo concurrencia.

---

## 6. Flujo de autenticación

> Ver el detalle completo (con justificación de cada decisión) en
> [`docs/authentication-architecture.md`](./authentication-architecture.md). Acá va
> solo un resumen con el estado real de implementación de cada paso.

**1. Registro (`auth.users`).** El usuario se registra a través de Supabase Auth (por
ejemplo `supabase.auth.signUp(...)` desde un frontend que todavía no existe en este
repo). Supabase crea la fila en `auth.users` — una tabla que Supabase gestiona en su
propio schema de Postgres, **fuera del `schema.prisma` de este proyecto** (Prisma no la
modela ni la controla).

**2. Creación del perfil de negocio (`public.users`).** 🧭 **Este paso es un hueco de
diseño hoy**: `manual_constraints.sql` *no* tiene un trigger que cree automáticamente
una fila en `public.users` cuando se inserta una fila en `auth.users`. Solo existen dos
triggers de *sincronización de email*, no de *creación*. Esto significa que, tal como
está el repo hoy, **hace falta decidir e implementar** cómo se crea esa fila: opción A)
un trigger de Postgres `AFTER INSERT ON auth.users` (simétrico a los dos triggers de
email que ya existen), o opción B) un endpoint del backend que el frontend llama justo
después de un `signUp` exitoso. En cualquier caso, esa creación debe asignar
`organizationId` y `roleId` — lo cual a su vez depende de una decisión de producto
todavía no tomada: ¿cada signup crea una organización nueva, o el usuario se une a una
existente por invitación? (Ver [sección 8](#8-próximos-pasos-recomendados), punto 4.)

**3. Sincronización de `email` (`auth.users` → `public.users`).** Esta parte **sí está
implementada** en `manual_constraints.sql`:
- `trg_set_user_email_from_auth` (`BEFORE INSERT OR UPDATE ON public.users`):
  sobreescribe `NEW.email` leyéndolo siempre de `auth.users`, sin importar qué haya
  enviado la aplicación. Garantiza que el email de negocio nunca pueda desincronizarse
  del email real de autenticación, incluso en la creación inicial.
- `trg_propagate_auth_email_change` (`AFTER UPDATE OF email ON auth.users`): si el
  usuario cambia su email desde Supabase Auth, propaga el cambio a `public.users`
  automáticamente.

**4. Emisión del JWT.** Supabase Auth firma el JWT con clave asimétrica (ES256).
El `sub` de ese JWT es el `id` de `auth.users`, que **es el mismo valor** que
`public.users.id`.

**5. Petición autenticada (✅ implementado y verificado contra logins reales).**
El cliente debe enviar el JWT en cada request, típicamente
`Authorization: Bearer <token>`. El middleware (`src/middlewares/authenticate.ts`):
   a. Verifica la firma del JWT contra el JWKS público de Supabase
      (`src/lib/jwt.ts`, `jose`). ✅
   b. Extrae el `sub` (= `id` de `public.users`). ✅
   c. Usa Prisma para buscar la fila de `public.users` con ese `id`, trayendo
      `organizationId` y `role` en el mismo query
      (`src/repositories/user.repository.ts`). ✅
   d. Adjunta ese contexto (usuario, organización, rol) al request
      (`req.auth`, tipado en `src/types/auth.ts`) para que el resto del handler lo
      use. ✅

   Ya está montado sobre rutas reales (`/api/companies`) — ver detalle del cambio
   de HS256 a ES256/JWKS en `authentication-architecture.md` sección 4. También
   existe `src/middlewares/authorize.ts` (autorización por rol, `ADMIN`/`USER`),
   montado en las rutas de escritura de `Company`.

**6. Scoping multi-tenant en cada query.** Con el `organizationId` del usuario
autenticado disponible, cada consulta Prisma en el handler filtra explícitamente por
ese `organizationId` (`where: { organizationId }`) — así lo hace
`src/repositories/company.repository.ts`, primer ejemplo real del patrón. RLS
(`prisma/sql/rls_policies.sql`) es una defensa secundaria, no reemplaza este filtro
(ver sección 9).

**Resumen de la relación entre piezas:**

```
auth.users (Supabase, gestionado)          public.users (Prisma, este repo)
┌─────────────────────────────┐            ┌──────────────────────────────────┐
│ id            (PK)          │──────────▶ │ id             (mismo valor)      │
│ email                       │  trigger    │ organization_id (FK)             │
│ encrypted_password          │  sync ──▶   │ role_id         (FK)              │
│ ...                         │  (email)    │ email  (solo lectura desde app)   │
└─────────────────────────────┘            │ full_name, is_active, ...         │
         │                                 └──────────────────────────────────┘
         │ JWT firmado con clave asimétrica (ES256)
         ▼
   Authorization: Bearer <token>
         │
         ▼
   Express middleware (✅ implementado, src/middlewares/authenticate.ts)
   → verifica JWT contra JWKS → obtiene sub → Prisma.user.findUnique({ id: sub })
   → adjunta { user, organizationId, role } al request
```

---

## 7. Estado actual del proyecto

**Infraestructura**
- ✅ `.gitignore`, `.env.example` documentado, `tsconfig.json` en modo estricto.
- ✅ Git inicializado, commits hechos.
- ✅ Dependencias instaladas (`node_modules/`).
- ✅ Servidor Express completo: middlewares estándar, manejo de errores, logging,
  health check (`GET /health`, chequea conectividad real a la base).
- ✅ Proyecto de Supabase provisionado y conectado: `.env` completo con
  `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` reales (`SUPABASE_JWT_SECRET` ya no se usa — ver
  Autenticación abajo). `GET /health` confirma `database: "ok"` contra la base
  real.

**Base de datos**
- ✅ `schema.prisma` completo: 10 modelos, 4 enums, relaciones, índices. `Stage`
  ganó `organizationId` y `deletedAt` en la migración de ese módulo; `User` ganó
  `deletedAt` en la migración de `Invitation` (ver sección 4).
- ✅ Cinco migraciones aplicadas contra la base real (inicial, la de `Stage`, la
  del índice `(organizationId, pipelineId)` en `Opportunity`, la del índice
  `authorId` en `Activity`, y la de `Invitation` + `User.deletedAt`) — el schema
  está sincronizado con Supabase (`prisma migrate status` verificado).
- ✅ `manual_constraints.sql` aplicado y verificado contra la base (2 triggers de
  sync de email, 4 `CHECK` constraints, 7 índices únicos parciales — los 4 de
  `Stage`, el fix de `pipelines_org_default_unique`, `contacts_org_email_unique`,
  y `invitations_org_email_pending_unique`).
- ✅ `prisma/sql/rls_policies.sql` aplicado y verificado: Row Level Security
  habilitado en las 10 tablas de negocio (incluida `invitations`), con políticas de
  aislamiento por `organization_id` uniformes en todas (la de `stages` se
  simplificó al agregarle `organizationId` propio — ya no necesita el join a
  `pipelines` que tenía antes) — ver sección 5 de `authentication-architecture.md`
  para la justificación de por qué es una defensa secundaria, no la principal.
  Reverificado empíricamente vía queries read-only directas contra la base (no
  asumido): el rol de conexión de Prisma (`postgres`) efectivamente tiene
  `bypassrls = true`.
- ✅ Seed inicial del catálogo `Role` (`ADMIN`, `USER`) vía `prisma/seed.ts`
  (`npm run prisma:seed`), idempotente.

**Backend**
- ✅ Scaffold de Express + patrón de tres capas (controllers/services/repositories).
- ✅ Infraestructura de autenticación (middleware `authenticate` + `authorize`) —
  montada sobre rutas reales (`/api/companies`), verificada contra logins reales.
- ✅ `POST /api/onboarding` — único registro público del sistema. Ver detalle en
  `docs/authentication-architecture.md` sección 1.
- ✅ **Módulo `Company` completo** — primer módulo de negocio del CRM, módulo de
  referencia. CRUD + soft delete + listado paginado con búsqueda por nombre, filtro
  por industria y por `ownerId`, y ordenamiento. `organizationId` siempre desde
  `req.auth`, nunca del cliente. `ownerId` opcional (default: quien crea) validado
  contra la misma organización y `isActive`. Lectura con `authenticate`, escritura
  con `authenticate` + `authorize("ADMIN")`.
- ✅ **Módulo `Contact` completo** — mismo patrón exacto que `Company` (mismo
  esqueleto de repository/service/controller/routes). Además: `companyId` opcional
  validado (existe, misma organización, no eliminada — reutiliza
  `findCompanyById` de `company.repository.ts` sin duplicar lógica), `ownerId`
  reutiliza `resolveOwnerId` ahora extraído a `src/services/ownership.service.ts`
  (compartido con `Company`), búsqueda global (`search`, OR entre
  firstName/lastName/email) combinable con filtros específicos
  (`firstName`/`lastName`/`email`/`companyId`/`ownerId`/`lifecycleStage`/`source`)
  en AND, y email normalizado a minúsculas antes de guardar para que la constraint
  de unicidad `contacts_org_email_unique` (ya existente en la base) detecte
  duplicados sin importar mayúsculas — violaciones de esa constraint se traducen a
  `409`, no a un `500` crudo.
- ✅ **Módulos `Pipeline` y `Stage` completos** — dejan el terreno listo para que
  `Opportunity` se construya sobre ellos. `Pipeline`: `isDefault` con auto-swap
  (desmarca el anterior antes de marcar el nuevo, nunca al revés, para no violar el
  índice único ni por un instante), no se puede borrar el último pipeline activo de
  la organización, y al borrar el default se auto-promueve el más antiguo restante.
  `Stage`: `organizationId` propio (agregado en este módulo), `pipelineId` validado
  contra la organización (reutiliza `findPipelineById`), `probability` 0–100, a lo
  sumo una etapa ganada y una perdida por pipeline (`409` si se repite), nombre único
  por pipeline, y **reordenamiento automático** sin huecos ni duplicados al crear
  (inserta y corre a los siguientes), actualizar `order` (reindexado en dos fases
  dentro de una transacción), o borrar (cierra el hueco) — ver
  `src/repositories/stage.repository.ts`.
- ✅ **Módulo `Opportunity` completo** — cierra el ciclo de ventas sobre
  `Pipeline`/`Stage`. Valida `companyId`/`contactId`/`pipelineId`/`stageId`/
  `ownerId` contra la organización reutilizando los repositories de esas
  entidades (mismo criterio que `Contact` con `companyId`), exige `companyId` y/o
  `contactId`, exige que el `stageId` pertenezca al `pipelineId`, y si el `PATCH`
  cambia `pipelineId` exige que también se envíe `stageId`. `currency` validado
  como ISO 4217 de 3 letras sin enum en Prisma. Soft delete, filtros por
  `companyId`/`contactId`/`ownerId`/`pipelineId`/`stageId`/`status`/`currency`/
  rango de `amount`, búsqueda por `title`, orden por `createdAt`/`updatedAt`/
  `amount`/`title`. Lectura con `authenticate`, escritura con `authenticate` +
  `authorize("ADMIN")`. Verificado con una batería de pruebas end-to-end contra un
  proyecto real de Supabase (CRUD, relaciones cruzadas, aislamiento multi-tenant,
  seguridad, filtros, regresión de los demás módulos) — datos de prueba limpiados
  al finalizar, sin residuos en la base.
- ✅ **Módulo `Activity` completo** — cierra el conjunto de entidades de negocio
  del modelo de datos actual. `authorId` sale exclusivamente de `req.auth.userId`
  (no existe en ningún schema de Zod, no se puede enviar ni modificar). `assigneeId`
  opcional, validado con `findUserByIdInOrganization` (existe, misma organización,
  activo) sin el default "asigna a quien crea" de `resolveOwnerId` — queda `null`
  si no se especifica. Exige `companyId`/`contactId`/`opportunityId` (al menos
  una), revalidado en cada `PATCH` contra el estado final (registro actual +
  claves presentes en el body, distinguiendo ausente de `null` explícito) para que
  nunca pueda quedar sin ninguna relación. `dueDate`/`completedAt`/`body` y las
  tres relaciones se pueden limpiar con `null` explícito en `PATCH` sin caer en el
  bug de `z.coerce.date()` → `1970-01-01` que se corrigió en `Opportunity`. `type`
  usa `z.nativeEnum(ActivityType)` sobre el enum real de Prisma. Filtros por
  `type`/`authorId`/`assigneeId`/`companyId`/`contactId`/`opportunityId`/rango de
  `dueDate`/rango de `completedAt` (con validación de que el límite inferior no
  sea posterior al superior), búsqueda `search` con `OR` entre `subject`/`body`,
  orden por `createdAt`/`updatedAt`/`dueDate`/`completedAt`/`subject`. Soft
  delete. `@@index([authorId])` agregado (única FK a `User` de la entidad que no
  tenía índice propio). Lectura con `authenticate`, escritura con `authenticate` +
  `authorize("ADMIN")`. Verificado con una batería de pruebas end-to-end contra un
  proyecto real de Supabase — datos de prueba limpiados al finalizar, sin residuos
  en la base.
- ✅ **Módulo `Invitation` completo** — ver sección 4 para el detalle del modelo
  y el mecanismo de compare-and-swap. `POST/GET /api/invitations` y
  `DELETE /api/invitations/:id` ADMIN-only (lectura incluida — a diferencia del
  resto de los módulos, expone emails de gente que todavía no es miembro).
  `POST /api/invitations/accept` no pasa por `authenticate` (ver sección 4).
  Verificado end-to-end contra Supabase real, incluidas las tres carreras
  concurrentes reales con `Promise.all` (crear vs. crear, aceptar vs. aceptar,
  aceptar vs. revocar, esta última observada empíricamente en ambos sentidos).
- ✅ **Administración acotada de `User`** — `GET /api/users` (roster, excluye
  removidos por defecto), `PATCH /api/users/:id` (únicamente `isActive`/`role`,
  no un editor genérico — `email`/`id`/`organizationId`/`deletedAt` no son
  campos de ese schema), `DELETE /api/users/:id` (soft delete: `deletedAt` +
  `isActive: false` en la misma escritura, sin tocar Supabase Auth — reversible
  de ese lado, pero sin undelete de nuestro lado en este bloque). Bloquea
  auto-modificación (`targetUserId === req.auth.userId`) y dejar a la
  organización sin ningún `ADMIN` activo (`countActiveAdmins`, mismo patrón que
  la protección del último `Pipeline` activo). `findUserByIdInOrganization`
  (usada por `resolveOwnerId` y `validateAssigneeId`) excluye
  `deletedAt != null` además de exigir `isActive`.

**Frontend**
- ❌ No existe ningún código de frontend en este repositorio.

**Autenticación**
- ✅ Diseño de sincronización de email (`auth.users` ↔ `public.users`) implementado en
  SQL.
- ✅ Middleware de verificación de JWT (`src/middlewares/authenticate.ts`) — valida
  firma/expiración contra el JWKS público de Supabase (`jose`, ES256; no
  `SUPABASE_JWT_SECRET`/HS256 como en la implementación original — ver
  `authentication-architecture.md` sección 4 para el detalle de la corrección),
  resuelve el usuario contra Postgres, rechaza usuario inexistente/desactivado/
  organización eliminada. **Verificado contra logins reales de Supabase**, no solo
  contra tokens fabricados a mano.
- ✅ Middleware de autorización por rol (`src/middlewares/authorize.ts`), montado en
  las rutas de escritura de `Company`.
- ✅ Onboarding inicial (`POST /api/onboarding`, `src/services/onboarding.service.ts`)
  — crea `Organization` + `User` ADMIN + identidad en Supabase Auth como una única
  operación lógica, verificado contra la base real (auth.users, public.users,
  Organization, Role consistentes; idempotente ante email/organización duplicados;
  sin datos huérfanos ante fallos, con compensación automática). Implementado como
  endpoint de backend, no como trigger de DB — ver el cambio de diseño documentado en
  `authentication-architecture.md` sección 1.
- ❌ Sin endpoint de login (el login en sí no pasa por Express — ver sección 3 de
  `authentication-architecture.md` — pero no hay nada de frontend todavía que lo
  ejercite).
- ✅ Invitación de usuarios (`Invitation` en `schema.prisma`, módulo completo —
  ver arriba). El diseño original de `authentication-architecture.md` sección 2
  asumía un trigger `AFTER INSERT ON auth.users` para el flujo de onboarding
  (sección 1) que **nunca se implementó** (onboarding quedó orquestado desde el
  backend, no desde un trigger) — la sección 2 de ese documento fue corregida
  para reflejar el diseño real de `Invitation` sobre esa base.

**API**
- ✅ `POST /api/onboarding` (público).
- ✅ `Company`: `POST/GET/GET :id/PATCH/DELETE /api/companies` (protegidos).
- ✅ `Contact`: `POST/GET/GET :id/PATCH/DELETE /api/contacts` (protegidos).
- ✅ `Pipeline`: `POST/GET/GET :id/PATCH/DELETE /api/pipelines` (protegidos).
- ✅ `Stage`: `POST/GET/GET :id/PATCH/DELETE /api/stages` (protegidos).
- ✅ `Opportunity`: `POST/GET/GET :id/PATCH/DELETE /api/opportunities` (protegidos).
- ✅ `Activity`: `POST/GET/GET :id/PATCH/DELETE /api/activities` (protegidos).
- ✅ `Invitation`: `POST/GET /api/invitations`, `DELETE /api/invitations/:id`
  (ADMIN-only), `POST /api/invitations/accept` (JWT de Supabase, sin `authenticate`
  estándar — ver sección 4).
- ✅ `User`: `GET /api/users`, `PATCH /api/users/:id`, `DELETE /api/users/:id`
  (ADMIN-only, administración acotada — ver arriba).

**Seguridad**
- ✅ `.env` correctamente excluido de git; `SUPABASE_SERVICE_ROLE_KEY` documentada
  explícitamente como "solo backend, nunca exponer al cliente ni commitear".
- ✅ Integridad de datos reforzada a nivel DB (`CHECK` constraints, índices únicos
  parciales), verificada contra la base real.
- ✅ Row Level Security habilitado en las 10 tablas de negocio
  (`prisma/sql/rls_policies.sql`) — defensa **secundaria**, no reemplaza la
  disciplina de filtrar por `organizationId` en Prisma (ver sección 5 de
  `authentication-architecture.md`; Prisma se conecta con un rol equivalente a
  `service_role`, que tiene `BYPASSRLS`, así que estas políticas no protegen el
  path de Express).
- ✅ Redacción de datos sensibles en logs (`src/lib/logger.ts`, `redact` de
  `pino`) — el `Authorization` y `Cookie` del request, y el `Set-Cookie` de la
  respuesta, nunca se escriben completos en los logs automáticos de
  request/response de `pino-http`, en dev y en producción por igual.
  Reproducido y verificado con un token real de Supabase (login real +
  request autenticado), no solo con un token de prueba armado a mano.

---

## 8. Próximos pasos recomendados

Orden de dependencia real. Los pasos que ya se completaron (git, `npm install`,
scaffold de Express, middleware de auth, provisionar Supabase, migración inicial,
`manual_constraints.sql`, RLS, seed de roles, endpoint de onboarding, módulos
`Company`, `Contact`, `Pipeline`, `Stage`, `Opportunity`, `Activity`, `Invitation`
y administración acotada de `User`, corrección JWT ES256) se sacaron de esta
lista — quedan documentados en la sección 7. Con `Invitation`/`User` cerrado, no
queda ningún módulo CRUD pendiente del modelo de datos actual.

1. **Configurar SMTP propio en el proyecto de Supabase** (Dashboard →
   Authentication → Email/SMTP Settings, con un proveedor tipo Resend/Postmark/
   SendGrid). El servicio de email por defecto de Supabase tiene un rate limit
   muy bajo a nivel de todo el proyecto — se confirmó empíricamente durante la
   verificación E2E de `Invitation` (`over_email_send_rate_limit`, `429`, tras
   apenas un puñado de invitaciones reales en poco tiempo). No es un bug del
   código: es una limitación de configuración externa que hay que resolver antes
   de usar `Invitation` con usuarios reales en producción.

2. **Rate limiting a nivel de Express.** No existe ningún middleware de rate
   limiting en `src/app.ts` — `POST /api/onboarding` (público) y
   `POST /api/invitations/accept` quedan sin protección de tasa propia (más allá
   de lo que Supabase límite en su propio servicio de email).

3. **Investigar la magnitud de latencia observada bajo escrituras condicionales
   concurrentes.** Durante la verificación de las carreras de `Invitation` se
   necesitó una ventaja de despacho de ~1000ms para que `revokeInvitation`
   ganara una carrera contra `acceptInvitation` en este entorno — mucho mayor a
   lo que un único round-trip adicional (`authenticate` completo vs. la
   verificación liviana de `accept`) explicaría por sí solo. Sugiere contención
   en el pool de conexiones de Prisma bajo concurrencia real, no investigado a
   fondo — no bloquea la corrección de `Invitation` (las invariantes de datos se
   verificaron correctas en ambos sentidos), pero vale la pena entenderlo antes
   de asumir que el sistema escala bien bajo carga concurrente real.

4. **Entidad `Invitation`: la remoción/revocación no libera el email en
   Supabase.** Ver sección 9 — limitación real de la plataforma, no de este
   código.

5. **Frontend.** Sigue sin existir ningún código de frontend en este
   repositorio — es la pieza que falta para que el backend sea un producto
   entregable, no solo una API verificada.

---

## 9. Riesgos o puntos a vigilar

- **El aislamiento multi-tenant de las lecturas (`findMany`/`findFirst`/`count`) del
  path de Express sigue dependiendo 100% de que Prisma filtre bien por
  `organizationId`.** RLS ya está habilitado (`prisma/sql/rls_policies.sql`), pero es
  una defensa secundaria: el rol con el que Prisma se conecta
  (`postgres.<project-ref>`, vía `DATABASE_URL`) es equivalente al `service_role` de
  Supabase y tiene `BYPASSRLS`, así que esas políticas no se evalúan para ninguna
  query de este backend. Un endpoint futuro que se olvide el `where: { organizationId }`
  en una lectura, o una escritura tenant-scoped nueva que no reutilice los
  repositories existentes, siguen siendo un riesgo real de fuga de datos entre
  organizaciones — RLS protege otras superficies (Realtime, acceso directo desde el
  frontend, SQL editor), no esta. **Corregido para las escrituras existentes (M4,
  2026-07-12):** `update`/soft-delete de `Company`, `Contact`, `Pipeline`, `Stage`,
  `Opportunity`, `Activity`, `User`, y la revocación de `Invitation` ya no dependen
  solo del pre-check del service — el `WHERE` efectivo de la escritura en el
  repository exige `organizationId` (`pipelineId` en el reindexado interno de
  `Stage`), verificado con test de integración contra Postgres real
  (`src/repositories/tenant-isolation.integration-test.ts`). Mitigación pendiente
  para lecturas y para escrituras futuras: formalizar la capa de servicios/repository
  como regla de arquitectura, no como convención (ver recomendación 4 de
  `authentication-architecture.md`).

- **Verificar un flujo de autenticación solo con tokens fabricados a mano no prueba
  que funcione contra el proveedor real.** El middleware `authenticate` se dio por
  verificado en su propia tarea usando un JWT HS256 firmado con un secreto de
  prueba — pasó todos los tests, pero era HS256 y este proyecto de Supabase firma
  con ES256. El bug (imposible loguearse con un token real) recién se detectó al
  implementar `Company` y hacer el primer login real de punta a punta, dos tareas
  después. Ya corregido (`src/lib/jwt.ts` usa `jose` contra el JWKS de Supabase,
  ver `authentication-architecture.md` sección 4) — queda como lección de proceso:
  cualquier verificación de auth futura (invitaciones, cambio de contraseña) debe
  probarse contra un login real de Supabase, no solo contra tokens armados a mano.

- **Consistencia `auth.users`↔`public.users` sin transacción compartida.** Resuelto
  para el onboarding (ver `authentication-architecture.md` sección 1: creación
  ordenada + compensación con `admin.deleteUser` si la transacción de Prisma falla)
  y para `Invitation` (creación de la fila en Prisma antes de llamar a Supabase,
  hard delete si `inviteUserByEmail` falla — ver sección 4). El residual conocido
  y aceptado en ambos casos: si la llamada a Supabase tiene éxito pero la
  respuesta se pierde en la red antes de llegar al backend, no hay compensación
  posible — se resolvería con un mecanismo de reintento/reenvío explícito, fuera
  de alcance hasta ahora.

- **Asimetría en soft delete — resuelta para las entidades que la necesitaban.**
  `Stage` y `User` ya tienen `deletedAt` (`User` agregado en el módulo
  `Invitation`, con semántica distinta de `isActive` — ver sección 4). Queda
  `Role`, que sigue sin `deletedAt` — es un catálogo global sin ciclo de vida
  propio hoy, no motiva el mismo riesgo que `User`/`Stage` tenían.

- **Email de Supabase Auth único a nivel de todo el proyecto, no por
  organización — y no se libera al revocar/vencer una invitación.** Invitar un
  email que ya es identidad de Supabase (miembro de otra organización, u otra
  invitación en curso en cualquier organización) falla al llamar a
  `inviteUserByEmail`, traducido a `409`. Más importante: revocar o dejar vencer
  una `Invitation` **no** borra la identidad de `auth.users` que `inviteUserByEmail`
  ya creó — así que reinvitar ese mismo email más adelante (incluso a la misma
  organización) puede volver a fallar del lado de Supabase. No es un bug de este
  código: es la misma decisión deliberada de "no tocar Supabase Auth en
  operaciones reversibles de nuestro lado" aplicada consistentemente (mismo
  criterio que remover un `User` no borra su identidad de Supabase) — pero el
  efecto práctico (un email "quemado" tras una invitación revocada/vencida) no
  está resuelto ni tiene mitigación implementada todavía.

- **Rate limit de envío de email de Supabase — limitación externa confirmada
  empíricamente.** Ver sección 8, paso 1. No es un bug del código.

- **`accept`/`revoke` de `Invitation` sin `invitationId` explícito puede devolver
  `404`/`400` en vez del `409`/`410` más específico, si la invitación ya no está
  `PENDING` en el momento exacto de la lectura.** Descubierto durante la
  verificación de las carreras concurrentes: el camino "sin `invitationId`" busca
  únicamente entre invitaciones `PENDING` (`findPendingInvitationsByEmail` /
  chequeo de estado antes del compare-and-swap) — cualquier invitación que ya
  transicionó fuera de `PENDING` antes de esa lectura (por la propia carrera, o
  simplemente porque ya se resolvió hace rato) se vuelve invisible para esa
  búsqueda y da un error genérico en vez del específico. **No es una violación de
  ninguna invariante de datos** (nunca hay dos ganadores, nunca un `500`, nunca un
  `User` huérfano — verificado en 30+ carreras reales) — es una imprecisión de UX
  acotada al camino de conveniencia. Con `invitationId` explícito (uso recomendado,
  y el único camino real cuando el cliente ya sabe cuál invitación está
  aceptando/revocando) el error siempre es el específico y correcto. No se corrigió
  en este ciclo — requeriría decidir qué invitación histórica referenciar en el
  caso ambiguo, una pregunta de diseño no discutida todavía.

- **Las constraints SQL manuales y las políticas de RLS no están versionadas junto
  con las migraciones de Prisma.** Tanto `manual_constraints.sql` como
  `prisma/sql/rls_policies.sql` se aplicaron a mano una vez
  (`prisma db execute --file ... --url "$DIRECT_URL"`), verificado que existen en la
  base real. Si alguien genera una migración nueva que toque estas tablas y se
  olvida de reaplicar alguno de los dos `.sql`, la base queda sin esas protecciones
  silenciosamente, porque Prisma no se queja de que falten. Automatizarlo (script
  npm o hook post-migración, ver paso 4 de sección 8) mitiga esto.

- **"MVP: un pipeline por organización" vs. el modelo ya permite múltiples.** El
  comentario en el schema y el modelo de datos no están alineados 1:1 — si la UI
  eventualmente expone crear varios pipelines, no hace falta migrar nada, pero
  conviene que quede claro en el producto si eso es una feature planeada o un efecto
  secundario del modelo.

- **Cero tests, cero linter/formatter.** A medida que crezca el backend, introducir
  estas herramientas después es más caro (hay que adaptar código ya escrito) que
  configurarlas desde el arranque de `src/`.

---

## 10. Documentación

Este archivo (`docs/project-overview.md`) es la documentación de referencia completa y
autosuficiente del proyecto a la fecha indicada arriba. Cubre objetivo de producto,
stack, estructura, modelo de datos completo, decisiones de arquitectura, el flujo de
autenticación diseñado (marcando explícitamente qué partes son código real vs. diseño
pendiente de implementar), estado actual desglosado por área, próximos pasos
priorizados por dependencia real, y riesgos conocidos.

**Cómo mantenerlo actualizado**: cada vez que se tome una decisión de arquitectura
nueva (ej. cómo se crea `public.users`, si se activa RLS), o se implemente una de las
secciones marcadas como 🧭/❌ en este documento, actualizar la sección correspondiente
en el mismo commit que introduce el cambio — así este archivo nunca queda
desincronizado del código real.
