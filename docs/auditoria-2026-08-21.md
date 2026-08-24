# Auditoría del proyecto — 2026-08-21

Auditoría completa del estado del repositorio, previa al diseño de la capa
de ingesta.

---

## 0. Alcance, método y limitaciones

**Qué se auditó.** Backend completo (`src/**`, 8.669 líneas), `prisma/`
(schema, las 5 migraciones, `manual_constraints.sql`, `rls_policies.sql`,
`seed.ts`), `scripts/`, `.github/workflows/ci.yml`, `frontend/src/**`
(110 archivos, 9.327 líneas), y los tres documentos de `docs/` + `README.md`.

**Método.** Lectura directa del código, sin ejecución. Cada hallazgo está
anclado a `archivo:línea` con la cita del código real.

**Limitaciones — importante.**

1. **No se ejecutó nada contra una base de datos.** Todo lo que depende del
   estado real de Postgres o de la configuración del proyecto de Supabase
   está marcado como **pendiente de verificación** y se lista en la
   sección 8, con el SQL exacto para resolverlo.
2. La auditoría se hizo sobre una **copia del repositorio tomada el
   2026-08-21**. La mayoría de los archivos `*.test.tsx` del frontend no
   formaron parte de la copia: la ausencia de un test en la copia **no**
   implica su ausencia en el repositorio.
3. Las conjeturas están marcadas como tales. No se reporta como hecho nada
   que no se haya leído en el código.

**Convención de severidad.**

| Nivel | Criterio |
|---|---|
| **CRÍTICO** | Compromete la seguridad o la integridad de los datos, o bloquea la etapa siguiente |
| **ALTO** | Falla real esperable en producción, o deuda que encarece mucho el paso siguiente |
| **MEDIO** | Falla bajo concurrencia o escala; inconsistencia de contrato |
| **BAJO** | Deuda menor, prolijidad, o riesgo de baja probabilidad |

---

## 0.1. Estado de remediación — actualizado 2026-08-21

Los tres hallazgos CRÍTICOS fueron corregidos y **verificados contra una base
real** el mismo día de la auditoría, aprovechando que el proyecto de Supabase
original se perdió y hubo que recrear la base desde cero (ver
`docs/supabase-setup.md`).

| # | Estado | Evidencia |
|---|---|---|
| **C-1** | ✅ Resuelto y verificado | Migración `20260821140100`. Diagnóstico filas 1 y 2: `anon`/`authenticated` sin permisos de lectura **ni** escritura sobre `public`. Se aplicó la opción A |
| **C-2** | ✅ Resuelto y verificado | Migración `20260821140000`. Diagnóstico filas 7, 8, 9 y 10 en `ninguno faltante` sobre una base construida **solo con `migrate deploy`** — los 36 objetos se reconstruyen desde el historial |
| **C-3** | ✅ Resuelto y verificado | Migración `20260821140200`. Las 15 FKs cruzadas son compuestas `(organization_id, x_id) → padre(organization_id, id)`, confirmadas con `pg_get_constraintdef` |

**V-3 confirmado:** el rol de `DATABASE_URL` (`postgres`) tiene `BYPASSRLS`.
La premisa de la sección 5 de `docs/authentication-architecture.md` es cierta:
RLS no protege el camino Express → Prisma → Postgres, y el filtro por
`organizationId` en cada query sigue siendo la defensa principal.

**Decisión de diseño tomada durante la corrección:** las 9 FKs compuestas con
columna nullable usan `ON DELETE NO ACTION` en lugar del `SET NULL` acotado
por columna de Postgres 15+. El DSL de Prisma no puede expresar el acotado, y
declarar `SetNull` en `schema.prisma` mientras el SQL hace `SET NULL (columna)`
dejaría al schema y a la migración diciendo cosas distintas — reintroduciendo
por la puerta de atrás el problema que C-2 vino a eliminar. Como el proyecto
usa soft delete y nada se borra físicamente (ver ALTO-8), ambas acciones son
indistinguibles en la práctica. `npx prisma validate` pasa sin warnings.

Sin cambios de estado: ALTO-1 a ALTO-13 (salvo lo indicado), y todos los
MEDIO y BAJO. Las filas 11 y 12 del diagnóstico confirman que **A-6** (falta
`(organization_id, created_at)`) y **A-7** (sin `pg_trgm`) siguen abiertos.

---

## 1. Estado general

El código de aplicación está por encima del promedio para esta etapa, y eso
es relevante para priorizar: **la deuda encontrada es casi toda perimetral**
—base de datos, CI, operaciones, herramientas— y no de diseño.

Verificado y correcto, para no romperlo:

- **Separación de capas sin excepciones.** Ningún controller importa
  `prisma`; no hay un solo `res.` fuera de `src/controllers/`. Los
  repositorios no tienen lógica de negocio.
- **Aislamiento multi-tenant forzado en la capa correcta.** Todas las
  escrituras usan `updateMany({ where: { id, organizationId } })`: la
  garantía es el `WHERE` de la escritura, no el pre-check del service.
  No se encontró **ni un solo IDOR**; ningún `organizationId` llega desde
  el cliente.
- **Validación completa.** Zod en el 100% de los endpoints con input, vía
  `parseOrThrow` (`utils/validation.ts:13`). Sin mass assignment:
  `z.object()` descarta claves desconocidas.
- **Concurrencia bien resuelta donde se miró:** compare-and-swap en
  `Invitation` (`invitation.repository.ts:122-138`),
  `lockOrganizationForUpdate` en Pipeline y User, reindexado en dos fases
  de Stage.
- **TypeScript en serio:** `strict: true`, **un solo `any`** justificado en
  8.669 líneas, cero `@ts-ignore`, cero non-null assertions.
- **Frontend:** el aislamiento de cache multi-tenant al cambiar de usuario
  (`queryClient.clear()` antes de exponer la identidad nueva + identidad en
  la queryKey de `/me`) está resuelto con rigor y probado, incluida la
  carrera A→B. Es el bug clásico de esta arquitectura y acá está cerrado.

---

## 2. Hallazgos CRÍTICOS

### C-1 — Las políticas RLS **otorgan** escritura que Express deniega

**Archivo:** `prisma/sql/rls_policies.sql:64-127`

```sql
create policy users_isolation on public.users
  for all                                    -- SELECT + INSERT + UPDATE + DELETE
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
```

El mismo patrón `for all` se repite en `companies`, `contacts`,
`opportunities`, `pipelines`, `activities`, `stages` e `invitations`. Y
`rls_policies.sql:55-58` permite a cualquier autenticado leer el catálogo
`roles`.

**No hay ningún `REVOKE ... FROM anon, authenticated` en el repositorio**
(verificado por grep sobre `prisma/` completo), ni `FORCE ROW LEVEL
SECURITY`.

El documento de arquitectura contempla el riesgo de que RLS sea
*bypasseada* por el rol de Prisma (`docs/authentication-architecture.md:496-512`).
No contempla el inverso: que RLS sea la **puerta de entrada**.

**Cadena de explotación** (pendiente de confirmar el paso 2, ver §8):

1. El frontend expone la anon key al navegador (`frontend/src/lib/supabase.ts:18`)
   y hace login directo contra Supabase Auth. PostgREST está vivo y nadie
   lo mira: el frontend nunca usa `.from()`, solo `supabase.auth.*`.
2. Supabase aplica `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO
   anon, authenticated` para las tablas creadas por el rol `postgres` —
   que es el rol con el que corren las migraciones
   (`scripts/apply-manual-sql.ts:37`).
3. Un usuario con rol `USER`, con su propio token y la anon key pública:

```
GET   /rest/v1/roles?select=id,name           → UUID del rol ADMIN
PATCH /rest/v1/users?id=eq.<su-propio-uuid>   → {"role_id": "<uuid ADMIN>"}
```

4. En el request siguiente, `resolveAuthContext` (`auth.service.ts:11`)
   relee el rol desde Postgres y devuelve ADMIN. El principio de no cachear
   el rol —que es una virtud del diseño— acelera la escalada.

Por la misma vía se saltean: `authorize("ADMIN")` en todas las escrituras,
todo Zod, la protección del último ADMIN (`user.service.ts:113-140`), la
del último Pipeline (`pipeline.service.ts:202-208`), los CHECK de negocio,
el CAS de invitaciones, y la lectura de todas las filas soft-deleted.

**Lo que sí está bien:** el `with check` bloquea el movimiento entre
tenants (`current_organization_id()` es `STABLE`). **No hay fuga
cross-tenant por esta vía; hay escalada total dentro del tenant.**

**Opciones**

| Opción | Qué hace | Trade-off |
|---|---|---|
| **A (recomendada)** | `revoke all on all tables in schema public from anon, authenticated;` + `alter default privileges in schema public revoke all on tables from anon, authenticated;` al final de `rls_policies.sql` | Cierra PostgREST por completo; las políticas quedan como defensa en profundidad *real*. Si algún día se quiere Realtime o cliente directo, hay que habilitarlo tabla por tabla — decisión consciente en vez de default |
| **B** | Bajar las políticas a `for select` | Sigue exponiendo lectura de filas soft-deleted, de `users.is_active` y de `invitations` (emails de no-miembros) a cualquier `USER`, salteando el ADMIN-only de `GET /api/invitations`. Media medida |
| **C** | Endurecer solo `users` e `invitations`, dejar el resto `for all` | Corta la escalada de rol pero deja intacto el bypass de `authorize` en las 6 entidades restantes. No recomendada |

En cualquiera de las tres, agregar
`alter table public._prisma_migrations enable row level security;` — es la
única tabla del esquema `public` sin RLS.

---

### C-2 — 36 objetos de DDL viven fuera del historial de migraciones

**Archivos:** `prisma/sql/manual_constraints.sql:1-5`,
`prisma/sql/rls_policies.sql`, `scripts/apply-manual-sql.ts:36-60`

Ni `manual_constraints.sql` ni `rls_policies.sql` están referenciados por
ninguna migración (verificado contra las 5). El único aplicador es
`npm run migrate:deploy`.

**Inventario de lo que no reconstruye `prisma migrate deploy` estándar:**

| Origen | Objetos |
|---|---|
| `manual_constraints.sql:20-63` | 2 funciones + 2 triggers de sincronización de email |
| `manual_constraints.sql:71-114` | 7 índices únicos parciales |
| `manual_constraints.sql:126-154` | 4 CHECK constraints |
| `rls_policies.sql:27-35` | función `current_organization_id()` |
| `rls_policies.sql:42-127` | 10 `ENABLE RLS` + 10 políticas |

**Por qué es crítico y no cosmético.** El problema no es que el SQL esté
en un archivo aparte: es que **el comando estándar hace lo incorrecto**.
Quien corra `prisma migrate deploy` —lo que haría cualquiera, y lo que hará
cualquier pipeline de deploy futuro— levanta un entorno que *parece sano*
(migrado, con el seed corrido porque `prisma migrate reset` ejecuta el seed
automáticamente) pero sin ninguna de las defensas. Y el código depende de
ellas como defensa **primaria**, explícitamente:

- `invitation.service.ts:88-92`: *"el índice único parcial
  `invitations_org_email_pending_unique` rechaza el segundo INSERT — eso es
  lo que garantiza"*.
- `activity.service.ts:262-265`: *"La defensa real que nunca falla es
  `activities_related_entity_check`"*.
- Sin `stages_pipeline_order_unique`, el reindexado en dos fases de
  `stage.repository.ts:232-260` **pierde su razón de ser**: el truco del
  `order` negativo existe únicamente porque la constraint se evalúa por
  statement. Sin la constraint, el bug que previene deja de dar error y
  pasa a ser corrupción silenciosa del orden.
- Sin `contacts_org_email_unique`, `rethrowAsConflict`
  (`contact.service.ts:94-113`) nunca se dispara: entran emails duplicados
  por organización en silencio.
- Sin las 10 políticas RLS, las tablas quedan legibles cross-tenant para
  `anon`/`authenticated`.

**Prisma no puede verlos.** `schema.prisma:160-162, 228-229, 255-256,
289-291, 329-331, 371-373` son comentarios en prosa, no declaraciones. CHECK,
triggers, RLS e índices parciales no son representables en el DSL, así que
`migrate dev` no puede generarlos y `db pull` no puede round-trippearlos.
La *shadow database* de Prisma nunca los tiene.

**Nota:** `schema.prisma` **sí** coincide con el estado que producen las
migraciones (verificado índice por índice). La deriva no está entre schema
y migraciones: está entre migraciones y **base real**.

**Opciones**

| Opción | Cómo | Trade-off |
|---|---|---|
| **A (recomendada)** | `prisma migrate dev --create-only` y pegar el DDL dentro del `.sql` generado; dejar los archivos actuales como referencia legible | Único enfoque donde `reset` reconstruye el estado completo y CI reproduce producción. Los `.sql` dejan de ser reaplicables idempotentemente — que es exactamente lo correcto para una migración |
| **B** | Migración "sello" por deploy con el DDL copiado por script | Menos disciplina manual, pero sigue habiendo un paso generable que alguien puede saltear |
| **C (complemento, no sustituto)** | Test de integración que consulte `pg_indexes` / `pg_constraint` / `pg_policies` y falle si falta cualquiera de los 36 objetos; correrlo en CI y como smoke post-deploy | No previene la pérdida, la detecta. Barato y de alto valor **incluso si se implementa A**: es lo único que hoy convertiría un fallo silencioso en ruidoso |

Recomendación: **A + C**. Y A es prerequisito de levantar Postgres en CI
(ver ALTO-1): sin A, el CI aplicaría un schema sin constraints y los tests
de integración fallarían por razones incomprensibles.

---

### C-3 — Cero FKs compuestas con `organization_id`

**Archivo:** `prisma/migrations/20260710203208_init/migration.sql:274` y 18 más

```sql
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
```

Las 19 FKs del modelo son de columna simple. Postgres verifica que el UUID
exista en la tabla padre — **no que pertenezca a la misma organización**.

**Las 15 relaciones cruzadas, y quién las garantiza hoy:**

| Relación | DDL | ¿La base garantiza misma org? | Quién lo garantiza |
|---|---|---|---|
| `Contact → Company` | `init:274` | **NO** | `contact.service.ts:71-89` |
| `Contact → User` (owner) | `init:277` | **NO** | `ownership.service.ts:8-30` |
| `Company → User` (owner) | `init:268` | **NO** | `ownership.service.ts:8-30` |
| `Opportunity → Company` | `init:289` | **NO** | `opportunity.service.ts:72-87` |
| `Opportunity → Contact` | `init:292` | **NO** | `opportunity.service.ts:89-104` |
| `Opportunity → User` | `init:295` | **NO** | `ownership.service.ts:8-30` |
| `Opportunity → Pipeline` | `init:298` | **NO** | `opportunity.service.ts:106-115` |
| `Opportunity → Stage` | `init:301` | **NO** | `opportunity.service.ts:119-138` |
| `Activity → User` (author) | `init:307` | **NO** | implícito (`req.auth.userId`) |
| `Activity → User` (assignee) | `init:310` | **NO** | `activity.service.ts:80-98` |
| `Activity → Company` | `init:313` | **NO** | `activity.service.ts:100-115` |
| `Activity → Contact` | `init:316` | **NO** | `activity.service.ts:117-132` |
| `Activity → Opportunity` | `init:319` | **NO** | `activity.service.ts:134-149` |
| `Stage → Pipeline` | `init:283` | **NO** | `stage.service.ts` |
| `Invitation → User` (invitedBy) | `mig5:39` | **NO** | `invitation.service.ts` |

**RLS tampoco cubre esto.** `rls_policies.sql:78-83` verifica
`contacts.organization_id = current_organization_id()`. Una `Activity` con
`organization_id = A` y `contact_id` de la organización B **pasa la política
sin problema**: la política nunca mira la fila referenciada.

**Caso agravado — `Stage`.** `Stage.organizationId` está denormalizado
(`schema.prisma:272-295`) y nada garantiza que coincida con
`pipeline.organizationId`. Si divergen, `findStageById(id, orgA)` devuelve
un stage cuyo pipeline es de B, y `validateStageId`
(`opportunity.service.ts:119-138`) solo compara `stage.pipelineId !==
pipelineId`: **compara los dos valores corruptos entre sí y los da por
buenos**.

`tenant-isolation.integration-test.ts:24-47` prueba las 16 escrituras (que
el `WHERE` exija `organizationId`). **No prueba** que la base rechace una FK
cross-org, porque no la rechaza.

**Por qué es crítico ahora y no antes.** El diseño es coherente *mientras
cada escritura pase por un service*. La promoción masiva staging →
`Contact`/`Company`/`Activity` es exactamente el camino que **no** va a
pasar por `resolveCompanyId` ni por `validateStageId`. Hoy no hay red de
seguridad debajo, y arreglarlo después, con datos ya cargados, es una
migración mucho más cara que hacerlo ahora.

**Opciones**

| Opción | Cómo | Trade-off |
|---|---|---|
| **A (recomendada)** | `UNIQUE (organization_id, id)` en cada tabla padre; reescribir cada FK como `(organization_id, x_id) REFERENCES padre(organization_id, id)`. Prisma lo soporta con `@@unique([organizationId, id])` + `references: [organizationId, id]` | Garantía absoluta verificada por el motor, inmune a bugs de aplicación y de ingesta. Cuesta 8 índices únicos extra, migración de las 19 FKs, y Prisma exige que `organizationId` participe de la relación (cambia la forma de los `connect`) |
| **B** | Triggers `BEFORE INSERT OR UPDATE` que validen que cada FK apunte a la misma org | Menos invasivo para el cliente de Prisma, pero es un objeto más de los que se pierden en `reset` (C-2), cuesta un `SELECT` por fila escrita, y el planner no lo puede usar |
| **C** | Cerrar solo el caso `Stage` (`stages(organization_id, pipeline_id) → pipelines(organization_id, id)`), donde la denormalización crea corrupción *silenciosa* | Alcance chico, alto retorno. Deja los otros 14 casos abiertos. Solo aceptable como paso 1 de A |

---

## 3. Hallazgos ALTOS

### ALTO-1 — El CI no ejecuta ningún test de negocio, y los tests están fuera del typecheck

**Archivos:** `.github/workflows/ci.yml:33`, `package.json:10`,
`tsconfig.json:17`

`npm test` es `tsx --test src/**/*.test.ts`. Bajo `sh` POSIX (npm usa
`sh -c`), `**` expande **un solo nivel de directorio**. Resuelve a
exactamente un archivo: `src/lib/logger.test.ts`, 4 tests sobre redacción
de secretos en logs.

| Tipo | Archivos | Tests | ¿Corre en CI? |
|---|---|---|---|
| Unitarios (`*.test.ts`) | 1 | 4 | Sí |
| Integración (`*.integration-test.ts`) | 8 | 56 | **No** |

Lo que el CI **no** valida, y está escrito y funcionando:

- Aislamiento multi-tenant de las 16 escrituras (16 tests) — **la garantía
  de seguridad central del producto**.
- Protección del último ADMIN bajo concurrencia (3 tests; el comentario de
  `user.service.integration-test.ts:23-27` dice que el bug se reproducía en
  ~29% de las corridas).
- Máquina de estados de Invitation, CAS accept/revoke (17 tests).
- Los 4 rate limiters (11 tests).
- Traducción de los CHECK de Postgres.

**Y además no se typechequean.** `tsconfig.json:17` excluye
`src/**/*.test.ts` y `src/**/*.integration-test.ts`, y `npm run typecheck`
usa ese mismo tsconfig. Un refactor que cambie una firma deja los tests
rotos sin que nada lo note: **se pudren en silencio**, y como no corren en
CI, "correrlos a mano" tiende a ser "nunca".

Es doblemente costoso porque la suite es buena: usa `pg_stat_activity` y
`pg_blocking_pids` reales para forzar interleavings determinísticos en vez
de `sleep` (`activity.service.integration-test.ts:20-30`).

**Opciones** (complementarias, en orden de costo)

1. **Sacar los tests del `exclude`** vía un `tsconfig.test.json` y agregar
   `tsc --noEmit -p tsconfig.test.json` al script `typecheck`. Una línea,
   sin riesgo, sin meterlos en el build de producción.
2. **Tests unitarios de la lógica pura** con repositorios mockeados:
   `staysActiveAdmin` (`user.service.ts:64-72`), el cálculo de
   `finalOrderIds` (`stage.service.ts:278-285`), `slugify`, las 3 variantes
   de `rethrowAsConflict`, `normalizeEmail`, el cálculo de `totalPages`.
   Hoy la cobertura unitaria de negocio es **cero**.
3. **Postgres como service container en CI** + `migrate deploy` +
   constraints + seed, corriendo la parte de la suite que no necesita
   Supabase. *Trade-off:* los tests que llaman a `getSupabaseAdmin()` no
   funcionan sin un proyecto real; hay que separar la suite en
   "solo-Postgres" vs "requiere-Supabase". **Requiere C-2 resuelto.**

   > **Corrección medida el 2026-08-23.** Esta opción decía "recupera ~40 de
   > los 56 tests". **Es falso: son 5.** Medido, no estimado — 6 de los 8
   > archivos usan `getSupabaseAdmin()` en sus fixtures, porque
   > `public.users.id` tiene que coincidir con `auth.users.id` y el trigger
   > de sincronización de email lee de ahí. Eso arrastra a
   > `tenant-isolation.integration-test.ts` completo, que son los 16 tests
   > que verifican la garantía de seguridad central del producto.
   > Consecuencia: esta opción, sola, deja afuera justo lo que más importa.
   > Además, un Postgres pelado **no puede** aplicar las migraciones: fallan
   > en la sexta, por el trigger sobre `auth.users`, `auth.uid()`/`auth.role()`
   > y los roles `anon`/`authenticated`/`service_role`.

4. **Proyecto Supabase dedicado a CI** con credenciales en GitHub Secrets,
   como job nocturno y no bloqueante de PR. *Trade-off:* no corre en forks;
   requiere limpieza de datos entre corridas.
5. **Stack local de Supabase en CI** (`supabase start`, la CLI oficial, sobre
   el Docker del runner). Levanta Postgres **con el esquema `auth` y los roles
   reales** más GoTrue, así que corre la suite completa —los 56— sin ningún
   secreto y sin depender de un proyecto hosteado. *Trade-off:* arranque más
   lento (varios minutos de pull inicial) y una pieza de infraestructura más
   que mantener. Opción identificada el 2026-08-23; es la única que cubre los
   16 tests de aislamiento.

Además, arreglar el glob: `tsx --test "src/**/*.test.ts"` con comillas
delega la expansión a la herramienta en vez de al shell.

---

### ALTO-2 — Registro público sin verificación de email (`email_confirm: true`)

**Archivo:** `src/services/onboarding.service.ts:43-49`

```ts
await supabaseAdmin.auth.admin.createUser({
  email, password,
  email_confirm: true,   // marcado como confirmado sin ninguna prueba
  user_metadata: { full_name: fullName },
});
```

`POST /api/onboarding` es público (`src/routes/onboarding.routes.ts:10`).
Cualquiera registra una organización con `ceo@empresa-victima.com` y esa
identidad queda **confirmada** en `auth.users` sin que la víctima haga nada.

**Consecuencias:**

- **Email squatting permanente.** Ese email queda quemado:
  `createInvitation` lo rechaza con 409 (`invitation.service.ts:102-108`) y
  `inviteUserByEmail` también. La víctima real ya no puede ser invitada a
  su propia organización.
- `email_confirmed_at` falso: cualquier flujo futuro que confíe en "email
  confirmado" arranca envenenado.

La decisión está documentada en `docs/authentication-architecture.md:110-111`
("evita depender del flujo de confirmación"), pero el costo de seguridad no
está registrado en la sección de riesgos.

**Opciones:** (A) `email_confirm: false` y crear `Organization`/`User` al
confirmar — el onboarding pasa de 1 paso a 2 y hay que manejar el estado
intermedio; (B) mantener `email_confirm: true` pero exigir un OTP enviado al
email antes de aceptar el POST — menos invasivo; (C) mitigación mínima:
permitir liberar un email squatteado cuya organización se creó y nunca se
usó — parche, no arregla el fondo.

---

### ALTO-3 — La aceptación de invitación no verifica que el email esté confirmado

**Archivos:** `src/middlewares/verifyInvitationAcceptIdentity.ts:22-29`,
`src/services/invitation.service.ts:320-326`

```ts
invitation = await findInvitationByIdUnscoped(input.invitationId);
if (!invitation || invitation.email !== email) {  // el email del JWT es la única credencial
  throw new AppError("Invitación no encontrada", 404);
}
```

El claim `email` del JWT es la credencial **completa** para unirse a una
organización con el rol que traiga la invitación. El código nunca mira
`email_verified` / `email_confirmed_at`.

La seguridad de todo el flujo queda apoyada en un toggle del panel de
Supabase ("Confirm email") que el repositorio **no controla, no documenta y
no verifica**. Si está apagado —o se apaga alguna vez para depurar—
cualquiera hace `POST /auth/v1/signup` con el email del invitado, recibe una
sesión ES256 válida, y acepta la invitación ajena.

**Lo que sí está bien y no debe reportarse como problema:** un token de otro
proyecto Supabase **no** entra (`createRemoteJWKSet` apunta al JWKS del
proyecto, `lib/jwt.ts:21-23`, y ES256 solo valida contra sus claves); la
anon key legacy tampoco (es HS256 y `algorithms: ["ES256"]` la rechaza); la
expiración la valida `jose`; el cacheo y la rotación de claves son
correctos. El mecanismo de invitación tampoco tiene token adivinable —
porque no usa token.

**Opciones:** (A) agregar `issuer`/`audience` a `jwtVerify` y rechazar 401
si `email_verified !== true` — *trade-off:* si Supabase cambia el formato de
`iss` rompe el login de golpe; (B) **recomendada**: resolver el email con
`supabaseAdmin.auth.admin.getUserById(payload.sub)` y usar
`email_confirmed_at` — una llamada a la Admin API en un endpoint de baja
frecuencia y ya rate-limiteado; (C) documentar el requisito operativo y
agregar un check de arranque — barato, pero deja la seguridad fuera del
código.

---

### ALTO-4 — Un fallo del JWKS desloguea a toda la base de usuarios

**Archivo:** `src/lib/jwt.ts:34-44`

```ts
try {
  const result = await jwtVerify(token, getJwks(), { algorithms: ["ES256"] });
  //                             ^^^^^^^^^ lanza AppError(500) si falta SUPABASE_URL
  payload = result.payload;
} catch (err) {
  if (err instanceof joseErrors.JWTExpired) throw new AppError("El token expiró", 401);
  throw new AppError("Token inválido", 401);   // se traga TODO
}
```

`getJwks()` se invoca **dentro** del `try`, así que su `AppError(500)` se
convierte en 401. Lo mismo con un fallo de red al traer el JWKS, un timeout,
o una rotación con el endpoint caído.

El frontend reacciona a cualquier 401 con `signOut()`
(`frontend/src/lib/api.ts:22-33` + `AuthContext.tsx:91`): **una caída
transitoria del JWKS desloguea a todos**, y no queda ni un log para
diagnosticarlo (el `err` original se descarta sin loguearse).

**Opciones:** (A) sacar `getJwks()` fuera del `try` y distinguir
`JWSSignatureVerificationFailed`/`JWTClaimValidationFailed` (→401) del resto
(→503 + `logger.error({err})`) — estrictamente mejor, sin trade-off; (B)
además precargar el JWKS al arrancar para fallar rápido — el servidor deja
de arrancar sin red, hay que decidir si se quiere.

---

### ALTO-5 — Reordenar stages: permutación calculada sobre estado obsoleto

**Archivos:** `stage.service.ts:275-288`, `:236`, `:307`

```ts
return await prisma.$transaction(async (tx) => {
  if (requestedOrder !== undefined && requestedOrder !== stage.order) {
    const siblings = await findStagesByPipeline(stage.pipelineId, tx);  // sin FOR UPDATE
```

`findStagesByPipeline` (`stage.repository.ts:78-83`) es un `findMany` liso.
Además, `stage.order` se lee **fuera** de la transacción (`:236` vía
`getStageById`, usado en `:276`; y `:307` usado en `:314`).

**Que es una omisión y no una decisión lo prueba el propio repositorio:**
`lockOrganizationForUpdate` (`organization.repository.ts:21-26`) existe y se
usa correctamente en `pipeline.service.ts:192` y `user.service.ts:125/185`,
con comentarios que explican por qué un conteo agregado necesita lock. Stage
tiene el mismo problema y no lo toma.

**Impacto:**

- Dos reorder concurrentes: el segundo aplica una permutación construida
  sobre la lista previa al primero. Como `reindexStages` reasigna `1..N` a
  todos los ids recibidos, **no hay violación de constraint**: es una
  pérdida silenciosa del primer reorder.
- Reorder concurrente con `createStage`: el índice único parcial rechaza →
  P2002 con `target = order` → cae en el `else` genérico de
  `rethrowAsConflict` (`stage.service.ts:130`) → el usuario ve
  **"El registro ya existe" (409) al reordenar**.
- `deleteStage` con `order` obsoleto: `shiftDownAfter` cierra el hueco
  equivocado. **[CONJETURA]** el índice único aborta la transacción en la
  mayoría de los interleavings, así que el dato no se corrompe, pero el
  borrado falla con un error incomprensible.

**Opciones:** (A) **recomendada** — agregar `lockPipelineForUpdate(pipelineId, tx)`
como primera sentencia de la transacción en `createStage`, `updateStage` y
`deleteStage`, y mover `getStageById` adentro; serializa las escrituras de
stages por pipeline, irrelevante en la práctica (5-10 stages, los reordena
un humano); (B) `SELECT ... FOR UPDATE` sobre las filas de `stages` —
requiere orden por id para evitar deadlocks, más frágil sin beneficio real;
(C) reemplazar `order: Int` contiguo por `position: numeric` con inserción
fraccional — elimina el reindexado y la carrera, pero es cambio de schema +
migración de datos y rompe el contrato del frontend. Correcto a largo plazo
si el reordenado pasa a ser drag & drop de alta frecuencia.

---

### ALTO-6 — Ningún índice sirve al patrón de listado real

**Archivos:** `prisma/schema.prisma` + las 5 migraciones, contrastados con
los `buildWhere`/`buildOrderBy` de los 8 repositorios

Toda query de listado tiene esta forma:

```sql
WHERE organization_id = $1 AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 20 OFFSET $2
```

| Tabla | Índices con `organization_id` | ¿`deleted_at`? | ¿`created_at`? |
|---|---|---|---|
| `contacts` | `(org)`, `(org, lifecycle_stage)` | ❌ | ❌ |
| `companies` | `(org)`, `(org, name)` | ❌ | ❌ |
| `opportunities` | `(org)`, `(org,status)`, `(org,stage)`, `(org,pipeline)` | ❌ | ❌ |
| `activities` | `(org)`, `(org, due_date)` | ❌ | ❌ |
| `pipelines` | `(org)`, unique `(org,name)` | ❌ | ❌ |
| `stages` | `(org)`, `(pipeline)` | ❌ | ❌ |

**Ninguna entidad tiene `(organization_id, created_at)`, y ningún índice
incluye `deleted_at`** — pese a que *todas* las lecturas filtran
`deletedAt: null`. La única tabla con índice sobre `deleted_at` es
`organizations` (`init:163`), cuyo `deletedAt` se consulta en un solo lugar
del código (`auth.service.ts:32`).

**Impacto.** Con 200k contactos en un tenant, cada `GET /contacts` hace
index scan sobre `(org)` → 200k heap fetches → filtra `deleted_at` → **sort
completo de 200k filas** → descarta todo menos 20. Y se paga **dos veces**
por request, porque `findMany` y `count` corren en paralelo con el mismo
`where`. Invisible hoy; con la ingesta masiva, 200k por tenant es el
escenario esperado, no el extremo.

**Opciones:** (A) índices parciales
`(organization_id, created_at DESC) WHERE deleted_at IS NULL`, uno por
entidad — mejor relación costo/beneficio, pero son 6 objetos más fuera del
historial mientras C-2 no se resuelva; (B) `(organization_id, deleted_at,
created_at)` no parcial, declarable con `@@index` en `schema.prisma` y por
lo tanto viaja por migración — más grande porque indexa filas borradas,
pero **no agrava C-2**; (C) paginación por keyset — solución correcta a
largo plazo, pero cambia el contrato de la API (`page`/`totalPages`
desaparecen y el frontend los consume).

---

### ALTO-7 — `search` con `ILIKE '%x%'` sin `pg_trgm`: seq scan garantizado

**Archivos:** `contact.repository.ts:33-50`, `company.repository.ts:23-25`,
`opportunity.repository.ts:27-29`, `activity.repository.ts:37-44`,
`stage.repository.ts:21-23`, `pipeline.repository.ts:18-20`

No existe `CREATE EXTENSION pg_trgm` en ninguna parte del proyecto
(verificado sobre `prisma/` completo). Un `ILIKE` con comodín inicial no
puede usar un B-tree, ni siquiera sobre `lower(col)`.

En `contacts` el `search` es un OR sobre 3 columnas; en `activities`, sobre
`subject` y **`body`** (`TEXT` sin límite, `init:149`) — seq scan que lee
TOAST, en cada búsqueda, dos veces (`findMany` + `count`).

**Opciones:** (A) `pg_trgm` + índices GIN `gin_trgm_ops` — funciona tal cual
con el `ILIKE` que Prisma ya genera, sin tocar TypeScript; índices grandes y
escrituras más caras; (B) `tsvector` generado + GIN — mejor para texto largo
(`body`), pero cambia la semántica (deja de ser substring) y exige
`$queryRaw`; (C) exigir largo mínimo y usar `startsWith` — gratis y
suficiente para autocompletar, inaceptable para buscar dentro de `body`.

---

### ALTO-8 — Soft delete sin cascada lógica: huérfanos visibles garantizados

**Archivos:** `contact.service.ts:213-219`, `company.service.ts:129-135`,
`stage.service.ts:306-316`, `pipeline.service.ts:185-247`

El patrón de *marcado* es uniforme y correcto (los 6 `buildWhere` incluyen
`deletedAt: null`). **No hay ninguna cascada.** Y los `onDelete: SetNull` /
`Cascade` de las migraciones (`init:274, 277, 283, 289, 292, 310, 313, 316,
319`) son **decorativos**: nunca se disparan, porque nada se borra
físicamente jamás.

**Escenarios concretos:**

1. **Stage borrado con oportunidades vivas.** `deleteStage` no consulta
   `opportunities`. Siguen contando en `countOpportunities` y en los
   totales, pero desaparecen del tablero, que se arma por stages activos.
   **Los números del pipeline dejan de cuadrar con las columnas.**
2. **Pipeline borrado con stages vivos.** `findManyStages`
   (`stage.repository.ts:42-55`) no filtra por el estado del pipeline: si
   no viene `filters.pipelineId`, los stages huérfanos aparecen en el
   listado de la organización.
3. **Contact borrado.** `activities_related_entity_check` se vuelve
   **vacuo**: una Activity cuyo único vínculo era ese contacto sigue
   satisfaciendo el CHECK sin estar relacionada con nada visible.
4. **User removido.** `Opportunity.ownerId` es `NOT NULL`. Las oportunidades
   quedan asignadas a alguien que no figura en el roster; el dashboard "por
   vendedor" las pierde o muestra un owner inexistente.

**Opciones:** (A) cascada lógica explícita en transacción, con
`deleteBatchId` para distinguir "borrado por cascada" de "borrado propio" y
poder restaurar con sentido; (B) **bloquear el borrado si hay hijos
activos** (RESTRICT lógico), como ya se hace con "el último pipeline"
(`pipeline.service.ts:203-208`) — peor UX, pero es lo más simple y elimina
la clase entera de bugs; buena opción para Stage y Pipeline; (C) filtrar en
lectura por el estado del padre — **no recomendada**: mueve la
inconsistencia a las queries, hay que acordarse en cada una, y los `count`
empiezan a divergir de los `findMany`.

---

### ALTO-9 — `users.email` único global sin filtro de soft delete

**Archivos:** `init:169`, `user.repository.ts:50-58`,
`invitation.service.ts:102-108`

```sql
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");  -- sin WHERE
```

`findUserByEmail` usa `findUnique({where:{email}})` sin filtro `deletedAt`;
el comentario `:50-55` lo reconoce: *"esté el otro activo, desactivado o
removido (el índice único de Postgres no distingue deletedAt)"*.

**Impacto.** Un empleado se va → `softDeleteUser` marca `deletedAt`. Vuelve
seis meses después → **es imposible re-invitarlo**, ni a su organización ni
a ninguna otra del SaaS. El desbloqueo requiere `UPDATE` manual en
producción. Para un CRM B2B con rotación normal de personal, esto va a
pasar.

**Opciones:** (A) índice único parcial `WHERE deleted_at IS NULL` +
filtrar en `findUserByEmail` — hay que decidir qué pasa si el `id` de
Supabase Auth se reusa; (B) tombstone del email al borrar — **descartable**:
choca de frente con el trigger de `manual_constraints.sql:37-40`, que
sobreescribe `email` desde `auth.users` en cada UPDATE, así que el tombstone
se revierte solo; (C) **la más honesta con el dominio**: si
`findUserByEmail` encuentra un usuario borrado *en la organización que
invita*, ofrecer un flujo de "reincorporar" en vez de 409 — implementa
`undelete` de facto y hay que definir qué pasa con el rol previo.

---

### ALTO-10 — Frontend: dos fallas de producto verificadas

**1. Callejón sin salida para usuarios desactivados.**
`frontend/src/auth/ProtectedRoute.tsx:21-38` — el estado
`account-unavailable` renderiza un `<p>` y nada más. El único botón de
"Cerrar sesión" vive en `AppLayout`, que se renderiza dentro del `<Outlet/>`
y por lo tanto nunca se monta ahí. Como Supabase auto-refresca el token, el
estado es permanente: la única salida es borrar `localStorage` a mano.

**2. Vaciar un campo opcional no borra nada, y la app dice que guardó.**
`CompanyFormPage.tsx:31-40` y `ContactFormPage.tsx:34-45` — `values.domain
|| undefined` → `JSON.stringify` elimina la clave → `company.service.ts:112`
hace `{ ...input }` y no toca la columna. Afecta 9 campos entre Company y
Contact. **Opportunity y Activity sí lo resuelven bien** (envían `null`
explícito), lo que confirma que es descuido y no criterio.

---

### ALTO-11 — Sin linter, sin deploy reproducible

No existe `.eslintrc*`, `eslint.config.*` ni `.prettierrc*` en ninguna parte
del repositorio (ni raíz ni `frontend/`), y no hay script `lint`. **Que la
ausencia es un accidente y no una decisión lo prueba
`src/middlewares/errorHandler.ts:13`**, que contiene un
`// eslint-disable-line @typescript-eslint/no-unused-vars` para un ESLint
que no existe.

Tampoco hay `Dockerfile`, `docker-compose*`, `Procfile`, `fly.toml`,
`render.yaml` ni workflow de deploy. El CI corre `build` y descarta el
artefacto. `scripts/apply-manual-sql.ts` está bien hecho pero **nada lo
invoca automáticamente**.

Consecuencia sobre otros hallazgos: los comentarios de `rateLimit.ts:24-39`
asumen "proceso Node único, sin proxy" — una suposición que no se puede
validar porque no hay una topología de deploy contra la cual validarla.

---

### ALTO-12 — Tipos duplicados a mano entre backend y frontend

`export type SortOrder = "asc" | "desc"` está declarado **16 veces** (8 en
`src/repositories/*.ts`, 8 en `frontend/src/features/*/types.ts`). Los enums
están **triplicados**: `LifecycleStage` en `schema.prisma:23-29`, en
`contact.controller.ts:16-22` (literales a mano) y en
`frontend/src/features/contact/types.ts:5`.

El propio frontend admite el método:
`frontend/src/features/activity/types.ts:1-5` — *"**Reconstruido** desde el
contrato real del backend"*.

**Mérito e inconsistencia interna:** el backend **sí** usa `z.nativeEnum`
sobre el enum real de Prisma en `activity.controller.ts:20` y
`invitation.controller.ts:21`, con el comentario correcto ("si cambia en
schema.prisma, este schema se actualiza solo"). Ese patrón **no** se aplicó
a `LifecycleStage` ni a `OpportunityStatus` — corregible en 2 líneas.

**Opciones:** (A) workspace npm con `@crm/contracts` (schemas Zod + tipos
inferidos) — fuente única y validación de respuestas gratis en el frontend,
pero convierte el repo en monorepo; (B) **recomendada** OpenAPI derivado de
los schemas Zod (`zod-to-openapi` + `openapi-typescript`) — fuente única sin
monorepo, y de paso el proyecto gana documentación de API que hoy no tiene;
requiere centralizar primero los schemas, hoy inline en los controllers;
(C) un `shared/types.ts` copiado por script — pragmático y feo, elimina la
deriva silenciosa a costo casi cero.

---

### ALTO-13 — N+1 trasladado al cliente

Ningún listado del backend usa `include` (única excepción correcta:
`findManyUsers` con `role`). Los 7 restantes devuelven UUIDs crudos, y el
frontend los resuelve con `useQueries`, **una petición HTTP por id**
(`frontend/src/features/opportunity/relationResolution.ts`, y equivalentes
en `activity/` y `contact/`).

Una página de 20 oportunidades dispara **hasta ~60 peticiones adicionales**,
cada una con verificación de JWT (`authenticate` → `findUserForAuth`, o sea
**una query extra a Postgres por petición**): ~60 round-trips y ~120 queries
para pintar 20 filas. React Query deduplica y cachea, lo que lo hace
tolerable en navegación, pero la carga en frío es exactamente eso.

**Opciones:** (A) **recomendada** `include` selectivo vía `?expand=company,stage`
— Prisma lo resuelve con `WHERE id IN (...)` por relación: de 61 peticiones
a 1 y de ~120 queries a ~5, preservando compatibilidad; (B) endpoint de
resolución batch (`GET /api/contacts?ids=a,b,c`) — atenúa, no resuelve;
(C) endpoint de vista (`/api/opportunities/board`) — acopla la API a la UI,
se justifica solo para un Kanban.

---

## 4. Hallazgos MEDIOS

| # | Hallazgo | Ancla |
|---|---|---|
| M-1 | `updateMany` sin `deletedAt: null` en 14 escrituras: un PATCH concurrente con un DELETE escribe sobre una fila ya borrada; dos DELETE pisan la fecha real de borrado | `company.repository.ts:115` +13 |
| M-2 | `rethrowAsConflict` de Stage sin rama para `order`; el comentario `:82-84` ("order nunca choca") es cierto en serie y falso bajo concurrencia | `stage.service.ts:103-131` |
| M-3 | `updateOpportunity`/`createActivity` validan relaciones fuera de transacción: el stage puede ser soft-deleted entre la validación y la escritura **[CONJETURA]** | `opportunity.service.ts:241-250` |
| M-4 | `GET /api/invitations` ejecuta un `updateMany` (expiración perezosa) y **no** tiene rate limiter de escritura: no se puede servir desde réplica de lectura | `invitation.service.ts:46` |
| M-5 | Errores de Zod aplanados a un string: se descarta `issue.path`, el frontend no puede mapear errores a campos, y no hay `code` estable | `utils/validation.ts:20-23` |
| M-6 | `Decimal` se serializa a **string** y el contrato no lo declara: escritura acepta `number`, lectura devuelve `string`. Lo descubrió el frontend empíricamente | `schema.prisma:278,310`; `frontend/.../opportunity/types.ts:8-10` |
| M-7 | `timestamp` sin timezone en 30+ campos, y `Organization.timezone` (`schema.prisma:57`) **nunca se lee ni se escribe**: "tareas que vencen hoy" es siempre UTC | `init:16-18` |
| M-8 | Sin `createdBy` y sin historial de etapas: `Opportunity.stageId` se sobreescribe en cada movimiento, destruyendo el dato de velocidad de pipeline / tiempo en etapa / conversión | `opportunity.service.ts:245-248` |
| M-9 | `lastLoginAt` (`schema.prisma:117`) nunca se escribe, pero el frontend lo tipa y lo muestra: siempre `null` | `frontend/.../user/types.ts:22` |
| M-10 | 6 índices redundantes por prefijo + `contacts_lifecycle_stage_idx` inútil (nunca hay query sin `organizationId`) | `init:175,187,196,202,217,238` |
| M-11 | `users.role_id`, `invitations.role_id`, `invitations.invited_by_id` sin índice; `countActiveAdmins` corre dentro de la transacción con lock, así que su latencia extiende el lock | `init:262`, `mig5:36,39` |
| M-12 | `probability` y `currency` validados solo en Zod: la base acepta `999.99` y `'xx'`. Sin coherencia `status`↔`stage.isWon`↔fechas. Multi-moneda sin tasa de cambio ni monto base: cualquier `SUM(amount)` suma peras con manzanas | `stage.controller.ts:28-31`, `init:106,126` |
| M-13 | La unicidad de email de contacto es case-sensitive; la normalización vive solo en `contact.service.ts:118-120` — la promoción desde staging no la va a ejecutar | `manual_constraints.sql:71-73` |
| M-14 | `pipelines(org, name)` único **total**, no parcial: borrar un pipeline quema su nombre y el 409 habla de un registro invisible | `init:205` |
| M-15 | Shutdown sin timeout, sin `closeIdleConnections()`, sin `uncaughtException`/`unhandledRejection`, y no idempotente | `server.ts:10-24` |
| M-16 | `errorHandler` usa el logger raíz y no `req.log`: el error no lleva `req.id` y **no se puede correlacionar con la request**. Sin `X-Request-Id` de vuelta al cliente | `errorHandler.ts:20` |
| M-17 | `/health` sin separar liveness de readiness (un blip de DB provoca **reinicio** en vez de sacarlo del balanceo), sin rate limit, y con una query por llamada | `health.controller.ts:5-8` |
| M-18 | Errores de `body-parser` (JSON malformado, payload >100kb) se reportan como `500` porque no son `AppError` | `errorHandler.ts:16-18` |
| M-19 | Pool de Prisma sin `connection_limit` explícito frente a PgBouncer | `lib/prisma.ts:9-13` |
| M-20 | `count` exacto en cada listado + `OFFSET` sin cota de `page` | `company.service.ts:29-39` +7 |
| M-21 | Duplicación de contrato: `idParamSchema` ×8, bloque de paginación del service ×8 idéntico. La duplicación de *estructura* es sana; la de *contrato* no | los 8 controllers/services |
| M-22 | Frontend: búsqueda sin debounce ni `placeholderData` en los 8 listados — aunque el debounce ya existe, copiado 3 veces, en los `*Select` | `frontend/src/features/*/​*ListPage.tsx` |
| M-23 | Frontend: sin ErrorBoundary y `config/env.ts` lanza en tiempo de import ⇒ pantalla en blanco ante una env var faltante | `frontend/src/config/env.ts` |
| M-24 | Frontend: el design system se usa en **2 de 15 pantallas**; 7 de 8 tablas son `<table>` crudo y el bloque de paginación está copiado 7 veces pese a existir `Pagination.tsx` | `frontend/src/design-system/` |
| M-28 | **Los tests del frontend replicaban el bug en vez de detectarlo.** Ninguna llamada al backend incluía el prefijo `/api` salvo `/me`, pese a que el backend monta todas las rutas de negocio bajo `/api`. El defecto sobrevivió porque **cada handler de MSW construía su mock con el mismo criterio equivocado que el código**: 44 archivos de test en verde contra un contrato inexistente. Es el argumento más fuerte a favor de ALTO-1: una suite que se escribe mirando la implementación en vez del contrato no verifica nada. El bug quedó corregido al centralizar el prefijo en `buildUrl()`; lo que queda como deuda es el método — los mocks deberían derivarse del contrato del backend, no redactarse en paralelo (ver ALTO-12 y la opción de OpenAPI) | `frontend/src/lib/api.ts`; `frontend/src/test/msw/handlers.ts` y 44 archivos de test |
| M-27 | **`slugify` puede producir el slug vacío.** `slugify("###")` → `""`, y lo mismo cualquier nombre sin caracteres ASCII alfanuméricos: `"株式会社"` → `""`. `onboarding.schema.ts:10` valida `min(1)` sobre el **nombre**, no sobre el slug resultante, así que una organización puede quedar con `slug = ""` — y la segunda que lo intente recibe un `409 "Ya existe una organización con ese nombre"` que no tiene relación con su nombre. Afecta a cualquier razón social en alfabeto no latino. Detectado el 2026-08-22 al escribir los tests unitarios de ALTO-1; el comportamiento quedó documentado en un test que pasa (`src/utils/slug.test.ts`), no en un test roto | `utils/slug.ts`; `schemas/onboarding.schema.ts:10` |
| M-26 | **Ningún campo de formulario tiene `name` ni `id`**: `grep ' name='` sobre todo `frontend/src` devuelve **cero** resultados. Chrome lo reporta como 71 issues de *"A form field element should have an id or name attribute"*. Consecuencia concreta: los gestores de contraseñas y el autocompletado del navegador no pueden identificar los campos — **incluido el formulario de login**. Es una decisión deliberada y documentada (`FormField.tsx:8-14`), pero justificada por conveniencia de los tests (`getByLabelText` funciona con label-envuelve-control), no por producto. Agregar `name` no rompe ese patrón ni los tests | `design-system/FormField.tsx:16-23` |
| M-25 | **No existe pantalla de registro.** Las rutas públicas son `/login`, `/forgot-password`, `/reset-password` e `/invite/accept`. `POST /api/onboarding` —el único endpoint público del sistema, el que crea Organization + primer ADMIN— no tiene ninguna UI que lo consuma: la primera organización solo se puede crear con una llamada HTTP a mano. Detectado al levantar el entorno nuevo el 2026-08-21 | `frontend/src/app/router.tsx:33-51`; `src/routes/onboarding.routes.ts:10` |

---

## 5. Hallazgos BAJOS

| # | Hallazgo | Ancla |
|---|---|---|
| B-1 | Oráculo de existencia de cuentas: `409 "Ya existe una cuenta con ese email"` en un endpoint **público** permite enumerar usuarios de toda la plataforma | `onboarding.service.ts:56-58` |
| B-2 | Mensajes de `AppError` con status 500 se devuelven verbatim (p. ej. *"SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no están configurados"*). El campo `isOperational` existe y **nadie lo lee** | `errorHandler.ts:18`, `utils/AppError.ts:3` |
| B-3 | El logger no redacta query strings: `GET /api/contacts?email=juan@cliente.com` queda en los logs. Es PII, no credenciales (tokens y service key sí están cubiertos) | `lib/logger.ts:17-21` |
| B-4 | `SUPABASE_ANON_KEY` está declarada en el backend y **no la usa nadie**: una copia más de un secreto en el entorno del servidor | `config/env.ts:18-23` |
| B-5 | Las tres variables de Supabase son `optional()`: un deploy incompleto pasa el health check y revienta al primer registro | `config/env.ts:18-23` |
| B-6 | `page` sin cota superior en los 8 listados | los 8 `listQuerySchema` |
| B-7 | `onboarding.controller.ts` es el único que no usa `parseOrThrow`, el helper que salió de él | `onboarding.controller.ts:9-16` |
| B-8 | `LifecycleStage`/`OpportunityStatus` con literales a mano en vez de `z.nativeEnum` | `contact.controller.ts:16-22` |
| B-9 | Trigger `BEFORE INSERT OR UPDATE` de email: en plpgsql un `SELECT INTO` sin filas asigna **NULL**, así que si la fila de `auth.users` fue borrada, cualquier UPDATE sobre `public.users` viola el `NOT NULL` — `softDeleteUser` fallaría con `23502` y el usuario no se podría remover nunca más. **[CONJETURA]**, merece un test | `manual_constraints.sql:26-32,38` |
| B-10 | `.claude/settings.local.json` versionado con `Bash(curl *)` y `Bash(npm run *)` pre-aprobados | `.claude/settings.local.json:11,43` |
| B-11 | `noUncheckedIndexedAccess` y `exactOptionalPropertyTypes` desactivados — el segundo es relevante dado cuánto trabaja este código con la distinción `undefined` vs `null` | `tsconfig.json:9` |
| B-12 | `Stage.order` sin CHECK de positividad: **es correcto** (el reindexado usa valores negativos como fase intermedia). Documentarlo para que nadie lo agregue "por prolijidad" | `stage.repository.ts:237-247` |
| B-13 | `checkHealth` atrapa el error de la base con un `catch {}` vacío: `/health` informa que algo falla y **destruye la única pista para saber qué**. Encontrado en vivo diagnosticando la pérdida del proyecto de Supabase — el health check dijo `"database":"error"` y no hubo forma de distinguir credenciales inválidas de proyecto eliminado sin correr `prisma db execute` a mano. Fix: `catch (err) { logger.error({ err }, "health: fallo de conexión a la base") }` | `health.service.ts:15-20` |
| B-16 | **La traducción del CHECK depende del idioma del servidor.** `stage.service.ts` (bloque T-2) reconoce la violación de `stages_won_lost_exclusive_check` buscando el nombre de la constraint **dentro del texto del mensaje de error de Postgres**. Con `lc_messages` en español el mensaje cambia y la traducción falla: el usuario recibe un error crudo de Prisma en vez del 409. Verificado empíricamente el 2026-08-23 contra un Postgres local en `Spanish_Uruguay.1252` — los 5 tests fallaron; con `lc_messages = C` pasan. Supabase corre en inglés, así que hoy no se manifiesta, pero el mecanismo se apoya en una superficie que Postgres no promete estable entre versiones ni locales | `stage.service.ts` (bloque T-2) |
| B-15 | Los 6 componentes `*Select` reciben `id` como prop **opcional** y renderizan `<label htmlFor={id}>` como **hermano** del control, no envolviéndolo. Si el caller no pasa `id`, o mientras la query está en `isLoading`/`isError` y el `<select>` no llega a renderizarse, la etiqueta apunta a un elemento que no existe en el DOM. Chrome lo reporta como *"Incorrect use of `<label for=FORM_ELEMENT>`"*. Efecto: hacer clic en la etiqueta no enfoca el campo y los lectores de pantalla no lo asocian. Fix: hacer `id` requerido, o renderizar la etiqueta solo junto al control | `stage/StageSelect.tsx:29-33,39-41`; `company/CompanySelect.tsx:68`; y 4 más |
| B-14 | Las 8 políticas RLS siguen siendo `for all` después del REVOKE de C-1. Hoy son inertes —sin grants nadie llega a las tablas—, pero la defensa en profundidad queda dependiendo de una sola capa: si alguien vuelve a otorgar permisos a `authenticated` (habilitando Realtime, o probando desde el editor SQL), las políticas permiten escritura otra vez. Bajarlas a `for select` haría que REVOKE y políticas se refuercen mutuamente | `rls_policies.sql:64-127`; diagnóstico fila 6 |

---

## 6. Estado de la documentación

- **El documento de arquitectura de la capa de ingesta no está en el
  repositorio.** Búsqueda de `staging`, `ingesta`, `csv`, `excel`, `import`,
  `landing`, `dedup` en `docs/` y en todo el código: **cero coincidencias**.
  `docs/project-overview.md` (169 KB, roadmap M0-M8) no lo menciona ni como
  fase futura. Claude Code, que lee el proyecto en vivo, hoy **no tiene
  forma de saber que la ingesta existe como objetivo**.
- **README vs. project-overview.** El README declara los módulos
  `Company`…`Invitation` "completos" sin salvedad; `project-overview.md`
  marca M6, M7 y M8 con ⏳ y la frase *"cierre del ciclo pendiente de
  decisión del operador, no declarado cerrado en este punto"*
  (líneas 1667-1669, 1812-1814, 1962-1964).
- **`docs/authentication-architecture.md`** declara "Última actualización:
  2026-07-11" pero contiene contenido sobre M7, necesariamente posterior. Y
  el cuerpo de la sección 2 sigue narrando el flujo del trigger
  `AFTER INSERT ON auth.users` que —según el recuadro de corrección del
  encabezado— **nunca se construyó**: la contradicción está resuelta por un
  aviso al principio, pero el texto narrativo no se reescribió.
- **M6 se declaró "implementado y verificado" sin los reviews ejecutados**
  (`project-overview.md:1806-1810`), a diferencia de M2-M5, M7 y M8.

---

## 7. La capa de ingesta: estado y prerequisitos

### 7.1 Inventario actual: cero

Verificado con grep sobre `prisma/`, `src/`, `scripts/` y `docs/`:

- **0** tablas de staging
- **0** campos `Json` en `schema.prisma`
- **0** usos de `createMany` en todo el repositorio
- **0** infraestructura de jobs, colas, cron o workers
- **0** claves de idempotencia, `upsert` o hashes de deduplicación
- **0** campos de procedencia (`source_system`, `external_id`,
  `import_batch_id`). `Contact.source` (`schema.prisma:216`) es un
  `VarChar(100)` libre de negocio ("web", "referido"), no de sistema.
- `frontend/src/lib/api.ts:87,95` fuerza `JSON.stringify` incondicional: un
  `File`/`FormData` se serializa a `{}`. Cero `type="file"`, cero
  `refetchInterval` para polling de jobs, cero virtualización de tablas.

### 7.2 Los seis obstáculos del modelo actual

1. **`Company` no tiene ninguna constraint de unicidad**
   (`schema.prisma:194-197` declara solo `@@index`; `companies_domain_idx`
   es no único y **ni siquiera está scopeado por organización**). Importar
   el mismo Excel dos veces produce el doble de filas sin ninguna
   resistencia de la base. Sin clave natural no hay `ON CONFLICT` posible.
2. **`Contact` solo tiene email como clave natural, y es nullable.** El
   índice único es parcial `WHERE email is not null`: **los contactos sin
   email son indeduplicables por construcción**. Un CSV de 10.000 leads
   telefónicos se puede importar diez veces seguidas.
3. **Campos obligatorios que un origen externo no puede garantizar:**
   `contacts.first_name` + `last_name` ambos `NOT NULL` (un formulario con
   un solo campo "Nombre" no puede aterrizar); `owner_id`, `pipeline_id`,
   `stage_id` de Opportunity; `author_id` de Activity, que además choca con
   el punto 6.
4. **Los CHECK imponen un orden de promoción.** No se puede promover una
   Activity u Opportunity antes que su Contact/Company, y las referencias
   entre filas del mismo lote (la fila 400 apunta al contacto de la fila 12)
   hay que resolverlas por clave natural — que como vimos no existe.
5. **Los `VarChar` acotados convierten datos sucios en errores duros**
   (`phone VARCHAR(30)`, `industry VARCHAR(100)`): un teléfono con extensión
   aborta el INSERT con `22001` en vez de marcarse como fila revisable. Es
   el argumento más fuerte a favor de staging con `text`/`jsonb`: validar y
   truncar **antes** de promover, nunca durante.
6. **El trigger de email impide crear usuarios fuera de Supabase Auth**
   (`manual_constraints.sql:26-32`), con el bug latente B-9 asociado.
7. *(operativo)* **El rate limiter lo hace inviable por la API pública:**
   `businessWriteRateLimiter` es una única instancia compartida por los 8
   routers (`rateLimit.ts:233`), 100 escrituras/minuto **por usuario sumadas
   entre todas las entidades**. Importar 50.000 contactos por la API
   tardaría 8,3 horas asumiendo cero errores. Solo aplica si la ingesta pasa
   por HTTP; un worker que llame a los services directo no lo toca.

### 7.3 Lo que sí está listo

- **`Db = PrismaClient | Prisma.TransactionClient`** (`lib/prisma.ts:23`):
  todo repositorio ya acepta un `tx`. Un job puede envolver un lote sin
  tocar un solo repositorio.
- **`organizationId` obligatorio en todo `where`:** la ingesta hereda el
  aislamiento gratis.
- **Las constraints de la base** son la defensa real y no dependen de la
  aplicación: la ingesta las hereda sin reimplementar nada — *siempre que
  C-2 esté resuelto*.
- **`lockOrganizationForUpdate`** ya existe como primitiva de serialización
  por tenant.
- **La separación de capas** permite que un worker llame a los services
  directamente, sin HTTP y sin rate limiter.

### 7.4 Diseño mínimo faltante

| Elemento | Para qué | Nota |
|---|---|---|
| **`ImportBatch`** | `organizationId`, `sourceType` (`LANDING_FORM`/`CSV`/`XLSX`/`API`/`THIRD_PARTY`), `sourceRef`, `targetEntity`, `columnMapping jsonb`, `status`, `uploadedById`, contadores | El `columnMapping jsonb` permite reprocesar un lote con un mapeo corregido sin volver a subir el archivo |
| **`ImportRow`** | `batchId`, `rowNumber`, **`rawPayload jsonb` intacto**, `normalizedPayload jsonb`, `status` (`PENDING`/`VALID`/`INVALID`/`PROMOTED`/`SKIPPED_DUPLICATE`), `errors jsonb`, `promotedEntityId` | `rawPayload` nunca se toca: única fuente de verdad para reprocesar. Índice `(batchId, status)` |
| **Idempotencia** | `rowHash` (SHA-256 del payload canónico), único parcial `(organizationId, targetEntity, rowHash) WHERE status = 'PROMOTED'` | Parcial, para no bloquear el reintento de una fila fallida |
| **Claves naturales en destino** | `(organizationId, lower(domain))` único parcial en Company; evaluar `(organizationId, lower(email))` en Contact | **Prerrequisito**, no complemento |
| **Origen externo** | `sourceSystem` + `externalId` en Contact/Company/Activity, único parcial por `(organizationId, sourceSystem, externalId)` | Habilita sincronización incremental idempotente |
| **Trazabilidad** | `importRowId` en las entidades promovidas | Responde "¿de dónde salió este contacto?", el caso de uso número uno cuando un import sale mal. Se solapa con M-8: conviene diseñarlos juntos |

**Opciones de forma:** (A) staging genérico — una sola pareja de tablas con
`jsonb` para todas las entidades; el jsonb no valida forma y toda la
validación es código, pero absorbe entidades futuras sin migración;
(B) staging tipado por entidad (`StagingContact`, `StagingCompany` con
columnas `text`) — N tablas por entidad nueva, pero consultas y mapeo mucho
más simples; (C) **recomendada** híbrido — `rawPayload jsonb` intacto +
columnas generadas para lo que se consulta seguido (`email`, `domain`,
`rowHash`): conserva el crudo sin pagar el precio de consultar jsonb en toda
query operativa.

**Opciones de ejecución:** (1) módulo dentro del mismo proceso, con la cola
en Postgres vía `SELECT ... FOR UPDATE SKIP LOCKED` — sin dependencias
nuevas, pero el worker compite por el pool y el event loop; aceptable si se
le da un `PrismaClient` con pool acotado; (2) proceso worker separado —
aislamiento real de recursos, pero **bloqueado por ALTO-11**: exige el
Dockerfile/deploy que hoy no existe; (3) ETL externo (Airbyte/Fivetran) que
escriba en staging — menos código propio, más infraestructura y costo, y el
dedupe/mapeo siguen siendo del backend.

---

## 8. Verificaciones pendientes

Nada de esta auditoría se ejecutó contra una base. Estas tres cosas hay que
confirmarlas contra el proyecto real de Supabase antes de cerrar
prioridades. El script `docs/auditoria-2026-08-21-diagnostico.sql` responde
las tres.

| # | Qué verificar | Por qué importa |
|---|---|---|
| V-1 | Si `anon`/`authenticated` tienen `INSERT/UPDATE/DELETE` sobre las tablas de `public` | Decide si **C-1** es "escalada de privilegios explotable hoy" o "endurecimiento preventivo" |
| V-2 | Cuáles de los 36 objetos de `manual_constraints.sql` + `rls_policies.sql` existen realmente en la base | Confirma el alcance de **C-2** en el entorno actual |
| V-3 | Si el rol de `DATABASE_URL` tiene `BYPASSRLS` | Es la premisa sobre la que se apoya toda la sección 5 de `authentication-architecture.md` |

---

## 9. Rutas de corrección

**Ruta 1 — Cerrar el perímetro antes de construir (recomendada).**
C-1 → C-2 → C-3 → ALTO-1. Ninguno requiere diseño nuevo y los cuatro son
*prerequisitos* de la ingesta: sin C-3 la promoción masiva escribe vínculos
cross-tenant sin red; sin C-2 el CI aplicaría un schema sin constraints y
los tests fallarían por razones incomprensibles. Costo: una iteración sin
features visibles.

**Ruta 2 — Ingesta primero, perímetro después.** Empezar por
`ImportBatch`/`ImportRow` porque es lo que mueve el producto. Trade-off
honesto: el staging es precisamente la capa que evade los services, así que
se estaría construyendo el camino que explota los tres críticos; y arreglar
C-3 después, con datos cargados, es una migración mucho más cara que hacerlo
ahora con las tablas casi vacías.

**Ruta 3 — Mixto por riesgo.** Solo lo explotable ya (C-1, C-2, ALTO-4, y
los dos de ALTO-10), después la ingesta, y C-3 **como parte** del diseño de
la ingesta en vez de como tarea aparte. Punto medio defendible si hay
presión de producto.

---

## 10. Apéndice: resumen priorizado

| # | Sev. | Hallazgo | Ancla |
|---|---|---|---|
| C-1 | ~~CRÍTICO~~ ✅ | RLS `for all` sin `REVOKE`: escalada a ADMIN vía PostgREST — **resuelto 2026-08-21**, ver §0.1 | `rls_policies.sql:64-127` |
| C-2 | ~~CRÍTICO~~ ✅ | 36 objetos de DDL fuera del historial de migraciones — **resuelto 2026-08-21**, ver §0.1 | `manual_constraints.sql:1-5` |
| C-3 | ~~CRÍTICO~~ ✅ | Cero FKs compuestas con `organization_id` (15/15 relaciones) — **resuelto 2026-08-21**, ver §0.1 | `init:274` |
| A-1 | ALTO | CI no ejecuta los 56 tests de integración; tests fuera del typecheck | `ci.yml:33`, `tsconfig.json:17` |
| A-2 | ALTO | Registro público con `email_confirm: true` → email squatting | `onboarding.service.ts:43-49` |
| A-3 | ALTO | Aceptación de invitación sin chequear `email_verified` | `verifyInvitationAcceptIdentity.ts:22-29` |
| A-4 | ALTO | Fallo del JWKS → 401 → deslogueo masivo, sin log | `jwt.ts:34-44` |
| A-5 | ALTO | Reorder de stages sin lock: lost update silencioso | `stage.service.ts:275-288` |
| A-6 | ALTO | Falta `(organization_id, created_at)`; ningún índice cubre `deleted_at` | `schema.prisma` vs los 8 `buildOrderBy` |
| A-7 | ALTO | `ILIKE '%x%'` sin `pg_trgm` en 6 repositorios | `activity.repository.ts:37-44` |
| A-8 | ALTO | Soft delete sin cascada lógica → huérfanos visibles | `stage.service.ts:306-316` |
| A-9 | ALTO | `users.email` único global → email quemado al remover un usuario | `init:169` |
| A-10 | ALTO | Frontend: callejón sin salida + campos opcionales que no se pueden vaciar | `ProtectedRoute.tsx:21-38`, `CompanyFormPage.tsx:31-40` |
| A-11 | ALTO | Sin ESLint/Prettier, sin Dockerfile ni deploy | (ausencia verificada) |
| A-12 | ALTO | Tipos duplicados a mano backend/frontend (`SortOrder` ×16) | 8 repos + 8 `features/*/types.ts` |
| A-13 | ALTO | N+1 trasladado al cliente (~60 peticiones por página) | `frontend/.../relationResolution.ts` |
| M-1…M-24 | MEDIO | Ver sección 4 | — |
| B-1…B-12 | BAJO | Ver sección 5 | — |
