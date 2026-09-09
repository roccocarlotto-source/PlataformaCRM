# Auditoría de errores y bugs — 2026-08-29

Auditoría de solo lectura de todo el código fuente, posterior al cierre del
módulo de Agenda/Booking (PR #44 mergeado en `master`, commit `c29c006`).

---

## 0. Alcance, método y limitaciones

**Qué se auditó.** `src/**` completo (35.494 líneas de TypeScript: controllers,
services, repositories, utils, workers, middlewares, config, routes, schemas,
lib), `prisma/schema.prisma`, las 19 migraciones de `prisma/migrations/`,
`prisma/sql/*.sql`, `prisma/seed.ts`, los 8 scripts de `scripts/`,
`.github/workflows/ci.yml`, y los 49 archivos de test (`*.test.ts` y
`*.integration-test.ts`). No se auditó `frontend/` (fuera del alcance pedido).

**Punto de partida.** `master` actualizado contra `origin/master`
(`c29c006`, merge de PR #44). Antes de mirar código se leyeron
`docs/project-overview.md`, `docs/auditoria-2026-08-21.md`,
`docs/booking-architecture.md`, `docs/roadmap-implementacion.md` y las
bitácoras del 28 al 31 de agosto.

**Método.** Lectura directa del código. El módulo de Booking/Google Calendar
(el más nuevo y el que toca más categorías del checklist) se leyó a mano,
archivo por archivo; el resto se repartió en cuatro pasadas de investigación
por área (capa de datos, CRM core + middlewares + config, ingesta + outbox +
workers, calidad de tests + CI) cuyos hallazgos se **verificaron después uno
por uno contra el código** antes de entrar acá. Cada hallazgo está anclado a
`archivo:línea` con el escenario concreto que lo dispara.

Lo único que se ejecutó: `npm test` (302 unitarios en verde, 0 skip, 0 todo),
`npx prisma validate` y `npx prisma migrate diff --from-empty
--to-schema-datamodel` (no necesita base). **Nada se corrió contra una base de
datos.** No se modificó ningún archivo salvo este.

**Limitaciones.**

1. Los escenarios de concurrencia están razonados sobre el código y la
   semántica de Postgres (READ COMMITTED, `FOR UPDATE`), no reproducidos.
2. Lo que depende del comportamiento real de la API de Google (tamaño de
   calendarios, reintentos de notificaciones) está marcado como VERIFICAR.
3. Lo que ya estaba en la auditoría del 21/08 se re-reporta **solo** si se
   confirmó que sigue en el código actual, y se marca como tal.

**Convención de severidad** (la pedida para esta auditoría).

| Nivel | Criterio |
|---|---|
| **CRÍTICO** | Pérdida de datos, fuga de secretos, fuga de aislamiento entre tenants, caída del servidor |
| **ALTO** | Bug funcional real bajo condiciones alcanzables en producción |
| **MEDIO** | Bug real pero de bajo impacto o difícil de alcanzar |
| **BAJO** | Mejora, deuda técnica o inconsistencia menor sin impacto funcional claro |
| **VERIFICAR** | No está claro si es bug o decisión; se reporta para no omitirlo |

---

## 1. Estado general

**No se encontró ningún hallazgo CRÍTICO.** En particular, y para que no se
busque de nuevo:

- **Aislamiento multi-tenant.** Las 28 FKs cruzadas del schema final son
  compuestas `(organization_id, x) → padre(organization_id, id)`, incluidas
  las 10 del módulo de Booking; los 10 padres tienen su `UNIQUE
  (organization_id, id)`. Todas las lecturas y escrituras de los repositorios
  filtran por `organizationId` (las excepciones están justificadas en
  comentario: `findInvitationByIdUnscoped`, `findUserForAuth`,
  `findApiKeyByHash`, `findConnectionByChannelId`, purgas). Ningún
  `organizationId` viene del body ni de los params. El webhook de Google
  verifica el token firmado y la coincidencia de `channelId` **antes** de
  tocar Postgres, y `findBookingByGoogleEventId` exige `organizationId`.
- **Secretos.** `api_keys.key_hash` nunca sale de un repositorio;
  `google_calendar_connections.refresh_token` (cifrado con AES-256-GCM) solo
  lo leen `desconectar`, `obtenerAccessToken`, el webhook y el worker, y
  ninguno lo devuelve ni lo loguea. Las lecturas expuestas usan `select`
  explícito (`CAMPOS_PUBLICOS`, `API_KEY_PUBLIC_SELECT`).
- **Google fuera de las transacciones.** `createBooking` hace validaciones →
  transacción corta (lock resource → lock serviceType → conteo → INSERT) →
  commit → `events.insert` best-effort. Ninguna llamada a Google ocurre dentro
  de un `$transaction` ni con un lock sostenido. Lo mismo en `desconectar`,
  `completarConexion`, `cancelBooking` y `renovarCanal`.
- **Workers.** Los tres usan `setTimeout` encadenado, arrancan y se detienen
  solo en `server.ts`, `app.ts` no importa ninguno, y un error por ítem no
  corta la pasada. Los reclamos de cola usan `FOR UPDATE SKIP LOCKED`.
- **Drift schema ↔ migraciones: ninguno.** Enums, columnas, defaults, los 48
  FKs con sus acciones y todos los `@@index/@@unique` (incluido el tardío
  `service_types_organization_id_id_key` en `20260830120000:48`) coinciden
  con el DDL que Prisma deriva del schema.
- **Env.** El único `process.env` es `env.ts:221`. Las siete variables
  `.optional()` que se usan tienen un `if (!env.X) throw AppError(500)` en su
  punto de uso.
- **Rate limiting por identidad.** `businessWrite`, `importPreview`,
  `acceptInvitation` e `ingest` tienen `keyGenerator` explícito. No hay
  `trust proxy` ni `req.ip` en ninguna parte de `src/`. (Lo que sí hay es el
  default de la librería, que es IP — ver A-2.)
- **Fechas.** Fuera de `utils/workingHours.ts` y `utils/timezone.ts` solo hay
  duraciones puras en milisegundos y `setUTCDate` para retenciones; no hay
  aritmética de calendario a mano.
- **Roadmap vs. código.** Todo lo que `docs/roadmap-implementacion.md`
  marca como hecho existe en el código (Branch/Resource/ServiceType,
  OAuth + freebusy, WorkingHours + Booking + disponibilidad, webhook + worker
  de canales, outbox, Lead vs. Contact). No se encontró ningún ítem marcado
  `[x]` sin implementación detrás.

La deuda encontrada se concentra en tres lugares: **carreras no cerradas del
todo** (stages, y revalidaciones que faltan después de tomar el lock),
**tests de concurrencia que no fuerzan la carrera** (dan confianza que no
respaldan), y **una serie de hallazgos del 21/08 que siguen abiertos** sin
estar listados como pendientes en ningún lado.

---

## 2. Hallazgos CRÍTICOS

Ninguno.

---

## 3. Hallazgos ALTOS

### A-1 — Reordenar y borrar stages sin el lock del pipeline (ALTO-5 del 21/08 sigue abierto en 2 de 3 caminos)

**Archivos:** `src/services/stage.service.ts:236-285` (`updateStage`),
`:305-338` (`deleteStage`)

`createStage` sí toma `lockPipelineForUpdate` (`:196`). Pero `updateStage`
abre la transacción en `:263` **sin ningún lock** y lee `stage.order` fuera de
ella (`:237`); `deleteStage` toma `lockStageForUpdate` (`:313`) — la fila del
**stage**, no la del pipeline — y después corre `shiftDownAfter` (`:336`).
Las tres operaciones que mantienen la secuencia `order` serializan sobre tres
filas distintas, o sea que no serializan entre sí.

**Escenarios** (READ COMMITTED, índice parcial `stages_pipeline_order_unique`):

1. Dos `PATCH /api/stages/:id {order}` concurrentes sobre el mismo pipeline:
   los dos leen la misma lista de hermanos; `reindexStages` reasigna `1..N` a
   todos, así que no hay violación de constraint — **el primer reorder se
   pierde en silencio**.
2. `PATCH {order}` concurrente con `POST /api/stages`: `reindexStages`
   (`stage.repository.ts:211-239`) actualiza las filas en el orden de la
   permutación y `shiftUpFrom` (`:155-167`) en orden `desc` → dos órdenes de
   adquisición de row locks sobre el mismo conjunto → **deadlock** que
   Postgres resuelve abortando uno (`P2034`), que `errorHandler` no mapea →
   **500** al usuario. En los interleavings sin deadlock, choca contra el
   índice único → `P2002` con `target = pipeline_id,order` → cae al fallback
   de `rethrowAsConflict` (`:129-143`) → **409 "El registro ya existe"** al
   reordenar.
3. `PATCH {order}` concurrente con `DELETE /api/stages/:id`:
   `findStagesByPipeline` ve la foto pre-delete y `reindexStages` no filtra
   `deletedAt` → el stage borrado ocupa un slot de `1..N` y los vivos quedan
   con huecos.

**Fix** (el que ALTO-5 ya recomendaba): `lockPipelineForUpdate` como primera
sentencia en `updateStage` y `deleteStage` (antes del lock de stage, para
mantener el orden pipeline → stage) y releer `stage.order` adentro.

---

### A-2 — Los tres limiters públicos keyean por IP (default de `express-rate-limit`), y ahora hay Dockerfile

**Archivo:** `src/middlewares/rateLimit.ts:79-88` (onboarding, 5/15 min),
`:121-132` (OTP de onboarding, 5/15 min), `:156-164` (aceptación pre-auth,
20/5 min, **sin `skip`**)

```ts
export function createOnboardingRateLimiter() {
  return rateLimit({
    windowMs: ONBOARDING_WINDOW_MS,
    max: ONBOARDING_MAX,
    ...
    skip: (req) => !onboardingSchema.safeParse(req.body).success,
    // sin keyGenerator → default de la librería = req.ip
```

El encabezado del archivo (`:24-41`, `:66-68`) lo documenta como deliberado
"para un proceso Node/Express directo, sin reverse proxy documentado
delante". Esa premisa cambió: desde el 28/08 el repo tiene `Dockerfile`, y
cualquier PaaS o balanceador pone un proxy delante. Con `trust proxy` sin
configurar (que es la decisión del proyecto), `req.ip` es **la IP del proxy
para todos los clientes** y el cupo pasa a ser **global**:

- Un atacante manda 5 bodies de onboarding bien formados → **nadie puede
  registrarse durante 15 minutos**. Costo: cero.
- Manda 20 POST vacíos a `/api/invitations/accept` → **nadie puede aceptar
  invitaciones durante 5 minutos**.
- Sin proxy, la protección contra fuerza bruta del OTP de 6 dígitos depende
  de que el atacante no rote IPs.

Esto va contra la regla explícita del proyecto (nada por IP) y contradice el
propio comentario del archivo, que dice que "el límite por IP" solo es
correcto sin proxy. Hay una clave natural en los dos endpoints de onboarding:
el `email` del body (ya parseado en `skip`). Para `/invitations/accept`
pre-auth no hay identidad; si se mantiene por IP, al menos que quede escrito
que ese limiter es inservible con proxy delante. **Se marca ALTO y no
VERIFICAR** porque, aunque la decisión esté documentada, su premisa dejó de
ser cierta.

---

### A-3 — Todo fallo de infraestructura del JWKS se convierte en 401 (ALTO-4 del 21/08 sigue abierto), y lo mismo en la Admin API de invitaciones

**Archivos:** `src/lib/jwt.ts:32-42`,
`src/middlewares/verifyInvitationAcceptIdentity.ts:117-122`

```ts
try {
  const result = await jwtVerify(token, getJwks(), { algorithms: ["ES256"] });  // getJwks() adentro del try
  payload = result.payload;
} catch (err) {
  if (err instanceof joseErrors.JWTExpired) throw new AppError("El token expiró", 401);
  throw new AppError("Token inválido", 401);   // timeout del JWKS, red caída, AppError(500): todos 401
}
```

Idéntico al fragmento de ALTO-4. Escenario: el endpoint
`/auth/v1/.well-known/jwks.json` no responde (o aparece un `kid` nuevo y el
endpoint está caído) → **todos los requests autenticados devuelven 401**, el
frontend desloguea a todos, y el `err` original no queda en ningún log.

Mismo patrón en `verifyInvitationAcceptIdentity.ts:117-122`: un `error` de
red/5xx de `auth.admin.getUserById` se descarta sin log y
`resolverIdentidadDeInvitacion(null)` responde 401 "No se pudo verificar la
identidad del token" — una caída de Supabase se presenta al invitado como
credencial inválida.

**Fix:** distinguir `JWSSignatureVerificationFailed` /
`JWTClaimValidationFailed` / `JWTInvalid` (401) de `JWKSTimeout` /
`JWKSNoMatchingKey` / errores de red (503 + `logger.error({ err })`).

---

### A-4 — RESTRICT con un hueco: mover un `ServiceType` a otro recurso deja reservas CONFIRMED colgando de un recurso que después se puede borrar

**Archivos:** `src/services/serviceType.service.ts:513-530`
(`updateServiceType`), `src/services/resource.service.ts:320-326`
(`deleteResource`), `src/repositories/serviceType.repository.ts:100-106`

La cadena de RESTRICT del módulo es: `deleteServiceType` cuenta bookings
CONFIRMED; `deleteResource` cuenta service types activos; `deleteBranch`
cuenta recursos. Funciona **mientras `Booking.resourceId ==
ServiceType.resourceId`**. Pero `UpdateServiceTypeData` admite `resourceId`
y `updateServiceType` lo aplica revalidando solo que el recurso nuevo exista
y sea de la sucursal (`:522-528`) — **nunca cuenta las reservas del recurso
viejo**.

**Escenario:**

1. `ServiceType` "Corte" sobre `Resource` "Juan". Tres reservas CONFIRMED
   para la semana que viene (`bookings.resource_id = Juan`).
2. `PATCH /api/service-types/:corte {"resourceId": "<Pedro>"}` → 200. Las
   tres reservas siguen con `resource_id = Juan`, `service_type_id = Corte`.
3. `DELETE /api/resources/:juan` → `countActiveServiceTypesByResource(Juan)`
   = 0 (Corte ya apunta a Pedro) → **el recurso se soft-borra con tres
   reservas CONFIRMED colgando**.
4. Consecuencias: `GET /api/availability?resourceId=Juan` → 400 "el recurso
   no existe"; las reservas no aparecen en ninguna agenda por recurso (el
   listado de recursos excluye borrados); `countOverlappingBookings` sigue
   contándolas contra Juan y no contra Pedro, así que Pedro queda "libre"
   en un horario en el que en realidad hay clientes; el evento en Google
   sigue existiendo.

Ninguna FK ni CHECK puede expresar esto (cruza tablas). **Fix:** en
`updateServiceType`, cuando cambia `resourceId`, contar
`countActiveBookingsByServiceType` dentro de la transacción con el lock del
service type y rechazar con 400 si hay reservas CONFIRMED (mismo criterio que
`deleteServiceType`); o, alternativamente, hacer que `deleteResource` cuente
también `bookings CONFIRMED por resourceId`.

---

### A-5 — La grilla de disponibilidad se ancla en `from`, no en el borde de la franja

**Archivos:** `src/utils/workingHours.ts:215-217` (`expandirFranjas` recorta
`inicio` a `desde`), `src/services/availability.service.ts:100-104`
(`calcularTurnos` arranca en `franja.inicio`),
`src/controllers/booking.controller.ts:56-61` (pasa `from` crudo como
`desde`)

El comentario de `calcularTurnos` (`:92-94`) dice "la grilla arranca en el
borde de cada franja … cada media hora desde las 9". Pero la franja que le
llega ya está **recortada a `from`** por `expandirFranjas`, así que la
grilla arranca en `from` cuando `from` cae en medio de una franja. El test
`workingHours.test.ts:203-217` fija el recorte con el motivo "si no, la
disponibilidad ofrecería horarios que ya pasaron" — un objetivo correcto con
un efecto secundario que nadie contempló.

**Escenario** (recurso lunes 9-13, servicio de 30 min, una reserva
existente 9:30-10:00):

- Cliente A consulta `from=09:00` → turnos 9:00, ~~9:30~~, 10:00, 10:30, …
- Cliente B consulta a las 9:10 con `from=<ahora>` → turnos 9:10-9:40 (choca
  con la reserva → descartado), 9:40-10:10 (choca → descartado), 10:10, 10:40,
  … → **B ve la agenda corrida diez minutos y con un hueco de más**.
- B reserva 10:10-10:40 (válido: está dentro del horario). Ahora A, al
  refrescar con `from=09:00`, pierde 10:00 **y** 10:30 por una sola reserva.
  Cada reserva hecha desde una grilla "desfasada" tapa dos turnos de la
  grilla "alineada", y viceversa.

El widget público de reservas (que §5 del diseño menciona como consumidor de
este endpoint) va a llamar naturalmente con `from = ahora`, así que es el
caso normal, no el borde. **Fix:** expandir las franjas sin recortar el
inicio (o recortar solo al día), generar la grilla desde el borde real de la
franja, y filtrar los turnos con `inicio < from` **después**. Relacionado:
`createBooking` acepta cualquier `startsAt` dentro del horario (9:07 es
válido), así que la grilla tampoco se sostiene desde el lado de la escritura
— ver V-2.

---

### A-6 — Un `email: ""` en el payload de ingesta marca la fila FAILED en vez de tratarla como "sin email"

**Archivo:** `src/schemas/ingestContact.schema.ts:111-117`

```ts
email: z
  .string()
  .trim()
  .email("email inválido")          // corre ANTES del transform
  .max(255, "…")
  .optional()
  .transform((valor) => (valor === undefined || valor === "" ? undefined : valor)),
```

`.email()` rechaza `""` antes de que el `.transform()` lo convierta en
`undefined`. El helper `opcional()` (`:151-158`, usado por `phone` y
`jobTitle`) no tiene `.email()` y sí funciona; el comentario de `:143-150`
promete "trata `""` como AUSENTE" para los tres. No hay ningún test con
`email: ""`.

**Escenarios:**

1. Webhook: un formulario HTML con el input de email vacío manda
   `{"firstName":"Ana","lastName":"P","email":"","phone":"11…"}` — que es lo
   que hace cualquier `<form>` — y el worker marca `FAILED: email inválido`.
   Según §4 del diseño de ingesta debería promoverse con nota
   `revision_manual`.
2. **CSV con la columna email vacía en algunas filas**: `csv-parse` devuelve
   `""` para una celda vacía (`utils/spreadsheet.ts:162-180`), `armarFila`
   lo conserva, `comoTextoDeCelda` (`promotion.service.ts:162-166`) solo
   descarta `null`/`undefined` → **toda fila CSV sin email termina FAILED**.
   En XLSX la celda vacía llega como `null` y sí se descarta: la asimetría
   CSV/XLSX es otro síntoma del mismo bug.

**Fix:** `z.preprocess` que convierta `""` en `undefined` antes de
`.email()`, o `z.union([z.literal(""), z.string().email()])`.

---

### A-7 — El test de "dos reservas concurrentes por el último cupo" no detecta la pérdida del lock que dice probar

**Archivo:** `src/services/booking.integration-test.ts:758-797`

```ts
const resultados = await Promise.allSettled([
  createBooking(org, { resourceId, serviceTypeId, contactId, startsAt: LUNES_9_LOCAL }, …),
  createBooking(org, { resourceId, serviceTypeId, contactId, startsAt: LUNES_9_LOCAL }, …),
]);
assert.equal(exitosas.length, 1, "exactamente una tiene que ganar");
```

Dos problemas independientes:

1. **No fuerza el solapamiento.** Cada `createBooking` hace ~5 lecturas fuera
   de transacción antes del `$transaction`; que las dos lleguen a
   `countOverlappingBookings` antes de que ninguna commitee depende del
   scheduling. Con el lock sacado, el test detecta el bug *a veces*. El repo
   ya tiene la técnica determinística (`activity.service.integration-test.ts:141-192`
   con `pg_blocking_pids`, `outboxWorker.integration-test.ts:134-181` con
   transacción anidada) y acá no se aplicó.
2. **Aunque solape, el lock que dice probar es redundante en este test.** El
   comentario (`:759`) habla de `lockResourceForUpdate`, pero
   `booking.service.ts:183-184` toma **dos** locks seguidos, y las dos
   reservas del test usan el **mismo `serviceTypeId`**. Si alguien borra
   `lockResourceForUpdate` y deja `lockServiceTypeForUpdate`, el segundo
   serializa igual y **el test queda verde**. Para probar el lock de recurso,
   las dos reservas tienen que ser de dos `ServiceType` distintos sobre el
   mismo recurso — que es además el caso real que `countOverlappingBookings`
   describe ("corte de pelo encima de barba").

La bitácora del 30/08 (§5) presenta este test como "la carrera ejercitada de
verdad, no razonada". Hoy no lo es.

---

### A-8 — Dos tests negativos del worker de canales pasan por la razón equivocada, y el worker barre sin scope toda la base compartida de CI

**Archivos:** `src/services/googleCalendarSync.integration-test.ts:769-789`
("el worker NO toca conexiones cuyo canal está lejos de vencer") y
`:791-813` ("una conexión REVOKED no recibe canal");
`src/workers/googleCalendarChannelWorker.ts:63-65`;
`.github/workflows/ci.yml:314-334`

Los dos llaman `await renovarCanalesVencidos()` **sin cliente inyectado** y
afirman que la fila no cambió. `renovarCanalesVencidos` llama
`renovarCanal(conexion)` → `obtenerAccessToken(…, cliente = undefined)` →
`getClienteGoogleCalendar()`, que en CI **lanza** `AppError(500, "Faltan:
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI")` porque el job
no define ninguna `GOOGLE_*` salvo `GOOGLE_WEBHOOK_URL` (`ci.yml:316`). El
worker atrapa el error, incrementa `fallidos` y sigue. **Ninguna conexión
puede cambiar en esa llamada**, así que:

- el primer test pasa aunque `findConnectionsNeedingChannel` devolviera todas
  las filas;
- el segundo pasa aunque se borre el filtro `status: "ACTIVE"` del repositorio.

Ninguno mira `resumen.fallidos` (que en CI es > 0). Los tests positivos del
worker (`:683-767`) sí inyectan el doble y son válidos.

**Efecto lateral peligroso:** `renovarCanalesVencidos()` no está acotado por
organización y recorre **todas** las conexiones ACTIVE de la base — en CI, las
que `booking.integration-test.ts` y `google-calendar-connection.integration-test.ts`
crean en paralelo. En CI el daño es solo ruido de `logger.error`. **Corriendo
la suite localmente con `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` reales en
`.env`**, el worker intentaría renovar el access token de esas conexiones con
el refresh token de prueba `"1//refresh-de-prueba"` → Google responde
`invalid_grant` → `obtenerAccessToken` marca **ERROR** la conexión de otro
archivo → tests como "con Google conectado, la reserva guarda el
googleEventId" (`booking.integration-test.ts:902`) fallan de forma
intermitente. Rompe la premisa "cada test trae su propia organización".

**Fix:** inyectar el doble en los dos tests y afirmar sobre `resumen`
(`renovados === 0`, `fallidos === 0`), o acotar `renovarCanalesVencidos` a
una organización cuando corre desde tests. **No** agregar las `GOOGLE_*` al
CI: eso convertiría el barrido en llamadas reales.

---

## 4. Hallazgos MEDIOS

### 4.1 Booking / Google Calendar

**M-1 — `createBooking` no revalida que el recurso y el servicio sigan
activos después de tomar los locks.**
`src/services/booking.service.ts:183-207`. El patrón del proyecto es lock →
revalidar → escribir, y `createServiceType` (`serviceType.service.ts:461-462`)
y `replaceWorkingHoursForResource` (`workingHours.service.ts:103`) lo cumplen
releyendo con `tx`. `createBooking` valida `resource`/`serviceType` **fuera**
de la transacción (vía `resolverContexto`), toma los dos locks y solo revalida
el **conteo**. Escenario: `deleteServiceType` concurrente toma el lock,
cuenta 0 reservas, soft-borra, commitea; `createBooking` (que estaba
esperando el lock) lo adquiere, cuenta 0, e **inserta una reserva CONFIRMED
sobre un servicio ya borrado**. Igual con `deleteResource`. Fix:
`findResourceById(…, tx)` y `findServiceTypeById(…, tx)` después de los locks.

**M-2 — `setGoogleEventId` no exige `status: CONFIRMED`: una cancelación en
la ventana entre el commit y la respuesta de Google deja un evento huérfano.**
`src/repositories/booking.repository.ts:166-173`. Escenario: `POST /bookings`
commitea (FASE 2) y llama a Google (FASE 3, hasta 10 s); en el medio llega
`PATCH /bookings/:id/cancel` → `markBookingCancelled` (CONFIRMED → CANCELLED)
y `googleEventId` es `null`, así que no hay nada que borrar; Google responde,
`setGoogleEventId` escribe el id sobre la fila **CANCELLED** → **el evento
queda vivo en el calendario del negocio para siempre** (nadie vuelve a pasar
por `borrarReservaDeGoogle`). Fix: `where: { id, organizationId, status:
"CONFIRMED" }` y, si `count === 0`, borrar el evento recién creado.

**M-3 — `listarCambios` con tope de 100 páginas y sincronización completa
sin `timeMin`: un calendario con más de ~25.000 eventos nunca obtiene
`nextSyncToken`.** `src/services/googleCalendar.service.ts:748-815`,
`src/services/googleCalendarSync.service.ts:197-203`. La primera
sincronización y la del 410 listan **el calendario entero** (sin `timeMin`),
250 eventos por página, tope 100 páginas. Si el calendario tiene más (un
consultorio con 10 años de historia lo alcanza: 10 turnos/día × 250 días ×
10 años), el bucle corta antes de la última página, `nextSyncToken` queda
`undefined`, **no se guarda nada** (`:230-234`) y cada notificación
siguiente vuelve a bajar 100 páginas sin converger jamás — 100 requests a
Google por cada edición del calendario, dentro del request del webhook.
**VERIFICAR** el volumen real; el fix es acotar la sincronización inicial
con `timeMin = ahora` (Google lo admite en el primer request y el
`syncToken` resultante lo recuerda), que además es coherente con "no
reconciliar hacia atrás".

**M-4 — Webhook con conexión en `ERROR`: 503 y reintentos de Google durante
hasta 7 días.** `src/controllers/googleCalendarWebhook.controller.ts:102-116`,
`src/services/googleCalendarConnection.service.ts:306-311`. Está documentado
que "todo lo que no es 403 se responde 503 a propósito" para que un 409
transitorio no pierda la notificación. Pero `status = ERROR` no es
transitorio: exige que un humano reconecte, y `desconectar` es lo único que
limpia el canal. Mientras tanto el canal sigue vivo y **cada** cambio del
calendario produce una notificación que este sistema responde 503 y Google
reintenta con backoff. Es costo de Google, no nuestro, pero el log se llena
de `logger.error` por una condición conocida. Fix: para `ERROR`, responder
200 y (opcionalmente) cerrar el canal best-effort; o limpiar el canal al
marcar ERROR.

### 4.2 Capa de datos

**M-5 — Siete tablas nuevas sin RLS, incluida la que guarda secretos.**
Migraciones `20260828150000` (`outbox_events`), `20260828160000`
(`branches`, `resources`, `service_types`), `20260829120000`
(`google_calendar_connections`), `20260830120000` (`working_hours`,
`bookings`): cero `enable row level security`, cero políticas. Contradice la
política de C-2 (`20260821140000:172-185`), la afirmación de
`20260824120000:250-254` ("RLS se habilita igual, para que la fila 4 del
diagnóstico siga diciendo 'a lo sumo _prisma_migrations'") y el tratamiento
deny-all de `api_keys` por "guardar material criptográfico" — que es
exactamente lo que guarda `google_calendar_connections.refresh_token`. Hoy
no es explotable (el REVOKE de `20260821140100` cierra PostgREST). Escenario
que lo vuelve real: alguien habilita Realtime o hace `GRANT SELECT ON
bookings TO authenticated` para un dashboard: en las 12 tablas viejas RLS
filtra por organización; en `bookings`/`google_calendar_connections` **no
hay política y el grant expone todos los tenants** (y los tokens cifrados).
Fix: una migración con RLS + política de aislamiento en las 6, deny-all en
`google_calendar_connections`, y actualizar la fila 5 del diagnóstico (hoy
afirma exactamente 12 políticas).

**M-6 — `verify:schema` cubre 5 de los 11 CHECK y 18 de las 28 FKs
compuestas; el módulo de Booking queda fuera.**
`scripts/verify-schema.ts:130` afirma "Los 5 CHECK constraints" (hay 11,
ver la tabla en §7); `:193-199` afirma "las 18 FKs conocidas" (las 10 de
Booking no están en la lista de la fila 16). La fila 14 del diagnóstico es
genérica y detectaría una FK **mal formada**, pero no una FK **que falta** ni
una que apunte al padre equivocado. Escenario: un rebase pierde la sección 7
de `20260830120000` (`:236-248`, los CHECK de `working_hours` y `bookings`);
`migrate deploy` OK, `verify:schema` OK, suite OK (Zod frena todo en el
borde); un script o worker futuro inserta `starts_at >= ends_at` sin que
nada lo diga. Fix: agregar las 6 tuplas a la fila 8 y las 10 firmas a la fila
16, o generalizar la fila 8 a "todo CHECK de `public`".

**M-7 — Sin índice para `bookings.google_event_id`: un scan del tenant por
cada evento cambiado en Google.** `src/repositories/booking.repository.ts:193-199`
filtra `(googleEventId, organizationId)`; los 4 índices de `bookings`
(`20260830120000:160-169`) empiezan por `organization_id` y ninguno incluye
`google_event_id`. `aplicarCambio` (`googleCalendarSync.service.ts:254`) lo
llama **una vez por evento cambiado** de cada notificación, y el propio
comentario (`:257-259`) dice que "la inmensa mayoría de los cambios" son
eventos ajenos al CRM. Escenario: peluquería con 3 años de reservas que usa
el mismo Google Calendar para todo; cada edición de cualquier evento ajeno
dispara un scan completo de sus bookings. Fix: índice parcial
`(organization_id, google_event_id) WHERE google_event_id IS NOT NULL`
(vive solo en la migración; hay que afirmarlo en el diagnóstico — ver B-14).

### 4.3 CRM core, config y errores

**M-8 — `PATCH /api/pipelines/:id {"isDefault": false}` deja a la
organización sin pipeline default.** `src/services/pipeline.service.ts:124-141`:
hay rama para `isDefault === true` (transacción + `unsetDefaultPipeline`),
ninguna para `false` sobre el pipeline que hoy es default. El índice parcial
solo impide **dos** defaults, no **cero**; `deletePipeline` (`:225-249`) se
toma el trabajo de promover otro justamente para que nunca haya cero. Fix:
400 ("marcá otro pipeline como default") o promover como hace el delete.

**M-9 — `z.coerce.number()` convierte `null` en `0` en bodies JSON.**
`src/controllers/opportunity.controller.ts:34` (`amount`),
`src/controllers/stage.controller.ts:28-32, 49` (`probability`). Es el mismo
bug que el propio archivo corrigió para fechas (`opportunity.controller.ts:59-68`:
"sin `.nullable()`, `z.coerce.date()` convertía un `null`…"). Escenario:
`PATCH /api/opportunities/:id {"amount": null}` (la forma natural de "limpiá
el monto") → 200 y **`amount = 0`**; `PATCH /api/stages/:id {"probability":
null}` → 0. También `""`, `[]`, `false` → 0. En `order`/`durationMin`/
`capacity` el `.positive()`/`.min(1)` frena el 0 por casualidad. Fix:
`z.number()` sin coerce en bodies (coerce solo para query strings).

**M-10 — PATCH no puede vaciar campos opcionales en Company y Contact (M-29
del 21/08 sigue abierto, y es más amplio).** `src/services/contact.service.ts:211-213`
(`normalizeEmail(input.email ?? undefined)` → `null` se vuelve `undefined` y
Prisma lo ignora → 200 sin cambio, tal cual M-29);
`src/controllers/company.controller.ts:24-28` (`domain/industry/phone/city/
country` son `z.string().optional()` → **rechazan `null` con 400** mientras
`UpdateCompanyInput` en `company.service.ts:81-89` los declara `string |
null`); `src/controllers/contact.controller.ts:39-44` (idem
`phone/jobTitle/source`; y `companyId` no admite `null` en ningún lado: **un
contacto no se puede desvincular de su empresa**). `activity.controller.ts:59-73`
es el ejemplo correcto (`.nullable().optional()` + `"x" in input`).

**M-11 — `errorHandler`: body-parser → 500, Prisma conocidos → 500, mensajes
de 500 al cliente, sin `req.id` (M-18, B-2 y M-16 del 21/08 siguen
abiertos).** `src/middlewares/errorHandler.ts:16-30`. (a) El `express.json()`
global de `app.ts:88` no traduce sus errores: `POST /api/companies` con JSON
malformado o > 100 KB → **500** + `logger.error`. (b) `AppError` con status
500 devuelve `err.message` verbatim — `"SUPABASE_URL o
SUPABASE_SERVICE_ROLE_KEY no están configurados"` (`supabaseAdmin.ts:18-21`),
`"La integración con Google Calendar no está configurada … Faltan:
GOOGLE_CLIENT_ID, …"` (`googleCalendar.service.ts:844-847`), `"authorize()
debe usarse después del middleware authenticate"` (`authorize.ts:11`);
`isOperational` (`AppError.ts:5`) existe y nadie lo lee. (c) `P2034`
(deadlock, ver A-1), `P2028` (transacción interactiva vencida) y `P2003`
llegan como 500 genérico. (d) Usa el `logger` raíz y no `req.log`: el error
no lleva el `req.id` de pino-http. (e) Loguea con nivel `error` todo 4xx.

**M-12 — Shutdown sin timeout ni `unhandledRejection`, y los `stop()` de los
workers no esperan la pasada en curso (M-15 del 21/08 sigue abierto).**
`src/server.ts:34-56`, `src/workers/ingestionWorker.ts:182-187`,
`src/workers/outboxWorker.ts:199-204`, `src/workers/googleCalendarChannelWorker.ts:160-165`.
Positivo: detiene los **tres** workers. Lo que falta: (a) `server.close`
espera a **todas** las conexiones keep-alive; sin `setTimeout(() =>
process.exit(1)).unref()` ni `closeIdleConnections()`, un cliente con la
conexión abierta deja el proceso vivo hasta el SIGKILL del orquestador y el
`$disconnect` prolijo no ocurre. (b) Sin `process.on("unhandledRejection")`,
Node ≥ 15 mata el proceso sin pasar por `shutdown`. (c) Los `detener*()`
devuelven `void`: el comentario de `server.ts:36-39` ("una pasada en curso
termina sola") no es cierto — nada espera a `drenarOutbox()`; escenario:
SIGTERM mientras `entregarEvento` está dentro del handler; el handler
completa su efecto externo, y entre eso y `markOutboxEventProcessed` llega
`$disconnect()`/`process.exit(0)` → la transacción se revierte → el evento
sigue PENDING → **al reiniciar se entrega otra vez**.

**M-13 — Slug vacío en onboarding (M-27 del 21/08 sigue abierto), y el
pre-check corre antes del OTP.** `src/services/onboarding.service.ts:123-131`,
`src/utils/slug.ts:10-19`, `src/schemas/onboarding.schema.ts:7-11`. Sin
`slug.length > 0` en ningún lado: `"株式会社"` → `""`, la primera organización
queda con `slug = ""` y la segunda recibe 409 "Ya existe una organización con
ese nombre". Además `findOrganizationBySlug` corre **antes** de `verifyOtp`
(`:128` vs `:137`): cualquiera puede sondear qué nombres de organización
existen sin tener un código — un oráculo público de la misma familia que B-1
del 21/08.

### 4.4 Ingesta y outbox

**M-14 — El tope del handler del outbox no aborta nada: el handler sigue
corriendo y compite con el reintento.** `src/services/outbox.service.ts:120-138`
(`await Promise.race([handler(), limite])`). Cuando vence
`OUTBOX_HANDLER_TIMEOUT_MS` la transacción hace `rescheduleOutboxEvent` y
commitea, pero la promesa del handler sigue viva. Escenario: handler con
`fetch` a un destino que responde a los 12 s con tope de 10 s → attempt 1
timeout → reschedule a +30 s → a los 12 s el POST original completa igual →
a los 30 s se reintenta → **el destino recibe el aviso dos veces**; con un
destino lento pero funcional, hasta `OUTBOX_MAX_ATTEMPTS` entregas. Si el
handler tardío lanza, `Promise.race` ya adjuntó sus handlers y la excepción
se traga sin log. No hay `AbortSignal` en `EventoAEntregar`
(`outboxHandlers.ts:23-28`). Hoy no hay consumidores, así que es un bug
latente para el paso 5 de Booking.

**M-15 — Con `X-External-Id` provisto se saltea el guard de profundidad del
payload → 500 en vez de 400.** `src/services/ingest.service.ts:64`
(`externalIdProvisto ?? deriveExternalId(payload)`); `MAX_PAYLOAD_DEPTH` vive
solo dentro de `canonicalize` (`utils/externalId.ts:49-61`). Escenario:
`POST /api/ingest` con clave válida, `X-External-Id: x` y un cuerpo de ~40 KB
con 20.000 niveles de `{"a":{"a":…}}` → `JSON.stringify(rawPayload)` en
`ingestionEvent.repository.ts:83` → `RangeError: Maximum call stack size
exceeded` → no es `AppError` → **500** y "Unhandled error" en el log.

**M-16 — Un ` ` en cualquier string del payload produce un 500.**
`src/repositories/ingestionEvent.repository.ts:83` y `:337`
(`${JSON.stringify(data.rawPayload)}::jsonb`). Postgres rechaza ` ` en
`jsonb` (`22P05`); ni `esObjetoJson` (`ingest.service.ts:44-46`) ni el parser
lo filtran. `{"firstName":"a b","lastName":"c"}` con clave válida →
error crudo de Prisma → 500 para un input del cliente. Igual en `POST
/api/imports` con un CSV/XLSX con un byte NUL. Debería ser 400 o
sanitizarse.

**M-17 — `insertPendingEventsBatch` no es atómico entre tandas: una falla a
mitad deja un lote fantasma sin `batchId` conocido.**
`src/repositories/ingestionEvent.repository.ts:328-360` (un INSERT por tanda
de 500), `src/services/import.service.ts:84-89` (lo llama con el `prisma`
global). Escenario: archivo de 3.000 filas, la tanda 4 falla (corte de
conexión, pool agotado) → las 1.500 primeras quedan commiteadas con un
`batchId` que el cliente **nunca recibe** (el request responde 500); el
worker las promueve igual; al re-subir, caen como `duplicados` y el resumen
del segundo lote reporta la mitad sin explicar dónde está el resto. No se
pierde dato; se pierde trazabilidad. Fix: envolver en `$transaction`.

**M-18 — No se pueden borrar los datos personales de un contacto
soft-deleteado.** `src/services/contact.service.ts:262-266`
(`erasePersonalData` → `getContactById` → `findContactById` filtra
`deletedAt: null` → 404). Escenario: ADMIN hace `DELETE /api/contacts/:id`;
después el titular pide el borrado de sus datos: `POST
/api/contacts/:id/erase-personal-data` → **404**. Los datos siguen en
`contacts` y en `ingestion_events.raw_payload`, y no hay endpoint de restore.
**VERIFICAR** si fue decisión; no se encontró nota que lo diga, y para GDPR
(Q-1 de la review de ingesta) es el caso más probable, no el raro.

### 4.5 Tests

**M-19 — Cinco tests de carrera más que no fuerzan el solapamiento y
detectarían la pérdida del lock solo por azar.**

| Test | Qué dice el propio archivo | Problema |
|---|---|---|
| `user.service.integration-test.ts:146-166` (último ADMIN, ×3) | "~29% de las corridas" (`:25-26`) | Un PR que borre `lockOrganizationForUpdate` de `user.service.ts:119/175` pasa CI ~7 de 10 veces; es una propiedad de **seguridad** |
| `pipeline.service.integration-test.ts:123-160` (deletePipeline ×2) | "0/4 corridas" (`:100-106`) | Test secuencial disfrazado de carrera |
| `soft-delete-restrict.integration-test.ts:242-299` y `booking-config.integration-test.ts:343-406` (create vs delete, ×4) | "`Promise.allSettled` no fuerza un interleaving" (`:42-46`) | El lado create tiene un preludio más largo fuera de tx; el delete commitea antes; la revalidación interna (que corre con o sin lock) ve el padre borrado → verde **aunque los `lock*ForUpdate` no existan**. Ninguno mira el resultado de las dos promesas |
| `invitation.service.integration-test.ts:478-530` (CAS perdido, ×2) | "queda determinado por un lock real, no por timing" (`:20-30`) | Son dos `setTimeout` (400 ms / 150 ms): en un runner lento el service ve ACCEPTED en el pre-check y responde el mismo 409 por el camino equivocado; en el inverso, flaky |
| `promotion.service.integration-test.ts:416-447` (dos promociones simultáneas) | — | Con `limite: 1` cada drenado toma un evento sea o no concurrente; "1 y 1" no distingue solapamiento de secuencia |

Los dos que sí lo hacen bien (`activity.service.integration-test.ts:141-192`
con `pg_blocking_pids`; `outboxWorker.integration-test.ts:134-181` con
transacción anidada) muestran que la técnica ya está en el repo.

**M-20 — `tenant-isolation.integration-test.ts` no cubre ninguna tabla del
módulo de agenda ni `outbox_events`.** Cubre 16 escrituras + 4 de ingesta
(`:304-500`). Sin prueba repository-level de "id de B + organizationId de A =
count 0": `Branch`, `Resource`, `ServiceType`, `WorkingHours`, `Booking`,
`GoogleCalendarConnection`, `OutboxEvent`, y las escrituras nuevas de
`IngestionEvent` (`retry`, `erase`, `markEventFailed`). Lo que hay son
pruebas a nivel service (404 cross-org), que prueban el pre-check y no el
`WHERE` de la escritura — la distinción que el encabezado del archivo
(`:20-24`) declara como su razón de ser.

---

## 5. Hallazgos BAJOS

| # | Hallazgo | Ancla |
|---|---|---|
| B-1 | `countOverlappingBookings` tiene el parámetro `excluirBookingId` sin ningún uso (reprogramar no existe) | `booking.repository.ts:94` |
| B-2 | `obtenerAccessToken` renueva el access token contra Google en **cada** llamada, sin cache: dos requests por operación (disponibilidad, reserva, cancelación, webhook, worker) | `googleCalendarConnection.service.ts:295-338` |
| B-3 | Reconectar (`upsertConnection` `update`) no limpia `syncToken` ni `channel_*`, y `markConnectionRevoked` tampoco limpia `syncToken`: tras reconectar con **otra** cuenta de Google, el primer sync usa un token ajeno → 410 → resync completo (recuperable, pero un viaje de más) | `googleCalendarConnection.repository.ts:101-136` |
| B-4 | `reflejarReservaEnGoogle`/`borrarReservaDeGoogle` tratan el 409 de una conexión en `ERROR` como "sin conexión" y **no lo loguean**; y un 401 de `events.insert` no marca ERROR (solo `obtenerAccessToken` y `consultarDisponibilidad` lo hacen). Una conexión rota queda invisible — la bitácora del 31/08 ya anota que "nadie ve las conexiones en ERROR" | `googleCalendarConnection.service.ts:434-442, 465-473` |
| B-5 | `aplicarCambio` compara instantes con precisión de ms; Google devuelve segundos. Una reserva creada con `startsAt` con milisegundos se loguea como "movida" en cada edición de descripción del evento. Solo `warn` | `googleCalendarSync.service.ts:299-301` |
| B-6 | `leerInstante` interpreta un evento de día completo (`date`) como medianoche **UTC**, no de la zona de la sucursal. Solo afecta al log de "movido" | `googleCalendar.service.ts:73-88` |
| B-7 | `renovarCanal` → `setConnectionChannel` sin guard `status = ACTIVE`: si `desconectar` corre entre `findConnectionsNeedingChannel` y el `set` (hay una llamada a Google en el medio), el canal se escribe sobre una fila REVOKED y nunca se renueva ni se cierra hasta vencer | `googleCalendarConnection.repository.ts:206-220` |
| B-8 | `desconectar` hace `markConnectionRevoked` y `clearConnectionChannel` en dos escrituras sin transacción: un crash entre ambas deja `REVOKED` con `channel_*` cargados (el CHECK lo permite) | `googleCalendarConnection.service.ts:251-256` |
| B-9 | `deleteBranch` permite borrar con una conexión en `ERROR`, que **conserva** el `refresh_token` cifrado (`markConnectionError` lo mantiene a propósito): credencial de una sucursal borrada retenida sin camino para revocarla | `branch.service.ts:156-162`, `googleCalendarConnection.repository.ts:146-160` |
| B-10 | `routes/index.ts` conserva el comentario "Booking y la disponibilidad todavía no existen" y un bloque con líneas en blanco intercaladas | `routes/index.ts:67-81` |
| B-11 | Comentarios de `schema.prisma` que describen un SQL distinto del real: `contacts_org_email_unique` omite `lower()` y `deleted_at IS NULL`; `pipelines_org_default_unique` y won/lost omiten `deleted_at IS NULL`; seis comentarios dicen "se crea manualmente en manual_constraints.sql" cuando desde C-2 la fuente es la migración | `schema.prisma:276-277, 351-352, 382-383, 422-424, 469-470, 515-516` |
| B-12 | `stage.repository.ts`: `findStageWithFlag`, `countStagesByName`, `shiftUpFrom` y `shiftDownAfter` filtran por `pipelineId` sin `organizationId`, y los dos `shift*` escriben con `update({ where: { id } })` — la única escritura del proyecto que no cumple "la escritura misma es la garantía" (`reindexStages` en el mismo archivo sí lo cumple) | `stage.repository.ts:72-101, 155-188` |
| B-13 | `hardDeleteInvitation(id)` borra por `id` solo; el caller tiene `organizationId` a mano | `invitation.repository.ts:152-154` |
| B-14 | Los índices parciales de las colas (`ingestion_events_pending_created_at_idx`, `outbox_events_claimable_idx`, `sources_org_created_at_idx`) no están afirmados en ninguna fila del diagnóstico: si se pierden, los reclamos degradan a seq scan sin ningún error | `docs/auditoria-2026-08-21-diagnostico.sql` (fila 7 solo cubre únicos) |
| B-15 | `apply-manual-sql.ts` reaplica en cada deploy `drop constraint if exists` + `add constraint` de los 5 CHECK (revalidación completa bajo `ACCESS EXCLUSIVE`), triggers y políticas — redundante desde C-2 y con riesgo de lock sobre tablas grandes con la app viva. VERIFICAR si `prisma db execute --file` lo envuelve en transacción | `scripts/apply-manual-sql.ts:36-46`, `prisma/sql/manual_constraints.sql:138-177` |
| B-16 | `findConnectionByChannelId` y `findConnectionsNeedingChannel` traen la fila completa (con `refresh_token`) sin necesitarlo; el propio archivo argumenta que el `select` es "la defensa que no depende de que alguien se acuerde" | `googleCalendarConnection.repository.ts:176-178, 188-195` |
| B-17 | Los seis `lock*ForUpdate` devuelven `void` sin verificar que bloquearon una fila: si la fila no existe, la función retorna y el caller cree que serializó | `resource.repository.ts:116-122` y equivalentes |
| B-18 | El CAS de aceptación de invitación no incluye `expiresAt > now()` en el `where`; el chequeo vive fuera de la transacción | `invitation.repository.ts:141-146`, `invitation.service.ts:325-328` |
| B-19 | `/health` traga el error de la base sin `logger.error` (B-13 del 21/08 sigue abierto) y sigue sin rate limit y con `SELECT 1` por llamada (M-17) | `health.service.ts:19-24`, `health.routes.ts:6` |
| B-20 | Query strings con PII en el log (B-3 del 21/08 sigue abierto): `GET /api/contacts?email=…` queda en `req.url`; y el header `x-external-id` de ingesta —que "puede ser el email del lead" según `ingestionEvent.repository.ts:725-726`— no está en la lista de redacción | `logger.ts:28-33` |
| B-21 | `page` sin cota en ~14 listados (B-6 del 21/08 sigue abierto); S2-5 solo se aplicó a ingestion-events (`.max(10_000)`) | los `listQuerySchema`; `apiKey.controller.ts:15`, `source.controller.ts:127` |
| B-22 | Supabase 422 se traduce a 409 "email ya registrado" aunque GoTrue devuelve 422 por otras validaciones; y cualquier error de `signInWithOtp` → 502, incluido el `429 over_email_send_rate_limit` que debería ser 429 | `invitation.service.ts:158-160`, `onboarding.service.ts:107-113` |
| B-23 | `express.urlencoded({ extended: true })` montado sin ningún consumidor: superficie de `qs` sin uso | `app.ts:89` |
| B-24 | `errorHandler` no mira `res.headersSent` | `errorHandler.ts:25` |
| B-25 | Las ramas "header repetido → array" son código muerto: Node solo devuelve array para `set-cookie`; para `X-External-Id`/`x-api-key` concatena con `", "`. Dos `X-External-Id` se aceptan como el id `"a, b"` en vez del 400 que el código pretende | `ingest.controller.ts:24-29`, `authenticateApiKey.ts:38-43` |
| B-26 | Las tres transiciones del outbox descartan el `count` del CAS (`updateMany … status: PENDING`); la ingesta sí lo verifica con `exigirTransicion` | `outbox.service.ts:166-224`, `outboxEvent.repository.ts:147-200` |
| B-27 | `anonymizeIngestionEventsOfContact` escribe con `update({ where: { id } })` sin `organizationId` | `ingestionEvent.repository.ts:817-823` |
| B-28 | Claves `__proto__`/`constructor` en payloads y encabezados: `canonicalize` pierde la rama (dos payloads distintos colisionan en el mismo `externalId`); `"constructor" in fila` es `true` en `promotion.service.ts:192`; `fila["__proto__"] = valor` es no-op en `spreadsheet.ts:143`. Contrivado; no contamina prototipos globales | `externalId.ts:73-75`, `promotion.service.ts:192`, `spreadsheet.ts:143` |
| B-29 | Celdas XLSX de fórmula con error (`#N/A`) se guardan como `"[object Object]"` | `spreadsheet.ts:87-99` |
| B-30 | Una fila de ingesta con un error de sistema **determinístico** se reclama, revienta y se pospone en cada tick (no hay contador de intentos en `IngestionEvent`, sí en outbox): ruido y una tx por tick, no un bloqueo | `ingestionWorker.ts:93-118` |
| B-31 | `redactPromotionNotes` conserva claves extra desconocidas en notas de tipo conocido (`{ ...objeto, crm, entrante }`); el fail-closed aplica solo a `tipo` desconocido | `ingestionEvent.repository.ts:769-778` |
| B-32 | Tests sin aserción explícita más allá de "no lanza": `googleCalendar.service.test.ts:533-550` y `:661-673` | — |
| B-33 | `workingHours.test.ts:322-354` (Santiago) depende de que la ICU del runner tenga el cambio de hora chileno entre el 31/08 y el 14/09 de 2026 — Chile lo mueve por decreto. Los de Nueva York son estables | — |
| B-34 | Fixtures orden-dependientes: `apiKey.controller.integration-test.ts:261-280` asume claves creadas por tests anteriores del archivo; `me.controller.integration-test.ts:139-165` y `rateLimit.integration-test.ts:306-342` crean el usuario de Supabase antes del `try` | — |
| B-35 | `NODE_ENV` no se define en el job `integration` → `isDevelopment = true` → Prisma loguea `warn`; `GOOGLE_WEBHOOK_URL` vive solo en el `env:` de un step | `.github/workflows/ci.yml:334` |

---

## 6. VERIFICAR — posiblemente intencional, o fuera de lo que se pudo probar

| # | Qué | Por qué importa | Ancla |
|---|---|---|---|
| V-1 | El callback OAuth responde **400** ante un `state` inválido o manipulado, mientras el webhook responde **403** ante un token inválido. El archivo lo justifica ("un state inválido es un problema del request") | La auditoría pedía confirmar 403 en los endpoints no autenticados; acá es una decisión documentada pero inconsistente entre los dos endpoints hermanos | `oauthState.ts:159`, `webhookToken.ts:140` |
| V-2 | `createBooking` acepta `startsAt` en el pasado y fuera de la grilla (9:07 para turnos de 30 min); solo valida contención en el horario de trabajo | Una reserva a las 9:07 tapa los turnos de 9:00 y 9:30 de la grilla. Si es intencional (mostrador que carga a mano), conviene escribirlo; si no, relacionado con A-5 | `booking.service.ts:163-168` |
| V-3 | `ALTER DEFAULT PRIVILEGES` sin `FOR ROLE` aplica al rol que corrió la migración | Si `DIRECT_URL` usa otro rol en algún entorno, las tablas nuevas nacen con grants a `anon/authenticated` — y por M-5, sin RLS | `20260821140100:27-28` |
| V-4 | `google_event_id` no es único: `findFirst` devolvería uno arbitrario y `markBookingCancelled` cancelaría el equivocado | Hoy solo lo escribe `setGoogleEventId` con el id que Google devolvió; si se agrega el índice de M-7, evaluar UNIQUE | `booking.repository.ts:193-199` |
| V-5 | Los límites por IP de Supabase Auth (`/otp`, `/verify`) ven siempre la IP del backend: el cupo de la plataforma es el de un solo cliente | Combinado con A-2, agotar el cupo de verificación deja el registro caído para todos. Hay que mirar los valores vigentes en Auth → Rate Limits | `onboarding.service.ts:97, 137` |
| V-6 | Todas las `$transaction` usan el timeout por defecto (5 s); solo `outboxWorker.ts:98` lo ajusta. Bajo `lockOrganizationForUpdate`, una operación lenta hace vencer a la siguiente con `P2028` → 500 sin mensaje | Improbable con el volumen actual | services con locks |
| V-7 | `jwtVerify` sin `audience: "authenticated"` (el `aud` sí es estable, a diferencia del `iss`) | Consistente con la decisión documentada de no pinnear `iss` | `jwt.ts:33-35` |
| V-8 | El limiter de aceptación **identificada** corre después de la llamada a la Admin API; una identidad válida puede provocar N llamadas acotadas solo por el limiter por IP de A-2 | Documentado en `verifyInvitationAcceptIdentity.ts:46-49` | `invitation.routes.ts:48-54` |
| V-9 | El worker de ingesta promueve eventos de fuentes pausadas o retiradas (el JOIN con `sources` no filtra `is_active`/`deleted_at`); `POST /ingestion-events/:id/retry` sobre un FAILED de una fuente retirada lo promueve igual | Las compuertas están solo en la entrada | `ingestionEvent.repository.ts:196-210` |
| V-10 | Handler de outbox ausente → DEAD_LETTER inmediato, sin distinguir "este proceso no lo tiene" de "no existe": con dos instancias en deploy escalonado, la vieja mata los eventos del tipo nuevo | Nota para cuando haya consumidores | `outbox.service.ts:165-176` |
| V-11 | Los handlers del outbox no reciben `tx`: uno que escriba en la base lo hará fuera de la transacción del evento | Decisión a fijar antes del primer consumidor (paso 5 de Booking) | `outboxHandlers.ts:34` |
| V-12 | Con `X-External-Id` fijo, un payload corregido se descarta en silencio (`DO NOTHING`): el reintento del ADMIN usa el payload viejo | Es lo que §4 pide; conviene tenerlo escrito para el emisor | `ingestionEvent.repository.ts:87-88` |
| V-13 | `nextAttemptAt` se calcula con el reloj de Node y se compara con `now()` de Postgres | Despreciable salvo relojes desincronizados | `outbox.service.ts:78`, `outboxEvent.repository.ts:115` |
| V-14 | La fila 16 del diagnóstico ("las 18 FKs conocidas") no incluye las 10 FKs de Booking — confirmado (ver M-6); lo que falta verificar es si conviene generalizarla o extenderla | — | `docs/auditoria-2026-08-21-diagnostico.sql:686-704` |

---

## 7. Inventario de CHECK constraints (para M-6 y para que nadie lo reconstruya)

| # | Constraint | Expresión | Migración | ¿Afirmado por `verify:schema`? |
|---|---|---|---|---|
| 1 | `opportunities_company_or_contact_check` | `company_id IS NOT NULL OR contact_id IS NOT NULL` | `20260821140000:140-144` | ✅ |
| 2 | `opportunities_amount_non_negative_check` | `amount >= 0` | `:146-150` | ✅ |
| 3 | `stages_won_lost_exclusive_check` | `NOT (is_won AND is_lost)` | `:153-157` | ✅ |
| 4 | `activities_related_entity_check` | alguno de company/contact/opportunity NOT NULL | `:160-168` | ✅ |
| 5 | `contacts_email_trimmed_check` | `email IS NULL OR email = btrim(email)` | `20260825120000:107-111` | ✅ |
| 6 | `service_types_duration_positive_check` | `duration_min > 0` | `20260828160000:195-196` | ❌ |
| 7 | `service_types_capacity_positive_check` | `capacity >= 1` | `:198-199` | ❌ |
| 8 | `google_calendar_connections_active_requires_token_check` | `status <> 'ACTIVE' OR refresh_token IS NOT NULL` | `20260829120000:150-151` | ❌ |
| 9 | `working_hours_minute_range_check` | `0 <= start < end <= 1440` | `20260830120000:240-241` | ❌ |
| 10 | `bookings_time_range_check` | `starts_at < ends_at` | `:247-248` | ❌ |
| 11 | `google_calendar_connections_channel_all_or_none_check` | los tres `channel_*` todos NULL o todos NOT NULL | `20260831120000:116-121` | ❌ |

Caminos de escritura que no pasan por Zod y a los que los CHECK sí les
importan: `promoteContact` (SQL crudo, #5), `replaceWorkingHours`
(`createMany`, #9), `insertPending*` (SQL crudo; `ingestion_events` no tiene
CHECKs, el aislamiento lo da la FK compuesta). `seed.ts` solo toca `roles`.
Invariantes que el código enuncia y **no** tienen CHECK, todos reconocidos
como service-only: `ServiceType.branchId == Resource.branchId`,
`Booking.resourceId == ServiceType.resourceId` (ver A-4), no-solapamiento de
franjas del mismo día.

---

## 8. Estado de los hallazgos del 21/08 que siguen abiertos

Ninguno de estos figura como pendiente en `docs/roadmap-implementacion.md`
(P0 lista seis ítems, todos cerrados). Conviene decidir en la revisión si se
incorporan al roadmap o se cierran explícitamente como "no se va a hacer".

| 21/08 | Estado hoy | Dónde en este informe |
|---|---|---|
| ALTO-4 (JWKS → 401) | Abierto, idéntico | A-3 |
| ALTO-5 (reorder de stages sin lock) | Abierto en `updateStage` y `deleteStage`; cerrado en `createStage` | A-1 |
| M-15 (shutdown) | Abierto; se sumó que los `stop()` no esperan la pasada | M-12 |
| M-16 (errorHandler sin `req.id`) | Abierto | M-11 |
| M-17 (`/health`) | Abierto | B-19 |
| M-18 (body-parser → 500) | Abierto para el `express.json()` global; cerrado en ingesta e import | M-11 |
| M-27 (slug vacío) | Abierto | M-13 |
| M-29 (email de contacto no se vacía) | Abierto, y extendido a Company | M-10 |
| B-2 (mensajes de 500 verbatim) | Abierto; hay más mensajes ahora (Google) | M-11 |
| B-3 (PII en query strings) | Abierto; se sumó `x-external-id` | B-20 |
| B-6 (`page` sin cota) | Abierto salvo ingestion-events | B-21 |
| B-13 (`/health` traga el error) | Abierto | B-19 |

No se re-verificaron en esta pasada: M-1 (`updateMany` sin `deletedAt`),
M-3, M-4, M-5, M-6, M-7, M-8, M-9, M-12, M-14, M-19, M-20, M-21 y los del
frontend. No se afirma nada sobre ellos.

---

## 9. Apéndice: resumen priorizado

| # | Sev. | Hallazgo | Ancla |
|---|---|---|---|
| A-1 | ALTO | Reorder/borrado de stages sin lock del pipeline: lost update, deadlock → 500, 409 espurio | `stage.service.ts:263, 313` |
| A-2 | ALTO | Tres limiters públicos por IP con Dockerfile y sin `trust proxy`: cupo global, DoS del registro a costo cero | `rateLimit.ts:79-88, 121-132, 156-164` |
| A-3 | ALTO | Fallo del JWKS / Admin API → 401 masivo sin log | `jwt.ts:32-42`, `verifyInvitationAcceptIdentity.ts:117-122` |
| A-4 | ALTO | Mover un ServiceType de recurso deja reservas CONFIRMED sobre un recurso que después se puede borrar | `serviceType.service.ts:513-530`, `resource.service.ts:320-326` |
| A-5 | ALTO | Grilla de disponibilidad anclada en `from`: agendas distintas según quién pregunta, turnos que tapan dos slots | `workingHours.ts:216`, `availability.service.ts:100-104` |
| A-6 | ALTO | `email: ""` en ingesta → FAILED; toda fila CSV sin email falla | `ingestContact.schema.ts:111-117` |
| A-7 | ALTO | Test de carrera del cupo: sin barrera y con un segundo lock que lo enmascara | `booking.integration-test.ts:758-797` |
| A-8 | ALTO | Dos tests del worker pasan porque el cliente de Google no se puede construir en CI; barrido sin scope de la base compartida | `googleCalendarSync.integration-test.ts:769-813` |
| M-1 | MEDIO | `createBooking` no revalida `deletedAt` tras los locks | `booking.service.ts:183-207` |
| M-2 | MEDIO | `setGoogleEventId` sin guard de status: evento huérfano en Google | `booking.repository.ts:166-173` |
| M-3 | MEDIO | Sync completa sin `timeMin` y tope de 100 páginas: calendarios grandes nunca convergen | `googleCalendar.service.ts:748` |
| M-4 | MEDIO | Webhook con conexión en ERROR → 503 → reintentos de Google por 7 días | `googleCalendarWebhook.controller.ts:102-116` |
| M-5 | MEDIO | 7 tablas nuevas sin RLS, incluida la de tokens | migraciones `20260828150000` … `20260830120000` |
| M-6 | MEDIO | `verify:schema` afirma 5/11 CHECK y 18/28 FKs | `verify-schema.ts:130, 193-199` |
| M-7 | MEDIO | Sin índice para `bookings.google_event_id` | `booking.repository.ts:193-199` |
| M-8 | MEDIO | `isDefault: false` deja a la org sin pipeline default | `pipeline.service.ts:124-141` |
| M-9 | MEDIO | `z.coerce.number()` convierte `null` en 0 (`amount`, `probability`) | `opportunity.controller.ts:34`, `stage.controller.ts:28-32, 49` |
| M-10 | MEDIO | PATCH no puede vaciar campos de Company/Contact; contacto no se desvincula de empresa | `contact.service.ts:211-213`, `company.controller.ts:24-28`, `contact.controller.ts:39-44` |
| M-11 | MEDIO | `errorHandler`: body-parser y Prisma → 500, mensajes de 500 verbatim, sin `req.id` | `errorHandler.ts:16-30` |
| M-12 | MEDIO | Shutdown sin timeout ni `unhandledRejection`; `stop()` no espera la pasada → entrega duplicada del outbox | `server.ts:34-56`, `outboxWorker.ts:199-204` |
| M-13 | MEDIO | Slug vacío + oráculo de nombres antes del OTP | `onboarding.service.ts:123-131` |
| M-14 | MEDIO | `Promise.race` no aborta el handler del outbox → entregas duplicadas y excepciones tragadas | `outbox.service.ts:120-138` |
| M-15 | MEDIO | `X-External-Id` saltea el guard de profundidad → 500 | `ingest.service.ts:64` |
| M-16 | MEDIO | ` ` en el payload → 500 (jsonb) | `ingestionEvent.repository.ts:83, 337` |
| M-17 | MEDIO | Lote de importación no atómico entre tandas | `ingestionEvent.repository.ts:328-360` |
| M-18 | MEDIO | No se pueden borrar datos personales de un contacto soft-deleteado | `contact.service.ts:262-266` |
| M-19 | MEDIO | Cinco tests de carrera más que no fuerzan el solapamiento (último ADMIN al 29%) | ver §4.5 |
| M-20 | MEDIO | `tenant-isolation` no cubre agenda ni outbox | `tenant-isolation.integration-test.ts` |
| B-1…B-35 | BAJO | Ver §5 | — |
| V-1…V-14 | VERIFICAR | Ver §6 | — |
