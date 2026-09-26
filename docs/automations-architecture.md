# Arquitectura del motor de automatizaciones

Documento de diseño — 13/09/2026. Sigue la misma convención que `ai-agent-architecture.md`, `ingestion-architecture.md` y `booking-architecture.md`: describe el diseño antes de implementarlo, se actualiza a medida que se construye.

## 1. Contexto y decisión

El motor de automatizaciones (trigger → acción, sección 10 del documento de visión) estaba previsto como el "paso 7" del roadmap, después de WhatsApp. Los dos casos de uso reales con los que se pensaba estrenarlo están **los dos bloqueados por dependencias externas que este repo no controla**:

- **Recordatorio por WhatsApp antes de un turno** — depende del trámite con Meta/Twilio (`docs/roadmap-implementacion.md`, 2.2), en curso por fuera del repo y sin fecha.
- **Envío del QR de reseña de Resea cuando una `Opportunity` pasa a `WON`** — depende de una decisión cruzada con Resea que **no está confirmada**: la propuesta de extender `DEC-051` para que Resea envíe el mensaje (sería `DEC-069`, ver `docs/integracion-resea-crm.md`) sigue pendiente de que el operador la confirme, y del lado de Resea falta el endpoint de review-link.

Se evaluó "saltar al paso 7" mientras WhatsApp sigue bloqueado, y la conclusión fue: **construir el motor real y genérico ahora, pero validarlo end-to-end contra un primer caso 100 % interno y ya desbloqueado** — cuando una `Opportunity` pasa a `WON`, se crea automáticamente una `Activity` de seguimiento asignada al dueño de la oportunidad. No hace falta ningún proveedor externo, ningún trámite, ninguna decisión ajena: todo lo que el caso necesita (`Opportunity`, `Activity`, el outbox) ya existe y está probado.

El punto no es la actividad de seguimiento en sí (que es útil, pero modesta): es que el día que WhatsApp o Resea se desbloqueen, agregar ese caso sea **registrar una acción nueva en el catálogo y nada más** — el trigger, el despacho, la idempotencia frente a reintentos y el CRUD de reglas ya van a estar construidos y probados contra un caso real.

**Decisión: el motor se apoya en el motor de eventos salientes (outbox) que ya existe** — `src/repositories/outboxEvent.repository.ts`, `src/services/outbox.service.ts`, `src/services/outboxHandlers.ts`, `src/workers/outboxWorker.ts` — y no lo reconstruye ni lo modifica. El outbox estaba 100 % construido pero sin ningún productor ni handler registrado (por diseño: se construyó antes que sus consumidores). Este módulo es su **primer consumidor real**: emite el primer evento (`opportunity.won`) y registra el primer handler.

## 2. Alcance de este PR

Incluye:

- El motor genérico de trigger → acción sobre el outbox existente (catálogo de triggers, catálogo de acciones, dispatcher con idempotencia por evento).
- **Un** trigger: `opportunity.won`, emitido desde `opportunity.service.ts`.
- **Una** acción: `activity.create_follow_up`, sobre `createActivity()` de `activity.service.ts`.
- El CRUD administrativo de reglas (`/api/automations`), con el mismo esquema de permisos que `/api/agents` y `/api/branches`.
- El modelo de datos (`Automation`, `AutomationExecution`) y su migración.

**No incluye, explícitamente, y queda documentado como bloqueado en `docs/roadmap-implementacion.md` sin tocar:**

- **WhatsApp** (recordatorio de turno o cualquier otro envío) — bloqueado por el trámite de Meta/Twilio.
- **Resea / envío de QR** — bloqueado por `DEC-069` (no confirmada) y por el endpoint de review-link del lado de Resea.
- **"Iniciar acción de IA"** (una automatización que dispare un turno del agente de IA) — no diseñado; cuando se aborde será una acción más del catálogo, pero la pregunta de qué significa "iniciar" una conversación sin un mensaje entrante del contacto no está resuelta.

> **Actualización (ítem 76 de `docs/frontend-cambios-pendientes.md`).** El caso concreto de "una automatización que ponga a trabajar a la IA" se resolvió **sin tocar** esa pregunta: el trigger `opportunity.stale` (producido por un barrido diario, `src/workers/opportunityStaleWorker.ts`, no por un service de negocio) dispara la acción `agent.draft_follow_up`, que le pide al modelo un **borrador** de seguimiento y lo deja como una `Activity` para el dueño de la oportunidad. **El agente nunca le escribe al cliente**, así que no se inicia ninguna conversación. Trajo también `Automation.triggerConfig` (la config del trigger, validada con un schema zod por trigger, como `actionConfig`), la compatibilidad acción/trigger declarada por cada acción, y una regla activa de `opportunity.stale` por organización. La pregunta de qué significa "iniciar" una conversación sigue abierta para cuando haga falta de verdad.

## 3. Modelo de datos

Dos entidades nuevas, bajo el mismo patrón de aislamiento multi-tenant que el resto del schema (`organizationId` en las dos, FK compuesta entre ellas):

```prisma
enum AutomationExecutionStatus {
  SUCCESS
  FAILED
}

model Automation {
  id             String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId String    @map("organization_id") @db.Uuid
  name           String    @db.VarChar(200)
  triggerType    String    @map("trigger_type") @db.VarChar(100)
  actionType     String    @map("action_type") @db.VarChar(100)
  actionConfig   Json      @map("action_config")
  isActive       Boolean   @default(true) @map("is_active")
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")
  deletedAt      DateTime? @map("deleted_at")

  organization Organization          @relation(fields: [organizationId], references: [id])
  executions   AutomationExecution[]

  @@unique([organizationId, id])
  @@index([organizationId, triggerType, isActive])
  @@map("automations")
}

model AutomationExecution {
  id             String                    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId String                    @map("organization_id") @db.Uuid
  automationId   String                    @map("automation_id") @db.Uuid
  outboxEventId  String                    @map("outbox_event_id") @db.Uuid
  status         AutomationExecutionStatus
  error          String?
  executedAt     DateTime                  @default(now()) @map("executed_at")

  organization Organization @relation(fields: [organizationId], references: [id])
  automation   Automation   @relation(fields: [organizationId, automationId], references: [organizationId, id])

  @@unique([automationId, outboxEventId])
  @@index([organizationId, automationId, executedAt])
  @@map("automation_executions")
}
```

**`Automation`** es la regla configurable por organización: "cuando pase `triggerType`, ejecutá `actionType` con esta `actionConfig`". Es **configuración**, no registro histórico — por eso lleva `deletedAt` (soft delete), mismo criterio que `Agent`, `Branch` o `Resource`, y no como `Opportunity`/`Activity`.

**`AutomationExecution`** es la marca de "esta automatización ya corrió para este evento" — la pieza que hace al motor idempotente frente a los reintentos del outbox (ver sección 6). Es append-mostly: una fila por `(automationId, outboxEventId)`, que nace `SUCCESS` o `FAILED` y solo cambia de `FAILED` a `SUCCESS` (o actualiza su `error`) en un reintento.

Decisiones sobre la forma, tomadas al construirlo:

- **`triggerType` y `actionType` son strings libres, no enums de Postgres** — mismo criterio que `OutboxEvent.eventType` y `Agent.modelProvider`/`modelName`: el catálogo vive en código (secciones 4 y 5), no en el schema. Agregar un trigger o una acción no debe requerir migración. Zod los valida en el borde contra el catálogo (sección 8).
- **`actionConfig` es `Json` sin forma impuesta por Postgres** — cada acción declara su propio schema zod y lo valida al crear/actualizar la regla. Mismo criterio que `Agent.guardrails`.
- **`id` es UUID generado por Postgres (`gen_random_uuid()`), no `cuid()`.** El primer borrador de este diseño lo escribía con `cuid()`; se cambió antes de implementar porque **las 40 tablas del schema usan UUID** y el borde HTTP valida todos los `:id` con `z.string().uuid()` — un `cuid` habría sido la única excepción del repositorio y habría roto esa validación en el CRUD.
- **`AutomationExecution` lleva `organizationId` propio y FK compuesta `(organizationId, automationId) → automations(organizationId, id)`** — el primer borrador no lo tenía (solo `automationId`). Se agregó porque es el estándar del proyecto desde C-3 (toda FK entre tablas con `organization_id` es compuesta, fila 14 del diagnóstico de esquema), porque permite la política RLS de aislamiento uniforme (fila 5) en vez de una excepción deny-all, y porque hace que toda escritura del dispatcher lleve `organizationId` en el WHERE, el invariante M4 del proyecto. Cuesta una columna denormalizada; a cambio la tabla no es una rareza.
- **`outboxEventId` NO tiene FK a `outbox_events`, a propósito.** Los eventos salientes se purgan a los 90 días (`purge:outbox-events`); una FK obligaría a purgar las ejecuciones junto con el evento o a bloquear la purga. La ejecución es el historial de la **regla** ("esta automatización corrió tal día por tal evento"), y sobrevive al evento que la originó. Una `outboxEventId` que ya no resuelve a ninguna fila no es una inconsistencia: es un evento viejo.
- **`@@unique([automationId, outboxEventId])`** es lo que convierte la marca en una garantía y no en una convención: dos workers que despachen el mismo evento a la vez (imposible hoy por el `FOR UPDATE SKIP LOCKED` del reclamo, pero es la clase de invariante que debe sobrevivir a un cambio del mecanismo) no pueden escribir dos marcas.
- **`@@index([organizationId, triggerType, isActive])`** sirve exactamente la consulta del dispatcher: "las automatizaciones activas de esta organización para este trigger". **`@@index([organizationId, automationId, executedAt])`** cubre el lado referenciante de la FK compuesta —que Postgres no indexa por su cuenta— y "las ejecuciones de esta regla, ordenadas", con un solo índice.
- **RLS habilitada en las dos tablas con la política de aislamiento uniforme** (`organization_id = current_organization_id()`), igual que `outbox_events`, `branches` o `vehicles` (M-5). Las dos entran al `values(...)` de la fila 5 del diagnóstico en el mismo PR; la FK compuesta entra a la fila 16.

## 4. Catálogo de triggers

Lista **cerrada en código**, en `src/services/automationTriggers.ts`:

```ts
export const TRIGGERS_CONOCIDOS = ["opportunity.won"] as const;
```

Coincide **1:1 con `OutboxEvent.eventType`** de los eventos que el negocio emite para el motor: un trigger *es* un eventType del outbox. No hay traducción intermedia, no hay tabla de mapeo.

**Agregar un trigger nuevo** son dos cosas, las dos en código:

1. Agregar el string a `TRIGGERS_CONOCIDOS` (con eso el CRUD ya lo acepta en una regla).
2. Emitir el evento con `emitOutboxEvent({ eventType: "<trigger>", ... }, tx)` desde el service de negocio correspondiente, **dentro de la transacción del cambio que lo origina** — es la única regla no negociable del outbox (ver el comentario de `emitOutboxEvent`).

El tercer paso que el diseño original pedía a mano —registrar el handler de despacho para ese eventType— **lo hace solo** `src/services/automationRegistrations.ts`: recorre `TRIGGERS_CONOCIDOS` y registra `registroDeHandlers.registrar(trigger, (evento) => despacharAutomatizaciones(evento, trigger))` para cada uno. Se derivó de la lista en vez de escribirse por trigger para que sea imposible olvidarlo: un trigger en la lista sin handler mandaría cada evento a `DEAD_LETTER` directo por handler ausente (el comportamiento diseñado del outbox para un bug de configuración), y nadie se enteraría hasta mirar la tabla.

## 5. Catálogo de acciones

Registro **en código**, `src/services/automationActions.ts`, con el mismo patrón exacto que `registroDeHandlers` del outbox (que a su vez calca los rate limiters): una **factory** `crearRegistroDeAcciones()` más un **singleton** `registroDeAcciones` construido con ella. Producción usa el singleton; los tests crean el suyo con la factory y quedan aislados sin resetear estado global.

Cada acción registra tres cosas:

```ts
interface AccionRegistrada {
  actionType: string;             // "activity.create_follow_up"
  schema: z.ZodType<...>;         // valida Automation.actionConfig
  handler: AutomationAction;      // la ejecución real
}

interface AccionAEjecutar {
  organizationId: string;
  automationId: string;             // la regla que se ejecuta (desde el ítem 159)
  config: Record<string, unknown>;  // actionConfig YA validado contra `schema`
  payload: Record<string, unknown>; // el payload del OutboxEvent
}
type AutomationAction = (input: AccionAEjecutar) => Promise<void>;
```

- **Registrar dos veces el mismo `actionType` lanza**, no sobrescribe — misma regla y mismo motivo que el outbox: sobrescribir en silencio dejaría al último módulo importado ganando por orden de imports.
- **El `schema` se usa en dos momentos**: al crear/actualizar la regla (el CRUD rechaza una `actionConfig` inválida con 400, sección 8) y al despachar (defensa en profundidad: si el schema de una acción cambió después de que la regla se guardó, la ejecución falla con un error legible en vez de correr con un config que la acción no entiende).
- **El handler no devuelve nada**: entrega o lanza. Igual que `OutboxHandler`, pedirle un valor de retorno invitaría a "reportar" un fallo devolviendo algo, que es la forma de que pase inadvertido.

Agregar una acción nueva = un archivo que exporta su `AccionRegistrada` + una línea en `automationRegistrations.ts` (`ACCIONES_INCORPORADAS`) + su entrada en el espejo del frontend (`frontend/src/features/automation/catalog.ts`).

### El catálogo de hoy

| `actionType` | Triggers | `actionConfig` | Qué hace | Archivo |
|---|---|---|---|---|
| `activity.create_follow_up` | `opportunity.won` | `{ subject, daysUntilDue, notes? }` | Crea una `Activity` TASK para el dueño de la oportunidad (sección 7). | `automationActions/createFollowUpActivity.ts` |
| `agent.draft_follow_up` | `opportunity.stale` | `{}` | La IA redacta un borrador de seguimiento y lo deja como tarea del dueño; marca la oportunidad para no redactar otro (ítem 76). | `automationActions/draftFollowUpMessage.ts` |
| `opportunity.send_qr_followup` | `opportunity.won` | `{ qrCodeId: uuid, delayHours: 0..720 }` | **Agenda** un WhatsApp al contacto de la oportunidad con el link del QR, que sale `delayHours` después (ítem 159). | `automationActions/sendQrFollowup.ts` |

### Precedente: la acción que agenda en vez de ejecutar (`opportunity.send_qr_followup`)

El dispatcher corre cada acción **en el instante** en que el outbox entrega el evento, dentro del drenado síncrono de la cola. No tiene ninguna noción de demora, y no conviene dársela: una acción que esperara horas —o que saliera a una API externa lenta— frenaría el drenado del outbox entero. Cuando una acción necesita que su efecto ocurra **más tarde**, el patrón es partirla en dos:

1. **La acción agenda.** Valida lo que puede validar ya (acá: que el QR exista, no esté borrado y sea de la organización; si no, lanza y la regla queda `FAILED` con un mensaje que manda a editarla) y escribe una fila en una tabla propia con la hora a la que tiene que ocurrir (`qr_follow_ups.scheduled_for = ahora + delayHours`). Nada de I/O externa: es rápida y no bloquea el outbox.
2. **Un worker ejecuta.** Un worker de polling propio (`src/workers/qrFollowUpWorker.ts`, mismo patrón que `agentInboundWorker.ts`: reclamo con `FOR UPDATE SKIP LOCKED` y lease, backoff, tope de intentos, arranque detrás de `workersHabilitados()`) toma las filas vencidas, **relee el estado del mundo** —la oportunidad pudo dejar de estar ganada, la regla desactivarse, el QR o el contacto borrarse— y recién ahí ejecuta el efecto. Si ya no corresponde, cancela la fila (`CANCELLED`, con el motivo) sin tocar nada.

Dos reglas que salen de este caso y valen para cualquier acción diferida futura:

- **La idempotencia la da la base, por `(regla, entidad)`.** La marca `SUCCESS` de `AutomationExecution` no alcanza: hay una ventana (el proceso muere entre el efecto de la acción y la escritura de la marca, sección 6) en la que el evento se reentrega y la acción vuelve a correr. Para una `Activity` eso es una tarea duplicada; para un WhatsApp, un segundo mensaje que no se puede deshacer. Por eso `qr_follow_ups` tiene `UNIQUE (automation_id, opportunity_id)` y la acción inserta con `ON CONFLICT DO NOTHING`: el duplicado es un no-op exitoso, no un error. Por eso también `AccionAEjecutar` lleva `automationId`. Es por **regla** y no por entidad a secas: dos reglas activas del mismo trigger (distintos QR, distintas demoras) agendan una fila cada una.
- **El efecto diferido tiene su propio estado visible**, separado de `AutomationExecution`. La ejecución de la regla es `SUCCESS` en cuanto agendó; si el WhatsApp después falla o se cancela, eso queda en la fila agendada (`status`, `attempts`, `lastError`), no en la ejecución.

**Lo que el envío necesita y no configura la regla:** la plantilla aprobada por Meta (`WHATSAPP_REVIEW_FOLLOWUP_TEMPLATE_NAME` / `_LANGUAGE`, dos variables posicionales: `{{1}}` nombre del contacto, `{{2}}` `QrCode.destinationUrl`), `WHATSAPP_ACCESS_TOKEN`, y un agente de la sucursal del QR con número de WhatsApp conectado (`Agent.whatsappPhoneNumberId`) — el número del que sale el mensaje. Sin las variables, el worker no reclama nada y lo dice en el log en cada pasada; sin número o sin teléfono del contacto, la fila pasa a `FAILED` con el motivo.

## 6. Mecanismo de despacho e idempotencia

`src/services/automationDispatch.service.ts` expone una única función genérica, reusable por cualquier trigger futuro:

```ts
despacharAutomatizaciones(evento: EventoAEntregar, triggerType: string): Promise<void>
```

Registrada como handler del outbox para cada trigger (sección 4, punto 3). Por cada evento entregado:

1. Busca las `Automation` con `organizationId = evento.organizationId`, `triggerType`, `isActive: true`, `deletedAt: null`.
2. Lee, en una sola consulta, las `AutomationExecution` que ya existen para `(esas automatizaciones, evento.id)`.
3. Por cada automatización:
   - si ya tiene una ejecución `SUCCESS` para este evento, **la salta**;
   - si no, resuelve la acción en `registroDeAcciones` por `actionType`, valida `actionConfig` contra su schema, y ejecuta el handler;
   - si el handler termina bien, escribe `AutomationExecution { status: SUCCESS }`;
   - si falla, escribe `AutomationExecution { status: FAILED, error }` y **recuerda el fallo**, pero sigue con las demás automatizaciones del mismo evento.
4. Al final, si alguna falló, **lanza un error que las resume** — y ese error sube al handler del outbox.

**Por qué existe `AutomationExecution`.** El outbox reintenta la entrega **completa** del evento si el handler lanza: reprograma con backoff, hasta cinco intentos, después `DEAD_LETTER`. Con dos automatizaciones para el mismo trigger, si la segunda falla y la primera ya tuvo éxito, el reintento del evento volvería a ejecutar la primera — una `Activity` duplicada por cada reintento. La marca `SUCCESS` por `(automationId, outboxEventId)` es lo que impide eso: en el reintento, la primera se salta y solo corre la que falló.

**Por qué el fallo se propaga y no se atrapa.** El dispatcher **no implementa ningún reintento propio**: ya existe uno, con backoff, tope de intentos, `DEAD_LETTER` y su diagnóstico en `lastError`, y está probado (`outboxWorker.integration-test.ts`). Atrapar el error acá lo dejaría sin efecto y convertiría cada fallo en un `PROCESSED` silencioso. Lo que el dispatcher agrega es exactamente lo que el outbox no puede saber solo: **cuáles** automatizaciones del evento ya están hechas.

**Por qué se siguen ejecutando las demás cuando una falla** (en vez de cortar en la primera). Si el dispatcher cortara, las automatizaciones posteriores a la fallida no correrían hasta el próximo intento del evento — 30 segundos de backoff como mínimo, por un fallo que no es suyo. Ejecutarlas todas y lanzar al final les da su primer intento ahora; la marca `SUCCESS` garantiza que el reintento no las repita. El costo es que el error que ve el outbox es un resumen ("2 de 3 automatizaciones fallaron: ...") y no un stack trace único; el detalle por automatización queda en `AutomationExecution.error`.

**Una `actionType` sin acción registrada** (regla guardada para una acción que ya no existe en el código, o un despliegue que olvidó registrarla) se trata como **fallo de esa automatización**: `FAILED` con un error explícito, log en `error`, y las demás siguen. Se eligió esto y no un `DEAD_LETTER` inmediato del evento entero (que es lo que el outbox hace con un *handler* ausente) porque a nivel de acción el evento sí tiene handler y las otras automatizaciones del mismo evento pueden ser perfectamente válidas — no deberían pagar por una regla rota.

**Las marcas se escriben con el cliente global de Prisma, fuera de la transacción del evento**, y es deliberado: el handler del outbox no tiene acceso a esa transacción (`EventoAEntregar` no la expone), y aunque la tuviera no convendría. Si la marca `SUCCESS` estuviera dentro de la transacción del evento y esa transacción revirtiera después de que la acción ya corrió (el caso B-26 del outbox: la fila ya no estaba en `PENDING`), la marca se perdería y el próximo intento repetiría la acción. Con la marca comiteada por su cuenta, la acción y su marca son atómicas respecto del reintento, que es lo único que importa.

**Decisión: `AutomationExecution` guarda también `status: FAILED` y `error`**, no solo un marcador binario de éxito. No es especulativo: es el mínimo de observabilidad que necesita cualquier admin que configura una regla y quiere saber si corrió o no, y por qué no — y sale prácticamente gratis del mismo modelo (una columna de estado y una de texto). Sin esto, "la regla no hizo nada" sería indistinguible de "la regla no existía" hasta que alguien mire `outbox_events.last_error`, que resume el evento entero y no la regla.

**Límite conocido.** Si el proceso muere **entre** el efecto de la acción (la `Activity` ya creada) y la escritura de la marca `SUCCESS`, el reintento va a repetir la acción. Es la misma ventana que tiene el propio outbox entre el handler y `markOutboxEventProcessed`, documentada ahí, y la única forma de cerrarla del todo sería que cada acción fuera transaccional con su marca — posible para acciones internas como ésta (una `Activity`), imposible para las externas (un WhatsApp enviado no se revierte). Se acepta la ventana, es de milisegundos, y se prefiere un mecanismo uniforme para todas las acciones.

## 7. Primer caso, en detalle: `Opportunity` → `WON` → `Activity` de seguimiento

### Trigger `opportunity.won`

Se emite desde `src/services/opportunity.service.ts` en dos lugares:

- **`updateOpportunity()`** — la función ya lee la oportunidad completa al inicio (`opportunity`, el estado pre-update) y calcula `effectiveStatus`. La detección es una función pura, exportada y probada sin base:

  ```ts
  transicionaAGanada(previo, efectivo) === previo !== "WON" && efectivo === "WON"
  ```

  `WON → WON` (un PATCH que manda `status: "WON"` sobre una ya ganada, o que no toca el status) **no** dispara; `OPEN → LOST` no dispara; `OPEN → WON` y `LOST → WON` sí.

  La escritura en `updateOpportunity` iba en transacción **solo** cuando cambiaba el stage o había que sincronizar la unidad (`if (nuevoStageId || needsVehicleSync)`), y el resto por el camino no transaccional. La condición se extendió con `|| pideGanada` (`input.status === "WON"`): todo PATCH que pide ganar entra en la transacción, y el `UPDATE` y el `emitOutboxEvent` comitean juntos. El evento se emite **después** de que el `UPDATE` confirmó `count === 1` (una oportunidad que desapareció entre el pre-check y la escritura da 404 y no emite nada). No existe ningún camino por el que el cambio a `WON` comitee sin el evento, ni el evento sin el cambio — es la garantía que `emitOutboxEvent` exige al no admitir un `tx` con default.

  **La transición se decide bajo el lock de la fila, no sobre la lectura previa.** El `opportunity.status` que la función lee al inicio se lee sin lock; dos PATCH concurrentes a `WON` sobre la misma oportunidad leerían `OPEN` los dos y emitirían dos eventos (dos seguimientos). Por eso, dentro de la transacción y justo antes del `UPDATE`, `lockOpportunityForUpdate` (`SELECT status ... FOR UPDATE`) relee el status con la fila bloqueada y `transicionaAGanada` se evalúa sobre ese valor: el segundo PATCH espera al primero, ve `WON` y no emite. El lock se toma **después** del de stage y del de organización, en el mismo orden relativo en que el propio `UPDATE` tomaría el lock de esa fila — `deleteOpportunity` lockea la organización y después escribe la oportunidad, así que tomar la fila antes que la organización sería la receta de un deadlock. Probado con dos `updateOpportunity` concurrentes en `automationOpportunityWon.integration-test.ts`.

- **`createOpportunity()`** — ya corre entera dentro de `prisma.$transaction`. Si `created.status === "WON"` (una oportunidad creada directamente como ganada), emite el mismo evento en el mismo `tx`, después de crear la fila y después de `setVehicleStatusForOpportunityLink` si aplica — el evento es lo último de la transacción, cuando todo lo demás ya está escrito.

**Payload: `{ opportunityId, ownerId }`** — el mínimo necesario; la acción resuelve el resto leyendo la oportunidad si lo necesita. `ownerId` es el **dueño efectivo después del cambio**: si el mismo PATCH cambia el owner y pasa a `WON`, el seguimiento va al owner nuevo, no al anterior. `Opportunity.ownerId` es `NOT NULL`, así que no hay caso "sin owner" que manejar.

### Acción `activity.create_follow_up`

`src/services/automationActions/createFollowUpActivity.ts`. Config de la regla:

```ts
z.object({
  subject: z.string().trim().min(1).max(200),
  daysUntilDue: z.number().int().min(0).max(365),
})
```

**Sin defaults ocultos**: si a la regla le falta `daysUntilDue`, falla la validación al crearla (400 del CRUD), no en tiempo de ejecución. `max(200)` en `subject` deja margen bajo el `VarChar(255)` de `Activity.subject`.

Crea la `Activity` vía el `createActivity(organizationId, actorUserId, input)` que ya existe en `activity.service.ts` — con sus validaciones intactas (el assignee existe, está activo y es de la organización; la oportunidad existe y no está borrada):

| Campo de la `Activity` | Valor | Por qué |
|---|---|---|
| `type` | `TASK` | De los cinco tipos (`CALL`, `MEETING`, `EMAIL`, `TASK`, `NOTE`), es el único que describe **algo pendiente que alguien tiene que hacer** con una fecha límite — que es lo que "Mis tareas" lista. `CALL`/`MEETING`/`EMAIL` presuponen el medio, que la regla no conoce; `NOTE` es un registro de algo que ya pasó. |
| `subject` | `config.subject` | Lo decide quien configura la regla. |
| `dueDate` | ahora + `config.daysUntilDue` días | Aritmética de calendario en UTC; `0` = vence hoy. |
| `assigneeId` | `payload.ownerId` | El dueño de la oportunidad es quien la sigue. |
| `opportunityId` | `payload.opportunityId` | La actividad queda colgada de la oportunidad que la originó; es la única relación que se setea y alcanza para el CHECK `activities_related_entity_check`. |
| `authorId` (`actorUserId`) | `payload.ownerId` | Ver la decisión abierta de la sección 10. |

## 8. CRUD administrativo: `/api/automations`

`src/routes/automation.routes.ts`, montado en `routes/index.ts` junto a los demás CRUD de configuración (`agent`, `branch`, `resource`, `serviceType`). **Mismo esquema exacto que `agent.routes.ts`**: lectura para cualquier usuario autenticado de la organización, escritura solo `ADMIN`, `businessWriteRateLimiter` en las escrituras (después de `authenticate`, antes de `authorize`), soft delete vía `deletedAt`.

| Método | Ruta | Quién |
|---|---|---|
| `GET` | `/api/automations` | cualquier autenticado |
| `GET` | `/api/automations/:id` | cualquier autenticado |
| `POST` | `/api/automations` | `ADMIN` |
| `PATCH` | `/api/automations/:id` | `ADMIN` |
| `DELETE` | `/api/automations/:id` | `ADMIN` |

Cuerpo de creación: `{ name, triggerType, actionType, actionConfig, isActive? }`. El PATCH es parcial (al menos un campo).

**Validación, toda antes de guardar, nunca en tiempo de ejecución:**

- La forma (zod) en el controller, como en `agent.controller.ts`.
- En el service, contra los catálogos: `triggerType` tiene que estar en `TRIGGERS_CONOCIDOS`; `actionType` tiene que estar registrado en `registroDeAcciones`; `actionConfig` tiene que pasar el schema de **esa** acción. Los tres son 400 con el motivo. En el PATCH, si cambia `actionType` sin cambiar `actionConfig` (o al revés), se revalida el config **efectivo** contra la acción **efectiva** — cambiar la acción de una regla nunca deja un config viejo que la acción nueva no entiende.

El listado admite `search` (por `name`), `triggerType`, `isActive`, y ordena por `name` o `createdAt`, con la misma paginación que el resto.

## 9. Plan de implementación

**Un solo PR**, alcance comparable al del script embebible del widget (PR #216): no amerita partirlo en 2a/2b. En orden:

1. Este documento + la línea del roadmap.
2. Schema (`Automation`, `AutomationExecution`, enum) + migración a mano (`20260913120000_automation_engine`) + filas 5 y 16 del diagnóstico de esquema.
3. Catálogo de triggers (`automationTriggers.ts`) y de acciones (`automationActions.ts`) + la primera acción (`automationActions/createFollowUpActivity.ts`).
4. Dispatcher (`automationDispatch.service.ts`) + repositorio (`automation.repository.ts`) + bootstrap de registros (`automationRegistrations.ts`, llamado desde `server.ts` antes de levantar el worker del outbox).
5. Emisión del evento en `opportunity.service.ts`.
6. CRUD (`automation.service/controller/routes`) + montaje + el test de montaje en `routes/index.test.ts`.
7. Tests: unitarios (detección de transición, registro de acciones, schema de la acción, fecha de vencimiento) e integración (dispatcher e idempotencia, la acción, CRUD por HTTP con permisos y scoping, y el flujo completo `updateOpportunity → outbox → worker → Activity`).

## 10. Decisiones abiertas / explícitamente fuera de alcance

- **WhatsApp, Resea/QR, "iniciar acción de IA"** — bloqueados, no se tocan (sección 2). Cuando se desbloqueen, cada uno es una acción nueva del catálogo (sección 5) y, en el caso del recordatorio de turno, también un trigger nuevo (sección 4) emitido desde `booking.service.ts`.
- **Autoría de las `Activity` generadas por automatización** — hoy `authorId = ownerId` (el dueño de la oportunidad figura como autor de su propia tarea de seguimiento). No existe un concepto de "usuario sistema" en el codebase, y `Activity.authorId` es `NOT NULL` con FK compuesta a `users`, así que inventar uno sería una migración y una fila especial por organización. Usar el owner como actor es el default reversible más simple. **A revisar** si en el futuro hace falta distinguir "creado por una persona" de "creado por una automatización" (por ejemplo, para que la UI lo muestre distinto o para métricas de adopción): las opciones son un usuario sistema por organización o una columna `createdByAutomationId` nullable en `Activity`. Ninguna se construye antes de que la distinción haga falta de verdad.
- **Retención de `automation_executions`** — la tabla crece una fila por (regla, evento) y no se purga. `outbox_events` se purga a los 90 días; las ejecuciones podrían seguir el mismo criterio con un script gemelo de `purge:outbox-events` cuando el volumen lo justifique. Hoy no lo justifica.
- **Lectura de ejecuciones desde la API** (`GET /api/automations/:id/executions`, "¿corrió esta regla?") — el dato ya se guarda; el endpoint es trivial y se agrega cuando exista la pantalla que lo consuma. No se construye antes.
- **Condiciones** (trigger → *condición* → acción, la forma completa de la sección 10 del documento de visión: "solo si el monto supera X", "solo en esta sucursal") — no diseñadas. El modelo lo admite sin migración (una columna `conditions Json?` más una evaluación en el dispatcher antes de la acción), pero no hay un caso real que la pida todavía.
- **Frontend del CRUD de reglas** — fuera de este PR, igual que la UI admin de Agentes. Hasta que exista, las reglas se crean por API.
- **Un evento WON emitido por un `Opportunity` cuyo owner fue desactivado antes del despacho** falla en `createActivity` (el assignee tiene que estar activo), la automatización queda `FAILED` y el outbox agota sus reintentos hasta `DEAD_LETTER`. Es el comportamiento correcto — no hay a quién asignarle el seguimiento — y queda diagnosticado en dos lugares. No se agrega un fallback ("asignar al ADMIN") sin un pedido real.
