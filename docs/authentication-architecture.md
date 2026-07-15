# Arquitectura de Autenticación y Onboarding — Plataforma CRM

> Última actualización: 2026-07-11.
> Este documento es un diseño de arquitectura. Complementa a
> [`project-overview.md`](./project-overview.md), que describe el estado general del
> proyecto y el modelo de datos ya existente (`Organization`, `Role`, `User`,
> `Company`, `Contact`, `Pipeline`, `Stage`, `Opportunity`, `Activity`, `Invitation`).
>
> **Estado de implementación**: **secciones 1, 2, 4 y 5 completamente implementadas
> y verificadas contra un proyecto real de Supabase.**
> - **Sección 4** (middleware de autenticación y autorización) — `src/middlewares/
>   authenticate.ts`, `src/middlewares/authorize.ts`, `src/services/auth.service.ts`,
>   `src/repositories/user.repository.ts`, `src/lib/jwt.ts`, `src/types/auth.ts`.
>   Montada sobre todas las rutas de negocio protegidas. `GET /api/me`
>   (`src/controllers/me.controller.ts`, `src/routes/me.routes.ts`) expone al
>   cliente, sin ninguna query adicional, el `AuthContext` que este
>   middleware ya resuelve en cada request — es la única forma que tiene el
>   frontend de conocer su propio `organizationId`/`role` tras un login
>   normal, dado que el JWT de Supabase nunca los lleva (ver principio
>   rector, arriba).
> - **Sección 5** (RLS) — `prisma/sql/rls_policies.sql`, aplicada y reverificada
>   empíricamente con queries read-only contra la base real (rol de conexión de
>   Prisma con `bypassrls = true` confirmado, no asumido).
> - **Sección 1** (onboarding) — implementada como endpoint de backend en vez de
>   trigger de DB, ver el detalle debajo del título de esa sección.
> - **Sección 2** (invitación de usuarios) — implementada como endpoint de backend,
>   **no** como el trigger `AFTER INSERT ON auth.users` que el diseño original de
>   esta sección asumía (ese trigger nunca se construyó ni para onboarding ni para
>   invitaciones — ver la corrección explícita al inicio de la sección 2). Módulo
>   `Invitation` completo (`src/services/invitation.service.ts`,
>   `src/repositories/invitation.repository.ts`, `src/controllers/
>   invitation.controller.ts`), con transiciones de estado por compare-and-swap
>   (`updateMany` condicionado a `status: "PENDING"`) verificadas históricamente
>   (sesión manual H3/H4, no test persistente) con tres carreras concurrentes
>   reales contra Supabase, no de manera uniforme entre las tres — ver el
>   desglose exacto y la cobertura persistente actual en `project-overview.md`
>   sección 4.
>
> Lo que sigue siendo diseño, no código: endpoint de login propio (el login en sí no
> pasa por Express, ver sección 3 — esto es una decisión de diseño estable, no algo
> pendiente de implementar).
>
> **M7 (frontend, ⏳ implementado y verificado en este ciclo, cierre pendiente de
> decisión del operador)**: los pasos 5-6 de la sección 2 (el frontend de
> aceptación) ya están implementados — `frontend/src/features/auth/AcceptInvitationPage.tsx`,
> ruta `/invite/accept`, fuera de `ProtectedRoute`. Un punto no cubierto
> explícitamente por el diseño original de esta sección y confirmado durante
> la implementación: `inviteUserByEmail` no fuerza a la persona invitada a
> establecer una contraseña — como este frontend solo soporta login por
> `email`+`password` (`signInWithPassword`, sección 3), `AcceptInvitationPage`
> agrega un paso explícito de `supabase.auth.updateUser({ password })`
> **después** de que `POST /api/invitations/accept` tenga éxito (nunca antes,
> para no modificar la identidad de Supabase sin saber todavía si la
> `Invitation` seguía siendo aceptable). `invitationId` se obtiene leyendo
> `supabase.auth.getUser().data.user.user_metadata.invitationId` (el mismo
> valor que `createInvitation` ya pasaba como `data` a `inviteUserByEmail`,
> paso 4 de la sección 2) — se usa para desambiguar el caso de la sección 7
> (mismo email invitado por más de una organización a la vez). El
> `redirectTo` de `inviteUserByEmail` sigue sin configurarse explícitamente
> en el código (usa el Site URL/Redirect URLs del proyecto de Supabase) —
> configuración operativa externa, no resuelta en este ciclo.

## Principio rector

Antes de entrar en los flujos, un principio que sostiene casi todas las decisiones de
este documento y al que se hace referencia constantemente:

> **El JWT prueba identidad, nada más.** Contiene `sub` (id de `auth.users`), `email` y
> `exp`. Cada request autenticado vuelve a leer de PostgreSQL (vía Prisma) el
> `organizationId`, el `role` y el `isActive` del usuario — **nunca se confía en esos
> datos si vinieran embebidos en el JWT o cacheados en memoria**.

La consecuencia práctica es que desactivar un usuario, cambiarle el rol, o eliminar su
organización **tiene efecto inmediato en el siguiente request**, sin necesidad de
mantener una lista de tokens revocados ni esperar a que el JWT expire. El costo es una
consulta a Postgres por request — un costo asumido y razonable para el beneficio de
seguridad y simplicidad que da.

---

## 1. Onboarding inicial

> ✅ **Implementado**, con tres cambios respecto al diseño original de esta sección
> (decididos y aprobados explícitamente antes de escribir el código):
>
> - **Orquestación desde el backend, no trigger de Postgres.** `POST /api/onboarding`
>   (`src/routes/onboarding.routes.ts` → `onboarding.controller.ts` →
>   `onboarding.service.ts`) hace lo que acá abajo se describía como responsabilidad
>   de un trigger `AFTER INSERT ON auth.users`. El trigger nunca se implementó — se
>   prefirió mantener toda la lógica en TypeScript, testeable, y consistente con el
>   patrón de capas del resto del backend. La consecuencia es que la atomicidad ya no
>   es "gratis" (una sola transacción de Postgres): `auth.users` (Supabase) y
>   `Organization`/`public.users` (Prisma) son ahora dos sistemas separados. La
>   estrategia de consistencia: crear el usuario en Supabase Auth primero
>   (`supabaseAdmin.auth.admin.createUser`, `service_role`), después
>   `Organization` + lookup de `Role` + `public.users` en una única
>   `prisma.$transaction` (atómica de nuestro lado), y si esa transacción falla,
>   compensar borrando el usuario de Supabase Auth (`admin.deleteUser`). Si la
>   compensación también falla (caso raro), se loguea como error crítico con el id
>   huérfano — no hay forma de garantizar consistencia perfecta cross-sistema sin
>   transacciones distribuidas, y se prefiere nombrar ese residual antes que
>   esconderlo.
> - **Colisión de nombre de organización → error, no sufijo.** El párrafo de abajo
>   decía que una colisión de slug se resolvía agregando un sufijo corto. Se cambió a
>   devolver `409` ("ya existe una organización con ese nombre") — más predecible
>   para el usuario y necesario para que una segunda petición idéntica sea
>   idempotente (no cree una organización distinta silenciosamente).
> - **Email auto-confirmado, no requiere click de confirmación.** El paso 4 de abajo
>   asumía que el usuario no tiene sesión válida hasta confirmar su email. El
>   endpoint usa la Admin API (`email_confirm: true`), que no dispara el flujo de
>   confirmación por email que sí tiene el `signUp` público — evita depender de
>   infraestructura de envío de mails (SMTP) que todavía no existe en el proyecto.
>   Es una reducción de seguridad consciente y documentada, revisable cuando se
>   agregue el flujo de invitaciones (que sí va a necesitar envío de mails, vía
>   `inviteUserByEmail`).

Contexto de producto que resuelve una aparente contradicción con la sección 2: el CRM
**no permite que alguien se una a una organización existente sin ser invitado**, pero
**sí permite que cualquiera cree una organización nueva** (así arranca cualquier SaaS
B2B self-serve: alguien tiene que ser el primero). Son dos flujos distintos con reglas
distintas — este documento los separa explícitamente para no confundirlos.

**Paso a paso — "una empresa crea su cuenta por primera vez":**

1. **El frontend pide, además de email/contraseña, el nombre de la organización**
   (ej. "Acme Inc.") y el nombre completo de la persona. Este es el único formulario
   de registro público que existe en todo el sistema.

2. **El frontend llama a Supabase Auth `signUp`**, pasando el nombre de la
   organización y el nombre completo como *user metadata* del signup, junto con un
   marcador explícito de intención (`intent: "new_organization"`). Supabase crea la
   fila en `auth.users` con esos metadatos guardados en `raw_user_meta_data`.
   *Justificación*: reutiliza el mecanismo de signup estándar de Supabase (validación
   de contraseña, confirmación de email, rate limiting) en vez de reinventar un
   formulario de registro custom.

3. **Un trigger `AFTER INSERT ON auth.users`** (extensión del mismo patrón que ya usan
   los triggers de sincronización de email en `manual_constraints.sql`) se dispara
   dentro de la **misma transacción** que crea la fila de `auth.users`, y hace lo
   siguiente:
   - Si `raw_user_meta_data->>'intent' = 'new_organization'`: crea una fila nueva en
     `Organization` (nunca reutiliza una organización existente, aunque el metadata
     trajera un `organization_id` — ese campo se ignora deliberadamente en esta rama,
     ver [sección 7](#7-riesgos)), generando un `slug` único a partir del nombre
     provisto (normalizado; si hay colisión de slug, se le agrega un sufijo corto en
     vez de fallar el signup completo — fallar todo el registro por una colisión de
     slug sería mala UX para algo que el usuario ni ve).
   - Busca el `Role` llamado `ADMIN` en el catálogo global de roles.
   - Crea la fila en `public.users` con `id` = `auth.users.id`, la `organizationId`
     recién creada, el `roleId` de `ADMIN`, y `fullName` desde el metadata.
   - Si el insert de `auth.users` **no** tiene `intent = 'new_organization'` **ni**
     `invited_at IS NOT NULL` (es decir, no es ni un founder-signup ni una invitación
     legítima), el trigger **rechaza el insert** (`RAISE EXCEPTION`), lo cual revierte
     también la creación del usuario en `auth.users` — Supabase Auth le devuelve un
     error al cliente y no queda ninguna identidad huérfana. **Este rechazo es el
     mecanismo real que impide el registro público** para unirse a una organización:
     no es una validación de frontend que se pueda saltear, es una regla que vive en
     la base de datos y se aplica sin importar qué cliente llame a la API de
     Supabase Auth.

   *Justificación de que esto viva en un trigger de DB y no en un endpoint del
   backend*: la creación de `Organization` + `User` ADMIN es atómica con la creación
   de la identidad en Supabase — no hay ventana en la que exista un `auth.users` sin
   organización ni perfil (a diferencia del flujo de invitación, ver sección 2, donde
   esa ventana sí existe intencionalmente).

4. **Confirmación de email.** Si el proyecto de Supabase tiene confirmación de email
   habilitada (recomendado), el usuario no obtiene una sesión válida hasta clickear el
   link de confirmación. La `Organization` y el `User` ADMIN ya existen en ese punto
   (se crearon en el paso 3), pero el founder todavía no puede autenticarse — evita que
   alguien registre una cuenta con un email que no controla y aun así "cree" una
   organización utilizable.

5. **Primer login.** Una vez confirmado el email, el founder inicia sesión
   normalmente (ver [sección 3](#3-flujo-de-autenticación)). El middleware lo
   reconoce como `ADMIN` de su organización recién creada porque `public.users` ya
   existe con esos datos desde el paso 3 — no hace falta ningún paso adicional de
   "completar perfil".

**Dependencia a tener en cuenta**: este flujo asume que el catálogo `Role` ya tiene
sembrada la fila `ADMIN` (y `USER`) *antes* de que exista el primer signup — es un
prerequisito operativo (seed), no algo que el trigger pueda crear sobre la marcha sin
ambigüedad.

---

## 2. Invitación de usuarios

> ✅ **Implementado**, con un cambio de diseño respecto a la versión original de esta
> sección (decidido y aprobado explícitamente antes de escribir el código, mismo
> criterio que la sección 1): el párrafo original asumía un trigger
> `AFTER INSERT ON auth.users` (heredado del diseño original de la sección 1) que
> "no crearía `public.users`" para el caso de invitación. **Ese trigger nunca se
> construyó, ni para onboarding ni para invitaciones** — la sección 1 ya está
> orquestada 100% desde el backend (`POST /api/onboarding`), y la invitación sigue
> exactamente el mismo criterio: todo en TypeScript, nada en PL/pgSQL. La distinción
> real entre "crear invitación" y "aceptar invitación" no es trigger-vs-no-trigger,
> es **service.ts vs. service.ts con verificación de identidad distinta** — ver el
> paso 6 corregido más abajo.

Regla de producto: **fuera del flujo de la sección 1, nadie puede crear su propia
cuenta.** Todo usuario adicional de una organización llega exclusivamente por invitación
de un `ADMIN` de esa misma organización.

**Quién puede invitar**: únicamente usuarios con `role = ADMIN` dentro de su propia
organización (`authenticate` + `authorize("ADMIN")`, montados en
`src/routes/invitation.routes.ts`). La ruta de invitación toma el `organizationId`
**del usuario autenticado que invita** (`req.auth.organizationId`) — nunca de un
campo enviado por el cliente. Esto cierra, por diseño, la posibilidad de que un admin
de la Organización A invite a alguien a la Organización B.

**Entidad `Invitation`** (`schema.prisma`, `src/repositories/invitation.repository.ts`):

| Campo | Propósito |
|---|---|
| `id` | Identificador de la invitación. |
| `organizationId` | Organización a la que se invita. |
| `email` | Email de la persona invitada, normalizado a minúsculas. |
| `roleId` | Rol que tendrá al aceptar — resuelto server-side desde `role: "ADMIN" \| "USER"`, nunca un `roleId` crudo del cliente. |
| `invitedById` | `User` (ADMIN) que generó la invitación — trazabilidad. |
| `status` | `enum InvitationStatus`: `PENDING \| ACCEPTED \| REVOKED \| EXPIRED`. Fuente de verdad del ciclo de vida — sin `deletedAt` propio (ver `project-overview.md` sección 4). |
| `expiresAt` | Vencimiento de negocio, 7 días desde la creación, calculado server-side. |
| `acceptedAt` | Se completa cuando el usuario efectivamente entra al sistema. |

*Por qué una tabla propia y no confiar solo en el mecanismo interno de Supabase*:
Supabase resuelve muy bien la parte "insegura" de invitar (generar un link firmado,
mandarlo por email, dejar que el usuario setee su contraseña) — no tiene sentido
reimplementar eso. Pero Supabase no sabe nada de `organizationId`, `roleId`, ni de
"quién invitó a quién" — esa es información de negocio que necesitamos para: mostrarle
al ADMIN la lista de invitaciones pendientes, poder revocar una invitación antes de
que se acepte, y aplicar **nuestra propia** política de vencimiento (independiente del
TTL interno del link de Supabase).

**Flujo completo (con tres carreras concurrentes reales verificadas históricamente
contra Supabase — sesión manual H3/H4, no de manera uniforme ni como test
persistente: ver `project-overview.md` sección 4 para el desglose exacto por
tramo, el mecanismo de compare-and-swap y la cobertura persistente actual):**

1. **El ADMIN completa un formulario** (email + rol) en el frontend. El backend
   verifica, vía middleware, que quien hace el request es `ADMIN` de una organización
   activa.

2. **Validaciones previas** en `invitation.service.ts` (`createInvitation`):
   - Que no exista ya un `public.users` con ese email **en toda la plataforma**
     (`User.email` es único globalmente, no por organización — no solo "en esa
     organización" como decía la versión original de este documento).
   - Que no exista ya una `Invitation` con `status = PENDING` para ese mismo
     `(organizationId, email)` — evita invitaciones duplicadas. Este chequeo es un
     pre-check de UX, no la defensa real contra una carrera: la defensa real es el
     índice único parcial `invitations_org_email_pending_unique`
     (`manual_constraints.sql`) — dos requests concurrentes para el mismo
     `(organizationId, email)` insertan como mucho una fila; la que pierde recibe
     `409` (`Prisma.PrismaClientKnownRequestError` con `code: "P2002"` capturado y
     traducido, nunca un `500` crudo).

3. **Se crea la fila `Invitation`** con `status = PENDING` **antes** de llamar a
   Supabase. *Justificación del orden*: si el paso 4 (llamada a Supabase) falla, se
   hace **hard delete** de la `Invitation` que acaba de crear esta misma operación
   (deliberado, no una revocación — esa fila nunca llegó a existir funcionalmente) y
   el ADMIN puede reintentar. Si el hard delete también falla, se loguea como error
   crítico con el `invitationId` (mismo criterio de riesgo residual que
   `onboarding.service.ts` documenta para su propia compensación). El orden inverso
   (invitar primero en Supabase, guardar después) es peor: si el guardado en nuestra
   base fallara después de que Supabase ya mandó el email, el usuario invitado
   recibiría un link que nunca va a poder completarse (ver [riesgo en sección
   7](#7-riesgos)).

4. **El backend llama a la Admin API de Supabase**
   (`auth.admin.inviteUserByEmail`, que requiere la `SERVICE_ROLE_KEY` y por lo tanto
   **solo puede ejecutarse desde el backend**, nunca desde el frontend), pasando como
   metadata el `id` de la `Invitation` recién creada. Supabase crea la fila en
   `auth.users` de inmediato y envía el email con el link de invitación.

   *Límite real de la plataforma, no de este código*: el email de `auth.users` es
   único en todo el proyecto de Supabase, no por organización — invitar un email que
   ya es identidad de Supabase (miembro de otra organización, u otra invitación en
   curso en cualquier organización) falla acá, traducido a `409`. Revocar o dejar
   vencer una `Invitation` **no** libera esa identidad de Supabase (ver riesgos).

5. **El usuario invitado abre el email y sigue el link.** `supabase-js`
   (`detectSessionInUrl: true`, `frontend/src/lib/supabase.ts`) consume el link
   automáticamente y establece una sesión válida (JWT) — pero **todavía no existe
   fila en `public.users` para él.** *Corrección respecto a una versión anterior de
   este párrafo (M7, implementación real)*: el frontend **no** hace que la persona
   establezca su contraseña en este paso, antes de llamar a `accept` — `AcceptInvitationPage`
   pide `POST /api/invitations/accept` primero (paso 6) y recién si esa
   aceptación tiene éxito ejecuta `supabase.auth.updateUser({ password })`;
   hacerlo en el orden inverso arriesgaría modificar la identidad de Supabase
   sin saber todavía si la `Invitation` seguía siendo aceptable (vencida,
   revocada, ya aceptada).

6. **El frontend, con esa sesión recién obtenida, llama a `POST /api/invitations/accept`**
   (`invitation.controller.ts` → `invitation.service.ts`, `acceptInvitation`). Este
   endpoint **no pasa por el middleware `authenticate` estándar**: ese middleware
   exige `resolveAuthContext`, que requiere una fila en `public.users` que
   precisamente todavía no existe para quien está aceptando — sería un `403` en el
   caso exacto que este endpoint tiene que resolver. En cambio usa una verificación
   liviana propia (`extractBearerToken` + `verifySupabaseJwt`, sin
   `resolveAuthContext`): solo prueba identidad (firma + expiración del JWT),
   `organizationId`/`roleId` salen exclusivamente de la `Invitation` encontrada,
   nunca del cliente ni del JWT. El endpoint:
   - Verifica el JWT.
   - Busca la `Invitation` — por `invitationId` explícito si se envía (recomendado:
     `findInvitationByIdUnscoped`, no filtra por status, así que da el error
     específico correcto — `409` ya aceptada, `410` revocada/vencida); si no se
     envía, busca entre las `PENDING` de ese email (`404` si no hay ninguna, `409`
     si hay más de una — un mismo email invitado a más de una organización a la
     vez, caso posible solo insertando filas directo en la base, no alcanzable hoy
     vía el flujo real porque Supabase ya rechaza el segundo `inviteUserByEmail`
     — ver riesgos).
   - Si el email del JWT no coincide con el de la `Invitation`: `404` (defensa en
     profundidad — nunca confía en que un `invitationId` ajeno no se cuele).
   - **Transición de estado por compare-and-swap, no por lectura previa**: dentro de
     una `prisma.$transaction`, el primer paso es `db.invitation.updateMany({
     where: { id, status: "PENDING" }, data: { status: "ACCEPTED", acceptedAt: ... }
     })` — si `count === 0`, alguien más ya transicionó esa `Invitation` (otra
     aceptación concurrente, o una revocación concurrente) y se aborta con `409`
     **antes** de intentar crear el `User` — cero riesgo de usuarios huérfanos. Si
     `count === 1`, recién ahí se crea `public.users` (mismo `id` que
     `auth.users.id`, `organizationId`/`roleId` de la `Invitation`) en la misma
     transacción.
   - Si la invitación no es válida (vencida, revocada, ya aceptada, o no existe):
     error claro y específico según el estado — el usuario queda con una identidad
     válida en Supabase pero sin poder usar el CRM hasta que lo reinviten (ver
     [sección 6](#6-casos-especiales)).

   *Por qué la validación de vencimiento vive acá y no en un mecanismo de Supabase*:
   debe evaluarse **en el momento de la aceptación**, no en el momento en que se
   invitó — la expiración es perezosa (`expireDueInvitations`, corre antes de
   cualquier operación que dependa del estado real de una `Invitation`), no un job
   programado.

7. **Asignación de rol**: queda resuelta por construcción — el `roleId` viene de la
   `Invitation`, elegido por el ADMIN en el paso 1, y nunca es negociable por la
   persona que acepta la invitación.

**Revocación** (`DELETE /api/invitations/:id`, ADMIN-only): mismo mecanismo de
compare-and-swap que la aceptación, en la dirección opuesta
(`PENDING → REVOKED`). Verificado históricamente (sesión manual H3/H4, no test
persistente) con una carrera real `accept` vs. `revoke` sobre la misma
`Invitation`, HTTP real completo en ambos sentidos: exactamente una transición
gana; si gana `revoke`, **nunca** se crea un `User`; si gana `accept`, `revoke`
recibe un `400`/`409` claro, nunca un `500`. Cobertura persistente actual (lock
determinístico de Postgres, no `Promise.all`): ver `project-overview.md` sección 4.

---

## 3. Flujo de autenticación

Recorrido de un request autenticado típico, ya con la cuenta creada (secciones 1/2
resueltas):

```
Login (frontend)
   │  usuario ingresa email + contraseña
   ▼
Supabase Auth
   │  valida credenciales contra auth.users
   │  emite access token (JWT, corta duración) + refresh token
   ▼
JWT
   │  firmado por Supabase con clave asimétrica (ES256) — el backend verifica
   │  contra el JWKS público del proyecto, sin secreto compartido (ver
   │  sección 4; era la recomendación 1 de la sección 8, ya implementada)
   │  claims: sub (= auth.users.id = public.users.id), email, exp
   ▼
Frontend
   │  el cliente de Supabase (supabase-js) guarda la sesión y renueva el
   │  access token automáticamente usando el refresh token antes de que
   │  expire — el frontend nunca maneja el refresh "a mano"
   │  cada request a la API propia agrega: Authorization: Bearer <jwt>
   ▼
Express (middleware de autenticación — ver sección 4)
   │  verifica firma y expiración del JWT
   │  extrae sub → busca en Postgres el User + Organization + Role reales
   │  (nunca confía en datos embebidos en el JWT más allá de sub/email)
   ▼
Prisma
   │  ejecuta la consulta de usuario, y luego todas las consultas del
   │  negocio de ese request, siempre con where: { organizationId }
   ▼
PostgreSQL (Supabase)
   │  devuelve solo las filas de la organización del usuario autenticado
   ▼
Response al frontend
```

Puntos a resaltar que no son obvios en el diagrama:

- **El login en sí no pasa por Express.** El frontend habla directo con Supabase Auth
  para login/logout/refresh — Express nunca ve una contraseña. Express solo entra en
  escena a partir del primer request a la API de negocio, verificando el JWT que
  Supabase ya emitió.
- **Express no emite tokens ni gestiona sesiones.** Toda la gestión de sesión (access
  token, refresh token, expiración, renovación) es responsabilidad de Supabase Auth +
  el SDK de frontend. Express es *stateless* respecto a sesiones: cada request se
  autentica de cero verificando el JWT que llega.

---

## 4. Middleware del backend

> ✅ **Implementado y verificado contra logins reales.** Mapeo diseño → código:
> - Pasos 1-3 (extraer token, verificar JWT, extraer `sub`/`email`) →
>   `src/lib/jwt.ts` (`verifySupabaseJwt`).
> - Paso 4 (resolver contra Postgres, con los tres resultados posibles) →
>   `src/repositories/user.repository.ts` (`findUserForAuth`) +
>   `src/services/auth.service.ts` (`resolveAuthContext`, que aplica las tres reglas).
> - Paso 5 (inyectar el contexto en el request) →
>   `src/middlewares/authenticate.ts` (adjunta `req.auth`, tipado en
>   `src/types/auth.ts`).
> - Paso 6 (autorización de grano fino, segundo middleware) →
>   `src/middlewares/authorize.ts` (`authorize(...roles)`, hoy solo `ADMIN`/`USER`,
>   sin permisos granulares). Ya montado sobre rutas reales (`/api/companies`).
>
> **Corrección importante, encontrada durante la implementación del módulo
> `Company`**: la primera versión de `lib/jwt.ts` verificaba con `jsonwebtoken` +
> `SUPABASE_JWT_SECRET` (HS256), tal como describía el paso 2 de abajo. Nunca se
> había probado contra un JWT real de Supabase — las pruebas de la tarea de
> autenticación usaban un token armado a mano con un secreto de prueba. Al probar
> el primer login real (para verificar el módulo `Company`), Supabase devolvió un
> JWT firmado con **ES256** (clave asimétrica) — este proyecto no usa el secreto
> compartido legacy. Se reemplazó `jsonwebtoken` por `jose`
> (`createRemoteJWKSet` + `jwtVerify` contra
> `SUPABASE_URL/auth/v1/.well-known/jwks.json`), y `SUPABASE_JWT_SECRET` se sacó
> de `env.ts`/`.env.example` por no usarse más. Esto implementa la recomendación
> 1 de la sección 8 — dejó de ser una mejora opcional, era lo que este proyecto
> necesitaba desde el principio. **Lección operativa**: verificar un flujo de auth
> únicamente con tokens fabricados a mano no prueba que funcione contra el
> proveedor real.

Diseño conceptual del middleware que se ejecuta antes de cualquier ruta de negocio
protegida:

1. **Extraer el token.** Leer el header `Authorization`, exigir formato
   `Bearer <token>`. Si falta o el formato es inválido → `401`.

2. **Verificar el JWT.** Validar firma y expiración contra el JWKS público del
   proyecto de Supabase (`src/lib/jwt.ts`, sin secreto compartido). Si la
   verificación falla (firma inválida, `exp` vencido) → `401`. Este es el único
   punto del sistema que decide si una firma es válida — ninguna otra capa vuelve
   a verificarla.

3. **Extraer identidad cruda del JWT.** Únicamente `sub` (id) y `email` — nada más del
   JWT se usa para tomar decisiones de autorización.

4. **Resolver el usuario real contra Postgres.** Con `sub`, buscar en `public.users`
   (vía Prisma) incluyendo su `Organization` y su `Role` en la misma consulta. Tres
   resultados posibles:
   - **No existe fila.** El JWT es válido (la identidad en Supabase existe) pero no
     hay perfil de negocio — típicamente una invitación nunca aceptada, o un
     `auth.users` recién creado por signup que el trigger rechazó pero que quedó con
     una sesión residual improbable. Responder `403` con un mensaje distinto a un
     `401` genérico ("tu cuenta todavía no está activada"), para que el frontend
     pueda mostrar algo útil en vez de mandarlo de nuevo al login en un loop.
   - **Existe pero `isActive = false`.** `403` — cuenta desactivada por un admin.
   - **Existe pero `organization.deletedAt IS NOT NULL`.** `403` — la organización fue
     dada de baja.
   - **Existe, activo, organización activa.** Continúa.

5. **Inyectar el contexto de autenticación en el request.** El resultado (`userId`,
   `organizationId`, `role`, `email`) queda disponible para el resto del handler y
   para la capa de servicios — es el **único** lugar del código donde se lee
   `organizationId` desde una fuente distinta a "lo que ya está en el contexto del
   request". Ningún handler de ruta debe volver a derivar `organizationId` de otro
   lado (params, body, headers).

6. **Autorización de grano fino** (ej. "solo ADMIN puede invitar") es responsabilidad
   de un segundo middleware/chequeo específico de cada ruta, no del middleware de
   autenticación — mantiene la separación entre "quién sos" (autenticación) y "qué
   podés hacer" (autorización).

---

## 5. Row Level Security

> ✅ **Implementado** en `prisma/sql/rls_policies.sql`, aplicado y verificado contra
> el proyecto real de Supabase: RLS habilitado en 10 tablas, con una función
> `public.current_organization_id()` (`SECURITY DEFINER`, evita la recursión de RLS
> al resolver la organización del propio usuario contra `public.users`). De esas 10,
> 8 son tenant-scoped y se aíslan con una política uniforme por `organization_id`
> (`stages` tiene `organization_id` propio, denormalizado desde `pipelines` — ya no
> requiere join); `organizations` y `roles` tienen políticas propias acordes a su
> estructura (sin columna `organization_id`). Se aplica con `prisma db execute
> --file prisma/sql/rls_policies.sql --url "$DIRECT_URL"`, igual que
> `manual_constraints.sql` — Prisma tampoco soporta RLS en su DSL.

La pregunta explícita del pedido es "no quiero duplicar responsabilidades" — la
respuesta no es que las tres capas hagan lo mismo por las dudas, sino que **cada capa
protege una superficie distinta**:

| Capa | Responsabilidad principal | Por qué es la dueña de esa responsabilidad |
|---|---|---|
| **Express** | Autenticación (quién sos) + autorización de grano fino (qué rol necesitás para esta acción) + reglas de negocio que no son "filtros de fila" (vencimiento de invitación, no poder auto-promoverse de rol, etc.) | Es donde vive el JWT y el contexto de la request — no hay otro lugar razonable para esto. |
| **Prisma / capa de servicios** | Aislamiento multi-tenant del día a día: **toda** query a una tabla con `organizationId` debe incluir ese filtro explícitamente. | Es simple, visible en el código, fácil de auditar y de testear — y es la capa que efectivamente corre el 100% de las queries de este backend. |
| **RLS (Postgres/Supabase)** | Red de seguridad **secundaria**, para cualquier acceso a la base que **no** pase por este backend. | Ver el porqué abajo — es importante entender sus límites reales en esta arquitectura. |

**Punto clave, y la razón de no tratar a RLS como la defensa principal**: Prisma se
conecta a Postgres usando la `DATABASE_URL`, con un rol de base de datos que tiene
privilegios elevados (equivalente al `service_role` de Supabase). El `service_role` de
Supabase tiene el atributo `BYPASSRLS` — es decir, **las políticas de RLS ni siquiera
se evalúan** para las conexiones que usa este backend. Activar RLS no vuelve más
seguro al camino Express → Prisma → Postgres; ese camino ya depende, y va a seguir
dependiendo, de que el código de Prisma filtre bien por `organizationId`.

Entonces, ¿para qué sirve RLS acá? Para las superficies que **no** son este backend y
que probablemente van a existir en algún momento: Supabase Realtime (subscripciones
directas del frontend a cambios en tablas), un cliente de Supabase usado directo desde
el frontend para algo puntual, acceso desde el SQL editor de Supabase con el rol
`authenticated`, o un futuro script/función serverless que use la `anon`/`authenticated`
key en vez de la `service_role`. Ninguna de esas rutas existe hoy en el diseño actual
(todo pasa por Express), pero es barato dejarlas protegidas desde ahora.

**Estado actual**: RLS está activo en las tablas multi-tenant (`companies`,
`contacts`, `opportunities`, `pipelines`, `stages`, `activities`, `users` e
`invitations`), con políticas basadas en `organization_id = (la organización del
usuario autenticado, resuelta vía `auth.uid()` contra `public.users`)`.
`prisma/sql/rls_policies.sql` ya documenta en su propio encabezado que estas
políticas **no** son la defensa del path de Express — son la defensa de todo lo
demás. No relajar la disciplina de scoping en Prisma asumiendo "total, RLS me
cubre": es exactamente la falsa sensación de seguridad que este documento busca
evitar nombrando el problema.

---

## 6. Casos especiales

- **Usuario desactivado** (`isActive = false`, decisión de un ADMIN). No hace falta
  revocar el JWT vigente: el middleware vuelve a leer `isActive` desde Postgres en
  cada request (principio rector, arriba), así que el próximo request del usuario
  desactivado ya devuelve `403`, sin importar cuánto le quede de vigencia al token.

- **Usuario eliminado.** ✅ Implementado: `User.deletedAt` (agregado en el módulo
  `Invitation`), con semántica distinta de `isActive` — `isActive: false` con
  `deletedAt: null` es una suspensión reversible; `deletedAt` seteado es remoción de
  la organización (`DELETE /api/users/:id`, soft delete: `deletedAt` + `isActive:
  false` en la misma escritura, sin undelete implementado). Esto era necesario
  porque `Opportunity.ownerId` y `Activity.authorId` son **campos obligatorios** (no
  nullable) — un hard delete de un `User` que sea dueño de oportunidades o autor de
  actividades rompería esas filas (violación de integridad referencial); de hecho,
  Postgres ya rechaza ese hard delete por sí solo (ninguna de las dos relaciones
  declara `onDelete`). `resolveAuthContext` chequea `deletedAt` antes que `isActive`
  (da el mensaje más específico, "removida" en vez de "desactivada", aunque
  `deletedAt` implica `isActive = false` por construcción). No se toca la identidad
  de Supabase Auth al remover un usuario — deliberado, para no perder la
  reversibilidad del lado de Supabase (aunque de nuestro lado, en este bloque, no
  hay forma de deshacer la remoción).

- **Organización eliminada** (`Organization.deletedAt` ya existe en el schema). El
  middleware ya lo chequea (paso 4 de la sección 4) — efecto inmediato en el próximo
  request de cualquier usuario de esa organización, sin trabajo adicional. Un proceso
  de baja de cuenta más completo (exportar datos, purgar definitivamente por
  cumplimiento) es un tema aparte, fuera del alcance de este documento.

- **Invitación vencida.** Resuelto en el paso 6 de la sección 2: la validación de
  `expiresAt` ocurre en el momento de aceptar, no antes. El usuario queda con una
  identidad válida en Supabase pero sin `public.users` — el middleware ya sabe
  responder ese caso con un mensaje claro (paso 4 de la sección 4).

- **JWT expirado.** Es el caso normal, no una falla: el middleware lo rechaza con
  `401`. La responsabilidad de renovarlo es exclusivamente del SDK de Supabase en el
  frontend (usa el refresh token de forma transparente); Express nunca intenta
  refrescar tokens.

- **Cambio de email.** Ya cubierto por los triggers existentes en
  `manual_constraints.sql` — Supabase exige confirmar el cambio (usualmente en ambos
  emails, viejo y nuevo) antes de escribir `auth.users.email`, y recién ahí el trigger
  `trg_propagate_auth_email_change` lo propaga a `public.users`. Ningún cambio
  adicional necesario para este diseño: `public.users.email` siempre refleja un email
  ya confirmado.

- **Cambio de rol.** ✅ Implementado (`PATCH /api/users/:id`, `user.service.ts`).
  Solo un `ADMIN` puede cambiar el rol de otro usuario de su misma organización —
  nunca el propio (`targetUserId === req.auth.userId` bloqueado explícitamente, ver
  sección 7). Además bloquea dejar a la organización sin ningún `ADMIN` activo
  (`countActiveAdmins`, mismo patrón que la protección del último `Pipeline`
  activo). Al igual que la desactivación, tiene efecto inmediato en el siguiente
  request gracias al principio rector: el rol nunca se cachea, se lee de Postgres en
  cada request.

---

## 7. Riesgos

- **Escalación de privilegios vía metadata falsificada en el signup.** Alguien podría
  llamar directamente a la API de Supabase Auth (sin pasar por el frontend) con
  `intent: "new_organization"` y un `organization_id` de una organización *existente*
  en el metadata, buscando que el trigger lo una a esa organización en vez de crear
  una nueva. **Mitigación**: la rama `new_organization` del trigger **nunca lee** un
  `organization_id` del metadata — siempre crea una fila `Organization` nueva. Es
  imposible, por diseño del trigger, unirse a una organización existente por esta vía.

- **Escalación de privilegios vía autopromoción de rol.** ✅ Mitigado e implementado:
  `PATCH /api/users/:id` (`user.service.ts`, `updateUser`) rechaza explícitamente
  `targetUserId === req.auth.userId` con `400` — un usuario nunca puede modificar su
  propio rol ni su propio `isActive`, sin excepción, ni siquiera un `ADMIN` (para
  evitar que un ADMIN comprometido se otorgue permisos que no existen todavía, y
  para que nunca pueda desactivarse/eliminarse a sí mismo dejando la organización
  sin nadie que pueda revertirlo). Verificado end-to-end contra Supabase real.

- **Fuga de datos entre tenants por una query de Prisma sin filtrar.** Es el riesgo
  más probable en la práctica (un desarrollador se olvida el `where: { organizationId
  }` en un endpoint nuevo). **Mitigación**: la disciplina de "capa de servicios"
  descrita en la sección 5 (nunca llamar a `prisma.<modelo>.findMany` directo desde un
  handler de ruta, siempre a través de funciones que exigen `organizationId` como
  parámetro obligatorio) + tests de integración específicos que verifiquen
  aislamiento cross-tenant + RLS como red secundaria.

- **Uso incorrecto de `SUPABASE_SERVICE_ROLE_KEY`.** Esta clave puede leer y escribir
  cualquier fila de cualquier organización, sin pasar por RLS. **Mitigación**: se usa
  exclusivamente para las dos llamadas administrativas descritas en este documento
  (`inviteUserByEmail`, y eventualmente revocar/borrar identidades) — nunca para
  servir requests normales de usuarios, que siempre pasan por el flujo JWT estándar.
  Nunca debe llegar al frontend (ya documentado en `.env.example`).

- **Bypass de RLS.** No es un riesgo nuevo que haya que mitigar con más RLS — es una
  característica conocida y documentada de esta arquitectura (Prisma usa
  `service_role`, que tiene `BYPASSRLS`). El riesgo real sería *creer* que RLS protege
  el path de Express y relajar la disciplina de scoping en Prisma por eso. La
  mitigación es la claridad de la sección 5, no una configuración técnica adicional.

- **Inconsistencia entre `auth.users` y `public.users` por falla parcial entre dos
  sistemas.** El flujo de invitación llama a dos sistemas distintos sin una
  transacción compartida (nuestra base de datos, y la API de Supabase Auth). Ya
  mitigado por el orden de operaciones elegido en la sección 2, paso 3-4: crear
  primero la `Invitation` en nuestra base y recién después invitar en Supabase, para
  que un fallo en el segundo paso nunca deje un email enviado sin invitación
  correspondiente. El caso inverso (una `Invitation` en `PENDING` sin que Supabase
  haya llegado a mandar el email, por un fallo justo después de crearla) es
  recuperable: el ADMIN simplemente reintenta la invitación, sin dejar identidades
  huérfanas en Supabase.

---

## 8. Recomendaciones

Puntos donde propongo un cambio o una decisión explícita sobre lo ya planteado en el
pedido original:

1. ✅ **Hecho — verificación de JWT contra JWKS (ES256), no secreto compartido.**
   Dejó de ser una recomendación evaluable: al probar el middleware contra un
   login real de este proyecto de Supabase, resultó que firma con ES256, no con
   el secreto legacy `SUPABASE_JWT_SECRET` (que ya no existe en `env.ts`/
   `.env.example`). `src/lib/jwt.ts` usa `jose` (`createRemoteJWKSet` +
   `jwtVerify`) contra `SUPABASE_URL/auth/v1/.well-known/jwks.json`. Ver el
   detalle completo en la sección 4.

2. ✅ **Hecho — `deletedAt` agregado a `User`.** Ver sección 6 ("usuario
   eliminado") y `project-overview.md` sección 4 para la semántica exacta
   (distinta de `isActive`, no redundante).

3. ✅ **Hecho — entidad `Invitation` agregada al schema** e implementada
   completa (sección 2), con las correcciones de diseño documentadas ahí
   (compare-and-swap en vez de lectura-luego-escritura, verificación liviana en
   la aceptación en vez de `authenticate` estándar).

4. **Formalizar la "capa de servicios" como regla de arquitectura, no como
   convención informal.** Dado que el mayor riesgo identificado (fuga de datos entre
   tenants) depende de que humanos no se olviden de filtrar por `organizationId`,
   conviene que esa regla sea estructural: por ejemplo, ningún handler de ruta importa
   `prisma` directamente, solo importa funciones de una capa de servicios que exige
   `organizationId` en su firma. Esto convierte un error humano posible en un error de
   compilación de TypeScript.

5. **Sembrar (seed) el catálogo `Role` con `ADMIN`/`USER` como parte de la
   configuración inicial del proyecto**, no como un paso manual — el flujo completo de
   la sección 1 depende de que esa fila exista antes del primer signup.

Ninguna de estas recomendaciones cambia la arquitectura de fondo descrita en las
secciones 1-7 — son ajustes puntuales que la hacen más robusta antes de implementarla.
