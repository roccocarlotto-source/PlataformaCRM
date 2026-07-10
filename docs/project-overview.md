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
| **Supabase** (Auth + Postgres hosting) | Autenticación gestionada + hosting de la DB | `.env.example` documenta `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`. El modelo `User` está diseñado para compartir `id` con `auth.users` (tabla gestionada por Supabase). |
| **PgBouncer** | Pooling de conexiones para runtime | `.env.example` distingue `DATABASE_URL` (puerto 6543, `?pgbouncer=true`, la usa la app) de `DIRECT_URL` (puerto 5432, solo para `prisma migrate`) — patrón estándar de Supabase + Prisma, porque Prisma Migrate no funciona bien a través de PgBouncer en modo transacción. |
| **dotenv** | Carga de variables de entorno | Dependencia declarada en `package.json`. |
| **SQL manual** (`prisma/sql/manual_constraints.sql`) | Constraints/triggers que Prisma no soporta nativamente | Prisma no expresa índices únicos parciales (`WHERE`), `CHECK` constraints ni triggers en el DSL de `schema.prisma` — se completan a mano. |
| **Express 4** | Framework HTTP del backend | `src/app.ts` — middlewares estándar (helmet, cors, compression), manejo de errores centralizado, health check. Ver `README.md` para el detalle de cada carpeta de `src/`. |
| **pino** / **pino-http** | Logging estructurado | `src/lib/logger.ts` — JSON en producción, `pino-pretty` en desarrollo. |
| **zod** | Validación de `process.env` al arrancar | `src/config/env.ts` — falla rápido y claro si falta una variable requerida. |
| **jsonwebtoken** | Verificación del JWT emitido por Supabase Auth | `src/lib/jwt.ts` — valida firma (HS256, `SUPABASE_JWT_SECRET`) y expiración; no emite tokens propios. |

**Lo que todavía NO está en el stack**:
- Ningún framework de frontend.
- Ningún framework de testing.
- Ningún linter/formatter (ESLint, Prettier).
- Nada de Supabase en runtime real todavía — el proyecto de Supabase sigue sin
  provisionar (ver sección 7).

---

## 3. Estructura del proyecto

```
Plataforma CRM/
├── .env / .env.example           # Variables de entorno. LOG_LEVEL agregado; las de
│                                  #   Supabase/DB siguen vacías (no provisionado).
├── .gitignore
├── package.json                  # Scripts dev/build/start + los tres de Prisma.
├── tsconfig.json                 # strict, rootDir "src".
├── README.md                     # Quickstart + explicación de cada carpeta de src/.
├── prisma/
│   ├── schema.prisma              # 7 modelos + 3 enums (ver sección 4).
│   └── sql/manual_constraints.sql # Triggers de sync de email, constraints manuales.
└── src/
    ├── config/env.ts               # Validación de process.env con zod.
    ├── lib/                        # prisma.ts (singleton), logger.ts (pino),
    │                                #   jwt.ts (verifica JWT de Supabase).
    ├── types/auth.ts                # RoleName, JwtPayload, AuthContext,
    │                                 #   AuthenticatedRequest, ampliación de Express.Request.
    ├── utils/                       # AppError.ts, asyncHandler.ts.
    ├── middlewares/                 # notFound.ts, errorHandler.ts, authenticate.ts,
    │                                 #   authorize.ts.
    ├── controllers/ services/ repositories/  # patrón de tres capas — ver README.md.
    ├── routes/                      # health.routes.ts + index.ts agregador.
    ├── app.ts                       # arma Express, no escucha puerto.
    └── server.ts                    # entry point + graceful shutdown.
```

Detalle carpeta por carpeta (propósito, qué va en cada una) en `README.md` — no se
duplica acá para no tener dos fuentes de verdad que se puedan desincronizar.

**Lo que ya no falta** (corrigiendo esta sección, desactualizada desde la tarea de
scaffold): `src/` existe y compila, `git init` ya se corrió (primer commit hecho),
`node_modules/` está instalado, `README.md` existe.

**Lo que sigue faltando:**
- No existe `prisma/migrations/` — el schema nunca se aplicó a una base de datos real
  (bloqueado por falta de un proyecto de Supabase provisionado, ver sección 7).
- `src/controllers/` y `src/services/` (más allá de `auth.service.ts`) siguen vacíos
  — no hay ningún endpoint de negocio ni de auth todavía, solo la infraestructura
  reutilizable (`authenticate`/`authorize`).

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

**4. Emisión del JWT.** Supabase Auth firma un JWT con el secreto configurado en
`SUPABASE_JWT_SECRET` (documentado en `.env.example`, no completado todavía en `.env`).
El `sub` de ese JWT es el `id` de `auth.users`, que **es el mismo valor** que
`public.users.id`.

**5. Petición autenticada (✅ implementado).** El cliente (frontend, todavía
inexistente) debe enviar el JWT en cada request, típicamente
`Authorization: Bearer <token>`. El middleware (`src/middlewares/authenticate.ts`):
   a. Verifica la firma del JWT usando `SUPABASE_JWT_SECRET` (`src/lib/jwt.ts`). ✅
   b. Extrae el `sub` (= `id` de `public.users`). ✅
   c. Usa Prisma para buscar la fila de `public.users` con ese `id`, trayendo
      `organizationId` y `role` en el mismo query
      (`src/repositories/user.repository.ts`). ✅
   d. Adjunta ese contexto (usuario, organización, rol) al request
      (`req.auth`, tipado en `src/types/auth.ts`) para que el resto del handler lo
      use. ✅

   No hay ningún endpoint todavía que use este middleware — está listo y verificado
   (`401`/`403`/`500` según corresponda), a la espera del primer endpoint protegido.
   También existe `src/middlewares/authorize.ts` (autorización por rol, `ADMIN`/
   `USER`) para cuando haga falta restringir una ruta más allá de "estar
   autenticado".

**6. Scoping multi-tenant en cada query.** Con el `organizationId` del usuario
autenticado disponible, cada consulta Prisma en el handler debe filtrar explícitamente
por ese `organizationId` (`where: { organizationId }`) para respetar el aislamiento
entre tenants. **Hoy no hay Row Level Security de Postgres** que haga cumplir esto a
nivel de base — el aislamiento depende enteramente de que ese filtro se aplique bien en
cada endpoint futuro. Ver riesgo en sección 9.

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
         │ JWT firmado con SUPABASE_JWT_SECRET
         ▼
   Authorization: Bearer <token>
         │
         ▼
   Express middleware (🧭 no implementado)
   → verifica JWT → obtiene sub → Prisma.user.findUnique({ id: sub })
   → adjunta { user, organizationId, role } al request
```

---

## 7. Estado actual del proyecto

**Infraestructura**
- ✅ `.gitignore`, `.env.example` documentado, `tsconfig.json` en modo estricto.
- ✅ Git inicializado, primer commit hecho.
- ✅ Dependencias instaladas (`node_modules/`).
- ✅ Servidor Express completo: middlewares estándar, manejo de errores, logging,
  health check (`GET /health`, chequea conectividad real a la base).
- ❌ Proyecto de Supabase no provisionado: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `DATABASE_URL`, `DIRECT_URL`
  están todos vacíos en `.env` — sigue siendo el bloqueante real para probar nada de
  esto contra datos de verdad.

**Base de datos**
- ✅ `schema.prisma` completo: 7 modelos, 3 enums, relaciones, índices.
- ✅ `manual_constraints.sql` con triggers de sync de email y constraints de
  integridad, listo para aplicar.
- ❌ Ninguna migración generada ni aplicada (`prisma/migrations/` no existe) — el
  schema nunca tocó una base de datos real.
- ❌ Sin seed (no hay datos iniciales de `Role`, `Pipeline` default, etc.)
- ❌ Sin trigger/lógica que cree `public.users` al registrarse (ver sección 6).

**Backend**
- ✅ Scaffold de Express + patrón de tres capas (controllers/services/repositories).
- ✅ Infraestructura de autenticación (middleware `authenticate` + `authorize`, ver
  abajo) — reutilizable, no montada sobre ninguna ruta todavía.
- ❌ `src/controllers/` y `src/services/` (más allá de `auth.service.ts`) vacíos — sin
  endpoints de negocio.

**Frontend**
- ❌ No existe ningún código de frontend en este repositorio.

**Autenticación**
- ✅ Diseño de sincronización de email (`auth.users` ↔ `public.users`) implementado en
  SQL.
- ✅ Middleware de verificación de JWT (`src/middlewares/authenticate.ts`) — valida
  firma/expiración, resuelve el usuario contra Postgres, rechaza usuario inexistente/
  desactivado/organización eliminada. Ver detalle en
  `docs/authentication-architecture.md` sección 4.
- ✅ Middleware de autorización por rol (`src/middlewares/authorize.ts`).
- ❌ Sin flujo de creación de `public.users` tras signup (trigger de la sección 1 de
  `authentication-architecture.md` — sigue siendo diseño, no código).
- ❌ Sin endpoint de login, registro, ni invitación de usuarios.
- ❌ Sin la entidad `Invitation` en el schema (propuesta en la sección 2 del doc de
  arquitectura, todavía no agregada a `schema.prisma`).

**API**
- ❌ Cero endpoints de negocio — solo `GET /health` (infraestructura, no API de
  negocio).

**Seguridad**
- ✅ `.env` correctamente excluido de git; `SUPABASE_SERVICE_ROLE_KEY` documentada
  explícitamente como "solo backend, nunca exponer al cliente ni commitear".
- ✅ Integridad de datos reforzada a nivel DB (`CHECK` constraints, índices únicos
  parciales) — buena práctica defensiva ya presente aunque no haya ni una query
  todavía.
- ❌ Sin Row Level Security (RLS) de Postgres visible — el aislamiento multi-tenant
  dependerá 100% del código de aplicación una vez exista.

---

## 8. Próximos pasos recomendados

Orden de dependencia real (cada paso bloquea al siguiente). Los pasos que ya se
completaron (git, `npm install`, scaffold de Express, middleware de auth) se sacaron
de esta lista — quedan documentados en la sección 7.

1. **Provisionar el proyecto de Supabase real y completar `.env`.** Sigue siendo el
   bloqueante de todo lo demás: sin esto no se puede correr `prisma migrate dev`, ni
   probar el middleware de auth contra un usuario real, ni nada de lo que sigue.
   Crear el proyecto en supabase.com, copiar `DATABASE_URL` (pooled), `DIRECT_URL`
   (directa), `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SUPABASE_JWT_SECRET` desde el dashboard (`Settings > API`) al `.env` local.

2. **Agregar al schema lo que `authentication-architecture.md` ya dejó pedido**:
   `deletedAt` en `User` (sección 8, recomendación 2 de ese doc) y la entidad
   `Invitation` (sección 2). Son cambios de schema chicos y ya diseñados — conviene
   hacerlos en la misma migración inicial en vez de migrar dos veces.

3. **Generar la primera migración real y sembrar el catálogo `Role`.**
   `prisma migrate dev --name init` → aplicar `manual_constraints.sql` a
   continuación → seed con `ADMIN`/`USER` (el flujo de onboarding de la sección 1 de
   `authentication-architecture.md` depende de que esa fila exista antes del primer
   signup). Recomendación concreta ya señalada: agregar un script npm que aplique
   `manual_constraints.sql` automáticamente después de cada migración.

4. **Implementar el trigger `AFTER INSERT ON auth.users`** descripto en la sección 1
   de `authentication-architecture.md` (crea `Organization` + `User` ADMIN en el
   signup fundacional, rechaza cualquier otro insert sin invitación válida). Es lo
   único que falta para poder probar el middleware de autenticación ya construido
   contra un usuario real de punta a punta.

5. **Decidir si se activa Row Level Security (RLS) en Postgres.** Ya hay una
   recomendación concreta en `authentication-architecture.md` sección 5 (activarlo
   como red de seguridad secundaria, no como reemplazo del scoping por
   `organizationId` en Prisma). Definir antes de escribir el primer endpoint de
   negocio.

6. **Implementar el primer endpoint real usando `authenticate`/`authorize`** (por
   ejemplo, "aceptar invitación" de la sección 2, o el endpoint de signup fundacional
   de la sección 1) — el middleware ya está listo y verificado, falta la lógica de
   negocio que lo use.

---

## 9. Riesgos o puntos a vigilar

- **Aislamiento multi-tenant sin red de seguridad a nivel de base.** Todo el diseño
  actual asume que cada query de Prisma va a filtrar correctamente por
  `organizationId`. Sin RLS, un único endpoint futuro que se olvide de ese filtro
  puede filtrar datos entre organizaciones — en un CRM esto es un riesgo de seguridad
  crítico (fuga de datos de clientes entre empresas distintas). Recomendación: decidir
  RLS antes de escribir el primer endpoint (ver paso 5 de sección 8).

- **Falta el paso que crea `public.users` al registrarse.** Si se implementa mal (por
  ejemplo, solo desde el frontend sin trigger de base), un usuario podría autenticarse
  correctamente contra Supabase pero no tener fila en `public.users` — y cualquier
  request que dependa de `organizationId`/`role` fallaría o requeriría manejo especial
  de ese caso en cada endpoint.

- **Asimetría en soft delete.** `Organization`, `Company`, `Contact`, `Pipeline`,
  `Opportunity`, `Activity` tienen `deletedAt`; `User`, `Role`, `Stage` no. No hay
  documentación de si es intencional. Si en algún momento hay que "desactivar" un
  usuario o reordenar/eliminar una etapa de pipeline sin perder el historial de
  oportunidades que la referencian, hoy no hay mecanismo — vale la pena decidirlo
  explícitamente antes de que haya datos reales en producción.

- **Las constraints SQL manuales no están versionadas junto con las migraciones de
  Prisma.** `manual_constraints.sql` se debe reaplicar a mano después de cada
  `prisma migrate dev`. Si alguien genera una migración nueva y se olvida de correr
  el `.sql`, la base queda sin los `CHECK` constraints y los índices únicos parciales
  — silenciosamente, porque Prisma no se queja de que falten. Automatizarlo (script
  npm o hook post-migración) mitiga esto.

- **"MVP: un pipeline por organización" vs. el modelo ya permite múltiples.** El
  comentario en el schema y el modelo de datos no están alineados 1:1 — si la UI
  eventualmente expone crear varios pipelines, no hace falta migrar nada, pero
  conviene que quede claro en el producto si eso es una feature planeada o un efecto
  secundario del modelo.

- **Cero tests, cero linter/formatter.** A medida que crezca el backend, introducir
  estas herramientas después es más caro (hay que adaptar código ya escrito) que
  configurarlas desde el arranque de `src/`.

- **Repo sin `git init` y sin `README.md`.** Hasta que se resuelva el punto 2 de la
  sección 8, no hay historial de cambios ni forma de que un colaborador nuevo entienda
  el proyecto sin este documento.

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
