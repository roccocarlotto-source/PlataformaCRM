# Arquitectura de Autenticación y Onboarding — Plataforma CRM

> Última actualización: 2026-07-10.
> Este documento es un diseño de arquitectura. Complementa a
> [`project-overview.md`](./project-overview.md), que describe el estado general del
> proyecto y el modelo de datos ya existente (`Organization`, `Role`, `User`,
> `Company`, `Contact`, `Pipeline`, `Stage`, `Opportunity`, `Activity`).
>
> **Estado de implementación**: la **sección 4** (middleware de autenticación y
> autorización) ya está construida — ver `src/middlewares/authenticate.ts`,
> `src/middlewares/authorize.ts`, `src/services/auth.service.ts`,
> `src/repositories/user.repository.ts`, `src/lib/jwt.ts` y `src/types/auth.ts`. No
> están montados sobre ninguna ruta todavía porque no hay rutas de negocio. **Todo lo
> demás sigue siendo diseño, no código**: el trigger de creación de `public.users`
> (sección 1), la tabla `Invitation` y su flujo (sección 2), y cualquier endpoint de
> login/registro/invitación.

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

Regla de producto: **fuera del flujo de la sección 1, nadie puede crear su propia
cuenta.** Todo usuario adicional de una organización llega exclusively por invitación
de un `ADMIN` de esa misma organización.

**Quién puede invitar**: únicamente usuarios con `role = ADMIN` dentro de su propia
organización. La ruta de invitación toma el `organizationId` **del usuario
autenticado que invita** (resuelto por el middleware, ver sección 4) — nunca de un
campo enviado por el cliente. Esto cierra, por diseño, la posibilidad de que un admin
de la Organización A invite a alguien a la Organización B.

**Entidad nueva propuesta — `Invitation`** (no existe hoy en `schema.prisma`; se
propone agregarla en la próxima iteración del modelo, antes de implementar este
flujo):

| Campo | Propósito |
|---|---|
| `id` | Identificador de la invitación. |
| `organizationId` | Organización a la que se invita. |
| `email` | Email de la persona invitada. |
| `roleId` | Rol que tendrá al aceptar. |
| `invitedById` | `User` (ADMIN) que generó la invitación — trazabilidad. |
| `status` | `PENDING \| ACCEPTED \| EXPIRED \| REVOKED`. |
| `expiresAt` | Vencimiento de negocio (propuesto: 7 días desde la creación). |
| `acceptedAt` | Se completa cuando el usuario efectivamente entra al sistema. |

*Por qué una tabla propia y no confiar solo en el mecanismo interno de Supabase*:
Supabase resuelve muy bien la parte "insegura" de invitar (generar un link firmado,
mandarlo por email, dejar que el usuario setee su contraseña) — no tiene sentido
reimplementar eso. Pero Supabase no sabe nada de `organizationId`, `roleId`, ni de
"quién invitó a quién" — esa es información de negocio que necesitamos para: mostrarle
al ADMIN la lista de invitaciones pendientes, poder revocar una invitación antes de
que se acepte, y aplicar **nuestra propia** política de vencimiento (independiente del
TTL interno del link de Supabase).

**Flujo completo:**

1. **El ADMIN completa un formulario** (email + rol) en el frontend. El backend
   verifica, vía middleware, que quien hace el request es `ADMIN` de una organización
   activa.

2. **Validaciones previas** en el backend (dentro de una transacción de Prisma):
   - Que no exista ya un `public.users` con ese email en esa organización (no tiene
     sentido invitar a alguien que ya es miembro).
   - Que no exista ya una `Invitation` con `status = PENDING` para ese mismo
     `(organizationId, email)` — evita invitaciones duplicadas.

3. **Se crea la fila `Invitation`** con `status = PENDING` **antes** de llamar a
   Supabase. *Justificación del orden*: si el paso 4 (llamada a Supabase) falla, no
   queda ninguna invitación fantasma — simplemente no se creó nada del lado de
   Supabase tampoco, y el ADMIN puede reintentar. El orden inverso (invitar primero en
   Supabase, guardar después) es peor: si el guardado en nuestra base fallara después
   de que Supabase ya mandó el email, el usuario invitado recibiría un link que nunca
   va a poder completarse (ver [riesgo en sección 7](#7-riesgos)).

4. **El backend llama a la Admin API de Supabase**
   (`auth.admin.inviteUserByEmail`, que requiere la `SERVICE_ROLE_KEY` y por lo tanto
   **solo puede ejecutarse desde el backend**, nunca desde el frontend), pasando como
   metadata el `id` de la `Invitation` recién creada, la `organizationId` y el
   `roleId`. Supabase crea la fila en `auth.users` de inmediato (con la columna
   propia `invited_at` seteada — es la señal que el trigger de la sección 1 usa para
   *no* rechazar este insert) y envía el email con el link de invitación.

   *Nota importante*: a diferencia del flujo de la sección 1, **el trigger de
   `auth.users` NO crea `public.users` en este punto.** Ver el porqué en el paso 6.

5. **El usuario invitado abre el email y sigue el link.** El frontend usa el flujo de
   Supabase para que la persona establezca su contraseña — esto autentica al usuario
   y le da una sesión válida (JWT), pero **todavía no existe fila en `public.users`
   para él.**

6. **El frontend, con esa sesión recién obtenida, llama a un endpoint del backend**
   dedicado: *aceptar invitación*. Este endpoint:
   - Verifica el JWT (igual que cualquier request autenticado).
   - Busca la `Invitation` con `status = PENDING` que corresponda al email del token.
   - Valida que **no** esté vencida (`expiresAt > now()`) y que no haya sido revocada.
   - Si es válida: crea `public.users` (mismo `id` que `auth.users.id`,
     `organizationId` y `roleId` **tomados de la `Invitation`, nunca del cliente**),
     y marca la `Invitation` como `ACCEPTED`, todo en una única transacción de
     Prisma.
   - Si no es válida (vencida, revocada, o no existe): devuelve un error claro
     ("esta invitación venció, pedile a tu administrador que te reinvite") — el
     usuario queda con una identidad válida en Supabase pero sin poder usar el CRM
     hasta que lo reinviten (ver [sección 6](#6-casos-especiales)).

   *Por qué esto vive en un endpoint del backend y no en un trigger de DB* (a
   diferencia de la sección 1): la validación de vencimiento debe evaluarse **en el
   momento de la aceptación**, no en el momento en que se creó el `auth.users` (que es
   cuando se manda la invitación, no cuando se acepta). Un trigger `AFTER INSERT ON
   auth.users` se dispara demasiado temprano para esta validación — se dispara al
   invitar, no al aceptar. Escribir esta lógica en TypeScript también la hace más
   fácil de testear que replicarla en PL/pgSQL.

7. **Asignación de rol**: queda resuelta por construcción — el `roleId` viene de la
   `Invitation`, elegido por el ADMIN en el paso 1, y nunca es negociable por la
   persona que acepta la invitación.

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
   │  firmado por Supabase (hoy: secreto compartido SUPABASE_JWT_SECRET;
   │  ver recomendación de migrar a claves asimétricas en sección 8)
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

> ✅ **Implementado.** Mapeo diseño → código:
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
>   sin permisos granulares).
>
> Ninguno de los dos middlewares está montado sobre una ruta real todavía — son
> exports reutilizables a la espera del primer endpoint protegido.

Diseño conceptual del middleware que se ejecuta antes de cualquier ruta de negocio
protegida:

1. **Extraer el token.** Leer el header `Authorization`, exigir formato
   `Bearer <token>`. Si falta o el formato es inválido → `401`.

2. **Verificar el JWT.** Validar firma y expiración usando `SUPABASE_JWT_SECRET` (o,
   si se adopta la recomendación de la sección 8, contra el JWKS público del
   proyecto). Si la verificación falla (firma inválida, `exp` vencido) → `401`. Este
   es el único punto del sistema que decide si una firma es válida — ninguna otra capa
   vuelve a verificarla.

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

**Recomendación concreta**: activar RLS en todas las tablas multi-tenant
(`companies`, `contacts`, `opportunities`, `pipelines`, `stages`, `activities`, y
`users`), con políticas basadas en `organization_id = (la organización del usuario
autenticado, resuelta vía `auth.uid()` contra `public.users`)`. Documentar
explícitamente en el código (comentario en la migración SQL) que estas políticas
**no** son la defensa del path de Express — son la defensa de todo lo demás. No
relajar la disciplina de scoping en Prisma asumiendo "total, RLS me cubre": es
exactamente la falsa sensación de seguridad que este documento busca evitar nombrando
el problema ahora.

---

## 6. Casos especiales

- **Usuario desactivado** (`isActive = false`, decisión de un ADMIN). No hace falta
  revocar el JWT vigente: el middleware vuelve a leer `isActive` desde Postgres en
  cada request (principio rector, arriba), así que el próximo request del usuario
  desactivado ya devuelve `403`, sin importar cuánto le quede de vigencia al token.

- **Usuario eliminado.** El modelo actual de `User` **no tiene `deletedAt`** (a
  diferencia de `Company`, `Contact`, `Opportunity`, etc. — ya señalado como
  asimetría en `project-overview.md`). Esto importa especialmente acá porque
  `Opportunity.ownerId` y `Activity.authorId` son **campos obligatorios** (no
  nullable) — un hard delete de un `User` que sea dueño de oportunidades o autor de
  actividades **rompería esas filas** (violación de integridad referencial) o las
  dejaría huérfanas si se relajara la constraint. Conclusión de este diseño: "eliminar
  un usuario" en este CRM debe significar siempre **soft delete**, nunca hard delete.
  Se recomienda agregar `deletedAt` a `User` (ver [sección 8](#8-recomendaciones))
  para modelar esto igual que el resto de las entidades, en vez de sobrecargar
  `isActive` con dos significados distintos (desactivado temporalmente vs. eliminado
  definitivamente).

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

- **Cambio de rol.** Solo un `ADMIN` puede cambiar el rol de otro usuario de su misma
  organización — nunca el propio (bloquear explícitamente la auto-promoción, ver
  sección 7). Al igual que la desactivación, tiene efecto inmediato en el siguiente
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

- **Escalación de privilegios vía autopromoción de rol.** Un `USER` intenta llamar al
  endpoint de cambio de rol sobre su propio `id`. **Mitigación**: el endpoint de
  cambio de rol debe rechazar explícitamente `targetUserId === req.auth.userId` — un
  usuario nunca puede modificar su propio rol, sin excepción, ni siquiera un `ADMIN`
  (para evitar que un ADMIN comprometido se otorgue permisos que no existen todavía).

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

1. **Migrar la verificación de JWT de secreto compartido a claves asimétricas
   (JWKS)**, si el proyecto de Supabase lo soporta. Hoy el diseño (y el
   `.env.example` ya existente) usa `SUPABASE_JWT_SECRET`, un secreto simétrico que el
   backend debe conocer y proteger. Supabase ofrece firmas asimétricas (ES256) donde
   el backend solo necesita la clave pública (vía un endpoint JWKS), sin guardar
   ningún secreto compartido — reduce superficie de exposición y permite rotar claves
   sin coordinar un secreto entre Supabase y el backend. No es bloqueante para
   arrancar, pero vale la pena evaluarlo antes de escribir el middleware definitivo.

2. **Agregar `deletedAt` a `User`.** Ya justificado en la sección 6 ("usuario
   eliminado") — sin esto, no hay forma segura de eliminar un usuario que sea dueño de
   oportunidades o autor de actividades, dado que esos campos son obligatorios.

3. **Agregar la entidad `Invitation`** al schema (tabla propuesta en la sección 2) —
   es un requisito para poder implementar el flujo de invitación tal como está
   diseñado acá, no una mejora opcional.

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
