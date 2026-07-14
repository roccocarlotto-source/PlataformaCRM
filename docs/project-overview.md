# Plataforma CRM — Project Overview

> Última actualización: 2026-07-14.
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
| **Prisma ORM 5.20** (`@prisma/client`, `prisma`) | Acceso a datos type-safe + migraciones | Es la única capa de aplicación que existe hoy: `prisma/schema.prisma` define 10 modelos. Scripts en `package.json`: `prisma:generate`, `prisma:validate`, `prisma:studio`. |
| **PostgreSQL** | Motor de base de datos | `datasource db { provider = "postgresql" }` en el schema. |
| **Supabase** (Auth + Postgres hosting) | Autenticación gestionada + hosting de la DB | Proyecto real provisionado y conectado (`.env` completo). El modelo `User` está diseñado para compartir `id` con `auth.users` (tabla gestionada por Supabase). |
| **Supavisor** (pooler compartido de Supabase — no PgBouncer clásico; confirmado en LOW-2 contra la documentación oficial vigente de Supabase, sección 8) | Pooling de conexiones para runtime | `.env.example` distingue `DATABASE_URL` (mismo host `*.pooler.supabase.com`, puerto 6543, Supavisor en **modo transacción**, `?pgbouncer=true` — bandera correcta y soportada para ese modo, ver sección 8) de `DIRECT_URL` (mismo host, puerto 5432, Supavisor en **modo sesión** — no una conexión directa a Postgres, pese al nombre de la variable — solo para `prisma migrate`) — patrón estándar de Supabase + Prisma: Prisma Migrate no funciona bien a través del modo transacción. |
| **dotenv** | Carga de variables de entorno | Dependencia declarada en `package.json`. |
| **SQL manual** (`prisma/sql/manual_constraints.sql`) | Constraints/triggers que Prisma no soporta nativamente | Prisma no expresa índices únicos parciales (`WHERE`), `CHECK` constraints ni triggers en el DSL de `schema.prisma` — se completan a mano. |
| **Express 4** | Framework HTTP del backend | `src/app.ts` — middlewares estándar (helmet, cors, compression), manejo de errores centralizado, health check. Ver `README.md` para el detalle de cada carpeta de `src/`. |
| **pino** / **pino-http** | Logging estructurado | `src/lib/logger.ts` — JSON en producción, `pino-pretty` en desarrollo. |
| **zod** | Validación de `process.env` al arrancar | `src/config/env.ts` — falla rápido y claro si falta una variable requerida. |
| **jose** | Verificación del JWT emitido por Supabase Auth | `src/lib/jwt.ts` — valida firma contra el JWKS público del proyecto (`createRemoteJWKSet` + `jwtVerify`, ES256) y expiración; no emite tokens propios. Reemplazó a `jsonwebtoken`+`SUPABASE_JWT_SECRET` (HS256) cuando se descubrió, probando contra un login real, que este proyecto firma con clave asimétrica. |
| **@supabase/supabase-js** | Cliente de Supabase para operaciones administrativas | `src/lib/supabaseAdmin.ts` — únicamente con `service_role`, nunca la `anon` key (crear/borrar usuarios de `auth.users`). |

**Lo que todavía NO está en el stack del backend**:
- Ningún framework de testing (usa el runner nativo `node:test`, sin dependencia
  externa — ver sección 7).
- Ningún linter/formatter (ESLint, Prettier).

### Frontend (`frontend/`, M0 scaffold + M1 autenticación y sesión + M2 Company + M3 Contact + M4 Pipeline/Stage + M5 Opportunity)

| Tecnología | Rol | Por qué (evidencia en el repo) |
|---|---|---|
| **React** 19 / **React DOM** | UI | `frontend/package.json` — única librería de vista, sin framework de estado global adicional. |
| **TypeScript** (`strict: true`) | Lenguaje del frontend | `frontend/tsconfig.app.json` — mismo criterio de tipado estricto que el backend. |
| **Vite** | Build tool + dev server | `frontend/vite.config.ts` — puerto de dev `5173` por default, coincide con `CORS_ORIGIN` por defecto del backend (`.env.example`). |
| **React Router DOM** | Ruteo | `frontend/src/app/router.tsx` — `createBrowserRouter`: `/login` (`LoginPage`, M1), `/` protegida por `ProtectedRoute` → `AppLayout` (M2, todavía placeholder de M0 sin dashboard real), `/companies`, `/companies/new`, `/companies/:id/edit` (M2), `/contacts`, `/contacts/new`, `/contacts/:id/edit` (M3), `/pipelines`, `/pipelines/new`, `/pipelines/:id/edit`, `/pipelines/:pipelineId/stages`, `/pipelines/:pipelineId/stages/new`, `/pipelines/:pipelineId/stages/:stageId/edit` (M4 — las 4 rutas de escritura comparten el mismo `AdminRoute` que Company/Contact), `/opportunities`, `/opportunities/new`, `/opportunities/:id/edit` (M5 — las 2 rutas de escritura reutilizan el mismo `AdminRoute`), `*` (placeholder de M0). |
| **TanStack Query** | Cache de server state | `frontend/src/lib/queryClient.ts` — infraestructura creada en M0; M1 agregó `GET /api/me` (`AuthContext.tsx`); M2 agregó las queries/mutations de `features/company/` (`companyKeys`, invalidación selectiva por mutación, sin `queryClient.clear()` fuera de la frontera de identidad); M3 agregó las de `features/contact/` (`contactKeys`) más `useCompaniesByIds` (`useQueries`) para resolver nombres de Company en el listado de Contacts sin acoplar `companyKeys.list`/`companyKeys.detail`; M4 agregó `pipelineKeys` (mismo shape que companyKeys, invalidación ampliada a `.all` solo cuando `isDefault: true` puede desmarcar otro pipeline) y `stageKeys` (jerárquica por `pipelineId` — `byPipeline(pipelineId)` como prefijo de array, verificado empíricamente contra `@tanstack/query-core` real); M5 agregó `opportunityKeys` (plana, mismo shape que companyKeys/contactKeys/pipelineKeys — Opportunity no está scoped a un único padre por URL, a diferencia de Stage — invalidación selectiva pura, sin efecto lateral demostrado sobre otras entidades) y `userKeys` (solo `all`/`lists`/`list`, deliberadamente sin `detail`: no existe `GET /api/users/:id` en el backend) — ver sección 7. |
| **@supabase/supabase-js** | Cliente de Supabase para el browser | `frontend/src/lib/supabase.ts` — única instancia, únicamente con la `anon key` (nunca `service_role`, esa es exclusiva del backend — ver `src/lib/supabaseAdmin.ts` arriba). |
| **Vitest** + **jsdom** + **@testing-library/react** + **user-event** + **jest-dom** + **MSW v2** | Testing frontend | `frontend/vite.config.ts` (bloque `test`, `defineConfig` de `vitest/config`), `frontend/src/test/`. Introducido en M2 para remediar `STD-SW-003` — ver detalle abajo. |

**Lo que todavía NO está en el stack del frontend**:
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
├── src/
│   ├── config/env.ts               # Validación de process.env con zod.
│   ├── lib/                        # prisma.ts (singleton + tipo Db), logger.ts
│   │                                #   (pino), jwt.ts (JWT de Supabase vía JWKS,
│   │                                #   jose), supabaseAdmin.ts (cliente service_role).
│   ├── types/auth.ts                # RoleName, JwtPayload, AuthContext,
│   │                                 #   AuthenticatedRequest, ampliación de Express.Request.
│   ├── utils/                       # AppError.ts, asyncHandler.ts (genérico sobre
│   │                                 #   el tipo de Request), validation.ts
│   │                                 #   (parseOrThrow), slug.ts, bearerToken.ts
│   │                                 #   (extractBearerToken, usado por el flujo de
│   │                                 #   aceptación de invitaciones, ver sección 4).
│   ├── schemas/                      # invitation.schema.ts, onboarding.schema.ts —
│   │                                  #   extraídos de los controllers para
│   │                                  #   compartirlos con los rate limiters de M1
│   │                                  #   (ver sección 7).
│   ├── middlewares/                 # notFound.ts, errorHandler.ts, authenticate.ts,
│   │                                 #   authorize.ts, rateLimit.ts (M1),
│   │                                 #   verifyInvitationAcceptIdentity.ts (M1).
│   ├── controllers/                 # health.controller.ts, onboarding.controller.ts,
│   │                                 #   company.controller.ts, contact.controller.ts,
│   │                                 #   pipeline.controller.ts, stage.controller.ts,
│   │                                 #   opportunity.controller.ts, activity.controller.ts,
│   │                                 #   invitation.controller.ts, user.controller.ts,
│   │                                 #   me.controller.ts.
│   ├── services/                    # health.service.ts, auth.service.ts,
│   │                                 #   onboarding.service.ts, ownership.service.ts
│   │                                 #   (resolveOwnerId, compartido entre Company,
│   │                                 #   Contact y Opportunity — Activity/Invitation
│   │                                 #   NO lo usan para assigneeId/reactivar, ver
│   │                                 #   sección 4), company.service.ts,
│   │                                 #   contact.service.ts, pipeline.service.ts,
│   │                                 #   stage.service.ts, opportunity.service.ts,
│   │                                 #   activity.service.ts, invitation.service.ts,
│   │                                 #   user.service.ts.
│   ├── repositories/                # user.repository.ts, organization.repository.ts,
│   │                                 #   role.repository.ts, company.repository.ts,
│   │                                 #   contact.repository.ts, pipeline.repository.ts,
│   │                                 #   stage.repository.ts (reindexado de order),
│   │                                 #   opportunity.repository.ts, activity.repository.ts,
│   │                                 #   invitation.repository.ts (compare-and-swap) —
│   │                                 #   ver README.md para el patrón de tres capas.
│   ├── routes/                      # health.routes.ts (sin prefijo), index.ts
│   │                                 #   agregador, onboarding.routes.ts,
│   │                                 #   company.routes.ts, contact.routes.ts,
│   │                                 #   pipeline.routes.ts, stage.routes.ts,
│   │                                 #   opportunity.routes.ts, activity.routes.ts,
│   │                                 #   invitation.routes.ts, user.routes.ts y
│   │                                 #   me.routes.ts (bajo /api).
│   ├── app.ts                       # arma Express, no escucha puerto.
│   └── server.ts                    # entry point + graceful shutdown.
└── frontend/                      # M0: scaffold + infraestructura base (Vite +
                                     #   React + TypeScript, paquete npm
                                     #   independiente, sin workspaces). M1 (ver
                                     #   abajo) agregó login/sesión, M2 agregó
                                     #   el primer módulo de negocio real
                                     #   (Company), M3 agregó Contact, M4
                                     #   agregó Pipeline/Stage, M5 agregó
                                     #   Opportunity — Activity/Users-Invitations
                                     #   UI y Dashboard siguen pendientes, ver
                                     #   sección 7/8.
    ├── .env.example
    ├── package.json
    ├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx                  # bootstrap: StrictMode + createRoot + <App/>.
        ├── vite-env.d.ts              # tipado de las 3 variables VITE_* de env.ts.
        ├── app/                        # App.tsx (QueryClientProvider →
        │                                #   AuthProvider → RouterProvider, M1),
        │                                #   router.tsx (createBrowserRouter:
        │                                #   /login + / protegida (AppLayout,
        │                                #   M2) + /companies* (M2) +
        │                                #   /contacts* (M3) + /pipelines* +
        │                                #   /pipelines/:pipelineId/stages* (M4)
        │                                #   + /opportunities* (M5) + *).
        ├── auth/                        # M1 — AuthContext.tsx (AuthProvider +
        │                                  #   useAuth + máquina de estados) +
        │                                  #   AuthContext.test.tsx (M2, 12 de
        │                                  #   los 14 escenarios de STD-SW-003),
        │                                  #   ProtectedRoute.tsx, getAccessToken.ts
        │                                  #   (puente hacia api.ts), AdminRoute.tsx
        │                                  #   + AdminRoute.test.tsx (M2 — protección
        │                                  #   visual de las rutas de escritura de
        │                                  #   Company, extendido en M3 para las de
        │                                  #   Contact, en M4 para las de
        │                                  #   Pipeline/Stage y en M5 para las de
        │                                  #   Opportunity; no un RBAC genérico).
        ├── config/env.ts                # Validación en runtime de las VITE_*
        │                                  #   (fail-fast si falta alguna o si
        │                                  #   una URL no es absoluta/http(s)).
        ├── features/
        │   ├── auth/                     # LoginPage.tsx (M1) +
        │   │                              #   LoginPage.test.tsx (M2, 2
        │   │                              #   escenarios de STD-SW-003 + el
        │   │                              #   round-trip con ProtectedRoute).
        │   ├── company/                  # M2 — types.ts (incluye ownerId en
        │   │   │                          #   CompanyListQuery/CreateCompanyInput),
        │   │   │                          #   api.ts + api.test.ts (reutiliza
        │   │   │                          #   request()/getAccessToken de M1),
        │   │   │                          #   queries.ts (companyKeys,
        │   │   │                          #   useCompanies/useCompany),
        │   │   │                          #   mutations.ts + mutations.test.tsx
        │   │   │                          #   (invalidación selectiva),
        │   │   │                          #   CompanyListPage.tsx + .test.tsx,
        │   │   │                          #   CompanyFormPage.tsx + .test.tsx,
        │   │   └──                        #   CompanySelect.tsx + .test.tsx (M3 —
        │   │                              #   selector/filtro server-side de
        │   │                              #   Company, consumido por Contact).
        │   ├── contact/                  # M3 — mismo esqueleto que company/:
        │   │   │                          #   types.ts, api.ts + api.test.ts,
        │   │   │                          #   queries.ts (contactKeys,
        │   │   │                          #   useContacts/useContact — M5
        │   │   │                          #   agregó `options.enabled` a
        │   │   │                          #   useContacts, sin cambiar el
        │   │   │                          #   comportamiento de ningún caller
        │   │   │                          #   existente),
        │   │   │                          #   mutations.ts + mutations.test.tsx,
        │   │   │                          #   ContactListPage.tsx + .test.tsx,
        │   │   │                          #   ContactFormPage.tsx + .test.tsx.
        │   │   └──                        #   companyResolution.ts
        │   │                              #   (useCompaniesByIds — resuelve
        │   │                              #   nombres de Company solo para los
        │   │                              #   companyId visibles en la página
        │   │                              #   actual de Contacts, ver sección 7;
        │   │                              #   reutilizado tal cual por
        │   │                              #   Opportunity en M5, sin modificar
        │   │                              #   este archivo — decisión explícita
        │   │                              #   de no generalizar todavía).
        │   ├── pipeline/                 # M4 — mismo esqueleto que company/:
        │   │   │                          #   types.ts, api.ts + api.test.ts,
        │   │   │                          #   queries.ts (pipelineKeys),
        │   │   │                          #   mutations.ts + mutations.test.tsx
        │   │   │                          #   (invalidación ampliada a `.all`
        │   │   │                          #   solo cuando isDefault: true),
        │   │   │                          #   PipelineListPage.tsx + .test.tsx,
        │   │   │                          #   PipelineFormPage.tsx + .test.tsx;
        │   │   └──                        #   M5 agregó PipelineSelect.tsx +
        │   │                              #   .test.tsx (selector simple, sin
        │   │                              #   búsqueda de texto, consumido por
        │   │                              #   Opportunity).
        │   ├── stage/                    # M4 — types.ts (probability: string,
        │   │   │                          #   ver sección 7), api.ts + api.test.ts,
        │   │   │                          #   queries.ts (stageKeys jerárquica
        │   │   │                          #   por pipelineId, + queries.test.ts
        │   │   │                          #   dedicado a esa key factory —
        │   │   │                          #   M5 agregó `options.enabled` a
        │   │   │                          #   useStages),
        │   │   │                          #   mutations.ts + mutations.test.tsx
        │   │   │                          #   (siempre invalida
        │   │   │                          #   stageKeys.byPipeline(pipelineId)
        │   │   │                          #   completo), StageListPage.tsx +
        │   │   │                          #   .test.tsx (gate del pipeline
        │   │   │                          #   padre, reordenamiento arriba/
        │   │   │                          #   abajo), StageFormPage.tsx +
        │   │   │                          #   .test.tsx; M5 agregó
        │   │   └──                        #   StageSelect.tsx + .test.tsx
        │   │                              #   (scoped a pipelineId, deshabilitado
        │   │                              #   sin pipeline elegido).
        │   ├── opportunity/              # M5 — mismo esqueleto que company/:
        │   │   │                          #   types.ts, api.ts + api.test.ts,
        │   │   │                          #   queries.ts (opportunityKeys,
        │   │   │                          #   plana) + queries.test.ts,
        │   │   │                          #   mutations.ts + mutations.test.tsx
        │   │   │                          #   (invalidación selectiva pura, sin
        │   │   │                          #   efecto lateral sobre otras
        │   │   │                          #   entidades), relationResolution.ts
        │   │   │                          #   + .test.tsx (resolución LOCAL —
        │   │   │                          #   no generalizada — de Contact/
        │   │   │                          #   Pipeline/Stage/Owner a nombre
        │   │   │                          #   humano; reexporta
        │   │   │                          #   useCompaniesByIds de contact/ sin
        │   │   │                          #   modificarlo), ContactSelect.tsx +
        │   │   │                          #   .test.tsx (independiente de
        │   │   │                          #   Company, sin filtro cruzado),
        │   │   │                          #   OpportunityListPage.tsx + .test.tsx
        │   │   │                          #   (columna Owner solo para ADMIN,
        │   │   │                          #   gateada de verdad — GET /api/users
        │   │   │                          #   nunca se dispara para USER),
        │   │   └──                        #   OpportunityFormPage.tsx + .test.tsx.
        │   └── user/                      # M5 — slice mínimo de solo lectura
        │       │                          #   (sin administración de Users,
        │       │                          #   fuera de alcance): types.ts,
        │       │                          #   api.ts + api.test.ts (listUsers,
        │       │                          #   sin getUser(id) — no existe
        │       │                          #   GET /api/users/:id en el backend),
        │       │                          #   queries.ts (userKeys, sin
        │       │                          #   detail/detail()),
        │       └──                        #   UserSelect.tsx + .test.tsx
        │                                  #   (selector de owner para
        │                                  #   OpportunityFormPage, ADMIN-only,
        │                                  #   sin búsqueda de texto).
        ├── layout/AppLayout.tsx          # M2 — nav mínima + logout
        │                                  #   (isLoggingOut local, sin
        │                                  #   duplicar estado de sesión) +
        │                                  #   Outlet; M3 agregó el link a
        │                                  #   /contacts, M4 agregó el link a
        │                                  #   /pipelines, M5 agregó el link a
        │                                  #   /opportunities.
        ├── lib/                          # supabase.ts (cliente único), api.ts
        │                                  #   (wrapper de fetch + ApiError,
        │                                  #   signal opcional desde M1),
        │                                  #   queryClient.ts.
        ├── styles/global.css               # Reset base, sin design system.
        └── test/                          # M2 — setup.ts (jest-dom + ciclo de
                                             #   vida de MSW), msw/server.ts,
                                             #   msw/handlers.ts (factories de
                                             #   /api/me), companyFixtures.ts
                                             #   (makeCompany(), compartida
                                             #   entre los tests de Company);
                                             #   M3 agregó contactFixtures.ts
                                             #   (makeContact()); M4 agregó
                                             #   pipelineFixtures.ts
                                             #   (makePipeline()) y
                                             #   stageFixtures.ts (makeStage());
                                             #   M5 agregó opportunityFixtures.ts
                                             #   (makeOpportunity()) y
                                             #   userFixtures.ts (makeUser()).
```

Detalle carpeta por carpeta (propósito, qué va en cada una) en `README.md` — no se
duplica acá para no tener dos fuentes de verdad que se puedan desincronizar.

**Lo que sigue faltando:**
- Nada del modelo de datos actual queda sin exponer vía API — `Company`, `Contact`,
  `Pipeline`, `Stage`, `Opportunity`, `Activity`, `Invitation` y la administración
  acotada de `User` ya están todos implementados — el nivel de verificación exacto
  de cada módulo está detallado en su propia entrada de la sección 7, no es
  uniforme para los ocho. En particular, `Invitation` no está "verificado
  end-to-end contra Supabase real" sin matices: ver el desglose por tramo
  (manual/histórico vs. persistente, HTTP vs. service) en las secciones 3, 7, 8 y
  9 (LOW-3). El flujo/UI de login del frontend contra Supabase Auth (sin
  endpoint propio en Express — eso es una decisión de diseño estable, no un
  pendiente, ver `authentication-architecture.md` sección 3), `AuthContext`/
  `AuthProvider` y `ProtectedRoute` **ya están implementados (M1)**, y
  `Company` **ya está implementado (M2, primer módulo de negocio real del
  CRM — ver sección 7)**, `Contact` también **(M3, ver sección 7 —
  cerrado, reviews en PASS)**, `Pipeline`/`Stage` también **(M4, ver
  sección 7 — cerrado, reviews en PASS)**, y `Opportunity` también **(M5,
  ver sección 7 — cerrado, reviews en PASS)**. `STD-SW-003` quedó resuelto en
  M2, sin condición pendiente. Lo que sigue pendiente es de otra
  naturaleza: el resto de las pantallas funcionales del CRM
  (`Activity`, administración de `User`/`Invitation`) y
  Dashboard — trabajo de M6 en adelante, todavía no implementado — ver
  sección 8.

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
- **Propósito**: catálogo global de roles (`ADMIN`, `USER`) — confirmados por
  `prisma/seed.ts`, que seedea exactamente esos dos valores de forma
  idempotente (`npm run prisma:seed`).
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
  La protección de "al menos un pipeline activo" es atómica de verdad, no
  check-then-act: `deletePipeline` toma `lockOrganizationForUpdate` (mismo
  mecanismo que M3, `SELECT ... FOR UPDATE` sobre la fila de `Organization`)
  incondicionalmente, como primera operación dentro de una única transacción
  que también revalida el `Pipeline` y recuenta los activos — corregido
  (H-1, auditoría nueva, 2026-07-12) tras confirmarse empíricamente, con un
  diagnóstico temporal (no persistido) corrido en loop dentro de un mismo
  proceso, que sin el lock dos `deletePipeline` concurrentes sobre dos
  pipelines distintos podían dejar la organización con cero activos (24/25,
  y 19/20 en una segunda corrida). Cobertura persistente:
  `src/services/pipeline.service.integration-test.ts`, dos escenarios de
  carrera real con `Promise.allSettled` (no-default vs. no-default, y
  default vs. no-default) — verificados antes del fix como corridas
  aisladas de proceso nuevo (el modo real en que corren en este repo): el
  segundo detectó el bug de forma confiable (4/4); el primero no lo
  reprodujo en esas mismas condiciones (0/4) pese a ejercitar el mismo
  código que el diagnóstico temporal — después del fix, ambos pasaron 5/5
  corridas aisladas cada uno bajo el mismo protocolo (y ese mismo protocolo
  de diagnóstico temporal, corrido post-fix, dio 0/25); el primero queda
  como test de invariante/regresión del camino simple, no como reproductor
  confiable del bug en un solo intento aislado. Ninguno de los dos usa una
  barrera que fuerce un interleaving concreto (siguen siendo
  `Promise.allSettled` sin más) — estos números son resultado observado
  bajo el protocolo corrido, no una garantía de determinismo del test.
- **PIPE-DEFAULT-GHOST (auditoría nueva, cerrado 2026-07-13) — invariante
  distinta de H-1, no una carrera: 100% secuencial, sin concurrencia**:
  `softDeletePipeline` escribía únicamente `deletedAt`, nunca `isDefault` —
  un pipeline default soft-deleted quedaba con `isDefault: true` para
  siempre, porque `unsetDefaultPipeline` (la única función que apaga un
  default existente) filtra `deletedAt: null` en su propio `WHERE` y nunca
  vuelve a alcanzar esa fila. Sin impacto funcional observable hoy vía la
  API (las queries activas filtran `deletedAt: null`, y el índice único
  parcial de arriba excluye `deleted_at IS NOT NULL` por diseño), pero la
  inconsistencia del dato raw era real y se acumulaba, una fila más por cada
  default borrado — un futuro lector raw/histórico o un eventual
  restore/undelete la interpretaría mal. Corregido escribiendo `isDefault:
  false` en el mismo `UPDATE` de `softDeletePipeline`, sin locks ni
  transacciones nuevas (ya corre dentro del `tx` que abre `deletePipeline`,
  bajo el lock de H-1). Cobertura persistente:
  `src/services/pipeline.service.integration-test.ts`, lee la fila afectada
  de forma RAW (sin filtrar `deletedAt`) — el único punto donde el bug era
  observable.

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
  - **T-2 (auditoría nueva, cerrado 2026-07-13) — invariante protegida por
    el `CHECK`, no por el pre-check de servicio**: `findStageWithFlag` (el
    pre-check de `updateStage` para `isWon`/`isLost`) solo busca esa marca
    en **otras** filas del pipeline — nunca revisa el flag opuesto de la
    propia fila que se está actualizando. Dos `updateStage` sobre la misma
    etapa, uno marcando `isWon: true` y otro `isLost: true`, podían pasar
    los dos ese chequeo. El dato persistido **nunca** quedó corrompido:
    `stages_won_lost_exclusive_check` (el `CHECK` de Postgres) rechazó
    siempre la escritura perdedora. Corregido extendiendo la traducción de
    conflictos ya existente en `updateStage` para reconocer también el
    nombre exacto de esta constraint — la traducción de P2002 (nombre/
    ganada/perdida duplicados) queda intacta, cualquier otro error se
    sigue propagando igual. Cobertura persistente:
    `src/services/stage.service.integration-test.ts`, mismo mecanismo de
    lock real de Postgres que T-1.

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
- **T-1 (auditoría nueva, cerrado 2026-07-13) — invariante protegida por el
  `CHECK`, no por el pre-check de servicio**: el chequeo síncrono de
  `updateActivity` (arriba) lee un snapshot de la `Activity` antes de
  escribir, sin lock ni transacción que abarque ambos pasos — dos
  `updateActivity` concurrentes, cada uno limpiando una relación distinta,
  podían pasar los dos ese chequeo contra un estado que el otro todavía no
  había comiteado. El dato persistido **nunca** quedó corrompido en ningún
  momento: `activities_related_entity_check` (el `CHECK` de Postgres)
  rechazó siempre la escritura perdedora, exactamente como está diseñado
  para hacerlo. Lo que faltaba era traducir esa violación concreta a
  `AppError(400)` en vez de dejarla subir cruda como
  `PrismaClientUnknownRequestError` hasta `errorHandler.ts` (500 genérico).
  Corregido en `updateActivity` reconociendo el nombre exacto de la
  constraint dentro de `err.message` — cualquier otro error se sigue
  propagando intacto. Cobertura persistente:
  `src/services/activity.service.integration-test.ts`, fuerza la carrera
  real con un lock de fila de Postgres (mismo mecanismo que el CAS perdido
  de LOW-1), no `Promise.allSettled` sin más.

### `Invitation`
- **Propósito**: invitación pendiente de un `ADMIN` a un nuevo miembro de su
  organización. ✅ Módulo completo (`POST/GET /api/invitations`,
  `DELETE /api/invitations/:id`, `POST /api/invitations/accept`) — verificado
  manualmente una vez, de forma empírica (H3/H4, no como test persistente),
  contra un proyecto real de Supabase, incluidas tres carreras concurrentes
  reales (ver más abajo). Cobertura persistente actual, más acotada: ver
  sección 8/9.
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
    concurrente. Esto resuelve tres carreras reales, verificadas manualmente
    una vez (H3/H4, sesión histórica — no un test persistente) con
    `Promise.all` genuino contra Supabase real:
    - **crear vs. crear** (mismo `organizationId`+`email`): el índice único
      parcial permite un solo `INSERT`; el segundo choca con `P2002`, traducido
      a `409` (antes: `500` crudo). Verificado directamente contra
      repository/service/Postgres real — a diferencia de las otras dos, no vía
      HTTP completo: el round-trip de `POST /api/invitations` quedó bloqueado
      por el rate limit de `inviteUserByEmail` durante esa misma sesión (ver
      sección 8/9).
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

- **Soft delete (`deletedAt`) en 8 de los 10 modelos.** `Organization`,
  `Company`, `Contact`, `Pipeline`, `Stage`, `Opportunity`, `Activity` y
  `User` lo tienen. `Stage` lo agregó durante la implementación de
  `Pipeline`/`Stage`; `User` lo agregó en la migración de `Invitation`
  (`20260711192539_invitation_and_user_deleted_at`, ver sección 7), con
  semántica distinta de `isActive` (ver sección 4). Los dos modelos sin
  `deletedAt` no comparten el mismo motivo: `Role` es un catálogo global sin
  ciclo de vida propio; `Invitation` lo omite deliberadamente porque su
  ciclo de vida ya está representado por `status`
  (`PENDING | ACCEPTED | REVOKED | EXPIRED`, ver sección 4) — agregar
  `deletedAt` encima sería redundante con esos estados terminales.

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

- **Separación `DATABASE_URL` (Supavisor, modo transacción, puerto 6543) vs.
  `DIRECT_URL` (Supavisor, modo sesión, puerto 5432 — mismo host
  `*.pooler.supabase.com`; no es una conexión directa a Postgres pese al nombre
  de la variable, confirmado en LOW-2, sección 8).** Patrón requerido por
  Supabase + Prisma: las migraciones necesitan el modo sesión porque el modo
  transacción rompe algunas operaciones de `prisma migrate`; el runtime de la
  app usa el modo transacción para escalar a más conexiones concurrentes de
  las que Postgres podría atender sin poolear — un beneficio de la
  arquitectura de pooling en sí, distinto del costo por-operación que esa
  misma configuración introduce (documentado en sección 8).

---

## 6. Flujo de autenticación

> Ver el detalle completo (con justificación de cada decisión) en
> [`docs/authentication-architecture.md`](./authentication-architecture.md). Acá va
> solo un resumen con el estado real de implementación de cada paso.

**1. Registro (`auth.users`).** El usuario se registra a través de Supabase Auth (por
ejemplo `supabase.auth.signUp(...)`) — **el frontend no implementa ningún flujo de
registro/signup** (fuera de alcance de M1 por decisión explícita, ver sección 7). No
confundir con el login: `frontend/` sí implementa `signInWithPassword` desde M1 (ver
sección 7) — son dos flujos de Supabase Auth distintos, y solo el segundo existe hoy
en el frontend. Supabase crea la fila en `auth.users` — una tabla que Supabase gestiona en su
propio schema de Postgres, **fuera del `schema.prisma` de este proyecto** (Prisma no la
modela ni la controla).

**2. Creación del perfil de negocio (`public.users`) — ✅ resuelto e implementado.**
`manual_constraints.sql` *no* tiene un trigger que cree automáticamente una fila en
`public.users` cuando se inserta una fila en `auth.users` (solo existen los dos
triggers de *sincronización de email*, no de *creación*) — la opción elegida fue
la B: un endpoint del backend, no un trigger de Postgres. La decisión de producto
de la que dependía esto ya está tomada e implementada, con dos caminos distintos
según el caso: `POST /api/onboarding` crea una `Organization` nueva junto con su
primer `User` ADMIN (signup inicial, ver sección 4/7), e `Invitation` incorpora
un `User` a una `Organization` ya existente (`POST /api/invitations/accept`,
`organizationId`/`roleId` salen de la `Invitation`, nunca del cliente — ver
sección 4). No queda un tercer camino pendiente.

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

   Ya está montado sobre las rutas reales de los 8 módulos de negocio
   (`Company`, `Contact`, `Pipeline`, `Stage`, `Opportunity`, `Activity`,
   `Invitation`, `User`) y sobre `GET /api/me` (identidad de negocio del
   propio usuario autenticado, ver sección 7) — ver detalle del cambio de
   HS256 a ES256/JWKS en `authentication-architecture.md` sección 4. También
   existe
   `src/middlewares/authorize.ts` (autorización por rol, `ADMIN`/`USER`),
   montado en las rutas de escritura de esos mismos 8 módulos.

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
  habilitado en las 10 tablas (incluida `invitations`), con políticas que **no
  son uniformes** — las 8 tablas tenant-scoped (`users`, `companies`,
  `contacts`, `opportunities`, `pipelines`, `activities`, `stages`,
  `invitations`) usan el mismo patrón de aislamiento por `organization_id`
  (`stages` se simplificó al agregarle `organizationId` propio — ya no
  necesita el join a `pipelines` que tenía antes); `organizations` usa una
  política acorde a su propia estructura (`id = current_organization_id()`,
  no tiene `organization_id` propio); `roles` usa una política acorde a su
  rol de catálogo global sin scope de tenant (lectura para cualquier usuario
  `authenticated`, sin aislamiento por organización) — ver sección 5 de
  `authentication-architecture.md` para la justificación de por qué es una
  defensa secundaria, no la principal. Reverificado empíricamente vía
  queries read-only directas contra la base (no asumido): el rol de
  conexión de Prisma (`postgres`) efectivamente tiene `bypassrls = true`.
- ✅ Seed inicial del catálogo `Role` (`ADMIN`, `USER`) vía `prisma/seed.ts`
  (`npm run prisma:seed`), idempotente.

**Backend**
- ✅ Scaffold de Express + patrón de tres capas (controllers/services/repositories).
- ✅ Infraestructura de autenticación (middleware `authenticate` + `authorize`) —
  montada sobre las rutas reales de los 8 módulos de negocio (mismo patrón
  `authenticate` + `authorize("ADMIN")` en escritura en los 8), verificada
  contra logins reales.
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
  Verificado manualmente una vez, de forma end-to-end contra Supabase real
  (H3/H4, sesión histórica — no persistido como test), incluidas las tres
  carreras concurrentes reales con `Promise.all`: aceptar vs. aceptar y
  aceptar vs. revocar vía HTTP real completo (esta última observada
  empíricamente en ambos sentidos); crear vs. crear vía repository/service/
  Postgres real, sin el tramo HTTP (bloqueado por el rate limit de
  `inviteUserByEmail`, ver sección 8/9). Cobertura persistente actual, más
  acotada: ver sección 8/9.
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
- ✅ **M0 (scaffold) implementado** — `frontend/`, aplicación Vite + React +
  TypeScript independiente (paquete npm propio, sin workspaces), sibling de
  `src/` en la raíz. Infraestructura únicamente: cliente único de
  `supabase-js` (`src/lib/supabase.ts`), wrapper propio sobre `fetch` con
  manejo de errores tipado (`src/lib/api.ts`, `ApiError`), `QueryClient` de
  TanStack Query (`src/lib/queryClient.ts`), router con dos rutas
  placeholder (`src/app/router.tsx`), validación de env en runtime
  (`src/config/env.ts`). ❌ Todavía sin login, sin `AuthContext`, sin
  `ProtectedRoute` ni ninguna pantalla funcional del CRM en este punto — eso
  se resuelve (parcialmente) en M1, ver abajo.
- ✅ **M1 (autenticación y sesión) implementado — cierre condicional.**
  `AuthContext`/`AuthProvider` (`frontend/src/auth/AuthContext.tsx`),
  `ProtectedRoute` (`frontend/src/auth/ProtectedRoute.tsx`), `LoginPage`
  (`frontend/src/features/auth/LoginPage.tsx`), puente de token
  (`frontend/src/auth/getAccessToken.ts`), y `signal` opcional agregado a
  `request()` en `frontend/src/lib/api.ts` (reenviado al `fetch` nativo, para
  cancelación automática de TanStack Query). Frontera de identidad/cache
  (`identityRef`/`identityKey`, `queryClient.clear()` solo ante cambio real
  de `session.user.id`, `queryKey` de `/api/me` parametrizada por identidad)
  diseñada y verificada contra los ocho escenarios reales de
  `onAuthStateChange` (`INITIAL_SESSION`, login, evento repetido, A→B sin
  `SIGNED_OUT` previo, `SIGNED_OUT`, `signOut` fallido, `TOKEN_REFRESHED`,
  respuesta tardía de `/api/me`).

  **Reviews obligatorios (Claude-Toolkit-V1) al cierre de M1 — outcomes
  reales, ningún FAIL:** `RV-ENG`: CONDITIONAL PASS. `RV-SECURITY`: PASS.
  `RV-STANDARDS`: CONDITIONAL PASS. El Gate de M1 quedó liberado
  condicionalmente (no incondicionalmente) según la semántica formal de
  `reviews/README.md` del Toolkit. La única condición pendiente
  (`STD-SW-003`) quedó **resuelta en M2** — ver el bullet de M2 abajo para
  el detalle y el nuevo outcome.

- ✅ **M2 (módulo Company + remediación de `STD-SW-003`) implementado.**
  `frontend/src/layout/AppLayout.tsx` (navegación mínima, acceso a
  `/companies`, logout con `isLoggingOut` local y error visual — sin
  duplicar estado de sesión, sin navegación manual: `ProtectedRoute` ya
  reacciona a `SIGNED_OUT`). `frontend/src/features/company/` completo:
  `types.ts`, `api.ts` (reutiliza `request()`/`getAccessToken` de M1, cero
  cliente Supabase nuevo), `queries.ts` (`companyKeys`, `useCompanies`,
  `useCompany`), `mutations.ts` (`useCreateCompany`/`useUpdateCompany`/
  `useDeleteCompany`, invalidación selectiva — nunca `queryClient.clear()`
  global por una escritura de negocio normal), `CompanyListPage.tsx`
  (paginación, `search`, filtro por `industry`, orden por
  `name`/`createdAt`/`industry`, acciones de escritura ocultas para
  no-ADMIN como cortesía de UX, no como autorización), `CompanyFormPage.tsx`
  (un único componente para alta y edición). `organizationId` nunca viaja
  desde el frontend en ninguna query/body de Company — verificado con un
  test persistente (`api.test.ts`, A.2) sobre requests reales interceptadas,
  no solo con un grep puntual — se resuelve exclusivamente server-side,
  igual que en M1.

  **`ownerId` — corrección de alcance dentro del propio ciclo de M2.** Una
  primera pasada de M2 omitió `ownerId` incluso de la capa de tipos/API
  (`CompanyListQuery`, `CreateCompanyInput`), tratándola como si cayera
  bajo el mismo gap que el filtro visual — una sobre-generalización
  detectada y corregida antes del cierre. Estado final, con la distinción
  correcta entre tres capas:
  - **Soporte API tipado (capa A) — ✅ implementado.** `CompanyListQuery.ownerId`,
    serializado en `buildListQueryString()`; `CreateCompanyInput.ownerId`
    (opcional, igual que en el backend). Sin nullability inventada: el
    backend no soporta limpiar `ownerId` a `null` vía `PATCH`
    (`company.service.ts` solo lo cambia con un chequeo truthy), y el tipo
    frontend lo refleja (`ownerId?: string`, nunca `string | null`).
  - **Filtro visual por nombre en `CompanyListPage` (capa B) — diferido.**
  - **Selector de asignación/reasignación en `CompanyFormPage` (capa C) — diferido.**

  B y C siguen diferidas porque mostrar un nombre real (no un UUID crudo,
  que no es un control visual aceptable) requiere `GET /api/users` — **no
  porque haga falta que exista antes una pantalla de administración de
  Users**: ese endpoint puede consumirse de forma independiente apenas se
  construya el selector, en cualquier ciclo futuro que lo necesite.

  **`STD-SW-003` (Testing Standards) — ✅ resuelto para el deliverable
  completo de M2**, no solo para auth/sesión. Dos frentes:

  1. **Auth/sesión (heredado de M1)**: cobertura automatizada persistente
     (`frontend/src/auth/AuthContext.test.tsx`,
     `frontend/src/features/auth/LoginPage.test.tsx`) de los 14 escenarios:
     (1) `INITIAL_SESSION` con sesión A, (2) estado sin sesión, (3) login
     exitoso, (4) login fallido, (5) evento repetido de la misma identidad,
     (6) transición A→B sin `SIGNED_OUT` previo, (7) `SIGNED_OUT`, (8)
     `signOut` fallido sin falso logout local, (9) `TOKEN_REFRESHED` sin
     limpieza de cache, (10) respuesta tardía de `/api/me` de A después del
     cambio a B, (11) `ApiError` 403 → `account-unavailable`, (12)
     5xx/network error → `profile-error`, (13) `retryProfile()`, (14)
     preservación y recuperación de la ruta privada original en login. 16
     tests. Poder de detección verificado con 4 mutaciones deliberadas
     revertidas antes de continuar: deshabilitar el guard de identidad
     repetida (detectado por el escenario 5), quitar el parametrizado de
     `queryKey` por identidad (detectado únicamente forzando un commit de
     React entre los dos eventos del escenario 10 — ver riesgos),
     deshabilitar `queryClient.clear()` (detectado por el escenario 5,
     confirma que el escenario 10 depende de la `queryKey`, no de
     `clear()`), y reintroducir el falso logout local ante `signOut`
     fallido (detectado por el escenario 8).

  2. **Company — cobertura agregada en dos correcciones de alcance dentro
     del mismo ciclo** (una primera pasada de M2 había dejado Company sin
     ningún test, incorrectamente dado por aceptable; una revisión externa
     posterior encontró que el wiring real de `delete` y la ausencia de
     protección visual ADMIN en las rutas de escritura tampoco estaban
     cubiertos). `api.test.ts` (A.1–A.5: serialización de filtros reales
     incluido `ownerId`, ausencia persistente de `organizationId` en
     list/create/update, payload de create/update/delete), `mutations.test.tsx`
     (B.6–B.9: invalidación de `companyKeys.lists()`/`detail(id)` tras
     create/update/delete con `QueryClient` real, ninguna invalidación ante
     mutation fallida), `CompanyListPage.test.tsx` (C.10–C.14: ocultamiento
     de acciones para USER, visibilidad para ADMIN, error de listado, empty
     state, controles de búsqueda/filtro/orden/paginación; **C.15–C.17**:
     cancelar `window.confirm` no envía `DELETE`, confirmar envía `DELETE`
     al id correcto y termina sin error, `DELETE` fallido muestra un error
     accesible reutilizando el estado de la propia mutation — sin duplicar
     estado remoto en `useState`), `CompanyFormPage.test.tsx` (D.15–D.19:
     create mode no pide detail, edit mode hidrata y actualiza el id
     correcto, error de detail no se confunde con create vacío, error de
     mutation no navega, campos opcionales vacíos viajan como ausentes),
     y **`auth/AdminRoute.test.tsx`** (nuevo: `USER` entrando directamente
     por URL a `/companies/new` o `/companies/:id/edit` no renderiza el
     formulario — ni siquiera pide el detail — y es redirigido a
     `/companies`; `ADMIN` sí accede a ambas; ejercitando la jerarquía real
     `ProtectedRoute → AdminRoute → CompanyFormPage`, no una condición
     aislada). 26 tests de Company, en 5 archivos `.test.*`
     (`AdminRoute.test.tsx`, `api.test.ts`, `CompanyFormPage.test.tsx`,
     `CompanyListPage.test.tsx`, `mutations.test.tsx`) — 7 archivos
     `.test.*` en total con los 2 de auth (`AuthContext.test.tsx`,
     `LoginPage.test.tsx`).

     Protección ADMIN implementada: `frontend/src/auth/AdminRoute.tsx`,
     componente mínimo (redirect a `/companies` si `me.role !== "ADMIN"`,
     si no `<Outlet/>`), anidado en `router.tsx` únicamente alrededor de
     `/companies/new` y `/companies/:id/edit` — no un sistema de
     permisos/RBAC genérico. Es exclusivamente higiene de UX: la
     autorización real de escritura sigue siendo `authorize("ADMIN")` en
     el backend, sin cambios.

     Poder de detección verificado con **6 mutaciones deliberadas en
     total** sobre Company, todas revertidas antes de continuar: fuga de
     `organizationId` en el body de create (detectada por A.2 y A.3),
     quitar la invalidación de `detail(id)` en update (detectada por B.7),
     romper el method de `deleteCompany` (detectado por A.5 y B.8),
     deshabilitar el chequeo de rol en `CompanyListPage` (detectado por
     C.10), quitar el render del error de `delete` (detectado por C.17), y
     deshabilitar la restricción de rol en `AdminRoute` (detectado por los
     dos tests de `USER` en `AdminRoute.test.tsx`).

     Suite completa: **42 tests, verde** (16 auth + 26 Company). Stack:
     Vitest + jsdom + React Testing Library + user-event + jest-dom +
     MSW v2 — `supabase.auth`/`getAccessToken` mockeados como frontera
     externa; `request()`, `ApiError`, `QueryClient` y React Router corren
     sin mockear.

  **Deuda técnica residual real, no minimizada**: `AppLayout.tsx` no tiene
  test de componente propio (su contrato de logout ya está cubierto
  indirectamente vía el contrato de `AuthContext`, pero su renderizado/nav
  propios no) — gap Medio, no bloqueante. El objeto `router` exportado por
  `app/router.tsx` (`createBrowserRouter`) nunca se renderiza literalmente
  en un test — todas las pruebas de routing reconstruyen la misma forma de
  árbol con `MemoryRouter` porque `createBrowserRouter` no admite
  `initialEntries` — limitación estructural conocida, no un gap de
  cobertura de comportamiento. Casos límite de paginación (botones
  deshabilitados en la primera/última página) y validación exhaustiva
  campo por campo de `CompanyFormPage` (más allá de `name`/`industry`) no
  tienen test dedicado — gaps Bajos, delegados en la práctica a la
  validación real del backend (Zod). Ninguno de estos gaps es Critical ni
  High bajo `code-review-standards.md` — no cappean el outcome de los
  reviews, pero quedan declarados explícitamente, no ocultos.

  **Reviews obligatorios (Claude-Toolkit-V1), ejecutados desde cero contra
  el deliverable final de M2 (no heredados de rondas anteriores):**
  `RV-ENG`: **PASS**. `RV-SECURITY`: **PASS**. `RV-STANDARDS`: **PASS**. Sin
  condiciones pendientes — el Gate de M2 queda liberado incondicionalmente.

- ✅ **M3 (módulo Contact + relación Contact→Company) implementado y
  cerrado — reviews ejecutados desde cero contra el deliverable final
  (posterior a la corrección de `CompanySelect`, ver abajo), sin
  condiciones pendientes.** `frontend/src/features/contact/` completo: `types.ts` (el
  contrato de escritura sigue fielmente el HTTP real, no el tipo interno
  del backend: `email`/`phone`/`jobTitle`/`source`/`companyId`/`ownerId`
  tipados `string` opcional, nunca `string | null` — la Zod schema real
  en `contact.controller.ts` solo tiene `.optional()`, no `.nullable()`,
  aunque `contact.service.ts` tipe internamente esos mismos campos como
  `string | null`; ninguno de esos campos puede limpiarse a `null` vía
  `PATCH` — limitación real del backend, documentada acá, no una omisión
  del frontend), `api.ts`, `queries.ts` (`contactKeys`, `useContacts`,
  `useContact`), `mutations.ts` (mismo patrón de invalidación selectiva
  que Company), `companyResolution.ts`, `ContactListPage.tsx`,
  `ContactFormPage.tsx` (un único componente para alta y edición, mismo
  patrón que `CompanyFormPage`). Rutas `/contacts`, `/contacts/new`,
  `/contacts/:id/edit` agregadas a `router.tsx`, reutilizando el mismo
  `AdminRoute` ya usado por Company — no un sistema de permisos nuevo.
  `AppLayout.tsx` agrega un link de navegación a `/contacts` (una línea,
  sin rediseño). `organizationId` nunca viaja desde el frontend en
  ninguna query/body de Contact — verificado con test persistente sobre
  requests reales interceptadas, mismo criterio que Company.

  **Relación Contact → Company.** El diseño inicial asumía que traer la
  primera página de Companies alcanzaba para resolver nombres en el
  listado de Contacts — se corrigió **antes** de implementar, en una
  segunda ronda de investigación, porque no escala con más de una página
  de Companies en la organización. Diseño final, dos mecanismos
  independientes para dos problemas distintos:
  1. **Selector/filtro (`frontend/src/features/company/CompanySelect.tsx`
     — vive en el propio módulo Company, no es un selector genérico de
     entidades)**: búsqueda server-side debounced (300ms, `setTimeout`/
     `useEffect`, sin nueva dependencia) sobre `GET /api/companies?search=`
     (ya existente, filtra solo por `name`, case-insensitive), `pageSize`
     acotado (20), sin precarga (`enabled` solo con término no vacío) —
     funciona igual con diez o con miles de Companies en la organización
     porque nunca asume un tope ni trae más que lo que el usuario pidió.
  2. **Resolución de nombres en el listado
     (`frontend/src/features/contact/companyResolution.ts`,
     `useCompaniesByIds`)**: resuelve exclusivamente los `companyId`
     realmente visibles en la página actual de Contacts (vía
     `useQueries`, deduplicados, `getCompany(id)` individual por cada
     uno) — nunca la lista completa ni la primera página de Companies.
     Verificado con un test dedicado donde la Company vinculada está
     fuera de cualquier página razonable del listado de Companies (el
     mock del endpoint de listado de Companies nunca se llama) y con un
     test de deduplicación (dos Contacts con el mismo `companyId`
     generan una sola resolución).

  **Corrección técnica sobre caché de TanStack Query, resuelta antes de
  implementar** (un análisis previo había asumido, incorrectamente, que
  la Company resuelta por `CompanySelect` quedaba "gratis" disponible
  para `useCompaniesByIds`): `companyKeys.list(query)` y
  `companyKeys.detail(id)` son queryKeys independientes — TanStack Query
  no normaliza entidades entre ellas automáticamente, confirmado contra
  la documentación oficial y contra el código real de
  `company/queries.ts`. Estrategia adoptada: `CompanySelect` siembra
  explícitamente `companyKeys.detail(id)` vía
  `queryClient.setQueryData()` con cada resultado de su propia búsqueda
  — dentro del módulo Company, sin acoplar `useCompaniesByIds` a que eso
  haya ocurrido: si `CompanySelect` nunca sembró esa Company,
  `useCompaniesByIds` simplemente hace su propio fetch individual, sin
  ninguna lógica especial de por medio. No se introdujo una capa de
  normalización de entidades genérica.

  `ownerId` queda sin selector visual en `ContactFormPage`, mismo motivo
  ya documentado para Company en M2 (`GET /api/users` no consumido
  todavía por ningún módulo).

  **Tests**: `contact/api.test.ts` (5), `contact/mutations.test.tsx` (4),
  `company/CompanySelect.test.tsx` (5, incluida la siembra de
  `companyKeys.detail` desde los resultados de búsqueda),
  `contact/ContactListPage.test.tsx` (13, incluidos los dos escenarios
  críticos de la relación Contact→Company: resolución fuera de la
  primera página, y deduplicación entre Contacts con el mismo
  `companyId`), `contact/ContactFormPage.test.tsx` (6), y una extensión
  de `auth/AdminRoute.test.tsx` (+4, mismo criterio que Company:
  jerarquía real `ProtectedRoute → AdminRoute → ContactFormPage`, no una
  condición aislada — `USER` termina redirigido a `/companies`, porque
  `AdminRoute` sigue redirigiendo siempre ahí, hardcoded desde M2, sin
  cambios para M3). 37 tests nuevos (5 + 4 + 5 + 13 + 6 + 4 — incluye el
  fallback de `CompanySelect` ante una resolución fallida de la Company
  ya seleccionada, corregido tras revisión externa antes del cierre —
  ver más abajo); **79 tests en total** en la suite frontend completa
  (16 auth + 26 Company + 37 Contact/CompanySelect/AdminRoute-Contact),
  todos verdes.

  Poder de detección verificado con mutaciones deliberadas, todas
  revertidas antes de continuar: fuga de `organizationId` en el body de
  `createContact` (detectada por `api.test.ts`), resolución de nombres
  degradada a la primera página de Companies en vez de resolución
  puntual por id (detectada por `ContactListPage.test.tsx`, tanto el
  escenario de "fuera de la primera página" como el de deduplicación),
  eliminación del filtro `companyId` en `buildListQueryString` (detectada
  por `ContactListPage.test.tsx` y, como efecto secundario, por un
  timeout en `api.test.ts`), y ocultamiento del error 409 en
  `ContactFormPage` (detectada por `ContactFormPage.test.tsx`, tanto el
  caso 409 como el de error genérico). **Un quinto intento — remover la
  deduplicación de `Array.from(new Set(ids))` en `useCompaniesByIds` —
  no hizo fallar ningún test**: verificado que TanStack Query dedupea
  las requests de red por `queryKey` idéntica a nivel interno,
  independientemente de que el array de queries pasado a `useQueries`
  tenga entradas repetidas: `detailRequestCount` se mantuvo en 1 con o
  sin el `Set`. Conclusión honesta, no forzada: el `Set` es una práctica
  defensiva razonable (evita instanciar N observers de query en vez de
  1 cuando hay ids repetidos), pero no es, hoy, el mecanismo del que
  depende la corrección funcional — esa corrección la garantiza TanStack
  Query internamente. Se mantiene el `Set` porque sigue siendo la forma
  más simple y explícita de expresar la intención ("resolver ids
  únicos"), no porque el test lo exija.

  **Corrección post-revisión: `CompanySelect` no debe mostrar el
  `companyId` crudo si falla la resolución de la Company ya
  seleccionada.** Una revisión externa detectó que, aunque
  `ContactListPage` ya tenía este fallback correcto (`"—"`, con test
  dedicado), `CompanySelect` mostraba el UUID sin resolver
  (`selectedCompanyQuery.data ? nombre : isLoading ? "Cargando…" :
  value`) cuando `GET /companies/:id` fallaba para la Company
  actualmente seleccionada — contradiciendo el mismo criterio ya
  aplicado en el listado. Corregido: el tercer caso del mismo ternario
  ahora muestra `"No pudimos cargar la empresa seleccionada."` en vez de
  `value`; no se agregó botón de "quitar", no cambió la semántica de
  `companyId` en ningún formulario, no se agregó estado remoto
  duplicado — se reutiliza `selectedCompanyQuery` tal cual ya existía.
  Sin `role="alert"` deliberadamente: a diferencia de un error de
  mutation (que sí bloquea una acción y amerita anuncio inmediato), este
  es un dato informativo degradado dentro de un selector que sigue
  siendo funcional (el `companyId` seleccionado sigue siendo válido y
  enviable) — mismo criterio, sin alerta, que el fallback `"—"` ya
  aprobado en `ContactListPage`. Cubierto con un test persistente nuevo
  en `CompanySelect.test.tsx` (monta `CompanySelect` real con
  `value="co-rota"`, `QueryClient` y MSW reales, `GET
  /companies/co-rota` responde 404, verifica el fallback visible y la
  ausencia de `"co-rota"` en el documento) — poder de detección
  verificado reintroduciendo temporalmente `: value` en el ternario
  (el test falló exactamente por eso: aparecía el UUID crudo y
  desaparecía el fallback esperado) y revertido por completo antes de
  continuar.

  **Deuda técnica / notas residuales, no minimizadas**: durante el test
  "el filtro companyId... puede limpiarse" de `ContactListPage.test.tsx`,
  MSW registra una advertencia de consola por una request de fondo a
  `GET /companies/:id` sin handler explícito — es el refetch en segundo
  plano que dispara `useCompany` dentro de `CompanySelect` por el
  `staleTime` default de TanStack Query (0), sobre una entrada de caché
  que ya fue sembrada y ya se está mostrando; no afecta ninguna
  aserción del test (la UI ya muestra el dato cacheado) y no es un bug
  de la aplicación, pero se deja declarado en vez de silenciado.
  `AppLayout.tsx` sigue sin test de componente propio (gap heredado de
  M2, sin agravarse en M3). Igual que en M2: casos límite de paginación
  y validación exhaustiva campo por campo de `ContactFormPage` (más allá
  de los campos requeridos) no tienen test dedicado — gaps Bajos,
  delegados en la práctica a la validación real del backend (Zod).

  **Reviews obligatorios (Claude-Toolkit-V1), ejecutados desde cero
  contra el deliverable final de M3** (incluida la corrección de
  `CompanySelect` — ninguna ejecución previa a esa corrección se heredó
  como definitiva): `RV-ENG`: **PASS**. `RV-SECURITY`: **PASS**.
  `RV-STANDARDS`: **PASS**. Sin condiciones pendientes — el Gate de M3
  queda liberado incondicionalmente.

- ✅ **M4 (módulo Pipeline + Stage) implementado y cerrado — reviews
  ejecutados desde cero contra el deliverable final, sin condiciones
  pendientes.** `frontend/src/features/pipeline/` y
  `frontend/src/features/stage/` completos, mismo esqueleto
  `types/api/queries/mutations/pages` que Company/Contact.

  **Pipeline**: CRUD completo (list/create/edit/soft-delete). `isDefault`
  con semántica corregida durante el diseño de M4: el backend garantiza
  **a lo sumo un** default por organización, **no exactamente uno** —
  `updatePipeline` solo desmarca el default anterior cuando
  `input.isDefault === true`; un `PATCH { isDefault: false }` explícito no
  promueve ningún reemplazo, y la organización puede quedar en **cero**
  defaults. El frontend adopta esa semántica real tal cual (Decisión A):
  el checkbox `isDefault` de `PipelineFormPage` se puede marcar y
  desmarcar libremente, sin restricción de UX inventada, y
  `PipelineListPage` representa correctamente el estado de cero defaults
  (sin badge en ninguna fila, nunca un fallback que sugiera que algo
  sigue siendo default). Se evaluó explícitamente la alternativa
  B (bloquear el desmarcado del default actual) y se descartó: hoy no
  existe ningún consumidor real que dependa de que siempre exista un
  default (`Opportunity.pipelineId` se elige explícitamente en cada
  creación, no se autocompleta desde ningún "default"), así que esa
  restricción habría sido una regla inventada por el frontend sin
  contraparte real en el backend.

  **Stage**: CRUD completo, siempre scoped a un `pipelineId` de la URL —
  no existe un listado global de Stage en esta UI (el endpoint sin scope
  existe en el backend pero mezclaría `order` de distintos pipelines, que
  solo es único dentro de cada uno). `probability` (`Decimal(5,2)` en
  Prisma) se tipa como **`string` en lectura** — verificado empíricamente
  que `Prisma.Decimal.toJSON()` devuelve un string
  (`JSON.stringify({ probability: new Decimal("25.50") })` →
  `{"probability":"25.5"}`), nunca `number`, pese a que la escritura
  acepte un `number` real — y se convierte explícitamente con `Number()`
  antes de formatear o de hidratar el campo numérico del formulario de
  edición. Reordenamiento de etapas vía botones **"Subir"/"Bajar"** (sin
  drag-and-drop: sin una razón aprobada para esa complejidad en esta
  primera fase) que solo proponen el `order` del vecino inmediato y
  confían en el refetch posterior a la invalidación para reflejar el
  `order` final que `reindexStages` calculó server-side — nunca
  reordenamiento optimista local. `isWon`/`isLost` se desmarcan
  mutuamente en el cliente como cortesía visual (evita un `409`
  previsible en el caso común); la autoridad real sigue siendo el
  `409`/`CHECK` del backend.

  **Gate del pipeline padre**: `StageListPage` exige que `usePipeline(pipelineId)`
  resuelva con éxito antes de renderizar la tabla de etapas — nunca bajo
  un header fantasma. Esto defiende contra una inconsistencia real del
  backend, descubierta durante el diseño y **fuera de alcance corregir**
  (no se tocó backend): `findManyStages` no valida que el `Pipeline`
  padre siga activo, así que las etapas de un pipeline soft-eliminado
  siguen siendo listables por `GET /stages?pipelineId=X` aunque
  `GET /pipelines/:id` de ese mismo pipeline ya devuelva `404` — el gate
  del frontend es la defensa ante ese caso, no una corrección del dato.

  **Query keys e invalidaciones — corregidas durante el diseño de M4,
  verificadas empíricamente contra `@tanstack/query-core` real** (no
  asumidas): `pipelineKeys` mantiene el shape plano de
  `companyKeys`/`contactKeys`, pero su invalidación es deliberadamente
  más amplia que el patrón selectivo de Company/Contact en el único caso
  en que corresponde — marcar `isDefault: true` invalida `pipelineKeys.all`
  completo (puede desmarcar silenciosamente otro pipeline), mientras que
  `isDefault: false`/sin tocar `isDefault` usa el patrón selectivo normal
  (`lists()` + `detail(id)`); `delete` siempre invalida `.all` (puede
  promover un nuevo default). `stageKeys` es **jerárquica por
  `pipelineId`** (`byPipeline(pipelineId)` como segmento propio del
  array, no una propiedad enterrada dentro del objeto de query — mismo
  modelo mental de prefijo que ya usan `lists()`/`list(query)`): create,
  update y delete siempre invalidan `stageKeys.byPipeline(pipelineId)`
  completo, porque el reindexado puede renumerar hermanas del mismo
  pipeline sin que la respuesta de la mutation las mencione. Verificado
  con un test dedicado a la key factory (`queries.test.ts`, no solo
  inferido vía componentes) sembrando variantes de listado con distinto
  `page`/`sortBy` bajo dos `pipelineId` distintos en un `QueryClient`
  real: invalidar `byPipeline(pipelineId)` marca `stale` **todas** las
  variantes de ese pipeline y **ninguna** de otro.

  **Routing y protección ADMIN**: `/pipelines`, `/pipelines/:pipelineId/stages`
  de lectura abierta a cualquier autenticado; `/pipelines/new`,
  `/pipelines/:id/edit`, `/pipelines/:pipelineId/stages/new`,
  `/pipelines/:pipelineId/stages/:stageId/edit` reutilizan el mismo
  `AdminRoute` ya usado por Company/Contact — sin generalizar el
  componente ni construir RBAC.

  **Tests**: `pipeline/api.test.ts` (5), `pipeline/mutations.test.tsx` (7,
  incluida la distinción `isDefault: true` vs. `false`/omitido),
  `pipeline/PipelineListPage.test.tsx` (12, incluidos los dos escenarios
  de transición de default sin refresh manual), `pipeline/PipelineFormPage.test.tsx`
  (4), `stage/api.test.ts` (6, incluido el round-trip de `probability`
  como string real), `stage/queries.test.ts` (2, key factory dedicada),
  `stage/mutations.test.tsx` (4), `stage/StageListPage.test.tsx` (11,
  incluido el gate del pipeline padre y el reordenamiento sin
  optimistic update), `stage/StageFormPage.test.tsx` (6), y una extensión
  de `auth/AdminRoute.test.tsx` (+8: 4 Pipeline + 4 Stage, mismo criterio
  que las extensiones de M3 — jerarquía real `ProtectedRoute → AdminRoute
  → *FormPage`). **65 tests nuevos; 144 tests en total** en la suite
  frontend completa (16 auth + 26 Company + 37 Contact/CompanySelect/
  AdminRoute-Contact + 65 Pipeline/Stage/AdminRoute-Pipeline-Stage),
  todos verdes.

  Poder de detección verificado con 6 mutaciones deliberadas, todas
  revertidas antes de continuar: `probability.toFixed()` sobre el string
  crudo (detectada por `StageListPage.test.tsx`, 7 tests — confirma
  exactamente el riesgo documentado en `stage/types.ts`), invalidación
  de `useUpdatePipeline` reducida a `lists()`+`detail(id)` incluso con
  `isDefault: true` (detectada por P7a), reintroducción de una
  restricción de UX que bloquea desmarcar el default actual —
  contradice la Decisión A — (detectada por P20), remoción de
  `pipelineId` de `stageKeys.byPipeline` (detectada por 3 tests: ambos
  escenarios de `queries.test.ts` y el chequeo de aislamiento de S7),
  remoción de la invalidación en `useUpdateStage` (detectada por S8 y
  por S17, que confirma que el refetch tras "Subir"/"Bajar" depende de
  esa invalidación), y degradar el gate del pipeline padre a un
  fallback silencioso (detectada por S18).

  **Deuda técnica / notas residuales, no minimizadas**: `StageListPage`
  usa `pageSize: 100` sin controles de paginación propios — una
  simplificación deliberada (un pipeline real tiene, en la práctica, un
  puñado de etapas) que dejaría etapas más allá de la 100 sin forma de
  verse si alguna vez ocurriera; gap Bajo, no bloqueante, declarado en
  vez de oculto. `AppLayout.tsx` sigue sin test de componente propio (gap
  heredado de M2, sin agravarse en M4). Igual que en M2/M3: casos límite
  de paginación de `PipelineListPage` y validación exhaustiva campo por
  campo de ambos formularios no tienen test dedicado — gaps Bajos,
  delegados en la práctica a la validación real del backend (Zod).

  **Reviews obligatorios (Claude-Toolkit-V1), ejecutados desde cero
  contra el deliverable final de M4**: `RV-ENG`: **PASS**. `RV-SECURITY`:
  **PASS**. `RV-STANDARDS`: **PASS**. Sin condiciones pendientes — el
  Gate de M4 queda liberado incondicionalmente.

- ✅ **M5 (módulo Opportunity) implementado y cerrado — reviews ejecutados
  desde cero contra el deliverable final, sin condiciones pendientes.**
  `frontend/src/features/opportunity/` completo, mismo esqueleto
  `types/api/queries/mutations/pages` que Company/Contact/Pipeline/Stage,
  más un slice mínimo de solo lectura `frontend/src/features/user/` (sin
  administración de Users — fuera de alcance) y dos selectores nuevos
  (`pipeline/PipelineSelect.tsx`, `stage/StageSelect.tsx`).

  **Contrato reconstruido antes de implementar** (fase de diseño separada,
  corregida una vez tras revisión antes de aprobarse): `amount` es
  `Decimal(14,2)` en Prisma — mismo caso que `Stage.probability` (M4), se
  tipa **`string` en lectura**, `number` en escritura, nunca `.toFixed()`
  directo sobre el valor crudo. `expectedCloseDate`/`actualCloseDate` son
  `@db.Date` pero se serializan como ISO datetime completo (`res.json()`
  vía `Date.prototype.toJSON()`) — se hidratan con `slice(0, 10)`, nunca
  con `new Date(iso)` + formateo local (evita corrimiento de día por
  timezone), y se escriben como `"YYYY-MM-DD"` directo. `pipelineId`/
  `stageId` son obligatorios en create; `opportunity.service.ts` exige que
  `stageId` pertenezca al `pipelineId` indicado y que un `PATCH` que
  cambia `pipelineId` incluya también `stageId` en la misma operación —
  nunca mueve una oportunidad de pipeline implícitamente. `companyId`/
  `contactId`: al menos uno es obligatorio en create (`CHECK` +
  `refine` de Zod), pero **sin validación cruzada entre ambos** — el
  backend no exige que el `Contact` pertenezca a la `Company` elegida.
  `lostReason`/`expectedCloseDate`/`actualCloseDate` admiten `null`
  explícito solo en update (limpiar el campo), nunca en create.

  **Company y Contact — independientes, corregido durante el diseño**: la
  primera versión del diseño proponía que `ContactSelect` aceptara
  `companyId` como "bias" de búsqueda; se descartó al confirmar que
  `GET /api/contacts?companyId=X` es un filtro **excluyente** real
  (`contact.repository.ts`), no un ranking — filtrar así habría ocultado
  combinaciones válidas (Company A + Contact de Company B, o sin
  Company). `ContactSelect.tsx` (nuevo, mismo patrón que `CompanySelect`)
  no acepta `companyId`; cambiar Company nunca modifica el Contact ya
  elegido, y viceversa.

  **Pipeline y Stage — dependientes, sí con reset real**: `PipelineSelect.tsx`
  (nuevo, `<select>` simple sin búsqueda de texto — cardinalidad baja
  esperada) y `StageSelect.tsx` (nuevo, scoped a `pipelineId`,
  deshabilitado/vacío sin pipeline elegido). Cambiar `pipelineId` en
  `OpportunityFormPage` limpia `stageId` — a diferencia de Company/Contact,
  esto sí está justificado por una regla real del backend (un stage de
  otro pipeline es rechazado). `useStages` (`stage/queries.ts`) y
  `useContacts` (`contact/queries.ts`) recibieron un `options.enabled`
  opcional (aditivo, sin romper ningún caller existente) — necesario para
  que `StageSelect` nunca dispare `GET /stages` sin `pipelineId` y para
  que `ContactSelect` nunca precargue un listado antes de que el usuario
  busque; sin este cambio, alguno de los dos violaba las Reglas de Hooks o
  perdía el aislamiento server-side por texto que ya tenía `CompanySelect`.

  **Owner — corregido durante el diseño**: `GET /api/users` es
  ADMIN-only (`user.routes.ts`) y no tiene `search` ni `GET /api/users/:id`
  — a diferencia de Company/Contact/Pipeline/Stage. Como las 3 rutas de
  escritura de Opportunity ya son ADMIN-only, `UserSelect.tsx` (nuevo,
  `<select>` simple, `isActive:true` explícito, `pageSize:100`,
  `sortBy:"fullName"`) puede usarse sin riesgo de 403 en
  `OpportunityFormPage`. La primera versión del diseño proponía resolver
  el nombre del owner en `OpportunityListPage` con el mismo `useUsers`
  incondicional; se corrigió antes de implementar: `useOwnerNames(isAdmin)`
  (`opportunity/relationResolution.ts`) gatea el fetch con `enabled`
  real — para `USER` la request a `/api/users` **nunca se dispara**, la
  columna "Owner" no se renderiza (ni vacía ni con el id crudo), y el
  resto de la página funciona igual sin ese catálogo.

  **`lostReason` — corregido durante el diseño**: la primera versión
  proponía mostrarlo solo cuando `status === "LOST"`; se descartó porque
  dejaba sin definir qué pasa al volver de `LOST` a `OPEN`/`WON`. Queda
  **siempre visible y editable**, con un texto de ayuda estático (no
  condicional). Cambiar `status` nunca lo toca; limpiarlo explícitamente
  en edición envía `null` (vía la misma asimetría create/undefined vs.
  update/null que ya usan `expectedCloseDate`/`actualCloseDate`); no
  tocarlo reenvía el mismo valor hidratado, nunca `null`/`undefined` por
  accidente.

  **Resolución de relaciones — deliberadamente local, no generalizada**:
  `opportunity/relationResolution.ts` reexporta `useCompaniesByIds` de
  `contact/companyResolution.ts` **sin modificar ese archivo** (decisión
  explícita: Stage y User no encajan en la misma abstracción — Stage
  necesita la clave compuesta `(pipelineId, stageId)`, User no tiene
  `GET /:id` — no hay evidencia suficiente todavía para una abstracción
  compartida). `useContactNames`/`usePipelineNames` repiten el mismo
  patrón estructural que `useCompaniesByIds` a propósito, sin forzarlo en
  un helper genérico. Ningún fallback humano muestra UUID crudo — `"—"`
  ante una relación que no resuelve (ej. Company borrada después de
  vincularse).

  **Query keys e invalidaciones**: `opportunityKeys` es **plana** (mismo
  shape que `companyKeys`/`contactKeys`/`pipelineKeys`), no jerárquica
  como `stageKeys` — Opportunity no está scoped a un único padre
  obligatorio por URL. Invalidación selectiva pura en las 3 mutaciones
  (`lists()` + `detail(id)` según corresponda): confirmado en
  `opportunity.repository.ts` que ninguna escritura de Opportunity toca
  otra tabla, así que no hay justificación real para invalidar
  `companyKeys`/`contactKeys`/`pipelineKeys`/`stageKeys`/`userKeys` desde
  acá — verificado con un test negativo dedicado.

  **Routing y protección ADMIN**: `/opportunities` de lectura abierta a
  cualquier autenticado; `/opportunities/new`, `/opportunities/:id/edit`
  reutilizan el mismo `AdminRoute` ya usado por Company/Contact/Pipeline/
  Stage.

  **Tests**: `opportunity/api.test.ts` (8), `opportunity/queries.test.ts`
  (2, key factory), `opportunity/mutations.test.tsx` (5, incluido el test
  negativo de invalidaciones ajenas), `opportunity/relationResolution.test.tsx`
  (7), `opportunity/ContactSelect.test.tsx` (6, incluida la independencia
  real de Company), `opportunity/OpportunityListPage.test.tsx` (11,
  incluidos ADMIN-ve-Owner / USER-no-llama-a-Users / USER-no-ve-Owner),
  `opportunity/OpportunityFormPage.test.tsx` (14, incluidos
  Pipeline→Stage reset, Company/Contact independientes, `lostReason`
  siempre visible, semántica create/update de fechas), `pipeline/PipelineSelect.test.tsx`
  (3), `stage/StageSelect.test.tsx` (5), `user/api.test.ts` (4),
  `user/UserSelect.test.tsx` (4), y una extensión de `auth/AdminRoute.test.tsx`
  (+4: Opportunity, mismo criterio que las extensiones de M3/M4). **73
  tests nuevos; 217 tests en total** en la suite frontend completa (144
  heredados de M4 + 73 de M5), todos verdes.

  Poder de detección verificado con 12 mutaciones deliberadas, todas
  revertidas antes de continuar (archivos confirmados de vuelta a su
  estado exacto, sin residuos): inyección de `organizationId` en el
  payload, `amount` enviado como string, fecha serializada como ISO
  completo en vez de `"YYYY-MM-DD"`, remoción del reset de `stageId` al
  cambiar `pipelineId`, filtrar `ContactSelect` por `companyId`, resetear
  `contactId` al cambiar Company, invalidación ampliada a
  `pipelineKeys.all` desde `useUpdateOpportunity`, fallback de UUID crudo
  en vez de `"—"`, `useOwnerNames` disparado incondicionalmente para
  `USER`, columna Owner/`ownerId` crudo visible para `USER`, borrado
  automático de `lostReason` al cambiar `status`, y bypass de `AdminRoute`
  (esta última detectada en 10 de los 20 tests de `AdminRoute.test.tsx` —
  las 5 entidades que comparten el componente). **Dos hallazgos reales
  del propio proceso de mutación, corregidos antes de cerrar el ciclo**:
  (1) la serialización incorrecta de fecha en creación no tenía ningún
  test que la cubriera — se agregó uno explícito; (2) el test de "USER no
  llama a `/api/users`" dependía de que una request no manejada bajo
  `onUnhandledRequest:"error"` hiciera fallar el test por sí sola, lo cual
  resultó falso en la práctica (la query interna solo entra en estado de
  error, sin lanzar una excepción que Vitest capture) — se reemplazó por
  un contador de requests real. Ambos gaps se confirmaron primero (la
  mutación pasaba desapercibida), se cerraron, y luego se re-verificó que
  la mutación correspondiente sí fallara.

  **Deuda técnica / notas residuales, no minimizadas**: `PipelineSelect` y
  `UserSelect` usan `pageSize: 100` sin búsqueda de texto — límite real
  del contrato backend (`GET /api/pipelines` si tiene `search` pero no se
  usó por simplicidad dado el volumen esperado; `GET /api/users` no tiene
  `search` en absoluto). La resolución de nombre de Owner en
  `OpportunityListPage` depende de esa misma lista de hasta 100 usuarios
  activos — si una organización superara ese número, algún owner visible
  podría no resolver a nombre y caer al fallback `"—"` pese a ser un
  usuario real y activo; no solucionable desde el frontend sin que el
  backend agregue `GET /api/users/:id` o búsqueda por nombre. `status` y
  `Stage.isWon`/`isLost` pueden quedar semánticamente inconsistentes (nada
  los sincroniza a nivel backend) — no se inventó esa sincronización.
  `actualCloseDate` no se autocompleta al marcar `status: WON/LOST` — el
  backend tampoco lo hace. `opportunity/relationResolution.ts` importa un
  hook desde `features/contact/companyResolution.ts` (cross-feature
  import) — aceptado explícitamente para no generalizar ni tocar ese
  archivo en este ciclo. `AppLayout.tsx` sigue sin test de componente
  propio (gap heredado de M2, sin agravarse en M5).

  **Reviews obligatorios (Claude-Toolkit-V1), ejecutados desde cero
  contra el deliverable final de M5** (diseño y código final revisados
  por separado — no se reutilizó el review de diseño como sustituto):
  `RV-ENG`: **PASS**. `RV-SECURITY`: **PASS**. `RV-STANDARDS`: **PASS**.
  Sin condiciones pendientes — el Gate de M5 queda liberado
  incondicionalmente.

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
  las rutas de escritura de los 8 módulos de negocio.
- ✅ Onboarding inicial (`POST /api/onboarding`, `src/services/onboarding.service.ts`)
  — crea `Organization` + `User` ADMIN + identidad en Supabase Auth como una única
  operación lógica, verificado contra la base real (auth.users, public.users,
  Organization, Role consistentes; idempotente ante email/organización duplicados;
  sin datos huérfanos ante fallos, con compensación automática). Implementado como
  endpoint de backend, no como trigger de DB — ver el cambio de diseño documentado en
  `authentication-architecture.md` sección 1.
- ✅ **Sin endpoint de login en Express, por diseño — no es un pendiente.** El login
  no pasa por Express: el frontend habla directo con Supabase Auth
  (`signInWithPassword`, ver sección 3 de `authentication-architecture.md`) — no
  existe ni debe existir un endpoint propio de login en este backend bajo la
  arquitectura aprobada. El login frontend **sí está implementado** (M1,
  `frontend/src/features/auth/LoginPage.tsx` + `AuthContext.tsx`, ver arriba);
  tras la sesión de Supabase, el frontend obtiene la identidad de negocio
  (`organizationId`/`role`) llamando a `GET /api/me`, nunca del JWT.
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
- ✅ `GET /api/me` — identidad de negocio del usuario autenticado
  (`{id, email, fullName, organizationId, role}`), cualquier rol. No hace
  ninguna query propia: serializa `req.auth`, ya resuelto por `authenticate`
  (`resolveAuthContext`) para ese mismo request. Sin esto, el frontend no
  tenía ninguna forma de conocer su propio `role`/`organizationId` tras un
  login normal (el JWT de Supabase solo prueba identidad, nunca lleva esos
  datos — ver sección 6). `isActive`/`createdAt`/`updatedAt` se excluyen a
  propósito: el primero es redundante (si la respuesta es `200`, ya implica
  `isActive: true`, de lo contrario `resolveAuthContext` la habría
  rechazado con `403`), y los otros dos no tienen ningún consumidor real en
  el frontend hoy.

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
- ✅ Rate limiting a nivel de Express (M1, `src/middlewares/rateLimit.ts`) —
  `POST /api/onboarding`: por IP, 5 intentos / 15 min (cuenta solo body
  Zod-válido). `POST /api/invitations/accept`: dos etapas — por IP antes de
  verificar el JWT (20/5min, cuenta todo request, mitiga el costo de intentar
  verificar un token de cualquier actor anónimo) y por identidad Supabase ya
  verificada después (10/10min, cuenta solo identidad+body válidos, mitiga
  abuso de una sesión ya autenticada). `verifyInvitationAcceptIdentity`
  (`src/middlewares/verifyInvitationAcceptIdentity.ts`) verifica el JWT una
  sola vez y comparte la identidad entre el limiter y el controller/service.
  Números baseline operacionales, ajustables según observabilidad real, no
  umbrales definitivos. Store: `MemoryStore` (default de la librería) — ver
  limitación operacional en sección 9.
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
   apenas un puñado de invitaciones reales en poco tiempo) y sigue vigente,
   verificado contra la documentación oficial de Supabase (2 emails/hora con
   el SMTP por defecto, 30/hora con SMTP propio recién configurado). No es un
   bug del código: es una limitación de configuración externa que hay que
   resolver antes de usar `Invitation` con usuarios reales en producción.
   **LOW-3 (2026-07-12)**: las dos ramas de `createInvitation` que resuelven
   antes de esta llamada (email ya es un `User` existente, ya existe una
   `Invitation` PENDING) ya tienen cobertura persistente contra Postgres real
   (`src/services/invitation.service.integration-test.ts`). El tramo
   `createInvitation` → `inviteUserByEmail` en sí —la llamada real a Supabase
   y el round-trip HTTP completo de creación de una invitación— sigue sin
   cobertura persistente, deliberadamente: no puede ejercitarse repetidamente
   sin arriesgar el cupo de envío de email del proyecto.

2. **Rate limiting a nivel de Express — ✅ resuelto (M1, 2026-07-12).**
   `POST /api/onboarding` y `POST /api/invitations/accept` ya tienen protección de
   tasa propia (`express-rate-limit`) — ver sección 7 (Seguridad) para el detalle
   de la política de cada endpoint y sección 9 para la limitación operacional del
   store elegido.

3. **Investigar la magnitud de latencia observada bajo escrituras condicionales
   concurrentes — ✅ investigado y entendido (LOW-2, 2026-07-12), sin
   remediation de código.** La hipótesis original ("contención en el pool de
   conexiones de Prisma bajo concurrencia real") quedó descartada por
   evidencia directa: la misma latencia, estable, aparece igual en ejecución
   100% secuencial sin ninguna concurrencia — no depende de que dos
   operaciones compitan entre sí.

   Causa raíz demostrada: `DATABASE_URL` usa el pooler compartido de Supabase
   (**Supavisor**, no PgBouncer clásico — ver sección 2) en **modo
   transacción, puerto 6543, con `pgbouncer=true`** — esta es la
   configuración deliberada y soportada para Prisma contra Supavisor en modo
   transacción (verificado contra la documentación oficial vigente de
   Supabase y de Prisma: el modo transacción de Supavisor no soporta
   prepared statements, y `pgbouncer=true` es exactamente la bandera
   correcta para eso, no una configuración pendiente de corregir).

   Bajo esa configuración soportada, las llamadas de repository trazadas
   durante la investigación (`Role`, `Organization`, `User`, `Invitation` —
   `findFirst`/`findMany`/`create`/`update`/`updateMany`, fuera de un
   `prisma.$transaction` explícito) mostraron consistentemente cuatro
   round-trips de red reales por llamada (`BEGIN` / `DEALLOCATE ALL` / la
   query / `COMMIT`) en vez de uno — `DEALLOCATE ALL` es el mecanismo
   esperado de esa configuración soportada, no un bug. Dentro de un
   `prisma.$transaction` explícito, varias escrituras comparten un solo
   envoltorio (confirmado en el mismo trazado: la escritura condicional y la
   creación de `User` de `acceptInvitation` comparten un único
   `BEGIN`/`COMMIT`). `acceptInvitation`/`revokeInvitation` encadenan varias
   llamadas sin agruparlas, así que el costo observado en esos dos flujos
   específicos se acumula linealmente con la cantidad de round-trips —
   demostrado directamente, sin relación con locks ni con contención de
   ningún tipo.

   Esto **no se verificó exhaustivamente sobre cada repository del
   proyecto** — es una muestra de un puñado de modelos y formas de query, no
   una garantía universal confirmada. El mecanismo que lo causa es de
   configuración de conexión (`pgbouncer=true`), no de contenido de query, lo
   que da una razón estructural para esperar que se replique en otras
   llamadas del mismo cliente Prisma fuera de una transacción explícita — se
   documenta acá como un **patrón potencialmente transversal, no confirmado
   en el resto del código**, y no abordado como tema general en este ciclo
   (fuera de su alcance).

   El RTT exacto medido (~37ms por hop) pertenece al entorno donde se
   investigó y no debe leerse como la latencia esperada de producción —
   depende de la distancia de red real hacia el proyecto de Supabase.

4. **Entidad `Invitation`: la remoción/revocación no libera el email en
   Supabase.** Ver sección 9 — limitación real de la plataforma, no de este
   código.

5. **Frontend — M1 (autenticación y sesión) — ✅ implementado.** `login`,
   `AuthContext`/`AuthProvider` y `ProtectedRoute` existen. **M2 (Company +
   remediación de `STD-SW-003`) — ✅ implementado (ver sección 7).**
   `AppLayout`, módulo `Company` completo (list/create/edit/soft-delete
   con confirmación y error de delete reales, protección visual `AdminRoute`
   en las rutas de escritura, soporte de capa API para `ownerId`) y
   cobertura automatizada persistente de los 14 escenarios de auth/sesión
   de M1 **más** los critical paths de Company (42 tests en total, 16 +
   26). Reviews del Toolkit, ejecutados desde cero contra el deliverable
   final de M2: `RV-ENG`, `RV-SECURITY` y `RV-STANDARDS` en **PASS** pleno,
   sin condiciones pendientes. **M3 (Contact + relación Contact→Company) —
   ✅ implementado y cerrado (ver sección 7)**: módulo `Contact`
   completo (mismo patrón que Company), `CompanySelect` reutilizado desde
   Company como selector/filtro server-side (con fallback humano, nunca
   el UUID crudo, ante una resolución fallida de la Company
   seleccionada), `useCompaniesByIds` para resolver nombres de Company en
   el listado de Contacts sin asumir un máximo de Companies en la
   organización, 37 tests nuevos (79 en total). Reviews del Toolkit,
   ejecutados desde cero contra el deliverable final de M3: `RV-ENG`,
   `RV-SECURITY` y `RV-STANDARDS` en **PASS** pleno, sin condiciones
   pendientes. **M4 (Pipeline + Stage) — ✅ implementado y cerrado (ver
   sección 7)**: módulo `Pipeline` completo (`isDefault` con semántica
   corregida — a lo sumo un default, nunca exactamente uno; el checkbox
   se puede desmarcar libremente), módulo `Stage` completo (siempre
   scoped a un pipeline, `probability` tratada como `string` en lectura
   por el shape real de `Prisma.Decimal`, reordenamiento por botones sin
   drag-and-drop, gate del pipeline padre), `stageKeys` jerárquica por
   `pipelineId` verificada empíricamente contra `@tanstack/query-core`
   real, 65 tests nuevos (144 en total). Reviews del Toolkit, ejecutados
   desde cero contra el deliverable final de M4: `RV-ENG`, `RV-SECURITY`
   y `RV-STANDARDS` en **PASS** pleno, sin condiciones pendientes.
   **M5 (Opportunity) — ✅ implementado y cerrado (ver sección 7)**:
   módulo `Opportunity` completo (`amount` tratado como `string` en
   lectura por el shape real de `Prisma.Decimal`, fechas hidratadas con
   `slice(0, 10)` sin conversión local, Company/Contact independientes —
   sin filtro cruzado, corregido durante el diseño —, Pipeline/Stage
   dependientes con reset real de `stageId`), selector de owner
   (`UserSelect`) nuevo y funcional para el formulario ADMIN de
   Opportunity (`GET /api/users` consumido por primera vez), columna
   Owner del listado gateada de verdad por rol (`useOwnerNames(isAdmin)`
   — `USER` nunca dispara esa request), 73 tests nuevos (217 en total).
   Reviews del Toolkit, ejecutados desde cero contra el deliverable final
   de M5: `RV-ENG`, `RV-SECURITY` y `RV-STANDARDS` en **PASS** pleno, sin
   condiciones pendientes. **Frontend — M6 en adelante.** Todavía faltan
   `Activity`, administración de `Users`/`Invitations`, Dashboard (sin
   endpoint de agregación backend todavía) y el filtro visual/selector de
   `ownerId` por nombre en Company y en Contact específicamente (capa API
   ya soportada desde M2/M3, ver sección 7 — M5 sí agregó el selector
   para Opportunity porque ahí es un campo central del formulario, no
   solo un filtro de listado; extenderlo a Company/Contact queda
   pendiente, es la misma `GET /api/users` ya consumida) — es lo que
   falta para que el backend sea un producto entregable completo, no solo
   una API verificada con los primeros módulos de negocio funcionales.

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
  `Invitation`, con semántica distinta de `isActive` — ver sección 4). De los
  10 modelos, quedan 2 sin `deletedAt`, sin ser la misma asimetría que
  `User`/`Stage` tenían: `Role` sigue sin `deletedAt` porque es un catálogo
  global sin ciclo de vida propio; `Invitation` tampoco lo tiene, pero de
  forma deliberada — su ciclo de vida ya está representado por `status`
  (`PENDING | ACCEPTED | REVOKED | EXPIRED`, ver sección 4), no por ausencia
  de resolver (ver también sección 5).

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
  Trazabilidad de cobertura de `Invitation` por nivel de prueba (LOW-3,
  revisado 2026-07-12): HTTP real contra un servidor Express real existe solo
  para `POST /api/invitations/accept` (`src/middlewares/rateLimit.integration-test.ts`).
  A nivel service/integración (Postgres real, sin pasar por HTTP) están
  cubiertos `acceptInvitation`/`revokeInvitation` completos y, desde esta
  revisión, las dos ramas de `createInvitation` previas a Supabase
  (`src/services/invitation.service.integration-test.ts`). El tramo
  `createInvitation` → `inviteUserByEmail` —ni a nivel service ni a nivel
  HTTP— no tiene cobertura persistente: es el único tramo bloqueado por el
  límite externo de esta sección, no el flujo de `Invitation` completo.

- **El rate limiting de M1 (`POST /api/onboarding`, `POST /api/invitations/accept`)
  usa `MemoryStore` — límite operacional deliberado, no un descuido.** Estado en
  memoria del propio proceso Node: se resetea en cada restart/deploy, y **no se
  comparte entre múltiples instancias/procesos** — si algún día la app corre con
  más de una réplica, cada una aplicaría su propio cupo independiente,
  multiplicando el límite real por la cantidad de instancias sin ningún error ni
  aviso. Correcto hoy porque la topología demostrada de Plataforma CRM es un
  proceso único (`node dist/server.js`, sin Dockerfile/orquestador/evidencia de
  réplicas en este repo). **Antes de desplegar múltiples instancias, la política
  de rate limiting debe migrar a un store compartido** (Postgres, reusando la
  única infraestructura de estado compartido que el proyecto ya tiene, o un
  proveedor externo tipo Redis) — no es automático, alguien tiene que hacerlo
  explícitamente en ese momento.

- **`accept`/`revoke` de `Invitation` sin `invitationId` explícito — corregido
  (LOW-1, commit `24b8ed3`).** Descubierto durante la verificación de las
  carreras concurrentes de H3/H4: el camino "sin `invitationId`" buscaba
  únicamente entre invitaciones `PENDING`, así que cualquier invitación que ya
  había transicionado fuera de `PENDING` (por una carrera real, o simplemente
  porque ya se había resuelto hace rato) quedaba invisible para esa búsqueda y
  daba un `404`/`400` genérico en vez del `409`/`410` específico — nunca una
  violación de invariante de datos (verificado manualmente en 30+ carreras
  reales durante la sesión histórica de H3/H4, no como test persistente),
  sino una imprecisión de respuesta. Corregido reemplazando esa búsqueda por
  `findInvitationsByEmail` (sin filtro de status, `createdAt DESC` explícito):
  hoy, exista o no una invitación `PENDING`, se reporta siempre el estado real
  y específico — `revokeInvitation` recibió el mismo tratamiento. Cobertura
  persistente en `src/services/invitation.service.integration-test.ts`
  (mecanismo distinto: lock determinístico de Postgres para forzar el CAS
  perdido, no las carreras `Promise.all` originales de H3/H4 — ver sección 3).

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

- **Sigue sin existir configuración de linter/formatter (ESLint, Prettier).**
  A diferencia de los tests (ver abajo), introducir esto después es más caro
  (hay que adaptar código ya escrito) que configurarlo desde el arranque de
  `src/`. Sí existen suites de test persistentes desde H1: unitarias
  (`*.test.ts`, `npm test`, sin DB) y de integración (`*.integration-test.ts`,
  `npm run test:integration`, contra Postgres/Supabase real) — 8 archivos de
  test en total a la fecha, cubriendo H1/H2/M3/M4/H-1/M1/LOW-1/LOW-3/PIPE-DEFAULT-GHOST/T-1/T-2.

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
