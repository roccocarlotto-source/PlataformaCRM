# Arquitectura del módulo de Agentes de IA

Documento de diseño — 12/09/2026. Sigue la misma convención que `authentication-architecture.md`, `ingestion-architecture.md` y `booking-architecture.md`: describe el diseño antes de implementarlo, se actualiza a medida que se construye.

## 1. Contexto y decisión

El sistema necesita que un agente de IA converse con leads y clientes por WhatsApp y por un chat embebido en la web del negocio, ejecutando acciones reales del CRM (calificar, crear oportunidades, agendar) bajo el control del backend — ver `sistema_saas_definicion_funcional.md` (carpeta "Sistema Saas"), secciones 6, 7 y 9, y `docs/roadmap-implementacion.md`, 2.2.

**Decisión: `Agent`/`Conversation`/`Message` como entidades propias, multi-tenant, con `Agent` a nivel de sucursal** — mismo nivel que `Resource`, `ServiceType` y `GoogleCalendarConnection` (`docs/booking-architecture.md`), no a nivel de organización. Motivo: el canal WhatsApp se conecta por sucursal (un número por sucursal, ver el brief del trámite de Meta/Twilio), así que un agente que responde por ese número tiene que poder tener tono, catálogo de servicios y guardrails propios de esa sucursal — dos sucursales de la misma organización pueden vender cosas distintas o tener políticas distintas.

**Decisión: proveedor de LLM abstraído detrás de una interfaz propia, un solo proveedor implementado al principio** — tal como pide el documento de visión (sección 6). Cuál proveedor arrancar no está decidido (ver sección 10) — el diseño de este documento no depende de esa elección.

**Principio que gobierna todo el diseño de acá para abajo, textual del documento de visión:** *"la IA puede proponer o ejecutar una acción, pero el sistema debe controlar si esa acción está permitida."* En este documento eso no es una frase de intención — tiene una implementación concreta en la sección 6 (capa de permisos), y es lo primero que hay que construir bien, antes que cualquier tool.

## 2. Alcance de este módulo

Incluye: modelo de datos de `Agent`/`Conversation`/`Message`, la capa de permisos y guardrails, el loop de orquestación del LLM con tool-calling (un solo proveedor), el mecanismo de handoff a humano, y las dos tools que ya tienen toda su base construida — `create_opportunity()`/`update_opportunity()` (sobre `opportunity.service.ts`) y `get_availability()`/`create_booking()` (sobre el módulo de Booking, completo) — probadas primero por el canal Web, sin depender de WhatsApp.

No incluye (fuera de alcance de este documento):
- **Integración de WhatsApp Business API** — depende del trámite externo con Meta/Twilio (en curso, por fuera de este repo). El modelo de datos de este documento ya lo contempla (`Conversation.channel`), pero el webhook y el envío real se diseñan cuando esa infraestructura exista.
- **Knowledge Base / RAG** (sección 8 del documento de visión) — no diseñada todavía. `Agent` no referencia ninguna entidad de conocimiento en este documento.
- **Motor de automatizaciones** (trigger/condition/action, sección 10 del documento de visión) — módulo aparte. Comparte el motor de eventos salientes (outbox) que ya existe, pero su diseño no vive acá.
- **Pagos** (`create_payment_link()`) — depende de 2.3, sin pasarela elegida.
- **`create_lead()`/`update_lead()` como tools terminadas** — el schema que necesitan ya existe (`Contact.leadScore`/`leadIntent`/etc., PR #207), pero `contact.service.ts` todavía no expone ningún método para escribirlos. Queda en el plan de implementación (sección 9), no diseñado a fondo acá porque es un wrapper fino, igual que las otras tools de la sección 7.

## 3. Modelo de datos

Tres entidades nuevas, bajo el mismo patrón de aislamiento multi-tenant que el resto del schema (`organizationId` + FKs compuestas donde aplica):

```prisma
enum ConversationChannel {
  WHATSAPP
  WEB
}

enum ConversationStatus {
  ACTIVE
  TRANSFERRED_TO_HUMAN
  CLOSED
}

enum MessageDirection {
  INBOUND
  OUTBOUND
}

enum MessageSenderType {
  CONTACT   // el lead/cliente escribiendo
  AGENT     // el agente de IA respondiendo
  HUMAN     // una persona del negocio tomó la conversación (post handoff)
}

model Agent {
  id             String   @id @default(uuid())
  organizationId String
  branchId       String
  name           String              // "Agente comercial"
  goal           String?             // resumen corto, para mostrar en el panel de admin
  instructions   String              // el prompt real: objetivo + tono + contexto del negocio
  tone           String?             // "formal", "cercano" — informativo, se compone en `instructions`
  modelProvider  String              // "anthropic" | "openai" | "google" — string, no enum: cambia más rápido que un catálogo cerrado (mismo criterio que Opportunity.currency)
  modelName      String              // el modelo exacto del proveedor
  enabledTools   String[]            // subconjunto del catálogo de la sección 7, ej. ["create_opportunity", "get_availability"]
  channels       ConversationChannel[] // en qué canales puede operar este Agent
  guardrails     Json                // estructura documentada en la sección 6, sin enforcement de forma a nivel de Postgres
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  deletedAt      DateTime?
}

model Conversation {
  id             String   @id @default(uuid())
  organizationId String
  branchId       String              // denormalizado desde agentId, mismo criterio que Stage.organizationId — evita un join para RLS/aislamiento
  agentId        String              // qué Agent la atendió al crearse; no se pisa en un handoff (ver más abajo)
  contactId      String              // NOT NULL: una conversación sin contacto no es una conversación (mismo criterio que Booking.contactId)
  assignedUserId String?             // se completa solo cuando status = TRANSFERRED_TO_HUMAN
  channel        ConversationChannel
  status         ConversationStatus @default(ACTIVE)
  externalThreadId String?           // id del hilo en el canal externo (WhatsApp: el número del contacto; Web: id de sesión del widget)
  lastMessageAt  DateTime?           // cache denormalizado, para ordenar un futuro listado sin agregar sobre Message
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  // Sin deletedAt: "cerrada" es un status (CLOSED), no un soft delete — mismo
  // criterio que Booking con BookingStatus.CANCELLED. Una conversación
  // cerrada es historia que hay que conservar tal cual.
}

model Message {
  id                String   @id @default(uuid())
  organizationId    String              // denormalizado desde conversationId
  conversationId    String
  direction         MessageDirection
  senderType        MessageSenderType
  senderUserId      String?             // solo cuando senderType = HUMAN
  content           String              @db.Text
  toolCalls         Json?               // auditoría: qué tool intentó usar el agente en este turno, con qué argumentos, si se permitió y qué devolvió — ver sección 6
  externalMessageId String?             // id del mensaje en el canal externo (SID de Twilio, etc.) — dedup ante reintentos/reentregas del webhook
  createdAt         DateTime @default(now())
  // Sin updatedAt/deletedAt: un mensaje enviado no se edita ni se borra,
  // es un registro de lo que pasó (mismo espíritu que Activity, que sí
  // permite editar — pero un Message es la transcripción de una
  // conversación real con un tercero, no una nota interna).
}
```

**Por qué `Agent.branchId` no es `@unique`.** El documento de visión (sección 6) permite más de un agente por negocio ("ventas, soporte, recepción, postventa") — el schema lo soporta desde ahora aunque el plan de implementación (sección 9) solo va a crear uno ("Agente comercial") por sucursal al principio. El ruteo entre varios agentes activos de la misma sucursal queda como decisión abierta (sección 10) porque hoy no es un problema real: con un solo agente por sucursal no hay nada que rutear.

**Por qué `Conversation.agentId` no cambia en un handoff.** Transferir a una persona es un cambio de `status` + completar `assignedUserId`, no reasignar la conversación a otro `Agent` — `agentId` sigue diciendo qué agente la venía atendiendo, para la auditoría. Si más adelante una conversación necesita pasar de un agente a otro (no a un humano), eso es un caso distinto, no diseñado acá.

**Por qué `guardrails` es `Json` y no columnas.** Mismo motivo que `Contact.customFields` (PR #207): la sección 6 del documento de visión lista siete dimensiones de guardrail distintas (temas prohibidos, acciones prohibidas, información no modificable, cuándo derivar, promesas prohibidas, información requerida antes de una acción, herramientas habilitadas — esta última ya tiene su propia columna, `enabledTools`) y cada negocio va a necesitar una combinación distinta. Modelarlo como columnas fijas sería inventar una forma que no le va a servir a todos. La forma esperada (documentada, no impuesta por Postgres) está en la sección 6.

**Índices** (sin agregar todavía los que dependan de un patrón de consulta real que no existe hasta que haya un panel de admin):
- `Agent`: `[organizationId]`, `[branchId]`.
- `Conversation`: `[organizationId]`, `[branchId]`, `[contactId]` (historial de conversaciones de un contacto), `[organizationId, status]` (bandeja de conversaciones activas/derivadas).
- `Message`: `[conversationId, createdAt]` (el patrón de lectura real: los mensajes de una conversación, en orden).
- `AgentEmbedToken` (paso 5a, 12/09/2026 — ver la nota del canal Web en la sección 10): el token de embed del widget, paralelo a `ApiKey` (`tokenHash` UNIQUE + `tokenPrefix`, `lastUsedAt`, `revokedAt`) pero scopeado a `(organizationId, agentId)`; `[organizationId, agentId, createdAt]` cubre el lado referenciante de la FK compuesta y el listado por agente, mismo criterio que `ApiKey`. Junto con él, `Agent.allowedOrigins String[] @default([])`.

> **Nota del 12/09/2026 — el modelo de datos ya está construido.** Paso 1 del
> plan de la sección 9, implementado en la migración
> `20260912130000_agent_conversation_message_schema`. Solo schema, mismo
> criterio que el PR #207 (Contact): sin controller, sin service, sin routes y
> sin loop de orquestación — eso es el paso 2.
>
> Los bloques `model` de arriba son pseudo-código de diseño; la implementación
> real sigue la convención de todo `prisma/schema.prisma` (`@id
> @default(dbgenerated("gen_random_uuid()")) @db.Uuid`, `@map("snake_case")` en
> cada columna, tablas `agents` / `conversations` / `messages`). Lo que hubo que
> ajustar o decidir al implementar, respecto de lo escrito arriba:
>
> - **FKs compuestas y `@@unique([organizationId, id])`.** Todas las
>   relaciones cruzadas son `(organization_id, x_id) -> padre(organization_id,
>   id)`, el estándar del proyecto desde C-3 — el borrador las tenía como
>   columnas sueltas. `Agent` y `Conversation` ganan el `@@unique([organizationId,
>   id])` que habilita a `Conversation` y `Message` a referenciarlos compuesto.
>   Acciones referenciales por la regla de `20260821140200`: `RESTRICT` en las
>   NOT NULL (`Agent.branch`, `Conversation.branch`/`agent`/`contact`,
>   `Message.conversation`), `NO ACTION` explícito en las dos nullable
>   (`Conversation.assignedUser`, `Message.senderUser`).
> - **Un CHECK que este documento no detallaba:**
>   `messages_sender_user_id_consistency_check`. `senderType = HUMAN` exige
>   `senderUserId`; `CONTACT`/`AGENT` exigen que sea NULL. El texto de arriba lo
>   decía en un comentario ("solo cuando senderType = HUMAN"); la base ahora lo
>   rechaza, no solo la aplicación — mismo espíritu que el CHECK de
>   `GoogleCalendarConnection`. Escrito con las dos ramas explícitas a
>   propósito: si `MessageSenderType` gana un cuarto valor, el CHECK lo rechaza
>   hasta que alguien decida qué exige. Vive en la migración (criterio B-15) y
>   entra a la fila 8 del diagnóstico (22 → 23 CHECK); las siete FKs compuestas
>   entran a la fila 16 (35 → 42).
> - **Nombres de relación en `User`:** `assignedConversations
>   Conversation[] @relation("ConversationAssignee")` y `sentMessages Message[]
>   @relation("MessageSender")`, mismo patrón que `assignedActivities
>   @relation("ActivityAssignee")`. El resto de las back-relations
>   (`Organization.agents/conversations/messages`, `Branch.agents/conversations`,
>   `Contact.conversations`, `Agent.conversations`, `Conversation.messages`) no
>   necesitan nombre.
> - **Tamaños de columna**, que el borrador no fijaba: `name` VarChar(200),
>   `goal` VarChar(500), `tone` VarChar(100), `modelProvider` VarChar(50),
>   `modelName` VarChar(100), `externalThreadId` / `externalMessageId`
>   VarChar(255). `instructions` y `content` son `Text`. `guardrails` es JSONB
>   NOT NULL sin default: un agente sin guardrails declarados no debería poder
>   existir, aunque el valor sea `{}`.
> - **`enabledTools` y `channels` sin `@default([])`**, tal como están arriba.
>   Prisma devuelve `[]` cuando la columna es NULL, así que en la práctica no
>   cambia nada; queda anotado por si el paso 2 prefiere el default explícito
>   que sí tiene `Vehicle.equipment`.
> - **Sin políticas RLS propias**, y no es una omisión: `bookings`,
>   `working_hours`, `resources`, `service_types` y
>   `google_calendar_connections` —el módulo arquitectónicamente más parecido a
>   este— tampoco las tienen. Sí las tiene el módulo de vehículos
>   (`20260907120000`), así que hoy conviven los dos precedentes; este módulo
>   sigue al de Booking. Si en algún momento se decide que toda tabla nueva con
>   `organization_id` lleve política, las tres entran juntas a
>   `prisma/sql/rls_policies.sql` y a la fila 5 del diagnóstico.
> - **`externalMessageId` sin UNIQUE todavía.** El índice que haga cumplir la
>   deduplicación nace con el webhook que la necesite (paso 6), cuando se sepa
>   contra qué se deduplica (¿por canal? ¿por conversación?).
>
> Lo que **no** cambió: los cuatro enums con los mismos valores, los índices
> exactamente como se listan arriba (ninguno más), sin `deletedAt` en
> `Conversation` ni `Message`, sin `updatedAt` en `Message`, `branchId` de
> `Agent` no único, `agentId` de `Conversation` intacto en un handoff.

## 4. Loop de orquestación del LLM

1. Llega un mensaje entrante (por ahora, desde el endpoint del canal Web — sección 5) → se resuelve o crea la `Conversation` (por `contactId` + `channel`, o por `externalThreadId` si ya existe una activa) y se persiste como `Message` (`INBOUND`, `senderType: CONTACT`).
2. Se arma el contexto para el LLM: `Agent.instructions` + `Agent.tone` como system prompt, una ventana de los `Message` más recientes de la conversación (tamaño exacto sin decidir — sección 10), y el catálogo de tools filtrado por `Agent.enabledTools`.
3. Se llama al proveedor de LLM (interfaz abstracta, sección 1) con tool-calling habilitado.
4. **Si el modelo pide ejecutar una tool, NO se ejecuta directo.** Pasa primero por la capa de permisos (sección 6): `puedeEjecutarTool(agent, toolName, args, conversation)`. Si no está permitida, no se ejecuta — se le devuelve al modelo que esa acción no está disponible (o se dispara un handoff, si el guardrail dice eso), nunca se le miente al modelo con un resultado falso.
5. Si está permitida, se ejecuta el wrapper real de la tool (que llama al service existente correspondiente — `opportunity.service.ts`, el módulo de Booking, etc.) y el resultado se registra en `Message.toolCalls` del turno.
6. El resultado de la tool vuelve al modelo si hace falta (para que arme la respuesta final), o el modelo responde directo.
7. La respuesta final se envía por el canal correspondiente y se persiste como `Message` (`OUTBOUND`, `senderType: AGENT`), con `Conversation.lastMessageAt` actualizado.

**Este loop es el mismo para Web y para WhatsApp.** Lo único que cambia entre canales es cómo entra el mensaje y cómo sale la respuesta (sección 5) — la orquestación, la capa de permisos y el registro de auditoría son una sola implementación. Es la razón por la que conviene probar todo esto primero por Web (sección 9): el canal más simple de construir, ninguna aprobación externa de por medio, y si el loop tiene un problema de diseño es mucho más barato encontrarlo ahí que en producción sobre WhatsApp real.

## 5. API interna

- **Canal Web**: `POST /api/public/agents/:branchId/web/messages` — recibe un mensaje del widget embebido en la web del negocio. **Sin `authenticate`**, porque quien escribe es un visitante anónimo del sitio del negocio, no un usuario de este CRM — mismo problema de fondo que ya resolvieron `qrPublic.service.ts` y la capa de ingesta (`ApiKey`) para otros casos de escritura pública. La identidad que hay que validar acá no es "quién es la persona", es "este widget pertenece de verdad a esta sucursal" — probablemente un token de embed por sucursal, análogo a `ApiKey` pero de menor privilegio (solo puede escribir mensajes, no leer nada del CRM). **Diseño exacto pendiente** (sección 10): cómo se identifica/crea el `Contact` de un visitante que todavía no dio ningún dato de contacto real.
- **Canal WhatsApp**: `POST /api/webhooks/whatsapp` — mismo patrón que `POST /api/webhooks/google-calendar` (`docs/booking-architecture.md`, sección 5): sin `authenticate`, un token firmado propio como defensa, `externalMessageId` para idempotencia ante reintentos. No se puede terminar de diseñar en detalle hasta que exista la cuenta de Twilio/Meta — lo que sí queda fijo desde ahora es que entra al mismo loop de la sección 4, no a uno paralelo.
- **Administración** (ADMIN-only, mismo `authorize("ADMIN")` que `Branch`/`Pipeline`): `POST/GET/GET :id/PATCH/DELETE /api/agents` — CRUD del `Agent` de una sucursal. `GET /api/conversations?status=&branchId=` — bandeja de conversaciones (activas / derivadas / cerradas). `GET /api/conversations/:id/messages` — el hilo completo de una conversación, para que un humano vea el contexto antes de tomarla en un handoff.

> **Nota (19/09/2026) — la bandeja construida se desvió de esta línea en dos cosas** (ítem 66 de `docs/frontend-cambios-pendientes.md`):
>
> 1. **No es ADMIN-only.** `GET /api/conversations` y `GET /api/conversations/:id` llevan `authenticate` y nada más. El agrupamiento de esta línea es por módulo, no por permiso, y para las conversaciones el permiso no sigue al del CRUD del `Agent`: ver una conversación con un contacto es leer un dato del CRM, como un contacto o una oportunidad, y quien más lo necesita es justamente el vendedor que la recibe en un handoff — que puede ser `USER`. El CRUD del `Agent` sigue ADMIN-only para escribir, sin cambios.
> 2. **El hilo viaja dentro del detalle**, no en `/:id/messages`. Una conversación sin sus mensajes no le sirve a ninguna pantalla, y dos requests para armar una vista que siempre las necesita a las dos son dos round trips por nada. `GET /api/conversations/:id` devuelve la conversación con `messages` en orden cronológico, sin paginar.
>
> Lo que NO se construyó, y es la decisión de fondo del ítem: **ninguna escritura**. No hay responder, cerrar ni reasignar. Persistir un `Message` `OUTBOUND` no lo entrega por el canal —el widget Web solo puede contestar a su propio mensaje y WhatsApp es el paso 6 de la sección 9—, así que un botón "Responder" mostraría como enviado algo que el contacto nunca recibiría.
- **Sin endpoint de ejecución de tools.** El loop de la sección 4 llama directo a los services existentes (`opportunity.service.ts`, el módulo de Booking) desde dentro del proceso — no hay una capa HTTP intermedia. Mismo principio que ya establece `docs/booking-architecture.md` sección 7 para `get_availability()`/`create_booking()`: el agente nunca le habla a un proveedor externo ni salta la validación de negocio, siempre pasa por el mismo código que usaría un humano desde el panel.

## 6. Guardrails y capa de permisos

Esta es la pieza que hace cumplir, con código, el principio de la sección 1 — no es una sugerencia en el prompt del modelo.

**Forma esperada de `Agent.guardrails`** (documentada acá, no forzada por Postgres — mismo criterio que `Contact.customFields`):

```json
{
  "temasProhibidos": ["diagnósticos médicos", "asesoramiento legal"],
  "accionesProhibidas": ["update_opportunity"],
  "infoNoModificable": ["Contact.email"],
  "condicionesDeDerivacion": ["el cliente pide hablar con una persona", "reclamo o queja"],
  "promesasProhibidas": ["descuentos no publicados", "plazos de entrega no confirmados"],
  "datosRequeridosAntesDeAccion": {
    "create_booking": ["contactId", "serviceTypeId"]
  }
}
```

**`puedeEjecutarTool(agent, toolName, args, conversation)` es la función central**, llamada antes de ejecutar cualquier tool (paso 4 de la sección 4). Chequea, en este orden: (1) `toolName` está en `agent.enabledTools`; (2) `toolName` no está en `guardrails.accionesProhibidas`; (3) los campos de `args` no tocan nada listado en `guardrails.infoNoModificable`; (4) si `guardrails.datosRequeridosAntesDeAccion[toolName]` existe, todos esos datos ya están disponibles en la conversación (si no, la tool no se ejecuta y el modelo tiene que seguir preguntando). Devuelve `{ allowed: boolean, reason?: string }` — nunca ejecuta nada, solo decide.

**El handoff a humano usa el mismo mecanismo, no uno aparte.** Se dispara cuando: el contacto lo pide explícitamente, el modelo no puede resolver el caso (falla repetida de tool-calling o el propio modelo lo señala), una `condicionDeDerivacion` configurada coincide con la conversación, o una tool bloqueada por el guardrail es la única forma de seguir (ej. el cliente pide algo que requiere una acción prohibida). Al dispararse: `Conversation.status = TRANSFERRED_TO_HUMAN`, `Conversation.assignedUserId` se completa (por ahora, el `ownerId` del `Contact` si tiene uno asignado; si no, sin asignar — un vendedor lo toma desde la bandeja de "Actividades"/"Mis tareas"), y se crea una `Activity` asociada al `Contact` — **reutiliza la infraestructura de `Activity` que ya existe**, no hace falta un mecanismo de notificación nuevo: la persona ve la conversación derivada exactamente donde ya mira sus tareas pendientes.

> **Nota del 12/09/2026 — decisiones tomadas al construir el paso 2b (loop de
> orquestación).** Cuatro cosas que esta sección y la 7 dejaban sin resolver y
> que hubo que decidir para poder escribir el loop y las primeras tools:
>
> 1. **A quién se le atribuye una `Opportunity` que crea el agente.**
>    `Opportunity.ownerId` es NOT NULL con FK a `User` — no puede quedar vacío,
>    y un agente de IA no es un `User`. Resolución: `create_opportunity` usa el
>    `ownerId` del `Contact` de la conversación (el vendedor ya asignado a ese
>    lead). Si el `Contact` no tiene `ownerId`, la tool falla con un error claro
>    ("no se puede crear la oportunidad: el contacto no tiene un vendedor
>    asignado") en vez de inventar un dueño — el modelo recibe ese error como
>    resultado de la tool y decide cómo seguir la conversación con eso. **Desde
>    el ítem 69 de `docs/frontend-cambios-pendientes.md` (20/09/2026)**, antes de
>    fallar se intenta el vendedor por defecto de la sucursal de la conversación
>    (`Branch.defaultOwnerId`), y si existe queda asignado al `Contact`; el error
>    de arriba es hoy el caso residual de una sucursal que no configuró ninguno. El
>    `contactId` de la oportunidad se toma SIEMPRE del `Contact` de la
>    conversación, nunca es un argumento que el modelo pueda elegir.
> 2. **A qué `pipelineId`/`stageId` va una `Opportunity` que crea el agente.**
>    Se usa el `Pipeline` con `isDefault = true` de la organización (la columna
>    ya existe, con índice único parcial que garantiza como máximo uno) y,
>    dentro de él, el `Stage` de menor `order` no borrado. Si la organización
>    no tiene un pipeline por defecto configurado, la tool falla con un error
>    claro — mismo criterio que el punto anterior, no se inventa nada.
>    `pipelineId`/`stageId`/`ownerId`/`contactId` NO son campos que el modelo
>    pueda pasar como argumento en `create_opportunity` — los resuelve el
>    wrapper, siempre. `update_opportunity` tampoco expone
>    `ownerId`/`contactId`/`pipelineId` en su schema hacia el modelo (un agente
>    de IA no debe poder reasignar el vendedor ni mover una oportunidad de
>    pipeline) — por eso el `actorUserId` de `updateOpportunity` es
>    efectivamente inerte en este camino: se le pasa el `ownerId` que la
>    oportunidad ya tiene.
> 3. **Alcance del handoff en este PR — NO es el mecanismo completo de esta
>    sección.** Lo único que implementa 2b es una red de seguridad
>    determinística: si el loop de tool-calling de un turno supera
>    `MAX_TOOL_ROUNDS_PER_TURN` (5) rondas sin que el modelo produzca una
>    respuesta final, el loop corta, pone `Conversation.status =
>    TRANSFERRED_TO_HUMAN`, persiste un mensaje de cierre fijo ("No pude
>    resolver tu consulta en este momento, alguien del equipo te va a
>    contactar.") y termina el turno — así el loop nunca queda colgado ni
>    miente con una respuesta inventada. Los otros disparadores de handoff que
>    describe esta sección (el contacto lo pide explícitamente, una
>    `condicionDeDerivacion` configurada coincide con el texto de la
>    conversación) y la notificación real a un humano (crear la `Activity`,
>    resolver `assignedUserId`) siguen siendo el paso 4 del plan, sin construir,
>    tal como ya estaba planeado — este PR no los adelanta.
> 4. **Interpretación de `guardrails.infoNoModificable` en
>    `puedeEjecutarTool`.** Los ejemplos de arriba son del tipo `Contact.email`
>    (formato `Entidad.campo`), pero no hay un mapeo tool→entidad en código.
>    Implementación: se descarta el prefijo antes del punto y se compara el
>    nombre de campo (case-insensitive) contra las claves de `args` de la tool
>    que se está por ejecutar. Es una simplificación deliberada, documentada acá
>    porque ninguna de las cuatro tools de este PR toca campos de `Contact`, así
>    que no se ejercita todavía — cuando `create_lead`/`update_lead` se
>    construyan (paso 3), es el primer lugar donde este chequeo importa de
>    verdad y donde conviene revisarlo.

> **Nota del 12/09/2026 — decisiones tomadas al construir el paso 5b (el
> endpoint público del canal Web, `POST /api/public/agents/:agentId/web/messages`).**
>
> 1. **Por qué la URL lleva un `:agentId` público aunque el token sea el
>    límite real de seguridad.** El diseño original consideraba resolver el
>    `Agent` únicamente por el embed token (sin `agentId` en la URL), por "más
>    limpio". Se descartó: el preflight CORS de un navegador (`OPTIONS`) NUNCA
>    lleva el valor real de un header custom, solo anuncia vía
>    `Access-Control-Request-Headers` que lo va a mandar. Sin un identificador
>    público en la URL, el servidor no tiene de dónde sacar `allowedOrigins`
>    para decidir el preflight. Por eso la ruta es
>    `POST /api/public/agents/:agentId/web/messages`: el `:agentId` es público
>    y solo sirve para la decisión de CORS; la autorización real sigue siendo
>    el embed token, que viaja en un header (`x-embed-token`, nunca en la URL,
>    mismo criterio que `x-api-key`) y cuyo propio `agentId` interno tiene que
>    coincidir con el de la URL (defensa contra un token de otro agente copiado
>    a la URL equivocada).
> 2. **CORS dinámico por agente, montado ANTES del CORS global de `app.ts`.**
>    El `cors()` global de `app.ts` es estático (una sola lista de orígenes) y,
>    montado con `app.use()` sin filtro de ruta, intercepta y termina CUALQUIER
>    preflight `OPTIONS` de la app antes de que llegue a otro middleware — así
>    que un segundo `cors()` montado después, sobre la ruta pública, nunca
>    correría para el preflight. La ruta del widget monta su propio middleware
>    de CORS (con un "options delegate", soportado por `cors@^2.8.5`, ya
>    confirmado instalado) ANTES del `cors()` global, resolviendo
>    `allowedOrigins` por el `:agentId` de la URL. Esto obliga a reordenar
>    `app.ts` (`pinoHttp` sube antes del `cors()` global, y el router público se
>    monta entre los dos).
> 3. **Rechazo único y genérico en la autenticación del token de embed**,
>    exactamente el mismo criterio que `resolveIngestContext`/`RECHAZO` para la
>    ingesta: header ausente, token inexistente, token revocado, agente
>    inactivo o borrado, `agentId` del token que no coincide con el de la URL, y
>    `Origin` ausente o no incluido en `allowedOrigins` — los siete casos
>    devuelven el mismo mensaje y el mismo 401, sin distinción observable. El
>    motivo real solo se loguea server-side. Es un endpoint público sin usuario
>    detrás; cualquier diferencia observable lo convierte en oráculo (enumerar
>    tokens válidos, dominios registrados, o si un agente existe).
> 4. **La validación de `Origin` en el POST real es independiente de si el
>    preflight pasó, y es intencional:** un cliente que nunca hace preflight
>    (server-to-server, un script con `fetch` sin CORS, `curl`) puede mandar el
>    POST directo con un `Origin` falsificado a mano. Esto NO es a prueba de un
>    atacante que ya tiene el token en la mano — solo un navegador real impide
>    que JavaScript de un sitio no autorizado falsifique su propio `Origin`. Es
>    el mismo límite conocido del modelo "site ID" de Intercom/Drift: la
>    defensa contra ese caso es el rate limit por token y la revocación, no el
>    `Origin`.
> 5. **Rate limit propio, por `embedTokenId`, más estricto que
>    `businessWriteRateLimiter`.** Es tráfico público no autenticado y cada
>    mensaje dispara una llamada real y paga a un LLM. Valores: ventana de 60 s,
>    máximo 20 requests — generoso para una conversación humana real (nadie
>    escribe más de un mensaje cada pocos segundos), estricto contra un script
>    en loop. Riesgo conocido, aceptado y no resuelto en este PR: el token es
>    público por diseño (vive en JS de cara al público), así que un token
>    filtrado o scrapeado permite evadir este límite repartiendo requests entre
>    muchas IPs distintas — un limiter por token no ve eso. Se documenta como
>    ítem nuevo en la sección 10 en vez de resolverse acá: resolverlo bien (ej.
>    límite adicional por combinación con huella de request, o un límite duro
>    por agente además del de por token) es trabajo especulativo hasta que haya
>    evidencia real de abuso.
> 6. **La respuesta del endpoint es una proyección mínima**, no el
>    `ResultadoDelTurno` completo que sí devuelve el endpoint ADMIN de prueba
>    (`POST /api/agents/:id/test-message`). Un visitante anónimo no tiene por
>    qué ver `toolCalls` (nombres de tools internas, argumentos, resultados) —
>    eso es superficie de implementación interna. La respuesta pública es
>    `{ conversationId, respuesta }` únicamente.

> **Nota del 12/09/2026 — decisiones tomadas al construir el paso 3
> (`create_lead`/`update_lead`).**
>
> 1. **Una sola función de servicio detrás de dos tools.** No hay una entidad
>    `Lead` separada — son columnas de `Contact` (comentario del schema). No
>    tiene sentido un "create" que falle si ya hay datos y un "update" que
>    falle si no los hay: sería un modelo pisándose contra un estado interno
>    que no puede observar de antemano. Las dos tools (`create_lead`,
>    `update_lead` — nombres que vienen del catálogo del documento de visión,
>    sección 6) llaman a la MISMA función `qualifyLead()` de
>    `contact.service.ts`, con descripciones distintas para orientar al modelo
>    sobre cuál usar, pero el comportamiento es idéntico e idempotente: cada
>    campo que el modelo envía se escribe, `leadNotes` siempre se agrega.
> 2. **`lifecycleStage` NO se toca.** Mismo criterio que ya usa la ingesta
>    (`promotion.service.ts`: "la ingesta no escribe lifecycleStage: al crear
>    queda el default LEAD y sobre un contacto existente no se toca",
>    `CAMPOS_IGNORADOS` en `ingestContact.schema.ts`) — es un campo que este
>    proyecto trata como de decisión humana, no de escritura automatizada.
>    `create_lead`/`update_lead` siguen el mismo precedente.
> 3. **`customFields` queda afuera del alcance de estas tools.** Son campos
>    configurables por vertical sin una definición de tipo formal todavía
>    (deferred desde PR #207) — el agente no tiene cómo saber qué campos
>    existen ni qué forma tienen. Se revisa cuando exista ese catálogo.
> 4. **`leadAiData` se mergea superficialmente, no se sobreescribe** — mismo
>    espíritu que `leadNotes`: es "cualquier dato sin columna propia" que se va
>    acumulando en distintas conversaciones. Claves nuevas pisan claves viejas
>    del mismo nombre; el resto del objeto anterior se conserva.
> 5. **Nombres de campo para `infoNoModificable`.** El chequeo (3) de
>    `puedeEjecutarTool` compara contra los ARGUMENTOS de la tool, así que el
>    nombre a listar es el del argumento (`Contact.budgetAmount`,
>    `Contact.score`, `Contact.notes`…), que es el de la columna sin el prefijo
>    `lead`; `Contact.leadBudgetAmount` no aplicaría. Cada nota que agrega
>    `qualifyLead` lleva un marcador `[AAAA-MM-DD]` al frente para que se pueda
>    distinguir de dónde vino cada una.

> **Nota del 12/09/2026 — decisiones tomadas al construir el paso 4 (handoff
> a humano completo).**
>
> 1. **A quién se le atribuye la `Activity` de una derivación.**
>    `Activity.authorId` es NOT NULL con FK a `User` — mismo problema que
>    `Opportunity.ownerId` en el paso 2b, misma resolución: se usa el `ownerId`
>    del `Contact` de la conversación (también como `assigneeId`, como ya
>    describía esta sección para `Conversation.assignedUserId`). Si el `Contact`
>    no tiene `ownerId`, NO se crea la `Activity` — se loguea un warning, pero la
>    transición de `Conversation.status` a `TRANSFERRED_TO_HUMAN` SIEMPRE ocurre
>    igual, porque es la garantía central (el agente deja de responder solo —
>    **ya no**: ver la nota del 22/09/2026 más abajo, ítem 83) y
>    no puede depender de que exista un vendedor asignado. Es una limitación
>    conocida, no un bug: un negocio con muchos contactos sin vendedor asignado
>    va a tener derivaciones silenciosas. Si eso importa en la práctica, la
>    solución natural es un "vendedor por defecto" por sucursal — no se
>    construye acá, es una decisión de producto aparte.
>
>    **RESUELTO el 20/09/2026 — ítem 69 de `docs/frontend-cambios-pendientes.md`.**
>    Esa decisión de producto se tomó y se construyó tal cual estaba propuesta:
>    `Branch.defaultOwnerId`, opcional, con `resolverOwnerDelContacto()`
>    (`src/services/ownership.service.ts`) compartida por este handoff y por
>    `create_opportunity`, que además PERSISTE la asignación en el `Contact`.
>    Lo de arriba sigue describiendo el comportamiento exacto de una sucursal
>    que no configuró ninguno, que es un estado válido y deliberadamente no
>    señalizado — no un pendiente.
> 2. **Cómo el modelo decide derivar, no solo el código.** Esta sección lista
>    cuatro disparadores; hasta ahora solo estaba construido uno (falla repetida
>    de tool-calling). Los otros tres —el contacto lo pide explícitamente, una
>    `condicionDeDerivacion` configurada coincide, una tool bloqueada es la
>    única forma de seguir— necesitan que el MODELO decida, porque son juicios
>    sobre el contenido de la conversación que el código no puede evaluar. Se
>    resuelven con una tool nueva, siempre disponible,
>    `request_human_handoff(reason)`, que el modelo puede llamar cuando
>    corresponda. Las instrucciones de cuándo usarla van en el system prompt
>    (ver punto 3). No pasa por `puedeEjecutarTool`: ni `accionesProhibidas`
>    ni ningún otro guardrail puede bloquear un pedido de derivación —
>    bloquear la salida de emergencia sería contradictorio con para qué sirve.
> 3. **`temasProhibidos` y `promesasProhibidas` de `guardrails` se incorporan
>    al system prompt por primera vez.** Estos dos campos existen en la forma
>    documentada de `guardrails` desde que se escribió esta sección, pero
>    ningún código los leyó nunca — `puedeEjecutarTool` solo chequea
>    `accionesProhibidas`/`infoNoModificable`/`datosRequeridosAntesDeAccion`,
>    que son gates de EJECUCIÓN de tools; `temasProhibidos`/`promesasProhibidas`
>    gobiernan lo que el modelo puede DECIR en texto libre, y la única forma de
>    hacer cumplir eso es que el modelo lo sepa de antemano. Mismo criterio para
>    `condicionesDeDerivacion`: se agregan al system prompt como instrucciones
>    explícitas ("si la conversación coincide con algo de esta lista, llamá a
>    `request_human_handoff`"), no como un chequeo de código que compare texto
>    contra una lista — es exactamente el tipo de juicio para el que sirve un
>    modelo de lenguaje y no un `string.includes`.
> 4. **La red de seguridad del paso 2b (tope de rondas) ahora también crea la
>    `Activity`.** Antes solo cambiaba `Conversation.status`; comparte la misma
>    función de ejecución de handoff que la tool nueva, con motivo "el agente
>    no pudo resolver el caso en el tiempo esperado".

> **Nota del 20/09/2026 — de dónde sale cada clave a partir del ítem 72** de
> `docs/frontend-cambios-pendientes.md`. La forma de `guardrails` documentada
> arriba **no cambió**, y las seis claves se siguen leyendo exactamente igual:
> `puedeEjecutarTool()` las tres de ejecución y `armarSystemPrompt()` las tres
> de prompt (punto 3 de la nota anterior). Lo que cambió es **quién escribe
> cada una**: la pantalla de "Reglas del agente" y su traducción por IA ahora
> producen solo `accionesProhibidas`, `infoNoModificable` y
> `datosRequeridosAntesDeAccion` — las tres que son un candado de código. Las
> otras tres se escriben en texto libre en el campo `instructions` del agente,
> porque iban al prompt con exactamente la misma fuerza que ese campo y la
> traducción intermedia no compraba nada.
>
> **No hubo migración de datos.** Los agentes que ya tienen `temasProhibidos`,
> `promesasProhibidas` o `condicionesDeDerivacion` guardados los conservan y
> siguen rigiendo; `updateAgent()` las preserva en cada guardado
> (`preservarGuardrailsHeredados` en `src/services/agent.service.ts`), porque
> el formulario manda el objeto entero en cada PATCH y sin esa fusión un
> guardado posterior las habría borrado en silencio. Un `guardrails` armado a
> mano contra la API puede seguir trayendo las seis.

> **Nota del 22/09/2026 — qué calla al agente, a partir del ítem 83** de
> `docs/frontend-cambios-pendientes.md`. Esta sección decía que la garantía
> central del handoff era que **el agente deja de responder**, y el código lo
> implementaba cortando el turno cuando `Conversation.status ===
> TRANSFERRED_TO_HUMAN`. Nada revierte ese status, así que cada derivación era
> un silencio **permanente**: un handoff disparado por un motivo transitorio
> —una tool que falló por una regla de negocio que después se arregló— dejaba
> al agente mudo para siempre en ese hilo, con el contacto escribiendo al
> vacío. Pasó de verdad, en producción, y el ítem 83 tiene el caso.
>
> **Lo que se desacopló.** "Avisar a una persona" y "callar al agente" eran lo
> mismo y ahora son dos cosas:
>
> - `request_human_handoff` hace **solo** lo primero: `assignedUserId`, la
>   `Activity` de aviso y el brief, exactamente como antes. También sigue
>   poniendo `status = TRANSFERRED_TO_HUMAN`, pero ese status pasa a
>   significar **"hay una notificación pendiente para un vendedor"** y no
>   "el agente se calló".
> - El gate del loop (`runAgentTurn`) es ahora **"¿existe algún `Message` con
>   `senderType = HUMAN` en esta conversación?"** (`hasHumanMessage`). Hasta
>   que una persona escriba, el agente sigue atendiendo lo que pueda.
>
> **La garantía de fondo no se aflojó, se corrigió.** Lo que hay que evitar es
> que el agente y la persona le hablen al contacto al mismo tiempo, y eso
> empieza cuando la persona habla, no cuando se la avisa. Mientras nadie tomó
> la conversación, que el agente siga contestando es estrictamente mejor que
> el silencio: el aviso ya está dado y el contacto no queda solo.
>
> **Por qué `Message.senderType` y no un campo nuevo en `Conversation`:** "hay
> un humano interviniendo" ya tiene fuente de verdad en los datos, y derivarlo
> de ahí no se puede desincronizar. Una columna booleana habría que acordarse
> de escribirla en cada lugar que mande un mensaje, y el día que alguien se
> olvide el agente le habla encima a una persona. El gate mira el hilo entero
> y no la ventana de contexto de §10 — un humano que escribió hace 21 mensajes
> intervino igual —, y **cualquier** mensaje `HUMAN` alcanza: una vez que una
> persona entró al hilo, el hilo es suyo.
>
> **Limitación conocida, no un pendiente disimulado: hoy ningún flujo de
> producción escribe un `Message` con `senderType = HUMAN`.** No existe
> todavía un endpoint para que un vendedor conteste desde el CRM — la bandeja
> del ítem 66 es de solo lectura a propósito —, así que en la práctica el gate
> está construido y probado pero nunca se dispara solo, y el agente no se
> calla nunca. Es el resultado buscado por ahora (el problema era el silencio,
> no el exceso de respuestas), y el día que exista "responder desde el CRM",
> persistir ese `Message` es todo lo que hace falta para que el agente se
> aparte: no hay que tocar el loop.
>
> **Lo que NO cambió:** los disparadores de derivación (cuándo el modelo llama
> a la tool) son los mismos; `CLOSED` sigue siendo el único status que da
> lugar a una conversación nueva; `findOpenConversation` sigue contando
> `TRANSFERRED_TO_HUMAN` como abierta; y `ejecutarHandoff` sigue siendo
> idempotente por status — que ahora es solo "no notificar dos veces".

**La restricción de cumplimiento de Meta (documento de visión, roadmap 2.2) se aplica estructuralmente, no como un guardrail más que un admin pueda desactivar.** El catálogo de tools de la sección 7 solo incluye acciones de negocio acotadas (calificar, agendar, crear oportunidades, links de pago) — no existe ninguna tool de "responder cualquier cosa", así que un agente no puede convertirse en un asistente de propósito general aunque un admin deshabilite todos los guardrails configurables. Es una propiedad del catálogo de tools, no de la configuración.

## 7. Tools del agente de IA — estado real

| Tool | Depende de | Estado |
| --- | --- | --- |
| `create_opportunity()` / `update_opportunity()` | `opportunity.service.ts` | **Construida (paso 2b, 12/09/2026)** — wrapper fino en `src/services/agentTools.service.ts` sobre el service existente. Ver la nota fechada bajo la sección 6 sobre qué resuelve el wrapper y qué NO puede elegir el modelo. Desde el ítem 84 (22/09/2026) `create_opportunity` no duplica: si el contacto ya tiene una oportunidad `OPEN`, devuelve la más reciente con `reused: true` en vez de crear otra. |
| `get_availability()` / `create_booking()` | Módulo de Booking (`docs/booking-architecture.md`) | **Construida (paso 2b, 12/09/2026)** — wrapper fino en `src/services/agentTools.service.ts` sobre `availability.service.ts` / `booking.service.ts`. `contactId` de la reserva sale siempre de la conversación. |
| `create_lead()` / `update_lead()` | `Contact.leadScore`/etc. (PR #207) | **Construida (paso 3, 12/09/2026)** — las dos tools llaman a la misma `qualifyLead()` de `contact.service.ts`, idempotente; `leadNotes` se agrega y `leadAiData` se mergea, nunca se pisan. Ver la nota fechada del paso 3 bajo la sección 6. |
| `send_message()` | Integración de WhatsApp | Bloqueada — fuera de alcance de este documento (sección 2). |
| `create_payment_link()` | Módulo de Pagos (2.3) | Bloqueada — pasarela sin elegir. |
| `get_payment_info()` | `Branch.paymentLinkUrl` / `Branch.bankTransferDetails` | **Construida (ítem 74 de `docs/frontend-cambios-pendientes.md`, 21/09/2026)** — NO reemplaza a `create_payment_link()`, que sigue sin construirse: devuelve un link de pago fijo y/o datos de transferencia cargados a mano por sucursal. Solo lectura, sin parámetros. Cuándo compartir el detalle está en la descripción de la tool, no en código. |
| `get_contact_info()` / `search_vehicles()` / `get_service_types()` / `get_contact_activities()` | `contact.repository.ts` / `vehicle.repository.ts` / `serviceType.repository.ts` / `activity.repository.ts` | **Construidas (ítem 85 de `docs/frontend-cambios-pendientes.md`, 22/09/2026)** — las primeras tools de solo lectura del catálogo, mismo patrón fino que `get_payment_info()`. Contacto y sucursal salen del contexto; cada una devuelve un `select` a mano, nunca la fila entera. `search_vehicles` fija `status: AVAILABLE` + `publishOnWebsite: true` sin que el modelo los pueda pisar, y nunca devuelve costos, precio mínimo ni datos de consignación. |

## 8. Costos

El costo real depende del proveedor de LLM elegido (sección 10, sin decidir) y del volumen/largo de conversación — no tiene sentido inventar un número acá antes de esa decisión. Lo que sí es estable independientemente del proveedor: el costo por conversación va a estar dominado por el tamaño del contexto que se le pasa al modelo en cada turno (system prompt + historial de mensajes + definiciones de tools), que es exactamente la ventana de contexto que la sección 10 deja como decisión abierta.

## 9. Plan de implementación sugerido

1. Schema: `Agent`/`Conversation`/`Message` + migración (esta es la base de todo lo demás).
2. Dividido en dos PRs, el segundo depende del primero:
   - **2a. Fundamentos:** interfaz `LlmProvider` abstracta + un primer adaptador concreto (OpenRouter — ver la decisión en la sección 10) + CRUD administrativo de `Agent` (`/api/agents`, sección 5). Sin loop todavía: deja el proveedor y la configuración del agente listos para que 2b los use.
   - **2b. Loop de orquestación:** capa de permisos (`puedeEjecutarTool`) + el loop completo de la sección 4 + `create_opportunity()`/`update_opportunity()` y `get_availability()`/`create_booking()` como primeras tools reales (son las dos que no necesitan construir nada nuevo debajo) + un endpoint interno de prueba para ejercitarlo antes de que exista el canal Web público. **Construido (12/09/2026):** `agentPermissions.service.ts`, `agentTools.service.ts`, `agentOrchestration.service.ts`, repositorios de `Conversation`/`Message` y `POST /api/agents/:id/test-message`. Las decisiones que hubo que tomar al construirlo están en la nota fechada bajo la sección 6. Sobre ese endpoint se construyó después el Playground del CRM (`/agents/:id/playground`, ítem 65 de `docs/frontend-cambios-pendientes.md`) — ver `docs/agent-testing-scenarios.md` para la checklist de prueba antes de habilitar un agente en un canal real.
3. `create_lead()`/`update_lead()` — extender `contact.service.ts` para escribir los campos de calificación, con la lógica de "agregar, no pisar" de `leadNotes`. **Construido (12/09/2026):** `qualifyLead()` en `contact.service.ts` y las dos tools en `agentTools.service.ts`. Decisiones en la nota fechada del paso 3 bajo la sección 6.
4. Mecanismo de handoff a humano (ya diseñado en la sección 6, reusa `Activity`).
5. Endpoint público del canal Web (sección 5) — el widget embebido real. **Construido (12/09/2026)**, en dos PRs: **5a** (schema y administración del token de embed: `AgentEmbedToken`, `Agent.allowedOrigins`, `utils/agentEmbedToken.ts`, `utils/origin.ts`, `agentEmbedToken.repository/service/controller/routes`) y **5b** (el endpoint público `POST /api/public/agents/:agentId/web/messages`: `types/widgetAuth.ts`, `services/widgetAuth.service.ts`, `middlewares/authenticateEmbedToken.ts`, `middlewares/widgetCors.ts`, `middlewares/widgetBody.ts`, `widgetRateLimiter` en `middlewares/rateLimit.ts`, `services/widgetContact.service.ts`, `controllers/publicWidget.controller.ts`, `routes/publicWidget.routes.ts`, y el reordenamiento de `app.ts` para montar el CORS del widget antes del global). Decisiones en la nota fechada del paso 5b bajo la sección 6 y en la nota del canal Web de la sección 10. El script embebible (`<script>`) del lado del sitio del cliente sigue siendo un desarrollo de frontend aparte.

   > **Nota del 13/09/2026 — decisiones tomadas al construir el script
   > embebible (el widget del canal Web, `frontend/src/widget/`).**
   >
   > 1. **Vive en `frontend/`, como un segundo entry point de build, no un
   >    paquete ni un repo nuevo.** Reusa el mismo deploy de Vercel que ya
   >    existe — sin dominio nuevo, sin CDN propia, sin CI aparte. Es la
   >    elección pragmática para esta etapa (cero clientes reales embebiendo
   >    el widget todavía, cero evidencia de que haga falta algo más
   >    sofisticado) — no una afirmación de que así va a quedar para siempre.
   >    Si el día de mañana hace falta una CDN dedicada con versionado, es una
   >    migración de infraestructura, no un rediseño del script en sí.
   > 2. **Build separado del de la SPA, en modo librería, sin hash en el
   >    nombre del archivo.** La SPA (`vite build`) emite assets con hash en
   >    el nombre (`index-a1b2c3.js`) porque `index.html` los referencia
   >    dinámicamente en cada deploy — pero el snippet que un negocio pega en
   >    SU sitio es texto estático que no se regenera solo; si el archivo
   >    cambiara de nombre en cada deploy, cada cliente embebido se rompería
   >    en el próximo deploy de la SPA. Por eso el widget es un config de Vite
   >    aparte (`frontend/vite.widget.config.ts`), en modo `build.lib`,
   >    formato IIFE, que emite siempre `dist/widget.js` a secas, al MISMO
   >    `dist/` que ya genera la SPA (`emptyOutDir: false` en el segundo
   >    build, para no comerse el resultado del primero).
   > 3. **`frontend/package.json`: el script `build` corre los dos builds
   >    encadenados** (`tsc -b && vite build && vite build --config
   >    vite.widget.config.ts`). Así el job `frontend` del CI (que ya corre
   >    `npm run build`) valida el widget automáticamente, sin tocar
   >    `.github/workflows/ci.yml`.
   > 4. **Vercel sirve `widget.js` como archivo estático de verdad**, sin que
   >    lo intercepte el rewrite catch-all de `frontend/vercel.json`
   >    (`/(.*)` → `/index.html`): el comportamiento por defecto de Vercel es
   >    que un archivo que existe en el build gana sobre cualquier rewrite.
   >    Esto se verifica de verdad contra el deploy real después de mergear
   >    (`curl -I https://<dominio-de-vercel>/widget.js` tiene que devolver
   >    `content-type: application/javascript` o similar, nunca `text/html`)
   >    — no alcanza con asumirlo. **Resultado de la verificación:**
   >    pendiente — se completa acá mismo cuando se haga contra el deploy
   >    real, después del merge.
   > 5. **El widget NO importa `src/config/env.ts` ni `src/lib/api.ts` de la
   >    SPA, a propósito.** `env.ts` valida las cuatro variables de la SPA al
   >    importarse (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
   >    `VITE_API_URL`, `VITE_QR_PUBLIC_BASE_URL`) — importarlo desde el
   >    widget acoplaría su build a variables de Supabase que no usa para
   >    nada. `api.ts` asume sesión de usuario (Bearer JWT, un
   >    `unauthorizedHandler` que cierra sesión en un 401) — semántica que no
   >    aplica: el widget no tiene usuario, y un 401 acá significa "token de
   >    embed inválido o dominio no autorizado", no "tu sesión venció". El
   >    widget lee `import.meta.env.VITE_API_URL` directo (Vite carga el mismo
   >    `.env` para cualquier config en la raíz del paquete, así que la
   >    variable está disponible igual) con su propia normalización mínima, y
   >    tiene su propio wrapper de `fetch`, sin compartir código con
   >    `lib/api.ts`.
   > 6. **Configuración por instancia vía atributos `data-*` del propio
   >    `<script>`** (`data-agent-id`, `data-embed-token`, `data-api-url`
   >    opcional, `data-primary-color` opcional), leídos de
   >    `document.currentScript` en el tope del módulo, de forma síncrona —
   >    es lo que hace que funcione aunque el script se cargue con `async`
   >    (el navegador puede diferir CUÁNDO se ejecuta el script, pero una vez
   >    que arranca, su código de nivel superior corre de un tirón;
   >    `document.currentScript` sigue apuntando al script correcto mientras
   >    se lo lea ahí, antes de cualquier `await`).
   > 7. **Aislamiento visual con Shadow DOM** (`attachShadow({ mode: "open" })`):
   >    los estilos del widget no se filtran al sitio del cliente y viceversa.
   >    Sin librería de CSS-in-JS: los estilos van como un string de CSS plano
   >    inyectado en un `<style>` dentro del shadow root. Color de acento
   >    configurable vía la custom property `--widget-accent`
   >    (`data-primary-color` la setea inline en el host element).
   > 8. **`sessionId` en `localStorage`, scopeado por `agentId`** dentro del
   >    mismo origen (por si una página llegara a embeber dos agentes
   >    distintos — no es el caso pensado, pero es gratis evitarlo). Si
   >    `localStorage` no está disponible (modo privado, storage bloqueado),
   >    el `sessionId` vive en memoria para esa carga de página: se pierde la
   >    continuidad entre recargas, pero el chat funciona.
   > 9. **Limitación conocida y aceptada, documentada a propósito y no
   >    resuelta acá: no hay forma de recuperar el historial de una
   >    conversación anterior al recargar la página.** El endpoint público
   >    (5b) es de solo escritura — no existe un GET de mensajes. El widget
   >    solo muestra lo que pasó en la pestaña actual desde que se abrió.
   >    Resolverlo (un GET de historial, protegido por el mismo embed token +
   >    el `sessionId` como prueba de que sos el mismo visitante) es trabajo a
   >    futuro si hace falta evidencia real de que los usuarios recargan la
   >    página en medio de una conversación — no se construye
   >    especulativamente ahora.
   > 10. **Sin pantalla en el CRM para copiar el snippet. RESUELTO el
   >     19/09/2026 — ver el cierre de este punto.** No existía todavía
   >     ningún `frontend/src/features/agent*` — el módulo de Agentes de IA no
   >     tenía UI de administración en absoluto (a diferencia de casi todos
   >     los demás módulos del backend, que sí la tienen). Armar una pantalla
   >     que genere el snippet sin que exista el resto de la administración de
   >     Agentes (crear agente, configurar guardrails, ver conversaciones)
   >     sería una pantalla huérfana. Por ahora el `<script>` se arma a mano
   >     con los datos que ya devuelve el CRUD admin existente
   >     (`POST /api/agents`, `POST /api/agents/:id/embed-tokens`, ambos de
   >     5a). Queda anotado como trabajo futuro, no en el alcance de este PR.
   >
   >     **Resuelto el 19/09/2026 (ítem 63 de
   >     `docs/frontend-cambios-pendientes.md`).** La condición que faltaba se
   >     cumplió: el módulo de Agentes ya tiene UI de administración desde el
   >     ítem 55. `frontend/src/features/agent/AgentEmbedPage.tsx`
   >     (`/agents/:id/embed`, dentro de `AdminRoute`) administra los tres
   >     pasos de la instalación —los dominios permitidos vía `PATCH
   >     /api/agents/:id`, los tokens de embed vía el CRUD de 5a, y el
   >     `<script>` listo para copiar— sin una sola ruta nueva del backend ni
   >     cambios de esquema. El dominio del `src` sale de
   >     `window.location.origin` y no de una constante, justamente por la
   >     decisión 2 de esta misma nota: el widget se sirve del mismo `dist/`
   >     que la SPA, así que el origen desde el que se ve el CRM es por
   >     construcción el correcto.
   > 11. **Sin retry automático ante fallo de red.** Cada mensaje dispara una
   >     llamada real y paga a un LLM; reintentar solo automáticamente podría
   >     duplicar mensajes o cobrar dos veces si el POST llegó a procesarse
   >     pero la respuesta no volvió. Ante un error de red o 5xx, el widget
   >     muestra un botón de "Reintentar" que el visitante dispara a mano —
   >     nunca un retry silencioso.
   > 12. **Sin branding propio del producto en el widget** ("Powered by ...").
   >     Es una elección conservadora para un producto B2B que se embebe en el
   >     sitio de OTRO negocio — el default es blanco, sin atribución. Fácil de
   >     agregar después si en algún momento se decide lo contrario; no es una
   >     decisión difícil de revertir.
   >
   > **Construido (13/09/2026):** `frontend/src/widget/config.ts` (lectura y
   > validación de los `data-*`), `session.ts` (`sessionId` en
   > `localStorage`), `api.ts` (`sendWidgetMessage` + `WidgetApiError` con
   > categoría), `styles.ts` (CSS plano), `ui.ts` (Shadow DOM, burbuja,
   > panel, mensajes, "escribiendo...", error con reintento), `main.ts`
   > (entry point, flag de idempotencia `window.__plataformaCrmWidgetLoaded`),
   > sus tests (`*.test.ts` + `frontend/src/test/msw/widgetHandlers.ts`),
   > `frontend/vite.widget.config.ts` y el script `build` de
   > `frontend/package.json`.
6. Integración de WhatsApp, cuando el trámite de Meta/Twilio esté resuelto — reusa el mismo loop ya probado en el paso 2, sin rediseñarlo.
7. Conectar el motor de automatizaciones (acción "iniciar acción de IA") — depende de que ese motor exista, que es un módulo aparte.
8. `create_payment_link()` — al final, cuando haya un pack que lo justifique (Pack Turnos, si se prioriza la seña anti no-show).

## 10. Decisiones abiertas / pendientes

- **Proveedor de LLM inicial** — **Resuelta el 12/09/2026: OpenRouter como primer adaptador.** No porque el producto final vaya a usar OpenRouter para siempre, sino porque expone una API compatible con el formato de OpenAI (chat completions + tool-calling) que rutea a decenas de modelos y proveedores distintos, varios gratuitos. Rocco pidió explícitamente que el sistema pueda funcionar con cualquier proveedor de IA: la interfaz `LlmProvider` (`src/services/llmProvider.service.ts`, paso 2a) es la pieza que lo garantiza — el loop de orquestación del paso 2b nunca importa nada específico de OpenRouter, solo la interfaz — y usar OpenRouter como primer adaptador permite arrancar gratis y cambiar de modelo o de proveedor después cambiando configuración (`OPENROUTER_MODEL`, `Agent.modelName`), no código. Un segundo adaptador (Anthropic, OpenAI, Google directo) es un archivo nuevo que implementa la misma interfaz.
- **Ruteo entre varios `Agent` activos de la misma sucursal** — hoy no es un problema real porque el plan de implementación solo crea un "Agente comercial" por sucursal; se resuelve cuando alguien de verdad necesite un segundo agente.
- **Diseño exacto del endpoint público del canal Web** — **Resuelta el 12/09/2026** (paso 5, dividido en 5a —schema y administración del token de embed— y 5b —el endpoint público en sí, que depende de 5a). Se investigó el código real antes de decidir: el `ApiKey` existente (`src/utils/apiKey.ts`, modelo `ApiKey`) es de mayor privilegio, está scopeado a `(organizationId, sourceId)` sin noción de sucursal, y su service (`ingest.service.ts`) no toca `Contact` directamente — no sirve para esto sin modificarlo, así que se crea un mecanismo nuevo, paralelo, de menor privilegio.
  1. **Modelo de confianza del widget: token público de baja privilegio, no secreto de sesión.** Mismo criterio que el "site ID" de Intercom/Drift — la seguridad no depende de que el token sea secreto (va a estar en el HTML/JS público del sitio del cliente), depende de tres cosas juntas: (a) el token solo puede escribir mensajes al loop de orquestación, nunca leer nada del CRM; (b) rate limit agresivo por token, mucho más estricto que `businessWriteRateLimiter`, porque es tráfico público no autenticado y cada mensaje cuesta una llamada real a un LLM; (c) el `Origin` del request tiene que coincidir con un dominio registrado para ese `Agent` (`Agent.allowedOrigins`) — un token filtrado sin el dominio correcto no sirve para nada.
  2. **Modelo nuevo `AgentEmbedToken`, paralelo a `ApiKey` y no una extensión de él** — mismo shape (hash + prefix, no el token en texto plano; múltiples tokens activos por `Agent` para poder rotar sin downtime: generar el nuevo, actualizar el widget, revocar el viejo), pero scopeado a `(organizationId, agentId)` en vez de `(organizationId, sourceId)`, porque el widget es por sucursal/agente, no por fuente de ingesta. Prefijo `embed_` en el token para distinguirlo de una `crm_` a simple vista en un log o en la UI. Administración ADMIN-only en `POST/GET /api/agents/:id/embed-tokens` y `DELETE /api/agents/:id/embed-tokens/:tokenId`, mismo patrón que `apiKey.routes.ts`.
  3. **`Agent.allowedOrigins`** — array de orígenes (`https://ejemplo.com`, sin path). Vacío significa que el widget de ese agente está completamente deshabilitado — nadie puede escribirle hasta que un ADMIN registre al menos un dominio. Fail-closed a propósito: un agente recién creado no debe ser accesible desde cualquier origen por descuido.
  4. **Contact anónimo: placeholder automático, sin fusión posterior.** `firstName: "Visitante"`, `lastName` un identificador corto derivado del `sessionId` de esa visita (para que no todos se vean idénticos en el CRM). El navegador genera y guarda ese `sessionId` (`crypto.randomUUID()`, en `localStorage`) y lo manda en cada mensaje — eso es lo que permite reencontrar la misma conversación (y el mismo `Contact`) dentro de la misma visita/navegador. Limitación conocida y aceptada: sin cookies/`localStorage`, o desde otro dispositivo, es un `Contact` nuevo. No hay mecanismo de fusión con un `Contact` existente aunque el visitante dé el mismo email después — `create_lead`/`update_lead` (paso 3, ya construidos) completan el nombre real sobre ESE `Contact` placeholder, no lo reemplazan por otro.
  5. **Fuera de alcance de este documento:** el script embebible real que un negocio pega en su sitio (`<script>`) es un desarrollo de frontend aparte — acá se construye el endpoint del backend que ese script va a llamar.
- **Tamaño de la ventana de contexto** — **Resuelta el 12/09/2026: los últimos 20 `Message` de la `Conversation`, truncado simple.** Si hay más de 20, se descartan los más viejos; sin resumen todavía. Se revisa si hace falta algo más sofisticado (resumen, ventana por tokens) cuando haya conversaciones reales de ese largo — hoy no las hay, y diseñar un resumen sobre conversaciones hipotéticas sería trabajo especulativo.
- **Rate limiting propio del loop del agente** — además del rate limiter genérico que ya usa el resto de las rutas de escritura (`businessWriteRateLimiter`), una llamada a un LLM es mucho más cara que un CRUD típico y probablemente necesita su propio límite — a evaluar cuando se implemente el paso 2 del plan.
- **Rate limiting del embed token filtrado, multi-IP** — pendiente, sin resolver (paso 5b, nota fechada bajo la sección 6, punto 5). El rate limit del widget cuenta por `embedTokenId` (60 s / 20 requests), y el token es público por diseño: vive en el JavaScript del sitio del cliente. Un token filtrado o scrapeado permite repartir requests entre muchas IPs distintas y un limiter por token no ve eso; tampoco serviría uno por IP (este proyecto no configura `trust proxy`, y detrás de un proxy `req.ip` es la IP del proxy para todos). Candidatos si aparece evidencia real de abuso: un límite duro adicional por `agentId` además del de por token, o una huella de request que combine varios headers. No se construye antes de esa evidencia: hoy la defensa es la revocación del token (rotar sin downtime, 5a) y el costo acotado de cada request rechazado.
- **Knowledge Base / RAG** — sección 8 del documento de visión, sin diseñar. Cuando se aborde, probablemente sea un documento propio, mismo criterio que este.
- **Contexto de negocio por cliente (documento de referencia)** — **Implementado el 19/09/2026** como el ítem 59 de `docs/frontend-cambios-pendientes.md`, que tiene el detalle completo. La idea original era un campo de texto libre (tipo `.md`) con el contexto del negocio de cada cliente —servicios, políticas, catálogo, preguntas frecuentes— probablemente en `Organization` o en `Branch`, para que los agentes tuvieran ese contexto sin derivarlo de otras tablas en cada turno. Se construyó con tres decisiones que cambian esa forma:
  1. **Entidad propia `KnowledgeBaseEntry`, branch-scoped, no un campo** — mismo alcance que `Agent` (horarios y políticas son de la sucursal, no de la cuenta), con `organizationId` + `branchId`, soft delete e `isActive`.
  2. **Una LISTA DE ENTRADAS CON TÍTULO, no un campo único** — cada entrada es una FAQ, una política o un dato suelto ("Horarios", "Política de cancelación"), editable por separado. Es más mantenible a medida que crece, y deja preparado el terreno para el día que esto se indexe de verdad (el bullet de Knowledge Base / RAG de acá arriba): cada entrada ya es la unidad natural para trocear y embeber. **Ese día no es hoy:** esta primera versión es texto plano que se suma al prompt, sin embeddings, sin búsqueda semántica y sin ninguna dependencia nueva.
  3. **Inclusión automática en TODOS los agentes de la sucursal, sin toggle por agente** — hoy hay un agente por sucursal y un toggle sería configuración sin beneficio. Si algún día hay varios agentes con roles distintos, el toggle se agrega ahí.

  Cómo se engancha: `armarSystemPrompt()` (`agentOrchestration.service.ts`) recibe las entradas como CUARTO PARÁMETRO y **sigue siendo pura** — no consulta la base. Quien lee es `runAgentTurn`, una vez por turno, con `findActiveKnowledgeBaseEntriesByBranch(agent.branchId, organizationId)`. El bloque va después de `agent.instructions` y **antes** de los guardrails: es contexto informativo, no una regla. Sin entradas activas, el bloque no aparece — mismo criterio que `temas`/`promesas`/`condiciones`. `puedeEjecutarTool` no se tocó: esto es contexto de lectura, no una acción ni un permiso.
