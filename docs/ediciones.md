# Ediciones: COMPLETA y ESENCIAL

> Documento de diseño. Estado: **aprobado, sin código**. Fecha: 2026-10-09.
> Las preguntas abiertas se cerraron el mismo día y están en §11 como
> decisiones (D1–D12).
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
  agenda) y deja la IA como algo que se regula, no como el centro (D1).
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

Va en `Agent`, no en `Organization` (ver §4 y D2):

```prisma
enum AgentParticipation {
  AUTONOMA          // (a) responde sola, como hoy
  PRIMER_CONTACTO   // (c) toma datos y deriva rápido; opcionalmente solo fuera de horario
  SOLO_SEGUIMIENTO  // (d) no conversa con el cliente; deriva todo a una persona
  // BORRADOR       // (b) fase 2 (D4): se agrega con su propia migración
}

model Agent {
  // ...
  participation            AgentParticipation? // null = "sin elegir" (solo ESENCIAL); sin DEFAULT: lo completa un trigger
  participationChosenAt    DateTime?           // cuándo un ADMIN eligió o cambió el nivel; solo lo escribe el service
  onlyOutsideBusinessHours Boolean @default(false) // solo con PRIMER_CONTACTO
}
```

`BORRADOR` se agrega recién en la fase 2. Un valor de enum que el backend
todavía no sabe ejecutar es una trampa.

#### Nivel sin elegir (D3)

En ESENCIAL **no hay valor por defecto**: el nivel lo elige el ADMIN. Por eso
la columna admite `null`, que significa "todavía no se eligió". Una regla
sostiene todo lo demás: **un agente sin nivel elegido no puede estar
activo.**

| Dónde | Qué pasa |
|---|---|
| **Migración** | `participation` nace nullable y **sin `DEFAULT` en la columna**. Que en ESENCIAL un agente nazca sin nivel no depende del service: lo garantiza el trigger de abajo, por cualquier camino de creación. Un `UPDATE agents SET participation = 'AUTONOMA'` deja a todos los agentes existentes como están hoy (todas sus organizaciones son COMPLETA). `participation_chosen_at` nace nullable y **no se rellena**: los agentes existentes quedan en `null`. |
| **Base: trigger** | `agents_nivel_por_defecto`, `BEFORE INSERT ON agents`: si `participation` viene `null` y la organización es **COMPLETA**, la completa con `AUTONOMA`; si es **ESENCIAL**, la deja `null`. Va en la migración y en `prisma/sql/manual_constraints.sql`, donde viven los triggers. Así los 26 archivos que hoy crean agentes directo con Prisma (tests en organizaciones COMPLETA, dos scripts, el repository) siguen andando sin cambios. Solo actúa al insertar: cambiar la edición después no toca a los agentes. |
| **Base: CHECK** | `agents_activo_requiere_nivel_check`: `NOT is_active OR participation IS NOT NULL`. Va **solo en la migración**: desde B-15 los CHECK ya no viven en `manual_constraints.sql`. Como `is_active` tiene `@default(true)`, un agente de ESENCIAL creado sin nivel por un camino que no pase por el service **falla al insertar** en lugar de quedar activo y sin nivel. |
| **Crear, COMPLETA** | Sin `participation` en el cuerpo, la completa el trigger con `AUTONOMA`. Se comporta como hoy. |
| **Crear, ESENCIAL** | `participation` es opcional. Si no viene, el service guarda el agente **inactivo** (`isActive: false` explícito) y el trigger lo deja en `null`. Si el cuerpo pide `isActive: true` sin nivel, responde 400 `NIVEL_DE_IA_SIN_ELEGIR`. Así el ADMIN puede armar el agente de a poco (instrucciones, base de conocimiento) antes de decidir. |
| **Editar** | Activar con el nivel en `null` → 400 `NIVEL_DE_IA_SIN_ELEGIR`. Un nivel elegido se puede cambiar, pero no volver a `null` (400): "sin elegir" es un estado inicial, no una opción. |
| **`participation_chosen_at`** | Lo escribe **solo el service de agentes**, con `now()`, cuando un ADMIN elige o cambia el nivel (en crear o editar, en cualquier edición). Ninguna otra ruta lo toca: ni scripts, ni seeds, ni importación, ni las asignaciones de plataforma. |
| **Loop del agente** | `participation = null` se trata como "no atiende": `derivarEntranteSinAgente`, sin modelo. Con el CHECK no debería pasar nunca en un agente activo; si pasa, gana el lado seguro (deriva) y no el de más IA. En ESENCIAL, además, hace falta `participation_chosen_at` (ver "Pendiente del PR 6" abajo). |
| **Asignaciones de plataforma** | Asignar el número de WhatsApp o la página de Facebook (`/admin/agents/...`) no activa el agente ni toca el nivel ni `participation_chosen_at`. |
| **Upgrade ESENCIAL → COMPLETA** | Los agentes conservan su nivel y su `participation_chosen_at` (el upgrade no toca esa columna). Los que estaban en `null` **siguen en `null` e inactivos**: subir de edición no puede subir la IA sin que nadie lo decida. El formulario de COMPLETA los muestra igual que el de ESENCIAL hasta que se elija. |

**Pendiente del PR 6: el filtro mira la edición además del nivel.** Que un
agente de ESENCIAL tenga nivel no alcanza para que responda; tiene que constar
que un ADMIN lo eligió. La regla que decide si el agente atiende un turno es:

- **COMPLETA:** decide `participation`. No mira `participation_chosen_at`, así
  los agentes existentes (con `chosen_at` en `null`) y los tests no se ven
  afectados.
- **ESENCIAL:** decide `participation` **solo si `participation_chosen_at` no
  es `null`**. Un nivel escrito sin `chosen_at` (por un script, un seed, un
  `UPDATE` a mano o un bug que escriba `AUTONOMA`) se trata como "sin elegir":
  el agente no responde y deriva con `derivarEntranteSinAgente`.

El trigger impide el accidente más probable (un INSERT que no dice nada). Este
filtro cubre el resto: una escritura explícita de un nivel que nadie eligió.

**Pendiente del PR 6: un agente borrado no atiende.** Borrar un agente
(`DELETE /api/agents/:id`) solo marca `deleted_at` y deja `is_active = true`.
Se verificó en producción en la prueba posterior al PR 2 (2026-10-09), y es el
comportamiento de antes de las ediciones: no lo introdujeron ellas. Por
eso el filtro que decide si un agente atiende un turno mira **las tres cosas**:
`deleted_at` vacío, `is_active` y el nivel (con `participation_chosen_at` en
ESENCIAL). Que un agente esté activo no alcanza. Lleva un test: "agente
borrado no responde".

**Cómo se ve en el formulario** (`AgentFormPage`):

- **Bloque "Cuánto hace la IA"**, arriba de las instrucciones. Tiene tres
  opciones con una línea cada una, más el interruptor "Solo fuera del horario
  de la sucursal", que aparece únicamente con "Primer contacto".
  - En **ESENCIAL** ninguna opción viene marcada y el bloque lleva la marca de
    obligatorio para activar.
  - En **COMPLETA** viene marcada **"Responde sola"** (AUTONOMA).
- **Interruptor "Activo"**: deshabilitado mientras no haya nivel, con la línea
  "Elegí cuánto hace la IA para poder activarlo". **Guardar** sí se puede: el
  agente queda inactivo.
- **Lista de agentes**: un agente sin nivel muestra la etiqueta
  "Sin nivel de IA · inactivo".
- Si igual llega un 400 `NIVEL_DE_IA_SIN_ELEGIR` (otra pestaña, un dato
  viejo), se muestra junto al bloque, no como un error genérico.

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
| Campos personalizados | ✅ | Decidido (D5), ver §2.3. |
| Agente interno | ✅ opt-in por usuario | Decidido (D6), ver §2.4. |
| Fuentes / API keys / eventos de ingesta (webhook de landing) | ✅ | Decidido (D8). |

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

- **Decidido (D7):** se sigue creando la `Delivery`, que queda oculta. Así no
  se bifurca el código de dominio por edición, y si hay upgrade las entregas
  pendientes aparecen como tales. La unidad queda "Vendida" en el stock, que
  es lo que la automotora espera ver.
- **Alternativa descartada:** no crearla en `ESENCIAL`. Es más prolijo para los datos,
  pero mete una rama por edición dentro de una transacción de dominio.

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

### 2.3 Campos personalizados (decidido: incluidos, D5)

Solo existen para contactos (`ContactCustomFieldDefinition`,
`schema.prisma:3067-3106`). El agente los lee en el prompt
(`bloqueDeCamposPersonalizados`) y puede escribir los `agentEditable` con
`update_contact_custom_fields`.

| Opción | A favor | En contra |
|---|---|---|
| **A. Incluir completo (decidida, D5)** | Es la forma de adaptar el contacto sin sumar módulos ("¿tiene auto para entregar?", "forma de pago preferida"). Ya está hecho y es contact-céntrico. | Una pantalla más de configuración. |
| B. Incluir sin `agentEditable` | Menos IA tocando datos. | El nivel de participación ya regula eso (§4). Duplica el control. |
| C. Excluir | Más simple. | Pierde la flexibilidad justo en la edición que no tiene oportunidades ricas. |

### 2.4 Agente interno (decidido: incluido, D6)

Es un asistente para el **personal**, no para el cliente. Crea tareas
(`create_internal_task`) y lee la agenda (`get_agenda`), dos módulos que
están en `ESENCIAL`. Ya es opt-in por usuario (`canUseInternalAgent`,
`requireInternalAgentAccess.ts`).

| Opción | A favor | En contra |
|---|---|---|
| **A. Incluir, opt-in como hoy (decidida, D6)** | El rechazo a la IA es del comprador, no necesariamente del vendedor. Cero costo extra. | Una entrada más en el menú (solo para quien tiene permiso). |
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

### 4.4 Decisión

**Esta etapa incluye (a), (c) y (d)**, en un mismo enum (D4). (b) queda para
la fase 2, con su propio PR de migración.

- (c) y (d) reusan piezas que ya existen y están probadas
  (`derivarEntranteSinAgente`, el horario de la sucursal,
  `puedeEjecutarTool`).
- (b) mete un estado nuevo en el camino de envío de todos los canales. Es
  mejor hacerlo cuando una automotora real pida aprobar mensajes, y no
  especulativamente.

**Agente nuevo en ESENCIAL: sin valor por defecto** (D3). El ADMIN elige el
nivel, y mientras no lo haga el agente no se puede activar (§1.2, "Nivel sin
elegir"). En COMPLETA, los agentes siguen en AUTONOMA.

**Tope de PRIMER_CONTACTO: 2 respuestas, fijo en el código** (D12), como una
constante `MAX_RESPUESTAS_PRIMER_CONTACTO` en `agentOrchestration.service.ts`,
junto a `MAX_TOOL_ROUNDS_PER_TURN`.

**Por agente y no por organización** (D2): el nivel convive con `channels` e
`isActive`, que ya son por agente, y permite combinaciones razonables, como el
widget web en AUTONOMA a las 3 de la mañana y WhatsApp en PRIMER_CONTACTO.

### 4.5 Seguimiento de consultas (#446) según el nivel

| Nivel | Seguimiento automático de consultas |
|---|---|
| AUTONOMA | Como hoy: texto libre de la IA dentro de la ventana de 24 h y plantilla fuera. |
| PRIMER_CONTACTO, SOLO_SEGUIMIENTO | **Siempre la plantilla aprobada**, aun con la ventana abierta. Lo decide `inquiryFollowUpWorker.ts` antes de `generarTexto`, leyendo el nivel del agente del canal. |
| Sin agente en el canal, agente inactivo o nivel sin elegir | **Plantilla aprobada.** El texto libre sale solo con un agente AUTONOMA activo; cualquier otro caso es el lado de menos IA. |
| BORRADOR (fase 2) | Tarea con el texto sugerido (como `agent.draft_follow_up`), sin envío automático. |

Decidido en D9.

---

## 5. Backend como fuente de verdad

> **Implementado en el PR 3.** Esta sección describe lo que quedó en el código.
> El diseño original montaba el gate arriba de todo, en `routes/index.ts`, con
> matchers de path y un `authenticate` idempotente. Se reemplazó por el gate
> dentro de `authenticate` (§5.2), que es más simple y no puede bloquear una
> ruta pública por error.

### 5.1 Catálogo de módulos

Un solo archivo, `src/config/ediciones.ts`, es la fuente de verdad:

```ts
export const MODULOS = [
  "comun", "plataforma", "usuarios", "contactos", "conversaciones", "agentes",
  "canales", "base_de_conocimiento", "sucursales", "agenda", "stock", "tareas",
  "cupones_y_qr", "automatizaciones", "oportunidades", "campos_personalizados",
  "agente_interno", "ingesta",
  "dashboard_atencion",            // reservado sin rutas: llega con el PR 8 (§6.4)
  // solo COMPLETA:
  "procesos_de_venta", "cotizaciones", "pagos", "entregas", "empresas",
  "dashboard_comercial",
  "financiacion", "permutas",      // solo campos, sin rutas propias
] as const;

export const MODULOS_POR_EDICION: Record<OrganizationEdition, ReadonlySet<Modulo>>;
export function modulosDe(edition): ReadonlySet<Modulo>;   // la única que decide
export const RUTAS_POR_MODULO: Record<Modulo, readonly string[]>; // "MÉTODO /api/patron"
export const RUTAS_PUBLICAS: readonly string[];            // rutas sin authenticate
export const MODULOS_SIN_RUTAS: ReadonlySet<Modulo>;       // dashboard_atencion, financiacion, permutas
export const CAMPOS_POR_RUTA: Record<string, { campo; modulo }[]>; // bloqueos por campo (§5.3)
```

Las rutas se escriben con el patrón tal como lo registra Express
(`"GET /api/quotes/:id"`). `docs/rubros.md` extiende `modulosDe` con el rubro:
sigue habiendo un solo gate.

### 5.2 Gate dentro de `authenticate`

**Restricción del repo:** no hay middleware global de auth. Cada ruta declara
`authenticate`, y todos los routers se montan en `/api` sin subprefijo.

**Cómo quedó:**

1. `findUserForAuth` ya hacía `JOIN organizations`: se suma `o.edition` al
   SELECT y `edition` a `AuthContext`. La edición viaja con el contexto de
   autenticación, que ya se cacheaba por usuario (`AUTH_CONTEXT_CACHE_TTL_MS`,
   5 s): **ninguna consulta extra por pedido**. Sale siempre de la base, nunca
   de un header ni del body.
2. `authenticate`, apenas resolvió `req.auth`, llama a
   `exigirModuloDeLaEdicion(req, auth)` (`src/middlewares/moduloDeLaEdicion.ts`).
   Es el único punto que decide; ninguna ruta lo llama a mano.
   - Identifica la ruta por método + `req.baseUrl` + `req.route.path`, el
     patrón exacto que registró Express. Sin regex de paths. `HEAD` cuenta como
     `GET`.
   - **COMPLETA: no-op total.** Retorna antes de buscar nada.
   - **ESENCIAL:** si el módulo de la ruta no está incluido, **403**
     `{ code: "MODULO_NO_INCLUIDO", modulo }` (D10).
3. **Orden de respuestas:** un pedido sin sesión, o con un token inválido,
   sigue dando **401**, porque `authenticate` falla antes de llegar al gate. El
   403 `MODULO_NO_INCLUIDO` solo lo ve un usuario ya autenticado de una
   organización ESENCIAL.
4. **Rutas que no dependen de la edición del usuario.** Las rutas sin
   `authenticate` nunca pasan por el gate, así que no se pueden bloquear por
   error:
   - health;
   - webhooks de WhatsApp, Meta y Google Calendar;
   - ingesta por API key;
   - widget web;
   - callbacks de OAuth y enlaces públicos de QR y cupones;
   - onboarding y aceptar invitación.

   Están listadas en `RUTAS_PUBLICAS`. Las de Plataforma (`/api/admin/*`) sí
   tienen `authenticate`, pero su módulo `plataforma` está en las dos ediciones.
   Las protege `requirePlatformAdmin`, como siempre. La edición de la
   organización **destino** de una importación es asunto del PR 9.
5. **Ruta autenticada sin clasificar, en runtime:** en COMPLETA se permite
   (no-op). En ESENCIAL se bloquea: falla cerrado, con 403
   `MODULO_NO_INCLUIDO`, `modulo: "sin_clasificar"` y un log de error. El test
   de clasificación (§5.4) impide mergearla en las dos ediciones.
6. **Cambio de edición (PR 4, hecho):** `PATCH /api/admin/organizations/:organizationId/edition`
   llama a `vaciarContextosDeAuth()` (el `vaciar()` de la caché de autenticación). Con un solo proceso, el cambio se ve en el acto;
   con varios, en a lo sumo el TTL.

**Caminos que no pasan por HTTP** y el gate no ve. Se cubren en sus propios
puntos, con la misma tabla:

| Camino | Dónde se valida |
|---|---|
| Tools del agente de clientes | `toolsHabilitadas` y `puedeEjecutarTool` (§6.1) |
| Tools del agente interno | Catálogo interno por edición |
| Automatizaciones | Al crear y editar (catálogo por edición) y en `despacharAutomatizaciones` (salta reglas de módulos no incluidos) |
| Importación | `importacionAdmin`: rechaza la entidad "empresas" en ESENCIAL (PR 9) |
| Workers de dominio | No hace falta: solo actúan sobre filas que solo pueden existir si el módulo existe |

### 5.3 Rutas bloqueadas en ESENCIAL

29 rutas, todas con 403 `MODULO_NO_INCLUIDO`:

| Módulo | Rutas |
|---|---|
| procesos_de_venta (10) | `GET, POST /api/pipelines` · `GET, PATCH, DELETE /api/pipelines/:id` · `GET, POST /api/stages` · `GET, PATCH, DELETE /api/stages/:id` |
| cotizaciones (4) | `GET, POST /api/quotes` · `GET, PATCH /api/quotes/:id` |
| pagos (5) | `GET, POST /api/payments` · `GET, PATCH, DELETE /api/payments/:id` |
| entregas (3) | `GET /api/deliveries` · `GET, PATCH /api/deliveries/:id` |
| empresas (5) | `GET, POST /api/companies` · `GET, PATCH, DELETE /api/companies/:id` |
| dashboard_comercial (2) | `GET /api/opportunities/dashboard-summary` · `GET /api/opportunities/revenue-series` |

**Bloqueos por campo:** 400 `{ code: "CAMPO_NO_INCLUIDO", campo, modulo }`.
Salen de `CAMPOS_POR_RUTA` y los aplica el mismo gate. No hay un middleware
ni una refinación por ruta. Un valor `null` no se bloquea, porque es
"desvincular".

| Campo | Rutas | Módulo |
|---|---|---|
| `companyId` | POST/PATCH `/api/contacts`, `/api/opportunities`, `/api/activities` | empresas |
| `financingType`, `financingLender`, `financingDownPayment`, `financingInstallmentCount`, `financingInstallmentAmount` | POST/PATCH `/api/opportunities` | financiacion |
| `tradeInOpportunityId` | POST/PATCH `/api/vehicles` | permutas |
| `pipelineId`, `stageId` | POST/PATCH `/api/opportunities` | **PR 5**, junto con el proceso fijo: sacarlos antes dejaría a ESENCIAL sin poder crear oportunidades |

**Oportunidades sin `/pipelines` ni `/stages`:**
- Marcar **Vendida** o **Perdida** ya funciona con `PATCH status: "WON" | "LOST"`, sin `stageId`. El servicio mueve la oportunidad a la etapa ganada o perdida de su proceso (ítem 154). Lo fija un test del PR 3.
- **Crear** todavía exige `pipelineId` y `stageId`. Eso se resuelve en el PR 5 (§10).

`get_payment_info` del agente lee `Branch.paymentLinkUrl` y los datos de
transferencia de la sucursal; no usa el módulo de pagos. Se mantiene en
ESENCIAL (D11).

En `COMPLETA` no se bloquea nada. El catálogo garantiza que la edición
original se comporte exactamente como hoy.

### 5.4 Tests

1. **Unitario: toda ruta clasificada** (`src/config/ediciones.test.ts`, PR 3).
   Recorre el router de la app real y separa las rutas según si su cadena
   tiene `authenticate` (compara la función, no el nombre). Falla si:
   - una ruta con `authenticate` no está en `RUTAS_POR_MODULO`;
   - una ruta sin `authenticate` no está en `RUTAS_PUBLICAS`;
   - una ruta del catálogo ya no existe en el router;
   - un módulo sin rutas no figura en `MODULOS_SIN_RUTAS`, o uno que figura
     ahí tiene rutas. Por eso `dashboard_atencion`, reservado, no deja el CI
     en rojo; el PR 8 lo saca de esa lista al darle su ruta.

   Es el equivalente del meta-test de `tenant-isolation.integration-test.ts`,
   que obliga a sumar cada modelo nuevo: acá obliga a decidir la edición de
   cada ruta nueva. El mismo archivo prueba el gate sin HTTP: no-op en
   COMPLETA, 403 en ESENCIAL, `sin_clasificar` y los campos.
2. **Integración: suite de ediciones**
   (`src/routes/ediciones.integration-test.ts`, PR 3), contra la app real:
   - Crea dos organizaciones, una `ESENCIAL` y una `COMPLETA`, con ADMIN
     reales de Supabase local. El patrón `ediciones-{etiqueta}-{ts}-{hex8}`
     está registrado en `PATRONES_DE_SLUG_DE_PRUEBA`.
   - **Genera los casos desde `RUTAS_POR_MODULO`**, no a mano. Usa UUIDs
     inventados en el path y, si no es GET, un body que es un array, que todo
     schema rechaza antes de tocar nada.
     - **COMPLETA:** recorre **todas** las rutas del catálogo (afirma que la
       cuenta es el total) y ninguna da `MODULO_NO_INCLUIDO`.
     - **ESENCIAL:** cada ruta excluida da 403 `MODULO_NO_INCLUIDO` con su
       módulo, y cada ruta incluida no lo da.
   - El orden de respuestas: sin token o con un token inválido, 401, también
     en una ruta excluida. El 403 es solo para el autenticado.
   - Bloqueos por campo (400 `CAMPO_NO_INCLUIDO` en ESENCIAL; COMPLETA no los
     ve; `null` pasa).
   - `/api/me` con `edition` y `modulos` en las dos ediciones.
   - ESENCIAL marca una oportunidad Vendida y Perdida sin llamar a
     `/pipelines` ni `/stages`, con el proceso fijo armado en el fixture.
   - **PR 4:** upgrade con `PATCH /admin/organizations/:id/edition` a
     COMPLETA, y la misma ruta pasa. Bajar devuelve 409. Un ADMIN que no es
     platform admin recibe 403.
   - **PR 5:** **crear** una oportunidad en ESENCIAL sin `pipelineId` ni
     `stageId` queda en "En curso" del proceso fijo. Y `pipelineId` o
     `stageId` en el body dan 400 `CAMPO_NO_INCLUIDO`. Es obligatorio.
3. **Agente** (unitarios de `agentPermissions` y del loop):
   - para cada nivel, qué tools se ofrecen y que una llamada forzada a una
     tool no permitida se rechace;
   - el gate de horario;
   - el tope de respuestas de PRIMER_CONTACTO;
   - que SOLO_SEGUIMIENTO no llame al proveedor;
   - que `participation = null` derive sin llamar al proveedor;
   - (PR 6) en ESENCIAL, un nivel escrito **sin** `participation_chosen_at`
     → el agente no responde y deriva; **con** `chosen_at` → responde según el
     nivel. En COMPLETA, el mismo agente sin `chosen_at` responde como hoy;
   - (PR 6) agente borrado no responde: con `deleted_at` puesto e
     `is_active = true` (como lo deja el borrado), el agente no corre el
     turno ni llama al proveedor, en cualquier edición y con cualquier nivel.
4. **Nivel sin elegir**, en dos partes:
   - **PR 2 (base, por cualquier camino):** el test inserta agentes
     **directo con Prisma**, sin pasar por el service, porque así son los
     caminos que no son el service.
     - en una organización ESENCIAL, un insert sin nivel e inactivo queda
       con `participation = null`; el mismo insert con `is_active` en su
       default (`true`) **falla** por el CHECK;
     - en COMPLETA, el insert sin nivel queda en `AUTONOMA` (trigger);
     - el CHECK rechaza un `UPDATE` directo que deje activo un agente sin
       nivel;
     - cambiar la edición de la organización no cambia el nivel de sus
       agentes (el trigger es solo de INSERT).
     - Hoy, los caminos de creación en producción son
       `createAgent` de `agent.service.ts` (que llama al de
       `agent.repository.ts`; lo usan la API y `scripts/seed-dev-data.ts`), `scripts/eval-agente-real.ts` y
       `scripts/smoke-qr-followup-whatsapp.ts` (estos dos con
       `prisma.agent.create`). La importación no crea agentes. El PR 2
       lista en su descripción cuáles cubre el test: todos llegan a la
       base como un INSERT en `agents`, que es lo que el trigger y el CHECK
       ven.
   - **PR 6 (service):** crear en ESENCIAL sin nivel → inactivo; con
     `isActive: true` y sin nivel → 400 `NIVEL_DE_IA_SIN_ELEGIR`; activar sin
     nivel → 400; volver un nivel a `null` → 400; elegir o cambiar el nivel
     escribe `participation_chosen_at` y las asignaciones de plataforma no;
     el upgrade a COMPLETA no le pone nivel a un agente que no lo tenía ni
     toca `chosen_at`.
5. **Automatizaciones:** crear una regla con trigger o acción fuera de la
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
| `update_contact_custom_fields` | ✅ | ✅ (D5) | ✅ | — |
| `get_payment_info` | ✅ | ✅ (D11) | ✅ | — |
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
| Campos personalizados | Incluidos (D5): sin cambios. |
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

El catálogo (`src/config/ediciones.ts`) ya reserva el módulo
`dashboard_atencion`, incluido en las dos ediciones y todavía sin rutas (está
en `MODULOS_SIN_RUTAS`). El PR 8 le agrega `GET /api/dashboard/atencion` y lo
saca de esa lista: el test de clasificación lo obliga.

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
| Agente | Selector **"Cuánto hace la IA"** (nivel), con el interruptor "solo fuera de horario". Sin opción marcada en ESENCIAL y "Activo" deshabilitado hasta elegir (§1.2). Solo las tools posibles. Disponible en las dos ediciones. |
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

Requisito previo, ya abierto: **#450**, que arregla un test de #446 con fecha
fija que empezó a fallar el 2026-10-09 y deja en rojo el CI de cualquier PR.

| # | PR | Migración | Riesgo | Contenido |
|---|---|---|---|---|
| 0 | `chore: borrar archivos vacíos de la raíz` | — | Bajo | `${clave}`, `=` y `opportunityId` entraron por error con #446. Independiente de todo lo demás. |
| 1 | `docs: diseño de ediciones` (#449) | — | Nulo | Solo `docs/ediciones.md`. |
| 2 | `feat(ediciones): columnas edition y participation` 🗄 | Sí | **Bajo-medio** | `organizations.edition` con default `COMPLETA`, sin backfill. `agents.participation` nullable y **sin DEFAULT en la columna**, con un `UPDATE` que deja `AUTONOMA` a todos los agentes existentes. `agents.participation_chosen_at` nullable, sin relleno. `agents.only_outside_business_hours` con default `false`. Trigger `agents_nivel_por_defecto` (BEFORE INSERT: `AUTONOMA` si viene `null` y la organización es COMPLETA), en la migración y en `manual_constraints.sql`. CHECK `agents_activo_requiere_nivel_check`, solo en la migración (B-15). Más lo que pidan `verify:schema` y el diagnóstico. Test de integración de la parte "PR 2" de §5.4 punto 4, con la lista de caminos de creación cubiertos en la descripción del PR. El riesgo sube de "bajo" por el `UPDATE`, el trigger y el CHECK: si el `UPDATE` no cubriera algún agente activo, el CHECK haría fallar la migración entera (que es lo correcto: no deja datos a medias). Ningún código de la app lee las columnas todavía, y gracias al trigger ningún insert existente cambia de comportamiento. |
| 3 | `feat(ediciones): catálogo de módulos y gate central` | — | **Medio-alto** | `src/config/ediciones.ts` (módulos, `modulosDe`, rutas por módulo, rutas públicas, campos por ruta), `edition` en `AuthContext` por el mismo JOIN (sin consulta extra), gate `exigirModuloDeLaEdicion` llamado desde `authenticate` (§5.2), bloqueos por campo salvo `pipelineId`/`stageId`, `edition` y `modulos` en `/me`, test "toda ruta clasificada" contra el router real, suite `ediciones.integration-test.ts` y slug. Toca cada request autenticado: el barrido de COMPLETA por todo el catálogo es la red. |
| 4 | `feat(plataforma): elegir y subir la edición` | — | Medio | **Hecho.** `edition` opcional en el alta (default COMPLETA); con ESENCIAL, el proceso de venta fijo (`PROCESO_DE_VENTA_FIJO` en `ediciones.ts`) en la misma transacción. `PATCH /api/admin/organizations/:organizationId/edition`: ESENCIAL → COMPLETA, la misma edición es 200 sin cambios, bajar es 409; después de subir, `vaciarContextosDeAuth()`. `GET /api/admin/organizations/editions` (clasificada en `plataforma`) y `edition` en el listado. **ESENCIAL no se ofrece todavía:** una sola llave, `ESENCIAL_HABILITADA = false` en `src/config/ediciones.ts`. El alta la consulta por `edicionesDisponibles()` y responde 400 a ESENCIAL antes de mandar la invitación. La pantalla "Nueva organización" le pregunta al backend las ediciones disponibles y solo muestra el selector si hay más de una, así que hoy queda igual que siempre. Los dos valores de la llave están probados (service con la llave inyectada, vitest con una y dos ediciones). La pantalla "Pasar a edición completa" y la guía pasan al PR 5. |
| 5 | `feat(oportunidades): versión mínima en ESENCIAL` | — | Medio | Crear sin `pipelineId`/`stageId` en ESENCIAL (el servidor usa el proceso por defecto y su primera etapa abierta, como `create_opportunity` del agente), y esos dos campos pasan a 400 `CAMPO_NO_INCLUIDO` en `CAMPOS_POR_RUTA`, con el test obligatorio de §5.4. Status→etapa con el proceso fijo (Vendida y Perdida ya andan por el ítem 154), lista y formulario simples, entrega creada y oculta (D7), sección 04 de la guía. **Además, obligatorio:** poner `ESENCIAL_HABILITADA = true` (y la línea del test que fija su valor en `organizationAdmin.controller.integration-test.ts`); la pantalla de Plataforma "Pasar a edición completa" (lista de organizaciones con su edición, usando `GET /api/admin/organizations` y el `PATCH .../edition` del PR 4, con confirmación); y **actualizar la sección 14 de la guía de uso**: la edición ESENCIAL, el selector en "Nueva organización" y la pantalla "Pasar a edición completa". |
| 6 | `feat(agente): nivel de participación (a, c, d)` | — | **Medio-alto** | Reglas del "nivel sin elegir" en el service de agentes (D3), escritura de `participation_chosen_at` solo al elegir o cambiar el nivel, y bloque "Cuánto hace la IA" en el formulario. **Filtro por edición y nivel**: en ESENCIAL el agente atiende solo con `participation_chosen_at` no `null`; en COMPLETA esa columna no se mira (§1.2, "Pendiente del PR 6"). El filtro mira también `deleted_at`: el borrado deja `is_active = true` (§1.2, "un agente borrado no atiende"), con su test. Gate de horario, tope fijo de 2 respuestas (D12), filtro de tools en los dos lugares, pausa al derivar en PRIMER_CONTACTO, SOLO_SEGUIMIENTO y `null` sin modelo, widget web, seguimiento de consultas con plantilla (§4.5, D9). Sección 08 de la guía. Es la parte más delicada del agente: tests del loop por nivel, incluido el de `chosen_at`. |
| 7 | `feat(ediciones): menú, pantallas y guía por edición` | — | Medio | `useModulo`, `ModuloRoute`, menú, contactos sin empresa, stock sin permuta, catálogo de automatizaciones, filtro de la guía y test de `AYUDA`. |
| 8 | `feat(dashboard): dashboard de atención` | — | Bajo | Endpoint y pantalla de §6.4. |
| 9 | `feat(importacion): sin empresas en ESENCIAL` | — | Bajo | Rechazo de la entidad y aviso en la vista previa. |

**Orden:** #450, 0 y 1 cuando sea. 2 → (autorización y aplicación) → 3 → 4 → 5,
6 y 7 en ese orden (6 puede ir en paralelo con 5) → 8 y 9.

**Hasta que esté el PR 4 nadie puede crear una organización ESENCIAL.** Antes
de eso, todo lo que se mergea es inerte para las organizaciones existentes.

### Camino a habilitar ESENCIAL (acordado el 2026-10-09)

Después del PR 4 se verificó que hoy una organización ESENCIAL no es usable:

- **No puede crear agentes activos.** `POST /api/agents` sin `isActive` da
  500, porque el CHECK rechaza el agente activo sin nivel. Y la API descarta
  `participation`.
- **Nada aplica el nivel de IA.** Ningún código fuera de los tests lee
  `participation` ni la edición en el agente.

Por eso el PR 5 se partió, y `ESENCIAL_HABILITADA` pasa a `true` **solo en el
último paso**. Todos los demás la dejan en `false`, ninguno lleva migración, y
cada uno deja a COMPLETA igual que hoy:

| Paso | PR | Contenido |
|---|---|---|
| A | `feat(plataforma): pantalla Organizaciones` | **Hecho.** Plataforma → Organizaciones con la edición y "Pasar a edición completa" (confirmación, sobre el `PATCH` del PR 4). Se muestra recién cuando el backend ofrece ESENCIAL: hasta H, el platform admin no ve nada nuevo. |
| B | `feat(oportunidades): crear sin proceso de venta en ESENCIAL` | **Hecho.** Sin el módulo `procesos_de_venta` (lo decide `modulosDe`, no la edición a mano), `POST /api/opportunities` no lleva `pipelineId` ni `stageId` (400 `CAMPO_NO_INCLUIDO`, también en el PATCH) y el servidor elige el proceso por defecto y la etapa del status pedido (`procesoDeVentaPorDefecto`: Vendida para WON, Perdida para LOST, la primera abierta si no); sin proceso por defecto, 409. COMPLETA usa el mismo schema de siempre. La tool `create_opportunity` del agente mantiene su propia resolución: unificarlas queda para D. |
| C | `feat(agente): nivel de IA en la API y el formulario` | **Hecho.** API: `participation` y `onlyOutsideBusinessHours` al crear y editar, con las reglas de `src/services/agentNivelDeIa.ts`. En ESENCIAL sin nivel, el agente nace inactivo; activarlo sin nivel da 400 `NIVEL_DE_IA_SIN_ELEGIR` (en vez del 500 del CHECK). Un nivel elegido no vuelve a null, y BORRADOR no existe. `participation_chosen_at` lo escribe solo el servicio, al elegir o cambiar el nivel. "Solo fuera de horario" va solo con PRIMER_CONTACTO y exige el horario de la sucursal. COMPLETA queda igual (el trigger pone AUTONOMA). Formulario: el bloque "Cuánto hace la IA" se muestra **solo en ESENCIAL**, sin nivel por defecto, con "Activo" deshabilitado hasta elegir; en COMPLETA no cambia nada de lo que se ve ni de lo que se manda. |
| D | `feat(agente): el loop respeta la edición y el nivel` | Parte 2 del PR 6. **Su diseño se muestra y se aprueba antes de escribir código.** Pasan acá desde C, porque recién con D el agente cumple el nivel: **mostrar el selector "Cuánto hace la IA" también en COMPLETA** (preseleccionado en el nivel del agente), **la sección 08 de la guía** (`{#cuanto-hace-la-ia}`) y la etiqueta "Sin nivel de IA · inactivo" en la lista de agentes (§1.2). |
| E | `feat(ediciones): menú, pantallas y guía por edición` | PR 7, con la lista y el formulario simples de oportunidades del PR 5. |
| F | `feat(dashboard): dashboard de atención` | **Hecho** (PR 8). `GET /api/dashboard/atencion?granularity=month|week|day`, en el módulo `dashboard_atencion` del catálogo, que deja de estar en `MODULOS_SIN_RUTAS`. Período en la zona de la organización, igual que el comercial. Devuelve conversaciones nuevas por canal, derivaciones, derivaciones sin respuesta a tiempo (avisos `UNANSWERED_HANDOFF`), consultas esperando respuesta (último mensaje del cliente, contacto vigente y sin "sin interés", sin oportunidad abierta), seguimientos agendados y tareas vencidas. En el inicio, una organización sin `dashboard_comercial` ve estas tarjetas, el stock y la actividad reciente, y no se monta nada que lea oportunidades. COMPLETA no cambia. |
| G | `feat(importacion): sin empresas en ESENCIAL` | **Hecho** (PR 9). La regla vive en `src/services/importacionEdicion.ts`, porque la importación no pasa por el gate: sin el módulo `empresas` en la organización destino (`modulosDe`), un lote de empresas da 400 al subirlo, antes de leer el archivo y sin crear la fuente. En un lote de contactos, la columna mapeada a empresa se ignora con una advertencia por fila en la vista previa, y no se crea ni se vincula ninguna empresa aunque el lote tenga `crearEmpresas`. La misma regla se aplica de nuevo al promover (escribe en la base). |
| H | `feat(ediciones): habilitar ESENCIAL` | `ESENCIAL_HABILITADA = true` y la línea del test que fija su valor. Secciones **14 y 04** de la guía, con el ancla de "Organizaciones" y su `help` (`AYUDA`) en la pantalla. Test de punta a punta. **Antes de H** se escribe y se aprueba un plan de prueba de punta a punta con una organización ESENCIAL de prueba creada por el platform admin. |

Antes de cada PR se repite `gh pr list --state open` por si apareció otro que
toque los mismos archivos (hay trabajo de rubros en paralelo).

**Fuera de este plan (fase 2, D4):** `feat(agente): borradores con aprobación
(b)` 🗄, con riesgo alto (§4.2 b). Se arma cuando haya un pedido concreto.
Lleva su propia migración: el valor `BORRADOR` del enum y el estado de
borrador en `messages`.

---

## 11. Decisiones

Tomadas el 2026-10-09 sobre las preguntas abiertas de la primera versión de
este documento.

| # | Pregunta | Decisión | Dónde se aplica |
|---|---|---|---|
| D1 | Nombre de la edición simple | **`ESENCIAL`**. Descartados: `CLASICA`, `ATENCION`. | §1.1 |
| D2 | Dónde vive el nivel de IA | **Por agente.** Descartado: por organización. | §1.2, §4.4 |
| D3 | Nivel por defecto de un agente nuevo en ESENCIAL | **Sin valor por defecto.** Hay que elegirlo; sin nivel el agente no se puede activar. Lo valida el service y lo respalda la base: un trigger completa `AUTONOMA` solo en COMPLETA, y un CHECK impide un agente activo sin nivel. En ESENCIAL, el agente responde solo si consta que un ADMIN eligió el nivel (`participation_chosen_at`). En COMPLETA, AUTONOMA. Ajustado el 2026-10-09 al preparar el PR 2: un `DEFAULT` en la columna habría dejado con nivel a cualquier agente de ESENCIAL creado sin pasar por el service, y sin `DEFAULT` ni trigger fallaban los inserts existentes. | §1.2 "Nivel sin elegir", §5.4, §10 |
| D4 | Borradores con aprobación (b) | **Fase 2.** Ahora solo a, c y d. | §4.4, §10 |
| D5 | Campos personalizados en ESENCIAL | **Incluidos.** | §2, §2.3, §6.1 |
| D6 | Agente interno en ESENCIAL | **Incluido**, activado por usuario como hoy (`canUseInternalAgent`). | §2, §2.4 |
| D7 | Entrega al marcar Vendida con una unidad vinculada | **Se crea igual y queda oculta.** | §2.1 |
| D8 | Webhook de landing, fuentes y API keys en ESENCIAL | **Incluidos.** | §2 |
| D9 | Seguimiento de consultas con niveles bajos de IA | **Siempre la plantilla aprobada.** Texto libre solo con un agente AUTONOMA activo. | §4.5 |
| D10 | Respuesta a una ruta de un módulo excluido | **403 `MODULO_NO_INCLUIDO`.** | §5.2 |
| D11 | `get_payment_info` en ESENCIAL | **Incluida.** | §5.3, §6.1 |
| D12 | Tope de respuestas de PRIMER_CONTACTO | **2, fijo en el código.** | §4.2 (c), §4.4 |
