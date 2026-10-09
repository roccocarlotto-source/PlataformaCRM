# Ediciones: COMPLETA y ESENCIAL

> Documento de diseño. Estado: **propuesta, sin código**. Fecha: 2026-10-09.
> Nada de lo descrito acá existe todavía; las referencias `archivo:línea` son al
> código de `master` en el merge de #448 y sirven para ubicar dónde se tocaría.

## 0. Por qué

Un referente del sector automotor uruguayo señaló dos cosas:

1. La plataforma completa, tal como está, probablemente no funcione en Uruguay
   (demasiado producto para el tamaño y la forma de trabajar de las
   automotoras).
2. Quien compra autos allá es gente mayor que rechaza a la IA. Si la IA hace
   todo el proceso, no va a funcionar; algunas empresas van a querer **menos
   participación de la IA**.

La respuesta tiene dos partes que conviene no mezclar:

- **Edición** (qué módulos tiene la organización): una segunda edición más
  simple, `ESENCIAL`, en el mismo código, el mismo deploy y el mismo dominio.
  La edición actual pasa a llamarse `COMPLETA` y **no cambia en nada**.
- **Nivel de participación de la IA** (cuánto hace el agente con el cliente):
  un ajuste del agente, **disponible en las dos ediciones**. Es lo que ataca el
  punto 2. Que sea independiente de la edición es una decisión de diseño: una
  automotora en `COMPLETA` también puede querer menos IA, y una en `ESENCIAL`
  puede querer la IA respondiendo sola.

---

## 1. Modelo

### 1.1 Edición de la organización

```prisma
enum OrganizationEdition {
  COMPLETA
  ESENCIAL
}

model Organization {
  // ...
  edition OrganizationEdition @default(COMPLETA)
}
```

- **Nombre del valor: `ESENCIAL`.** No dice "solo agentes" ni "lite": describe
  un producto con lo esencial de una automotora (atención, contactos, stock,
  agenda) y deja la IA como algo que se regula, no como el centro. Alternativas
  en la pregunta abierta P1.
- **Existentes:** la migración agrega la columna con `DEFAULT 'COMPLETA'`, así
  que todas las organizaciones actuales quedan en `COMPLETA` sin backfill.
- **Quién la elige:** el platform admin, en **Plataforma → Nueva
  organización** (`POST /api/admin/organizations`, hoy con `organizationName`,
  `adminFullName`, `adminEmail` en `organizationAdmin.controller.ts:20-35`).
  Se suma `edition`, obligatorio en el formulario (sin valor preseleccionado,
  para que sea una decisión consciente) y opcional en la API con default
  `COMPLETA` por compatibilidad.
- **Quién la cambia:** solo el platform admin, con una ruta nueva
  `PATCH /api/admin/organizations/:organizationId/edition`
  (`requirePlatformAdmin`, como el resto de `/admin/organizations`).
  - **Permitido:** `ESENCIAL → COMPLETA`.
  - **Fuera de alcance:** `COMPLETA → ESENCIAL`. La ruta responde 409. Bajar
    de edición deja datos huérfanos (cotizaciones, pagos, procesos de venta
    configurados) y merece un diseño propio si algún día hace falta.
  - El ADMIN de la organización **no** la ve como editable en
    `/organization`: la ve como dato de solo lectura.
- **Caché de autenticación:** la edición viaja en `AuthContext` (ver §5.2) y
  ese contexto se cachea por usuario (`authContextCache.ts`, TTL
  `AUTH_CONTEXT_CACHE_TTL_MS`). El cambio de edición es raro y lo hace una
  sola persona: después del `UPDATE` se llama a `vaciar()`
  (`authContextCache.ts:33`). Sin eso, el upgrade tardaría hasta el TTL.

### 1.2 Nivel de participación de la IA

Va en `Agent`, no en `Organization` (ver §4 y la pregunta P2):

```prisma
enum AgentParticipation {
  AUTONOMA          // (a) responde sola, como hoy
  PRIMER_CONTACTO   // (c) toma datos y deriva rápido; opcionalmente solo fuera de horario
  SOLO_SEGUIMIENTO  // (d) no conversa con el cliente; deriva todo a una persona
  BORRADOR          // (b) redacta y una persona aprueba (fase 2, ver §4.4)
}

model Agent {
  // ...
  participation          AgentParticipation @default(AUTONOMA)
  onlyOutsideBusinessHours Boolean          @default(false) // solo con PRIMER_CONTACTO
}
```

`BORRADOR` se agrega recién en la fase 2. Un valor de enum que el backend
todavía no sabe ejecutar es una trampa.

---

## 2. Qué entra en cada edición

`COMPLETA` = todo lo que existe hoy, sin cambios. La tabla describe `ESENCIAL`.

| Módulo | ESENCIAL | Notas |
|---|---|---|
| Agentes de IA (+ probador, embed, guardrails) | ✅ | Con nivel de participación (§4). |
| Canales: WhatsApp, web, Messenger, Instagram (+ conexión Meta, plantillas de WhatsApp) | ✅ | |
| Base de conocimiento | ✅ | `sync-vehicles` incluido (el stock entra). |
| Conversaciones: bandeja, responder, derivar, devolver al agente, aviso si nadie responde | ✅ | |
| Contactos, con "Clientes" y "Consultas sin identificar" | ✅ | Sin empresa (ver abajo). |
| Usuarios, invitaciones | ✅ | |
| Sucursales, horarios | ✅ | Incluye Google Calendar de la sucursal. |
| Importación de datos (platform admin) | ✅ | Sin la entidad "empresas" (§2.2). |
| Stock de vehículos | ✅ | Sin permutas. |
| Tareas (actividades) | ✅ | |
| Seguimiento automático de consultas y "sin interés" (#446) | ✅ | |
| Agenda / test drive (recursos, servicios, turnos) | ✅ | "Test drive" es un `ServiceType`, no una entidad. |
| Cupones y QR de reseñas | ✅ | Disparador: venta registrada (§3). |
| Dashboard | ✅ simple | Endpoint nuevo de atención (§6.4). |
| Oportunidades | ✅ mínima | Lista simple, sin procesos de venta configurables (§2.1). |
| Procesos de venta y etapas (`/pipelines`, `/stages`) | ❌ | Existe un proceso fijo, invisible (§2.1). |
| Cotizaciones | ❌ | |
| Pagos (registro de pagos de una oportunidad) | ❌ | `get_payment_info` del agente no es este módulo (§5.3). |
| Entregas | ❌ | Ver §2.1, "Ganar sin entregas". |
| Permutas | ❌ | |
| Financiación (columnas de la oportunidad) | ❌ | |
| Empresas | ❌ | No es inseparable de contactos (§2.2). |
| Campos personalizados | ✅ recomendado | Dudoso, analizado en §2.3. |
| Agente interno | ✅ opt-in, recomendado | Dudoso, analizado en §2.4. |
| Fuentes / API keys / eventos de ingesta (webhook de landing) | ✅ recomendado | No estaba en la lista; ver P8. |

### 2.1 Oportunidades mínimas (opción B)

**El problema.** `Opportunity.pipelineId` y `stageId` son NOT NULL
(`schema.prisma:1185-1186`), y "ganar" está atado a una etapa con
`isWon` (`opportunity.service.ts:620-622`). Además, hoy **el alta de una
organización no crea ningún proceso de venta**, y sin un pipeline
`isDefault` la tool `create_opportunity` del agente falla
(`agentTools.service.ts:673-682`).

**La solución: un proceso fijo, invisible.** Al crear una organización
`ESENCIAL`, en la misma transacción de `createOrganizationWithFoundingAdmin`
(`organizationAdmin.service.ts:186-211`), se crea un pipeline `isDefault`
"Ventas" con tres etapas:

| Orden | Etapa | Flags |
|---|---|---|
| 1 | En curso | — |
| 2 | Vendida | `isWon` |
| 3 | Perdida | `isLost` |

- El modelo de datos no cambia. Todo lo que hoy depende de Pipeline/Stage
  (`create_opportunity`, el reuso de la OPEN, `opportunity.won`, el dashboard
  de la edición completa) sigue funcionando sin bifurcaciones.
- En `ESENCIAL`, `/pipelines` y `/stages` quedan bloqueadas (§5). Nadie puede
  agregar etapas.
- **API de oportunidades en ESENCIAL:** el cuerpo no lleva `pipelineId` ni
  `stageId` (se rechazan con 400 si vienen). El service resuelve el pipeline
  fijo y mapea `status` a etapa: `OPEN → En curso`, `WON → Vendida`,
  `LOST → Perdida` (con `lostReason`). En el PR hay que verificar si la
  sincronización status↔etapa del ítem 154 ya cubre la dirección
  status→etapa; si no, se agrega ahí, para las dos ediciones.
- **Campos de módulos excluidos** (`companyId`, `financing*`): en `ESENCIAL`
  se rechazan con 400. Ignorarlos en silencio haría creer que se guardaron.
- **Upgrade a COMPLETA:** el proceso fijo pasa a ser un proceso de venta
  normal y editable. No hay nada que migrar.

**Lo que ve el usuario:** una lista de oportunidades (contacto, vehículo,
monto, estado En curso/Vendida/Perdida, asignado, fecha) y un formulario corto.
Sin kanban, sin selector de proceso ni etapa.

**Ganar sin entregas.** Al ganar con una unidad vinculada, hoy se crea una
`Delivery` en la misma transacción (`opportunity.service.ts:428-430`,
`:760-762`) y la unidad queda SOLD hasta que se confirma la entrega. En
`ESENCIAL` no hay entregas:

- **Recomendado:** se sigue creando la `Delivery`, que queda oculta. Así no
  se bifurca el código de dominio por edición, y si hay upgrade las entregas
  pendientes aparecen como tales. La unidad queda "Vendida" en el stock, que
  es lo que la automotora espera ver.
- **Alternativa:** no crearla en `ESENCIAL`. Es más prolijo para los datos,
  pero mete una rama por edición dentro de una transacción de dominio. Ver P7.

### 2.2 Empresas: no son inseparables de contactos

- `Contact.companyId` es opcional (`schema.prisma:952`), en create y update.
- `Opportunity` tiene un CHECK que exige empresa o contacto
  (`schema.prisma:1269`). En `ESENCIAL`, el contacto pasa a ser obligatorio
  en el schema de la edición, así que el CHECK se cumple solo.
- `Activity` exige empresa, contacto u oportunidad; en `ESENCIAL` siempre hay
  contacto u oportunidad.
- Frontend: se ocultan el filtro y la columna "Empresa" de `ContactListPage`
  (`:209-211`, `:273`, `:304`, `:389`) y el `CompanySelect` de
  `ContactFormPage` (`:365-369`).
- La importación de empresas se rechaza en `ESENCIAL`. La columna "empresa"
  de un Excel de contactos se ignora (con un aviso en la vista previa).
- `get_contact_info` del agente devuelve `companyId`: en `ESENCIAL` es
  siempre null y no hace falta tocarlo.

**Conclusión:** empresas queda fuera de `ESENCIAL`.

### 2.3 Campos personalizados (dudoso)

Solo existen para contactos (`ContactCustomFieldDefinition`,
`schema.prisma:3067-3106`). El agente los lee en el prompt
(`bloqueDeCamposPersonalizados`) y puede escribir los `agentEditable` con
`update_contact_custom_fields`.

| Opción | A favor | En contra |
|---|---|---|
| **A. Incluir completo (recomendada)** | Es la forma de adaptar el contacto sin sumar módulos ("¿tiene auto para entregar?", "forma de pago preferida"). Ya está hecho y es contact-céntrico. | Una pantalla más de configuración. |
| B. Incluir sin `agentEditable` | Menos IA tocando datos. | El nivel de participación ya regula eso (§4). Duplica el control. |
| C. Excluir | Más simple. | Pierde la flexibilidad justo en la edición que no tiene oportunidades ricas. |

### 2.4 Agente interno (dudoso)

Es un asistente para el **personal**, no para el cliente. Crea tareas
(`create_internal_task`) y lee la agenda (`get_agenda`), dos módulos que
están en `ESENCIAL`. Ya es opt-in por usuario (`canUseInternalAgent`,
`requireInternalAgentAccess.ts`).

| Opción | A favor | En contra |
|---|---|---|
| **A. Incluir, opt-in como hoy (recomendada)** | El rechazo a la IA es del comprador, no necesariamente del vendedor. Cero costo extra. | Una entrada más en el menú (solo para quien tiene permiso). |
| B. Excluir | Edición "sin IA para el personal". | Le saca algo útil a quien lo quiera, y la decisión ya se toma por usuario. |

`resolverOportunidadPorTexto` sigue funcionando con las oportunidades
mínimas.

---

## 3. Cupones y QR de reseñas sin cotizaciones, pagos ni entregas

**Cómo es hoy:**

- El **envío automático** de cupón y de QR de reseñas depende 100% de la
  oportunidad ganada:
  - las acciones `opportunity.send_discount_voucher` y
    `opportunity.send_qr_followup` solo admiten el trigger `opportunity.won`;
  - las filas que agendan (`DiscountVoucherFollowUp`, `QrFollowUp`) tienen
    `opportunityId` NOT NULL;
  - los workers cancelan si la oportunidad ya no está WON
    (`discountVoucherFollowUpWorker.ts:168`, `qrFollowUpWorker.ts:204`).
- El **cupón manual** (`POST /api/vouchers`) acepta un contacto sin
  oportunidad.
- El **QR** en sí cuelga de una sucursal.
- **Nada depende de cotizaciones, pagos ni entregas.** "Venta ganada" es solo
  `Opportunity.status = WON`.

**Propuesta: el disparador sigue siendo `opportunity.won`, que en ESENCIAL se
llama "venta registrada".** Con las oportunidades mínimas (§2.1), marcar una
oportunidad como **Vendida** es ganarla: corre en la misma transacción, emite
`opportunity.won` y agenda el cupón y el QR igual que hoy. No hay migración ni
cambio en las acciones ni en los workers.

| Opción | Qué requiere | Riesgo |
|---|---|---|
| **A. `opportunity.won` vía "Vendida" (recomendada)** | Nada en el backend. Solo cambia el rótulo en el catálogo de automatizaciones de ESENCIAL ("Cuando se registra una venta"). | Bajo. |
| B. Trigger nuevo "contacto pasa a Cliente" sin oportunidad | Migración: `opportunityId` nullable en `QrFollowUp` y `DiscountVoucherFollowUp`, y reescribir la revalidación de los workers. | Medio. Duplica la definición de venta. |
| C. Solo manual | Un botón "Mandar QR de reseña" en la ficha del contacto (el cupón manual ya existe). | Bajo, pero depende de que alguien se acuerde. |

Se puede sumar C a A más adelante, sin conflicto.

---

## 4. Nivel de participación de la IA

### 4.1 Qué existe hoy

No hay "modo de respuesta", aprobación humana ni configuración de IA por
organización. Lo que hay:

| Mecanismo | Dónde | Efecto |
|---|---|---|
| `Agent.isActive` | `schema.prisma:2464` | Apaga el agente. |
| `Agent.channels` | `:2403` | Canales que atiende. Un entrante de un canal no atendido se **deriva sin llamar al modelo** (`derivarEntranteSinAgente`, `agentOrchestration.service.ts:1517`). |
| `Agent.enabledTools` y `guardrails` | `agentPermissions.service.ts:84-149` | `puedeEjecutarTool` valida cada tool en el backend: habilitada, no prohibida, sin campos protegidos, con los datos requeridos. |
| Pausa por conversación | `humanoAtiendeLaConversacion` (`:1969`) | No es un campo: el agente calla si la conversación está `TRANSFERRED_TO_HUMAN` **y** la última palabra fue de una persona. Si deriva el agente, él sigue hablando hasta que escriba alguien. |
| Devolver al agente | `conversationReply.service.ts:497` | Vuelve a `ACTIVE`. |
| Aviso si nadie responde | `avisoSinRespuestaWorker.ts`, `Agent.unansweredHandoffNoticeMinutes` | Texto fijo al cliente y tarea. |
| Horario de la sucursal | `BranchBusinessHours` | **Fuera de horario el agente responde igual**; solo cambia la frase de derivación. Los seguimientos de consultas sí se posponen. |
| Borrador de seguimiento | `agent.draft_follow_up` | La IA redacta y queda como tarea; una persona copia y manda a mano. Es el único precedente de "la IA propone, la persona envía". |

**Advertencia sobre #446:** el seguimiento de consultas estancadas manda
**texto libre generado por la IA sin revisión** cuando la ventana de 24 h de
WhatsApp está abierta (`inquiryFollowUpWorker.ts:220-236`). Ese es justamente
el tipo de mensaje que una automotora "con poca IA" no quiere. Ver §4.5.

### 4.2 Las cuatro opciones

Regla de diseño: **cada nivel lo hace cumplir el backend**, en el loop y en
`puedeEjecutarTool`. Un texto en el prompt sirve para que el modelo se
comporte bien, pero no es la garantía.

#### (a) AUTONOMA: responde sola, como hoy

- Requiere: nada. Es el default de los agentes existentes.

#### (c) PRIMER_CONTACTO: atiende la primera consulta y deriva rápido

El agente saluda, responde lo básico (stock, horarios, base de conocimiento),
toma nombre y datos de calificación, y deriva. Variante con
`onlyOutsideBusinessHours`: dentro del horario de la sucursal no atiende
(deriva directo, sin modelo); fuera de horario hace lo mismo que
PRIMER_CONTACTO.

**Lo que hace cumplir el backend:**

1. **Gate de horario**, antes de llamar al modelo, en
   `responderEnLaConversacion`. Con `onlyOutsideBusinessHours` y la sucursal
   abierta, se usa `derivarEntranteSinAgente` con un motivo nuevo
   ("La IA atiende solo fuera de horario"). Reusa
   `atencionFueraDeHorarioDeLaSucursal`
   (`branchBusinessHours.service.ts:115`).
   - **Sucursal sin horario cargado:** la API rechaza
     `onlyOutsideBusinessHours = true` (400), porque "fuera de horario" no
     estaría definido. Si se borra el horario después, el gate trata a la
     sucursal como abierta: deriva siempre, el lado seguro.
2. **Tope de respuestas.** Se cuentan las respuestas AGENT de la conversación
   desde su último paso a `ACTIVE`. Al llegar a `MAX_RESPUESTAS_PRIMER_CONTACTO`
   (propuesta: 2), el turno siguiente deriva sin modelo. Lo cuenta el
   servidor, no el modelo.
3. **Tools permitidas** (filtro duro en `toolsHabilitadas` y en
   `puedeEjecutarTool`, además de `enabledTools`):
   - Sí: `search_vehicles`, `get_service_types`, `get_availability`,
     `get_contact_info`, `get_contact_activities`, `create_lead`,
     `update_lead`, `update_contact_custom_fields`, `request_human_handoff`.
   - No: `create_opportunity`, `update_opportunity`, `reserve_vehicle`,
     `create_booking`, `mark_no_interest`. Son las que **comprometen algo**
     (reservan una unidad o un turno, cierran o descartan); las hace la
     persona.
4. **Una vez derivada, el agente calla.** Hoy, si deriva el agente, sigue
   hablando hasta que escriba una persona (ítem 83). En PRIMER_CONTACTO,
   `humanoAtiendeLaConversacion` devuelve true con solo
   `status = TRANSFERRED_TO_HUMAN`. Se hace en una función, sin columna nueva
   (el comentario `:2030-2038` rechaza un booleano de pausa, y esto lo
   respeta).
5. **Prompt:** se agrega una instrucción de rol corto ("tu tarea es recibir la
   consulta, responder lo básico, tomar los datos y pasar con una persona del
   equipo"). Se quita `INSTRUCCION_OPORTUNIDAD_CON_INICIATIVA`, porque la tool
   no está.

**Requiere:** la columna `participation` (migración), el gate, el filtro de
tools, tests unitarios del gate y de `puedeEjecutarTool` por nivel, y un
selector en `AgentFormPage`.

#### (d) SOLO_SEGUIMIENTO: no conversa con el cliente

El agente no responde nunca. Cada entrante se deriva sin modelo
(`derivarEntranteSinAgente`, que ya existe para "agente apagado o sin el
canal"). La IA queda para lo que no es conversar:

- el seguimiento de consultas (#446), **con plantilla aprobada**, no texto
  libre (§4.5);
- el borrador de seguimiento de oportunidades (`agent.draft_follow_up`), que
  ya es una tarea para una persona;
- el aviso si nadie responde, con texto fijo.

**Requiere:** el gate en el loop (una línea antes del modelo), un motivo de
derivación nuevo y tests. Sin migración aparte de `participation`.

**Web:** el widget es sincrónico y espera una respuesta
(`publicWidget.controller.ts:63-67`). En SOLO_SEGUIMIENTO devuelve un texto
fijo ("Gracias, te va a responder una persona del equipo"). Hay que
verificar en el PR qué devuelve hoy el widget con el agente sin el canal WEB
y alinearlo.

¿Hace falta el agente? En (d) se podría usar `isActive = false`, que ya
deriva todo. Igual conviene el nivel explícito: con el agente apagado no está
claro que la IA de seguimiento siga activa, y el admin pierde la
configuración (instrucciones, base de conocimiento) que usa el borrador de
seguimiento.

#### (b) BORRADOR: la IA redacta y una persona aprueba

Es el que más se parece a "la IA ayuda, pero no habla sola", y el más caro.

**Lo que requiere:**

1. **Estado nuevo del mensaje.** El texto del agente se persiste en el mismo
   punto de hoy (`agentOrchestration.service.ts:2518-2525`), con un estado
   `AWAITING_APPROVAL` (un valor de `MessageDeliveryStatus` o una columna).
   Esto es una migración y hay que revisar los CHECK de `messages`
   (`schema.prisma:256-259`, `:2626-2628`).
2. **No enviar:**
   - En el worker de entrantes, un borrador no pasa por `enviarRespuesta`
     (rama `agentInboundWorker.ts:551`).
   - En web se devuelve `respuesta: null` más un texto fijo, y
     `publicWidgetThread.service.ts:96` filtra los borradores.
3. **Aprobar, editar o descartar:** rutas nuevas en `conversation.routes.ts`.
   Aprobar reusa `conversationReply.enviarPorElCanal` (`:268`), que ya
   resuelve el destino, la ventana de 24 h, los reintentos y FAILED.
4. **Exclusiones obligatorias:**
   - `humanSpokeLast` (`message.repository.ts:88-98`) no puede contar un
     borrador como "habló el agente".
   - `aHistorial` (`:1283`) no puede meterlo en el historial como si el
     cliente lo hubiera recibido.
   - La detección de ecos de Meta (`findSalientesRecientes`) no puede
     compararlo.
5. **Borrador viejo:** si el cliente escribe de nuevo antes de la aprobación,
   el borrador anterior queda reemplazado. Si vence la ventana de 24 h, el
   envío falla con un mensaje claro y la persona responde con plantilla.
6. **Tools:** las mismas restricciones que PRIMER_CONTACTO. Un borrador
   retiene el texto, **no las acciones**: si el agente reserva una unidad y la
   persona descarta el mensaje, la reserva ya está hecha. Por eso las tools
   que comprometen algo no se ofrecen.
7. **UI:** en la bandeja, el borrador se muestra con "Enviar", "Editar" y
   "Descartar", más una tarea o notificación para que no quede olvidado.

**Riesgo:** alto. Toca el camino de envío de todos los canales, la lógica de
pausa y el widget.

### 4.3 Resumen

| Nivel | El cliente habla con la IA | Acciones que comprometen | Migración | Esfuerzo |
|---|---|---|---|---|
| AUTONOMA (a) | Sí | Sí (según `enabledTools`) | — | 0 |
| PRIMER_CONTACTO (c) | Hasta 2 respuestas; opcionalmente solo fuera de horario | No | `participation` + `onlyOutsideBusinessHours` | Medio |
| SOLO_SEGUIMIENTO (d) | No | No | `participation` | Bajo |
| BORRADOR (b) | Solo lo que una persona aprueba | No | Estado de borrador en `messages` | Alto |

### 4.4 Recomendación

**Mínimo para esta edición: (a), (c) y (d)** en un mismo enum. (b) queda como
fase 2, con su propio PR de migración.

- (c) y (d) reusan piezas que ya existen y están probadas
  (`derivarEntranteSinAgente`, el horario de la sucursal,
  `puedeEjecutarTool`).
- (b) mete un estado nuevo en el camino de envío de todos los canales. Es
  mejor hacerlo cuando una automotora real pida aprobar mensajes, y no
  especulativamente.

**Default para un agente nuevo de una organización ESENCIAL:**
PRIMER_CONTACTO. Los agentes de organizaciones COMPLETA siguen en AUTONOMA.
Ver P3.

**Por agente y no por organización** (P2): el nivel convive con `channels` e
`isActive`, que ya son por agente, y permite combinaciones razonables, como el
widget web en AUTONOMA a las 3 de la mañana y WhatsApp en PRIMER_CONTACTO.

### 4.5 Seguimiento de consultas (#446) según el nivel

| Nivel | Seguimiento automático de consultas |
|---|---|
| AUTONOMA | Como hoy: texto libre de la IA dentro de la ventana de 24 h y plantilla fuera. |
| PRIMER_CONTACTO, SOLO_SEGUIMIENTO | **Siempre la plantilla aprobada**, aun con la ventana abierta. Lo decide `inquiryFollowUpWorker.ts` antes de `generarTexto`, leyendo el nivel del agente del canal. |
| BORRADOR (fase 2) | Tarea con el texto sugerido (como `agent.draft_follow_up`), sin envío automático. |

Ver P9.

---

## 5. Backend como fuente de verdad

### 5.1 Catálogo de módulos

Un solo archivo, `src/config/ediciones.ts`, es la fuente de verdad:

```ts
export type Modulo =
  | "comun" | "contactos" | "conversaciones" | "agentes" | "canales"
  | "base_de_conocimiento" | "usuarios" | "sucursales" | "importacion"
  | "stock" | "tareas" | "agenda" | "cupones_y_qr" | "automatizaciones"
  | "dashboard_atencion" | "oportunidades" | "campos_personalizados"
  | "agente_interno" | "ingesta" | "plataforma"
  // solo COMPLETA:
  | "procesos_de_venta" | "cotizaciones" | "pagos" | "entregas"
  | "empresas" | "dashboard_comercial";

export const MODULOS_POR_EDICION: Record<OrganizationEdition, ReadonlySet<Modulo>>;

/** Cada ruta montada, clasificada. Un test falla si aparece una ruta sin clasificar. */
export const RUTAS_POR_MODULO: ReadonlyArray<{ metodo: string; ruta: string; modulo: Modulo }>;
```

### 5.2 Gate central, no ruta por ruta

**Restricción del repo:** no hay middleware global de auth. Cada ruta declara
`authenticate`, y todos los routers se montan en `/api` sin subprefijo
(`routes/index.ts`). Un `router.use(gate)` sin path interceptaría cualquier
request que pase por ese router.

**Propuesta:**

1. `findUserForAuth` (`user.repository.ts:42-63`) ya hace `JOIN organizations`.
   Se suma `o.edition` al SELECT y `edition` a `AuthContext`
   (`types/auth.ts:126-132`).
2. Un único middleware `gateDeEdicion`, montado una vez al principio de
   `routes` en `routes/index.ts`:
   - Busca el `metodo + path` del request en `RUTAS_POR_MODULO`, compilado una
     vez a matchers.
   - Si el módulo es `comun` o está en todas las ediciones, sigue sin hacer
     nada (sin costo).
   - Si no, corre `authenticate` (que deja `req.auth`) y verifica
     `MODULOS_POR_EDICION[req.auth.edition]`.
   - `authenticate` aprende a no repetir el trabajo si `req.auth` ya existe
     (un `if` al principio). Así la ruta, que declara su `authenticate` como
     siempre, no verifica el JWT dos veces.
3. **Respuesta:** **403** con `code: "MODULO_NO_INCLUIDO"` y el nombre del
   módulo. El frontend lo usa para mostrar "Disponible en la edición
   completa", y no oculta nada que no sea público (el repo es público y los
   módulos son conocidos). Ver P10.
4. **Rutas públicas o sin organización** (`/api/public`, webhooks, `/qr/resolve`,
   `/vouchers/resolve`, onboarding, `/admin/...`) se clasifican como `comun` o
   `plataforma`. Las de `/admin/organizations/:organizationId/...` aplican la
   edición de **esa** organización cuando el módulo lo requiere, por ejemplo
   importar empresas a una ESENCIAL.

**Caminos que no pasan por HTTP** y el gate no ve (se cubren en sus propios
puntos, con la misma tabla):

| Camino | Dónde se valida |
|---|---|
| Tools del agente de clientes | `toolsHabilitadas` y `puedeEjecutarTool` (§6.1) |
| Tools del agente interno | Catálogo interno por edición |
| Automatizaciones | Al crear y editar (catálogo por edición) y en `despacharAutomatizaciones` (salta reglas de módulos no incluidos) |
| Importación | `importacionAdmin`: rechaza la entidad "empresas" en ESENCIAL |
| Workers de dominio | No hace falta: solo actúan sobre filas que solo pueden existir si el módulo existe |

### 5.3 Rutas bloqueadas en ESENCIAL

| Módulo | Rutas | Respuesta |
|---|---|---|
| procesos_de_venta | `/api/pipelines*`, `/api/stages*` | 403 |
| cotizaciones | `/api/quotes*` | 403 |
| pagos | `/api/payments*` | 403 |
| entregas | `/api/deliveries*` | 403 |
| empresas | `/api/companies*` | 403 |
| dashboard_comercial | `GET /api/opportunities/dashboard-summary`, `GET /api/opportunities/revenue-series` | 403 |
| (campo) permutas | `tradeInOpportunityId` en POST/PATCH `/api/vehicles` | 400 |
| (campo) empresa | `companyId` en `/api/contacts`, `/api/opportunities`, `/api/activities` | 400 |
| (campo) financiación, pipeline, etapa | `financing*`, `pipelineId`, `stageId` en `/api/opportunities` | 400 |

Los bloqueos por **campo** van en los schemas zod de esas rutas: una
refinación que lee `req.auth.edition` y una lista de campos por edición
definida en el mismo `ediciones.ts`. No es un middleware por ruta escrito a
mano.

`get_payment_info` del agente lee `Branch.paymentLinkUrl` y los datos de
transferencia de la sucursal; no usa el módulo de pagos. Se mantiene en
ESENCIAL (P11).

En `COMPLETA` no se bloquea nada. El catálogo garantiza que la edición
original se comporte exactamente como hoy.

### 5.4 Tests

1. **Unitario: toda ruta clasificada** (`src/config/ediciones.test.ts`).
   Recorre el stack de Express de la app real, como hace
   `src/routes/index.test.ts`, y falla si hay una ruta montada que no esté en
   `RUTAS_POR_MODULO` o una entrada que no corresponda a ninguna ruta. Es el
   equivalente del meta-test de `tenant-isolation.integration-test.ts`
   (`:2548-2566`), que obliga a sumar cada modelo nuevo: acá obliga a decidir
   la edición de cada ruta nueva.
2. **Integración: suite de ediciones**
   (`src/routes/ediciones.integration-test.ts`), al estilo de los tests de
   aislamiento:
   - Crea dos organizaciones, una `ESENCIAL` y una `COMPLETA`, cada una con un
     ADMIN real (Supabase local). Los slugs `ediciones-esencial-{ts}` y
     `ediciones-completa-{ts}` se registran en `PATRONES_DE_SLUG_DE_PRUEBA`
     (`testOrganizationsPurge.service.ts`).
   - **Genera los casos desde `RUTAS_POR_MODULO`**, no a mano. Para cada ruta
     de un módulo fuera de ESENCIAL:
     - con el token de la ESENCIAL espera 403 `MODULO_NO_INCLUIDO`;
     - con el de la COMPLETA espera cualquier cosa **menos** ese código.
   - Casos por campo (los 400 de §5.3).
   - Contraprueba: para las rutas de los módulos incluidos, la ESENCIAL
     **no** recibe `MODULO_NO_INCLUIDO`.
   - Upgrade: `PATCH /admin/organizations/:id/edition` a COMPLETA y la misma
     ruta pasa. Bajar devuelve 409. Un ADMIN que no es platform admin recibe
     403.
3. **Agente** (unitarios de `agentPermissions` y del loop):
   - para cada nivel, qué tools se ofrecen y que una llamada forzada a una
     tool no permitida se rechace;
   - el gate de horario;
   - el tope de respuestas de PRIMER_CONTACTO;
   - que SOLO_SEGUIMIENTO no llame al proveedor.
4. **Automatizaciones:** crear una regla con trigger o acción fuera de la
   edición da 400, y el despachador salta una regla que quedó fuera.

---

## 6. El agente por edición y por nivel

### 6.1 Tools

Un hallazgo que simplifica: **el agente nunca tocó cotizaciones, pagos,
entregas ni empresas.** No hay tools de esos módulos, y Pipeline/Stage solo
se usan por dentro de `create_opportunity`. Con el proceso fijo de §2.1, la
edición casi no cambia el catálogo; lo que lo recorta es el **nivel de
participación**.

| Tool | COMPLETA | ESENCIAL | PRIMER_CONTACTO / BORRADOR | SOLO_SEGUIMIENTO |
|---|---|---|---|---|
| `search_vehicles`, `get_service_types`, `get_availability`, `get_contact_info`, `get_contact_activities` | ✅ | ✅ | ✅ | — (no hay turno) |
| `create_lead`, `update_lead` | ✅ | ✅ | ✅ | — |
| `update_contact_custom_fields` | ✅ | ✅ si entra el módulo (P5) | ✅ | — |
| `get_payment_info` | ✅ | ✅ (P11) | ✅ | — |
| `create_opportunity`, `update_opportunity` | ✅ | ✅ (proceso fijo) | ❌ | — |
| `reserve_vehicle`, `create_booking` | ✅ | ✅ | ❌ | — |
| `mark_no_interest` | ✅ | ✅ | ❌ | — |
| `request_human_handoff` | siempre | siempre | siempre | — |

**Filtro efectivo:** `enabledTools ∩ toolsDeLaEdicion ∩ toolsDelNivel`.

- Se aplica en dos lugares: en `toolsHabilitadas` (lo que se le ofrece al
  modelo) y en `puedeEjecutarTool` (lo que se ejecuta). El segundo es la
  garantía.
- El formulario del agente muestra solo las tools posibles.
- Si `enabledTools` tiene alguna que el nivel no permite, la API de agentes no
  la rechaza. Solo queda inactiva y el formulario lo avisa, así cambiar de
  nivel no destruye configuración.

### 6.2 Prompt

| Parte (`armarSystemPrompt`) | Cambio |
|---|---|
| `INSTRUCCION_OPORTUNIDAD_CON_INICIATIVA` (#444) | Va solo si `create_opportunity` queda habilitada después del filtro. |
| `INSTRUCCION_SIN_AUTORIDAD_COMERCIAL` | Igual en las dos ediciones. |
| Bloque de contacto | Sin cambios. La marca SIN INTERÉS (#446) sigue. |
| Campos personalizados | Según P5. |
| Instrucción de rol del nivel | Nueva: corta para PRIMER_CONTACTO y BORRADOR. SOLO_SEGUIMIENTO no arma prompt. |
| Fuera de horario | Igual. Con `onlyOutsideBusinessHours` el agente solo corre fuera de horario, así que la frase de derivación ya es la de "fuera de horario". |

La edición **no** se le dice al modelo. Al modelo le llegan solo las tools y
las instrucciones que le corresponden; contarle "estás en la edición
ESENCIAL" sería un texto en el prompt sin ningún efecto que el backend pueda
garantizar.

### 6.3 Dependencia de #444 y #446 respecto de las oportunidades

- **#444 (oportunidades con motivo): dependencia alta, pero sobrevive.**
  - Todo el PR existe para regular cuándo se crea una oportunidad: motivo
    obligatorio, iniciativas de `utils/iniciativaDelCliente.ts` y candado de
    identidad.
  - Crear exige el pipeline `isDefault` y su primera etapa abierta. En
    ESENCIAL eso lo da el proceso fijo.
  - El motivo queda como nota (Activity NOTE), sin columna nueva.
  - Funciona sin cambios en AUTONOMA. En PRIMER_CONTACTO no corre, porque la
    tool no se ofrece.
  - El candado de identidad también protege `create_booking` y
    `reserve_vehicle`.
- **#446 (seguimiento de consultas): dependencia baja, solo como filtro.**
  - Lo único que mira de las oportunidades es "¿el contacto tiene una OPEN?":
    en el barrido (`inquiryFollowUp.repository.ts:93-99`), en la acción y en
    el worker antes de enviar.
  - No usa Pipeline ni Stage. Con las oportunidades mínimas funciona igual.
  - Si algún día una edición no tuviera oportunidades, ese filtro daría
    siempre "no tiene" y el seguimiento seguiría andando.
  - Lo que sí lo afecta es el nivel de participación (§4.5).

### 6.4 Dashboard simple

El dashboard actual sale entero de oportunidades
(`/opportunities/dashboard-summary`, `/revenue-series`, `PipelineStageSummary`).
Para ESENCIAL va un endpoint nuevo, `GET /api/dashboard/atencion?periodo=`,
sin migración. Usa ventanas en la zona de la organización (`zonedWindow.ts`):

- conversaciones nuevas en el período, por canal;
- derivaciones a una persona (`transferredToHumanAt` en el período);
- derivaciones en las que nadie respondió a tiempo (avisos
  `UNANSWERED_HANDOFF`);
- consultas pendientes (seguimientos agendados y contactos sin oportunidad
  abierta con la última palabra del cliente);
- tareas vencidas.

En COMPLETA se puede sumar después como una tarjeta más.

---

## 7. Frontend

- **`/me`** devuelve `edition` y **`modulos: string[]`**, calculado por el
  backend desde `MODULOS_POR_EDICION`. El frontend no tiene su propia tabla de
  ediciones; así no hay dos tablas que se desincronicen. Se suman al
  `MeResponse` de `auth/AuthContext.tsx:18-37` (los campos existen en el
  endpoint, como pide el comentario `:15-17`).
- **Hook `useModulo(m)`** y **`<ModuloRoute modulo>`**: envuelven las rutas de
  `app/router.tsx`. Una ruta de un módulo no incluido redirige al inicio. Es
  UX: la garantía es el 403 del backend.
- **Menú** (`layout/AppLayout.tsx`): cada entrada declara su módulo y se
  filtra con el mismo hook, en el mismo lugar donde hoy se filtra por
  `isAdmin`. En ESENCIAL desaparecen Empresas, Procesos de venta y las
  secciones de oportunidad que no aplican.
- **Pantallas y formularios en ESENCIAL:**

| Pantalla | Cambio |
|---|---|
| Dashboard | `DashboardAtencionPage` en lugar de las tarjetas comerciales. |
| Oportunidades | Lista simple (sin kanban). Formulario: contacto, título, vehículo, monto/moneda, estado, motivo de pérdida, asignado. Sin `QuoteSection`, `DeliverySection`, `TradeInSection`, `PaymentSection`, financiación, empresa, proceso ni etapa (`OpportunityFormPage.tsx:531-555`, `:692`, `:828-831`). `CreateVoucherDialog` queda. |
| Contactos | Sin filtro, columna ni selector de empresa. |
| Stock | Sin `TradeInSection`. |
| Agente | Selector **"Cuánto hace la IA"** (nivel), con el interruptor "solo fuera de horario". Solo las tools posibles. Disponible en las dos ediciones. |
| Automatizaciones | Catálogo filtrado (§8). |
| Organización | La edición como dato de solo lectura. |
| Plataforma → Nueva organización | Selector de edición obligatorio (`NewOrganizationPage.tsx:90-122`). |
| Plataforma → organizaciones | Columna "Edición" y acción "Pasar a edición completa", con confirmación. |

- Si igual llega un 403 `MODULO_NO_INCLUIDO` (por un link viejo, por
  ejemplo), se muestra "Esta función es de la edición completa".

---

## 8. Automatizaciones

**Triggers** (`automationTriggers.ts`) y **acciones**
(`automationRegistrations.ts`): ninguno depende de cotizaciones, pagos ni
entregas, y `opportunity.stale` mira `status = OPEN` y `updatedAt`, no la
etapa (`opportunity.repository.ts:292-307`). Por eso **el catálogo es el
mismo en las dos ediciones**; solo cambian los rótulos.

| Trigger | ESENCIAL (rótulo) | Acciones |
|---|---|---|
| `opportunity.won` | "Cuando se registra una venta" | `opportunity.send_qr_followup`, `opportunity.send_discount_voucher`, `activity.create_follow_up` |
| `opportunity.stale` | "Cuando una oportunidad queda sin movimiento" | `agent.draft_follow_up` (tarea con borrador, sin envío) |
| `contact.inquiry_stalled` | "Cuando una consulta queda sin respuesta del cliente" | `inquiry.follow_up` (con la regla del nivel, §4.5) |

Igual, el catálogo pasa por `MODULOS_POR_EDICION`: cada trigger y cada acción
declara su módulo. Así un trigger futuro de cotizaciones o entregas queda
fuera de ESENCIAL sin acordarse de hacerlo. El frontend
(`features/automation/catalog.ts`) recibe los rótulos según `edition`.

---

## 9. Guía de uso (lo que queda pendiente de B)

La guía en la app (#447) y la limpieza de textos (#448) **ya están
mergeadas**. Lo que depende de la edición, y queda pendiente hasta que este
diseño se apruebe, es:

1. **Filtro por edición** en `features/guia/secciones.ts`. Hoy
   `seccionesVisibles(esPlatformAdmin)` solo oculta "Plataforma".
   - Se agrega un mapa `slug → módulo` y otro `ancla → módulo`, para los `##`
     de módulos excluidos.
   - `GuiaPage` omite esas secciones y bloques según `me.modulos`.
   - El índice y el buscador usan la misma lista filtrada.
2. **`04-oportunidades-y-procesos-de-venta.md`:** las anclas `#embudo`,
   `#cotizaciones`, `#pagos`, `#permuta`, `#entrega`, `#procesos-de-venta` y
   `#etapas` quedan ocultas en ESENCIAL. Hace falta un `##` nuevo
   `{#oportunidades-esencial}` que explique la lista simple y el estado
   "Vendida".
3. **`08-agentes-de-ia.md`:** un `##` nuevo `{#cuanto-hace-la-ia}` para el
   nivel de participación (las dos ediciones).
4. **`07-cupones-y-qr.md` y `10-automatizaciones.md`:** "venta ganada" pasa a
   decir "venta registrada" donde aplique a las dos ediciones. Se explica la
   regla del seguimiento con plantilla.
5. **`02-contactos-y-consultas.md`:** el bloque de empresa queda oculto en
   ESENCIAL.
6. **`01-primeros-pasos.md`:** la descripción del menú, según la edición.
7. **`14-plataforma.md#nueva-organizacion`:** la elección de edición y el
   cambio a completa.
8. **`AYUDA` (`features/guia/anclas.ts`):** el "?" de una pantalla de ESENCIAL
   tiene que apuntar a un ancla visible en ESENCIAL. Un test en
   `secciones.test.ts` lo verifica para cada clave usada por una pantalla
   gateada por módulo.

Esto se hace en el PR de frontend de las ediciones, en el mismo PR, según la
regla de la guía.

---

## 10. Plan de PRs

Los PR con 🗄 llevan migración y **quedan abiertos hasta que se autoricen a mano**.

| # | PR | Migración | Riesgo | Contenido |
|---|---|---|---|---|
| 0 | `chore: borrar archivos vacíos de la raíz` | — | Bajo | `${clave}`, `=` y `opportunityId` entraron por error con #446. Independiente de todo lo demás. |
| 1 | `docs: diseño de ediciones` (este) | — | Nulo | Solo `docs/ediciones.md`. |
| 2 | `feat(ediciones): columna edition y participation` 🗄 | Sí | Bajo | Enums y columnas con default (`COMPLETA`, `AUTONOMA`, `false`). Aditivo y sin backfill. Ningún código lee las columnas todavía; el PR incluye lo que pidan `verify:schema` y el diagnóstico para columnas nuevas. |
| 3 | `feat(ediciones): catálogo de módulos y gate central` | — | **Medio-alto** | `ediciones.ts`, `edition` en `AuthContext`, `gateDeEdicion`, `authenticate` idempotente, refinaciones zod por campo, `edition` y `modulos` en `/me`, test "toda ruta clasificada", suite `ediciones.integration-test.ts` y slugs. Toca cada request: el test de clasificación y el de COMPLETA sin cambios son la red. Depende de 2 aplicado. |
| 4 | `feat(plataforma): elegir y subir la edición` | — | Medio | `edition` en el alta, con el proceso fijo para ESENCIAL en la misma transacción. `PATCH .../edition` solo hacia arriba y `vaciar()` de la caché. Pantallas de Plataforma y sección 14 de la guía. |
| 5 | `feat(oportunidades): versión mínima en ESENCIAL` | — | Medio | Status→etapa con el proceso fijo, lista y formulario simples, sección 04 de la guía. |
| 6 | `feat(agente): nivel de participación (a, c, d)` | — | **Medio-alto** | Gate de horario, tope de respuestas, filtro de tools en los dos lugares, pausa al derivar en PRIMER_CONTACTO, SOLO_SEGUIMIENTO sin modelo, widget web, seguimiento con plantilla (§4.5). Selector en el formulario y sección 08 de la guía. Es la parte más delicada del agente: tests del loop por nivel. |
| 7 | `feat(ediciones): menú, pantallas y guía por edición` | — | Medio | `useModulo`, `ModuloRoute`, menú, contactos sin empresa, stock sin permuta, catálogo de automatizaciones, filtro de la guía y test de `AYUDA`. |
| 8 | `feat(dashboard): dashboard de atención` | — | Bajo | Endpoint y pantalla de §6.4. |
| 9 | `feat(importacion): sin empresas en ESENCIAL` | — | Bajo | Rechazo de la entidad y aviso en la vista previa. |
| 10 | `feat(agente): borradores con aprobación (b)` 🗄 | Sí | **Alto** | Fase 2, cuando haya un pedido concreto. §4.2 (b). |

**Orden:** 0 y 1 cuando sea. 2 → (autorización) → 3 → 4 → 5, 6 y 7 en ese
orden (6 puede ir en paralelo con 5) → 8 y 9 → 10 más adelante.

**Hasta que esté el PR 4 nadie puede crear una organización ESENCIAL.** Antes
de eso, todo lo que se mergea es inerte para las organizaciones existentes.

---

## 11. Preguntas abiertas

Cada una con opciones; la **recomendada** va primero.

- **P1. Nombre de la edición simple.** **`ESENCIAL`** / `CLASICA` (sugiere
  "a la antigua", con poca IA) / `ATENCION` (describe el foco, pero suena
  raro como plan). → **ESENCIAL.**
- **P2. ¿Dónde vive el nivel de participación?** **Por agente** (convive con
  canales; permite distinto nivel en web y WhatsApp) / por organización (más
  simple de explicar, pero un solo nivel para todo). → **Por agente.**
- **P3. Nivel por defecto de un agente nuevo en ESENCIAL.**
  **PRIMER_CONTACTO** / AUTONOMA (como en COMPLETA) / sin default, con
  elección obligatoria en el formulario. → **PRIMER_CONTACTO**, por lo que dijo
  el referente.
- **P4. ¿BORRADOR (b) entra en esta etapa?** **No, fase 2 con su propia
  migración** / sí, junto con c y d. → **Fase 2.**
- **P5. Campos personalizados en ESENCIAL.** **Incluir completo** / incluir
  sin `agentEditable` / excluir. → **Incluir.**
- **P6. Agente interno en ESENCIAL.** **Incluir, opt-in por usuario como hoy**
  / excluir. → **Incluir.**
- **P7. Al marcar Vendida con una unidad, ¿se crea la entrega oculta?**
  **Sí, igual que hoy y oculta** (sin ramas en el dominio; el upgrade la
  muestra) / no crearla en ESENCIAL. → **Crearla.**
- **P8. Webhook de landing, fuentes y API keys en ESENCIAL.** **Incluir** (es
  una vía de entrada de consultas, sin IA) / excluir. → **Incluir.**
- **P9. Seguimiento automático de consultas con niveles bajos de IA.**
  **Siempre la plantilla aprobada** / texto libre de la IA como hoy / tarea
  con borrador para una persona. → **Plantilla.**
- **P10. Respuesta a una ruta de un módulo excluido.** **403
  `MODULO_NO_INCLUIDO`** / 404 (oculta que existe). → **403.**
- **P11. `get_payment_info` (link de pago y datos de transferencia de la
  sucursal) en ESENCIAL.** **Incluir** (es dato de la sucursal, no el módulo
  de pagos) / excluir. → **Incluir.**
- **P12. Tope de respuestas de PRIMER_CONTACTO.** **2 respuestas, fijo en
  código** / configurable por agente (columna más) / 1. → **2, fijo**; se hace
  configurable si alguien lo pide.
