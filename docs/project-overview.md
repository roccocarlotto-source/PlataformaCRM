# Plataforma CRM — Project Overview

> Última actualización: 2026-07-10.
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
| **Prisma ORM 5.20** (`@prisma/client`, `prisma`) | Acceso a datos type-safe + migraciones | Es la única capa de aplicación que existe hoy: `prisma/schema.prisma` define 7 modelos. Scripts en `package.json`: `prisma:generate`, `prisma:validate`, `prisma:studio`. |
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
│   ├── schema.prisma               # 7 modelos + 3 enums (ver sección 4).
│   ├── seed.ts                     # Seed idempotente del catálogo Role (ADMIN/USER).
│   ├── migrations/20260710203208_init/  # Migración inicial, aplicada a la base real.
│   └── sql/
│       ├── manual_constraints.sql   # Triggers de sync de email, constraints manuales.
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
    │                                 #   (parseOrThrow), slug.ts.
    ├── middlewares/                 # notFound.ts, errorHandler.ts, authenticate.ts,
    │                                 #   authorize.ts.
    ├── controllers/                 # onboarding.controller.ts, company.controller.ts.
    ├── services/                    # auth.service.ts, onboarding.service.ts,
    │                                 #   company.service.ts.
    ├── repositories/                # user.repository.ts, organization.repository.ts,
    │                                 #   role.repository.ts, company.repository.ts —
    │                                 #   ver README.md para el patrón de tres capas.
    ├── routes/                      # health.routes.ts (sin prefijo), index.ts
    │                                 #   agregador, onboarding.routes.ts y
    │                                 #   company.routes.ts (bajo /api).
    ├── app.ts                       # arma Express, no escucha puerto.
    └── server.ts                    # entry point + graceful shutdown.
```

Detalle carpeta por carpeta (propósito, qué va en cada una) en `README.md` — no se
duplica acá para no tener dos fuentes de verdad que se puedan desincronizar.

**Lo que sigue faltando:**
- `Contact`, `Opportunity`, `Activity` — mismo patrón que `Company`, todavía no
  implementados.
- Endpoints de login/invitación de usuarios (dependen de la entidad `Invitation`,
  ver sección 8).

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
  No tiene `deletedAt` (asimetría respecto a otras entidades, ver [riesgos](#9-riesgos-o-puntos-a-vigilar)).

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
- **Propósito**: proceso de ventas de una organización.
- **Relaciones**: pertenece a `Organization`. Tiene `Stage[]` y `Opportunity[]`.
- **Decisiones importantes**: el comentario dice "MVP: uno por organización", pero **el
  modelo ya soporta múltiples pipelines por organización** (`@@unique([organizationId,
  name])`, no un único pipeline). `isDefault` con índice único parcial (`WHERE
  is_default = true`) garantiza a lo sumo un pipeline default por organización — esto
  es una decisión de modelo que anticipa multi-pipeline aunque el MVP no lo exponga
  todavía.

### `Stage`
- **Propósito**: etapa ordenada dentro de un `Pipeline` (ej. "Prospecto", "Negociación",
  "Cerrado ganado").
- **Relaciones**: pertenece a `Pipeline` (`onDelete: Cascade` — si se borra el pipeline,
  se borran sus etapas). Tiene `Opportunity[]`.
- **Decisiones importantes**: `probability` (probabilidad de cierre por etapa),
  `isWon`/`isLost` con `CHECK` constraint que impide que ambos sean `true` a la vez
  (`stages_won_lost_exclusive_check`, en `manual_constraints.sql`). Único
  `(pipelineId, order)` y `(pipelineId, name)`. **No tiene `deletedAt`** (soft delete
  no aplica aquí — ver riesgos).

### `Opportunity`
- **Propósito**: una venta en curso (deal).
- **Relaciones**: pertenece a `Organization`, `Pipeline`, `Stage`, tiene un `owner`
  obligatorio (`User`), y opcionalmente una `Company` y/o `Contact`. Tiene
  `Activity[]`.
- **Decisiones importantes**: `CHECK (company_id IS NOT NULL OR contact_id IS NOT
  NULL)` — una oportunidad necesita estar ligada a al menos una empresa o un contacto
  (`opportunities_company_or_contact_check`). `CHECK (amount >= 0)`
  (`opportunities_amount_non_negative_check`). `status` enum `OPEN/WON/LOST` con
  `lostReason` opcional. Soft delete.

### `Activity`
- **Propósito**: registro unificado de cualquier interacción — llamada, reunión, email,
  tarea o nota (`enum ActivityType`).
- **Relaciones**: pertenece a `Organization`, tiene un `author` obligatorio (`User`) y
  un `assignee` opcional (`User`). Opcionalmente ligada a `Company`, `Contact` y/o
  `Opportunity`.
- **Decisiones importantes**: **un solo modelo para 5 tipos de interacción** en vez de
  5 tablas separadas — trade-off consciente: menos duplicación de esquema, a costa de
  columnas que solo aplican a algunos tipos (`dueDate`/`completedAt` tienen sentido
  para `TASK`, menos para `NOTE`). `CHECK` que exige que esté ligada a *al menos* una
  de `Company`/`Contact`/`Opportunity` (`activities_related_entity_check`). Soft
  delete.

### Enums
- `ActivityType`: `CALL | MEETING | EMAIL | TASK | NOTE`
- `LifecycleStage`: `LEAD | MQL | SQL | CUSTOMER | CHURNED`
- `OpportunityStatus`: `OPEN | WON | LOST`

---

## 5. Decisiones de arquitectura tomadas

- **Multi-tenant por columna (`organizationId`), no schema-per-tenant ni
  DB-per-tenant.** Todas las tablas de negocio llevan `organization_id` y lo indexan.
  Es el enfoque más simple de operar (un solo schema, una sola migración para todos los
  tenants) pero **hoy el aislamiento entre organizaciones depende 100% de que el código
  de aplicación filtre correctamente por `organizationId` en cada query** — no hay
  Row Level Security (RLS) de Postgres visible en el repo todavía (ver
  [riesgos](#9-riesgos-o-puntos-a-vigilar)).

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
  `Organization`, `Company`, `Contact`, `Pipeline`, `Opportunity`, `Activity` lo tienen;
  `User`, `Role`, `Stage` no. No hay documentación en el repo de si esto es intencional
  o un pendiente — está marcado como punto a vigilar en la sección 9.

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
- ✅ `schema.prisma` completo: 7 modelos, 3 enums, relaciones, índices.
- ✅ Migración inicial generada y aplicada (`prisma/migrations/20260710203208_init`)
  — el schema ya está sincronizado con la base real de Supabase.
- ✅ `manual_constraints.sql` aplicado y verificado contra la base (2 triggers de
  sync de email, 4 `CHECK` constraints, 2 índices únicos parciales).
- ✅ `prisma/sql/rls_policies.sql` aplicado y verificado: Row Level Security
  habilitado en las 9 tablas de negocio, con políticas de aislamiento por
  `organization_id` (ver sección 5 de `authentication-architecture.md` para la
  justificación de por qué es una defensa secundaria, no la principal).
- ✅ Seed inicial del catálogo `Role` (`ADMIN`, `USER`) vía `prisma/seed.ts`
  (`npm run prisma:seed`), idempotente.

**Backend**
- ✅ Scaffold de Express + patrón de tres capas (controllers/services/repositories).
- ✅ Infraestructura de autenticación (middleware `authenticate` + `authorize`) —
  montada sobre rutas reales (`/api/companies`), verificada contra logins reales.
- ✅ `POST /api/onboarding` — único registro público del sistema. Ver detalle en
  `docs/authentication-architecture.md` sección 1.
- ✅ **Módulo `Company` completo** — primer módulo de negocio del CRM, pensado como
  referencia para `Contact`/`Opportunity`/`Activity`. CRUD + soft delete + listado
  paginado con búsqueda por nombre, filtro por industria y por `ownerId`, y
  ordenamiento. `organizationId` siempre desde `req.auth`, nunca del cliente.
  `ownerId` opcional (default: quien crea) validado contra la misma organización y
  `isActive`. Lectura con `authenticate`, escritura con `authenticate` +
  `authorize("ADMIN")`. Ver `src/services/company.service.ts`,
  `src/repositories/company.repository.ts`,
  `src/controllers/company.controller.ts`.
- ❌ `Contact`, `Opportunity`, `Activity`, invitaciones — todavía no implementados.

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
- ❌ Sin invitación de usuarios — depende de la entidad `Invitation`, todavía no
  agregada a `schema.prisma` (propuesta en la sección 2 del doc de arquitectura).

**API**
- ✅ `POST /api/onboarding` (público).
- ✅ `Company`: `POST/GET/GET :id/PATCH/DELETE /api/companies` (protegidos).
- ❌ `Contact`, `Opportunity`, `Activity` — todavía no implementados.

**Seguridad**
- ✅ `.env` correctamente excluido de git; `SUPABASE_SERVICE_ROLE_KEY` documentada
  explícitamente como "solo backend, nunca exponer al cliente ni commitear".
- ✅ Integridad de datos reforzada a nivel DB (`CHECK` constraints, índices únicos
  parciales), verificada contra la base real.
- ✅ Row Level Security habilitado en las 9 tablas de negocio
  (`prisma/sql/rls_policies.sql`) — defensa **secundaria**, no reemplaza la
  disciplina de filtrar por `organizationId` en Prisma (ver sección 5 de
  `authentication-architecture.md`; Prisma se conecta con un rol equivalente a
  `service_role`, que tiene `BYPASSRLS`, así que estas políticas no protegen el
  path de Express).

---

## 8. Próximos pasos recomendados

Orden de dependencia real. Los pasos que ya se completaron (git, `npm install`,
scaffold de Express, middleware de auth, provisionar Supabase, migración inicial,
`manual_constraints.sql`, RLS, seed de roles, endpoint de onboarding, módulo
`Company`, corrección JWT ES256) se sacaron de esta lista — quedan documentados en
la sección 7.

1. **Implementar `Contact` y `Opportunity` siguiendo el patrón de `Company`**
   (`src/repositories/company.repository.ts`,
   `src/services/company.service.ts`, `src/controllers/company.controller.ts` como
   referencia directa) — mismo criterio de `organizationId` desde `req.auth`,
   soft delete, paginación/búsqueda/filtro/orden, `authorize("ADMIN")` solo en
   escritura. `Opportunity` va a necesitar además validar `pipelineId`/`stageId`
   contra la organización, y el `CHECK` de company_id/contact_id ya existente en
   la base.

2. **Agregar al schema lo que `authentication-architecture.md` ya dejó pedido**:
   `deletedAt` en `User` (sección 8, recomendación 2 de ese doc) y la entidad
   `Invitation` (sección 2). Son cambios de schema chicos y ya diseñados — al ser una
   migración nueva sobre una base que ya tiene datos, conviene revisar que no rompa
   nada existente, pero no hay bloqueante técnico.

3. **Implementar el flujo de invitación de usuarios** (sección 2 de
   `authentication-architecture.md`): endpoint para que un `ADMIN` invite
   (`authenticate` + `authorize("ADMIN")`, ya construidos y verificados contra
   endpoints reales), usando `supabaseAdmin.auth.admin.inviteUserByEmail`, y el
   endpoint de aceptación que crea `public.users` a partir de la `Invitation`.
   Depende del paso 2 (la tabla `Invitation`).

4. **Automatizar la reaplicación de `manual_constraints.sql` y `rls_policies.sql`
   tras futuras migraciones.** Hoy ambos se aplicaron a mano una vez
   (`prisma db execute --file ... --url "$DIRECT_URL"`) — si se genera una migración
   nueva que altere estas tablas, hay que recordar reaplicarlos. Un script npm
   (`db:post-migrate`, por ejemplo) que corra los dos archivos en orden evitaría que
   alguien se olvide.

---

## 9. Riesgos o puntos a vigilar

- **El aislamiento multi-tenant del path de Express sigue dependiendo 100% de que
  Prisma filtre bien por `organizationId`.** RLS ya está habilitado
  (`prisma/sql/rls_policies.sql`), pero es una defensa secundaria: el rol con el que
  Prisma se conecta (`postgres.<project-ref>`, vía `DATABASE_URL`) es equivalente al
  `service_role` de Supabase y tiene `BYPASSRLS`, así que esas políticas no se
  evalúan para ninguna query de este backend. Un endpoint futuro que se olvide el
  `where: { organizationId }` sigue siendo un riesgo real de fuga de datos entre
  organizaciones — RLS protege otras superficies (Realtime, acceso directo desde el
  frontend, SQL editor), no esta. Mitigación ya identificada: formalizar la capa de
  servicios como regla de arquitectura, no como convención (ver recomendación 4 de
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
  ordenada + compensación con `admin.deleteUser` si la transacción de Prisma falla),
  pero sigue siendo un patrón a repetir con cuidado — el flujo de invitación
  (próximo paso) va a tener el mismo problema de dos sistemas sin transacción
  compartida, y ya está resuelto en el diseño (sección 2) con un orden de
  operaciones análogo.

- **Asimetría en soft delete.** `Organization`, `Company`, `Contact`, `Pipeline`,
  `Opportunity`, `Activity` tienen `deletedAt`; `User`, `Role`, `Stage` no. No hay
  documentación de si es intencional. Si en algún momento hay que "desactivar" un
  usuario o reordenar/eliminar una etapa de pipeline sin perder el historial de
  oportunidades que la referencian, hoy no hay mecanismo — vale la pena decidirlo
  explícitamente antes de que haya datos reales en producción.

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
