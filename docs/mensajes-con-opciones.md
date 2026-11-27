# Mensajes con opciones: botones y listas resueltos por código

> Documento de diseño. Estado: **diseño aprobado, sin código** (decisiones de
> Rocco del 2026-11-27 en §9). Fecha: 2026-11-27.
> Las referencias `archivo` y `función` son de `master` en d0e1c76 (merge de
> #663). Los ejemplos usan datos ficticios.

## 0. De qué se trata

Hoy todo lo que escribe un contacto pasa por la IA, incluso cuando la respuesta
es una elección cerrada: qué prestación quiere, qué horario le sirve, si
confirma. Eso cuesta tokens, suma segundos por turno (~10–15 s de modelo) y
abre la puerta a errores de interpretación. Un ejemplo: en una prueba real, el
agente contestó "te lo reservo" sin llamar a `create_booking`, y la guarda de
salida lo tuvo que reemplazar por "Perdón, me expresé mal…".

La propuesta: **los pasos estructurados se resuelven con mensajes con opciones
(botones y listas de WhatsApp) y con código; la IA queda para el texto libre.**

- **Bienvenida** al primer contacto: "¡Hola! Soy {asistente}, la asistente
  virtual de {organización}. ¿En qué te puedo ayudar?", con tres botones:
  **Agendar un turno**, **Más información** y **Hablar con alguien**.
- **Agendar un turno:** flujo de listas resuelto por código (prestación →
  horario → apellido si falta → confirmación). Reutiliza los servicios que hay
  debajo de `get_service_types`, `get_availability`, `update_lead` y
  `create_booking`.
- **Más información:** una lista de temas. Lo estructurado (horarios,
  dirección, precios, medios de pago) lo resuelve el código; lo abierto
  (preguntas frecuentes) lo responde la IA con la base de conocimiento.
- **Hablar con alguien:** la derivación que ya existe (el agente se calla, se
  crea la tarea para Recepción, se avisa al contacto y, fuera de horario, se le
  dice cuándo le responden).
- **Texto libre en cualquier momento:** responde la IA, como hoy.

Principio: **el SaaS da capacidades y el negocio configura el
comportamiento.** El código trae los flujos y los defaults por rubro. Cada
organización elige qué botones, textos y temas muestra.

**Relación con `docs/primera-clinica.md` §3.3** ("Menú de bienvenida, segunda
fase", y sus PR10 y PR11): este documento lo reemplaza y lo amplía. Allí
"Agendar" mandaba el link de la reserva en línea y "Más información" hacía un
turno normal del agente. Acá los dos pasan a ser flujos por código, y el link
queda como alternativa para quien prefiera la web (§3.3). Los diagnósticos de
§3.3 siguen valiendo: no se envían interactivos, el webhook no lee el id del
botón y hace falta que el agente se calle.

---

## 1. Cómo llegan las respuestas y cómo se enrutan

### 1.1 Qué hay hoy

| Pieza | Estado | Dónde |
|---|---|---|
| Envío de interactivos (`type: "interactive"`) | **No existe.** Solo texto y plantillas | `whatsappGraph.service.ts`: `sendWhatsappTextReal`, `sendWhatsappTemplateReal` |
| Lectura de `interactive.button_reply` / `list_reply` | Lee **solo el título**, como texto; ni el `id` ni el `context.id` | `whatsappWebhook.service.ts`: `interactivoSchema`, `leerMensaje` |
| Botones de plantilla (`type: "button"`) | Lee `payload` y `context.id` | `whatsappWebhook.service.ts`: `botonSchema`, `MensajeLeido.boton` |
| Algo resuelto por código antes del modelo | **Un solo caso:** la respuesta al recordatorio de turno (Confirmo / Necesito cancelar) | `agentInboundWorker.ts` → `resolverRespuestaDelRecordatorio` (`src/clinicas/recordatorios/respuesta.service.ts`) |
| Estado de la conversación (en qué paso está) | **No existe.** `Conversation` no tiene columnas de paso ni JSON | `prisma/schema.prisma`, `model Conversation` |
| Marcas por turno | `Message.toolCalls` ya se usa como estado de dos pasos (el resumen de `cancel_booking`) y como auditoría de las reglas del rubro | `src/clinicas/toolsDeTurnos.ts`, `reglasDelRubro.ts` |

### 1.2 Qué manda WhatsApp (verificado en la documentación de Meta)

Respuesta a un botón:

```json
{
  "from": "59899000000",
  "id": "wamid.ENTRANTE",
  "type": "interactive",
  "context": { "from": "59829000000", "id": "wamid.DEL_MENU" },
  "interactive": {
    "type": "button_reply",
    "button_reply": { "id": "op1.bienvenida.agendar", "title": "Agendar un turno" }
  }
}
```

Respuesta a una lista: `interactive.type = "list_reply"` y
`list_reply: { id, title, description }`. El `context.id` es el wamid del
mensaje que tenía la lista o los botones.

Fuente: [webhook `interactive`](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/interactive).
Para comparar, el botón de una plantilla llega como `type: "button"` con
`button: { payload, text }`
([webhook `button`](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/button)).

**Aviso de Meta sobre la identidad:** con los nombres de usuario de WhatsApp
(BSUID), `from` y `wa_id` pueden no venir, y Meta recomienda identificar al
usuario con `user_id`. Esto no es de este diseño, pero el parser nuevo no
debe empeorarlo. Queda como tarea aparte (D12).

### 1.3 El id de cada opción

El `id` lo elegimos nosotros. Formato propuesto:

```
op1.<flujo>.<paso>[.<valor>]
op1.bienvenida.agendar
op1.reserva.prestacion.3f2c…           (uuid de la prestación)
op1.reserva.horario.20261204T1530.7a1e…  (inicio local + uuid del profesional)
op1.reserva.confirmar
op1.info.horarios
```

- `op1` es la **versión** del esquema. Un botón con otra versión, o que no
  parsea, se trata como texto y va a la IA.
- Cabe en los topes: 200 caracteres para una fila de lista y 256 para un
  botón (§2).
- **El id no es de confianza.** Todo valor se vuelve a validar en el
  servidor: que la prestación sea de la sede, que el horario siga libre y que
  el contacto pueda reservar. Ninguna acción se hace solo porque lo dice el id.

### 1.4 Dónde se guarda lo que tocó

Hoy `Message.content` guarda el título ("Agendar un turno") y el id se pierde
antes de llegar al worker.

- **🗄 `messages.option_id`** (varchar 256, NULL). Es el id de la opción
  tocada, en el mensaje entrante.
- **🗄 `messages.reply_to_external_id`** (varchar 255, NULL). Es el
  `context.id`: a qué mensaje respondió.
- El título sigue en `content`, así que la conversación se lee igual en el
  CRM.
- El mensaje saliente con opciones guarda sus opciones en un campo nuevo
  **🗄 `messages.options`** (JSON, NULL): tipo (botones o lista), ids y
  títulos. Sirve para mostrarlo en el CRM y para validar respuestas viejas
  (§7.3).

### 1.5 El enrutador: código o IA

El enrutador va en **`responderSinMedir`** (`agentOrchestration.service.ts`),
en el "PUNTO DE EXTENSIÓN DE ENTRADA". Ahí lo ven todos los canales: el worker
de WhatsApp, Messenger e Instagram, y el turno síncrono del chat web.
Precedente: `responderConDecisionDelRubro`, que ya responde sin modelo.

Orden propuesto en cada turno:

1. **Regla prioritaria del rubro** (urgencia de salud): gana siempre, como
   hoy.
2. **Una persona atiende** (`humanoAtiendeLaConversacion`) o **el agente
   quedó callado por una regla** (`calladoPorUnaReglaDelRubro`): no se manda
   nada, como hoy.
3. **Respuesta al recordatorio:** sigue en el worker, antes de todo esto, sin
   cambios.
4. **Enrutador de opciones** (nuevo):
   - el mensaje tiene `option_id` válido → **lo resuelve el flujo** (§1.6);
   - el flujo está esperando un dato de texto (el apellido, §1.6) y el texto
     tiene la forma esperada → **lo resuelve el flujo**;
   - corresponde la bienvenida (§4) → **se manda la bienvenida**;
   - si no, sigue.
5. **Nivel de IA** (`decidirAtencion`), las reglas de entrada y **el modelo**,
   como hoy.

Una respuesta del flujo se guarda como mensaje `AUTOMATION`, igual que la del
recordatorio, y **no llama al modelo**.

**Por qué el flujo va antes del nivel de IA:** así funciona también con la IA
apagada o en "solo fuera de horario". Una clínica sin IA podría tener igual el
menú y la reserva por botones (D10).

### 1.6 Estado del flujo

**🗄 `conversations.flow_state`** (JSON, NULL), validado con zod en el código:

```ts
{
  version: 1,
  flujo: "reserva",
  paso: "horario",            // prestacion | horario | apellido | confirmar
  datos: {
    serviceTypeId: "…",
    resourceId: "…" | null,   // null = el primero libre
    inicio: "2026-12-04T15:30:00-03:00"
  },
  menuExternalId: "wamid.DEL_MENU",  // último mensaje con opciones del flujo
  actualizadoEn: "…",
  venceEn: "…"                // pasado esto, el estado no vale (por defecto 30 min)
}
```

- **Una columna, no una tabla:** hay a lo sumo un flujo activo por
  conversación, y así no hace falta tabla nueva con RLS, diagnóstico y FKs
  compuestas (D1).
- **Se escribe dentro del lock de la conversación** (`conLockDeConversacion`)
  y con compare-and-swap sobre `paso`, así que dos toques rápidos no avanzan
  dos veces.
- **Se borra** al terminar (turno creado o derivación), al vencer, al cerrar la
  conversación y cuando el contacto toca otra vez la bienvenida.
- **El único dato que se acepta como texto dentro de un flujo es el
  apellido**: 1 a 3 palabras, solo letras, sin dígitos. Cualquier otro texto va
  a la IA (§7.1).

---

## 2. Límites de WhatsApp (documentación oficial de Meta, 2026-11-27)

| Elemento | Tope | Fuente |
|---|---|---|
| Botones de respuesta | **máx. 3**; título **20 caracteres**, único en el mensaje; id 256 | [reply buttons](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages) |
| Cuerpo con botones | 1024 caracteres; pie 60 | idem |
| Lista: filas | **máx. 10 en total** (sumando todas las secciones); hasta 10 secciones | [list messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-list-messages) |
| Lista: fila | título **24**; descripción **72** (opcional); id **200** | idem |
| Lista: botón que la abre | 20 caracteres, uno solo | idem |
| Lista: cuerpo / encabezado / pie | 4096 / 60 (solo texto) / 60 | idem |
| Plantilla con botones (para iniciar) | hasta 10 respuestas rápidas, etiqueta de 25 | [template components](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components) |

**Ventana de 24 horas:** los interactivos son mensajes de servicio. Solo se
pueden mandar con la ventana abierta, que se abre o renueva con cada mensaje
del contacto. Fuera de ella solo van plantillas
([send messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages),
[pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)).
La bienvenida y los flujos siempre responden a un mensaje entrante, así que
caen dentro de la ventana. Lo que inicia la clínica (recordatorio, reseña)
sigue con plantilla, como hoy.

**Costo (cambió hace poco):** desde el **1 de octubre de 2026**, Meta volvió a
cobrar los mensajes de servicio, con **1.000 gratis por mes por número**. Sin
medio de pago, pasado ese tope Meta **deja de entregarlos** ([pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)).

Cada mensaje con opciones cuenta. Los números y el criterio están en §2.1.

**Qué implica para el diseño:**

- **Prestaciones:** con hasta 9 entra todo en una lista. Con más de 9 van 9
  filas y una décima "Ver más", que pagina.
- **Horarios:** los 9 más cercanos y una fila "Otro día", que pide el día con
  una lista de los próximos 10 días con lugar.
- **Títulos de fila de 24 caracteres:** "Consulta dermatológica" (22) entra.
  Si no entra, se corta con "…" y el nombre completo va en la descripción.
- **Descripción de 72:** ahí van el profesional, la duración y el precio.
  Ejemplo: "Dra. Ejemplo · 30 min · $ 2.000".
- **Botones de 20:** "Agendar un turno" (16), "Más información" (15) y
  "Hablar con alguien" (18) entran. La pantalla de configuración valida el
  largo al guardar.

### 2.1 Costos: reserva por IA vs. por botones

**Tarifa de Meta para Uruguay** (mercado "Rest of Latin America"), de la
planilla oficial en USD enlazada en la
[página de precios](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
("Cost per message in USD on the WhatsApp Business Platform, effective
October 1, 2026"). Es por mensaje entregado:

| Categoría | US$ por mensaje |
|---|---|
| Servicio (respuestas dentro de la ventana, incluidos botones y listas) | 0,0113. Los primeros 1.000 por mes y por número son gratis |
| Utilidad (plantillas: recordatorio, reseña) | 0,0113. Desde el 1/10/2026 se cobra aunque la ventana esté abierta. Con volumen baja a 0,0107 (más de 100.000 por mes) |
| Marketing | 0,0740 |

**Costo de IA medido** en `llm_turn_usages`, en una prueba real por WhatsApp
de una organización de demostración del rubro clínica (2026-11-27,
`claude-haiku-5.5`, 17 turnos):

- **por turno:** US$ 0,0020 en promedio (entre 0,0009 y 0,0042), con unos
  18.000 tokens de entrada y 470 de salida;
- **una reserva completa:** **US$ 0,0099**, en 4 turnos y con 4 mensajes del
  agente.

Es el costo que informa el proveedor del modelo, con caché del prompt
incluida.

**Costo por reserva** (sin contar el aviso de privacidad, que sale igual en
los dos casos):

| Reserva | Mensajes de servicio | Tokens (US$) | Dentro de los 1.000 gratis | Pasados los 1.000 |
|---|---|---|---|---|
| Por IA, 3 mensajes | 3 | 0,0099 | **0,0099** | **0,0438** |
| Por IA, 4 mensajes (lo medido) | 4 | 0,0099 | **0,0099** | **0,0551** |
| Por botones, 5 mensajes | 5 | 0 | **0,0000** | **0,0565** |
| Por botones, 6 mensajes (con el pedido de apellido) | 6 | 0 | **0,0000** | **0,0678** |

**Criterio:**

- **Los botones se justifican por velocidad y confiabilidad, no por costo.**
  Hay que tener en cuenta tres cosas:
  - un solo mensaje de Meta (US$ 0,0113) cuesta más que todos los tokens de
    una reserva (US$ 0,0099);
  - pasados los 1.000 gratis, cada mensaje de más cuesta más de lo que se
    ahorra en IA;
  - la diferencia es de ±1 centavo por reserva, en cualquier sentido.
- **Los 1.000 gratis son por número y para todos los mensajes de servicio**,
  no solo para los flujos. Una clínica con movimiento los pasa igual.
- **El diseño tiene que minimizar mensajes:**
  - **un mensaje por decisión:** el resumen del turno va en el mismo mensaje
    que los botones **Confirmar** / **Cambiar**, no en uno aparte;
  - **la confirmación final lleva los datos del turno y las indicaciones**
    (llegar antes, medios de pago) en un solo mensaje, no en "listo" + detalle;
  - **sin pasos que no deciden nada:**
    - si hay una sola prestación, no se pregunta cuál;
    - si el primer mensaje ya nombra la prestación ("quiero una consulta
      dermatológica") o la IA ya la sabe, se arranca en el horario;
    - el apellido se pide solo si falta;
  - **sin textos de transición** ("Perfecto, ahora te muestro los
    horarios…"): la lista lleva su propio cuerpo;
  - el aviso de privacidad dentro del cuerpo de la bienvenida ahorraría un
    mensaje en cada primer contacto. **Por ahora no** (D13): sigue aparte
    hasta la revisión legal del aviso.
- Con esas reglas, una reserva típica queda en **4 o 5 mensajes**:
  1. bienvenida;
  2. lista de prestaciones (se saltea si hay una sola o si ya se sabe);
  3. lista de horarios;
  4. resumen con Confirmar / Cambiar;
  5. turno confirmado con sus datos.

  Son los mismos mensajes que por la IA, pero sin tokens ni errores de
  interpretación.

**Política de "AI Providers" de Meta.** No cambia esta cuenta, según los textos
oficiales leídos el 2026-11-27:

- **La página de precios define el servicio así:** "Any non-template message
  _not_ powered by the Meta Business Agent Platform. These can be powered by a
  3rd-party AI solution or people (like customer service representatives)."
  ([pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)).
- **La política de AI Providers apunta a otra cosa:**
  - empieza aclarando que "This does NOT change how Meta charges all other
    businesses";
  - "AI Providers are only permitted to offer general-purpose AI assistants on
    the WhatsApp Business Platform where Meta is legally required to permit this
    use case";
  - cobra solo en los mercados donde la ley obliga a Meta a permitirlo, con
    categoría propia `general_purpose_ai`. Uruguay no está en la lista
  ([AI Providers](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/ai-providers)).
- **Lectura:** un negocio que usa IA de terceros para atender a sus propios
  clientes desde su propio número manda mensajes de servicio comunes.
  - La definición de "AI Provider" en los términos (enero 2026) es amplia, y
    Meta decide a su criterio.
  - Para no acercarse a esa definición, el agente se mantiene acotado al
    negocio y no funciona como asistente de propósito general. Hoy ya es así,
    con las reglas y guardas del agente.
  - Queda como punto a confirmar en la revisión legal (D11).

---

## 3. Configuración: organización, sucursal y agente

### 3.1 Qué hay

- **Agente** (una sucursal, varios canales): `name`, `instructions`,
  `enabledTools`, `channels`, `participation` (nivel de IA). Se valida en
  `agent.controller.ts` y se edita en `AgentFormPage.tsx`.
- **Clínica:**
  - `ClinicSettings` (por organización): término del contacto, aviso de
    privacidad, mensajes de salud;
  - `ClinicBranchSettings` (por sede): recordatorios y plazo para cambiar un
    turno.
  - Los defaults viven en código (`CONFIGURACION_DE_SEDE_POR_DEFECTO`) y, si no
    hay fila, se usan los defaults.
- **Rubro:**
  - `reglasDelRubro(industry)` (automotora / clínica) y los textos de
    `textosDeClinica`;
  - `MODULO_DE_LA_TOOL` en `src/config/ediciones.ts`.
- **Datos que los flujos pueden leer estructurados:**
  - horario de atención: `BranchBusinessHours`, o el horario por defecto;
  - prestaciones, duración y precio: `ServiceType`;
  - profesionales de cada prestación;
  - medios de pago: `Branch.paymentLinkUrl` y `bankTransferDetails`.
- **Lo que no existe estructurado:**
  - **dirección**: no hay columna; hoy está como texto en la base de
    conocimiento;
  - **nombre "de persona" de la asistente**: `agents.name` es interno
    ("Recepción virtual").

### 3.2 Propuesta

**🗄 `agents.options_config`** (JSON, NULL = los defaults del rubro), validado
con zod `.strict()`. La configuración va por agente porque el agente ya es de
una sucursal y define los canales, así que cubre "por sucursal" sin otra capa.

```ts
{
  version: 1,
  activo: true,                     // apagado por defecto en los agentes existentes
  nombreDeLaAsistente: "Sofía",     // opcional (D4)
  bienvenida: {
    texto: "¡Hola! Soy {asistente}, la asistente virtual de {organizacion}. ¿En qué te puedo ayudar?",
    botones: ["agendar", "informacion", "humano"],   // orden y cuáles (máx. 3)
    titulos: { agendar: "Agendar un turno", informacion: "Más información", humano: "Hablar con alguien" },
    volverAMostrarTrasDias: 7       // §4.1
  },
  reserva: { elegirProfesional: "si_hay_mas_de_uno" },  // D7
  informacion: {
    temas: [
      { tipo: "HORARIOS", titulo: "Horarios" },
      { tipo: "DIRECCION", titulo: "Cómo llegar" },
      { tipo: "PRECIOS", titulo: "Precios" },
      { tipo: "MEDIOS_DE_PAGO", titulo: "Medios de pago" },
      { tipo: "ENTRADA", titulo: "Cuidados previos", entradaId: "…" },  // texto tal cual de la base
      { tipo: "PREGUNTA", titulo: "Otra pregunta" }                      // pasa a la IA
    ]
  }
}
```

- **Variables:** `{asistente}`, `{organizacion}`, `{sede}`, `{contacto}` (el
  nombre si se conoce) y `{termino}` (paciente / cliente).
- **Los títulos se validan** contra los topes de §2 al guardar.
- **Tipos de tema:**
  - `HORARIOS`: arma el texto desde `BranchBusinessHours`, con el mismo
    `describirHorario` del prompt;
  - `PRECIOS`: la lista de prestaciones con su precio;
  - `MEDIOS_DE_PAGO`: las columnas de `Branch`;
  - `DIRECCION`: **🗄 columna nueva `branches.address`** (texto) más un link
    de mapa opcional (D6);
  - `ENTRADA`: manda tal cual el contenido de una entrada de la base de
    conocimiento, como ya hace `INDICACIONES`;
  - `PREGUNTA`: le dice al contacto "Contame tu pregunta" y su próximo texto
    va a la IA, con la base de conocimiento, como hoy.

### 3.3 Defaults por rubro (en código, no en la base)

| | Clínica | Automotora |
|---|---|---|
| Botones de la bienvenida | Agendar un turno · Más información · Hablar con alguien | Ver autos · Agendar una visita · Hablar con un vendedor |
| Flujo de "agendar" | Reserva de prestación (§0) | Prueba de manejo o visita (segunda etapa, §8) |
| Temas de "Más información" | Horarios · Cómo llegar · Precios · Medios de pago · Otra pregunta | Horarios · Cómo llegar · Financiación · Otra pregunta |
| Variante con turno futuro | "Mis turnos" en lugar de "Agendar un turno" (§4.2) | — |
| Link a la reserva web | Fila "Prefiero reservar en la web" si la reserva en línea está activa (`primera-clinica.md` §2) | — |

Los defaults van junto a `reglasDelRubro`. Para eso, la interfaz
`ReglasDelRubro` suma `opcionesPorDefecto`. **La automotora no cambia hasta
que se active**: `activo: false` y el snapshot del prompt de la automotora
igual.

---

## 4. Cuándo se manda la bienvenida

### 4.1 Reglas

Se manda si se cumplen **todas** estas condiciones:

1. el agente tiene `options_config.activo` y el canal admite opciones (§5);
2. **es el primer mensaje del contacto** (no hay mensajes suyos anteriores) o
   **vuelve después de `volverAMostrarTrasDias`** sin escribir (por defecto
   7). Se mide con el último entrante (`findLastInboundAt`);
3. ninguna persona atiende la conversación, y no hay una urgencia ni un flujo
   en curso;
4. **el mensaje no pide algo concreto** (D2). Un saludo o un mensaje muy
   corto ("hola", "buenas", "info") recibe la bienvenida. "Quiero un turno
   para mañana a la tarde" va directo a la IA, porque el menú ahí sería un
   paso de más. La detección es por código: hasta 4 palabras y una lista de
   saludos por rubro. Ante la duda, gana la IA.

### 4.2 Contacto con turno futuro

Si el contacto tiene un turno **confirmado y futuro**, y su identidad alcanza
para mostrarlo (`datosQueFaltanParaActuar` / `bloqueoPorIdentidad`, las mismas
reglas de `get_contact_bookings`):

- **la bienvenida cambia el primer botón** a **"Mis turnos"**;
- "Mis turnos" muestra el próximo turno, con tres botones: **Confirmo**,
  **Cambiar horario** y **Cancelar**;
  - "Cambiar horario" entra al flujo de reserva en el paso de horario, con la
    prestación ya elegida, y termina en `reprogramarTurno`;
  - "Cancelar" usa la misma confirmación de dos pasos y el mismo
    `minHoursToChangeBooking` que `cancel_booking`;
  - fuera de plazo, va la derivación con el mismo texto que hoy;
- con dos turnos futuros (el tope es 2), aparece primero una lista para
  elegir cuál.

### 4.3 Aviso de privacidad

Va **antes** de la bienvenida y en el mismo turno, con el mismo
compare-and-swap de `contacts.privacy_notice_sent_at`
(`registrarAvisoDePrivacidad`). Hoy el worker ya manda los avisos pendientes
antes de la respuesta, así que no cambia el orden. Hay que cambiar una cosa:
las respuestas por código hoy **no registran** el aviso (la respuesta al
recordatorio solo manda uno pendiente). El enrutador sí tiene que registrarlo,
porque la bienvenida puede ser el primer contacto.

### 4.4 Lo que no cambia

- La respuesta al recordatorio (plantilla) se resuelve como hoy.
- La urgencia de salud gana siempre.
- El mensaje fijo para audio, imagen o archivo sin soporte sigue igual.

---

## 5. Otros canales

| Canal | Qué admite | Propuesta |
|---|---|---|
| **WhatsApp** | Botones (3) y listas (10 filas) | Todo el diseño |
| **Chat web** (widget propio) | Lo que dibujemos | Botones como "chips" debajo del mensaje. El contrato del widget suma `opciones: [{id, titulo}]` en la respuesta y `optionId` en el envío. Es el canal más barato de probar: no depende de Meta |
| **Messenger** | Respuestas rápidas: **hasta 13**, título de 20, payload de 1000; **desaparecen** después del próximo mensaje. Plantilla de botones: 1–3 botones de postback ([quick replies](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/quick-replies), [button template](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/template/button)) | Bienvenida y listas como respuestas rápidas, con payload = mismo id. El webhook (`metaWebhook.service.ts`) hoy ignora `quick_reply.payload` y los postbacks: hay que leerlos. La doc de Meta se contradice sobre si llega como `messages` o como `messaging_postbacks`: se verifica con un webhook real |
| **Instagram** | Respuestas rápidas (13, 20 caracteres, **no en escritorio**) y plantilla de botones (1–3) ([quick replies](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/quick-replies)) | Igual que Messenger. En escritorio el contacto ve solo el texto: el cuerpo tiene que entenderse sin los botones ("Respondé 1, 2 o 3" como respaldo) |
| **Voz** (`ConversationChannel.VOICE`, `src/voz/`) | Sin botones | **Sin flujos.** La llamada sigue con la IA y las tools, como hoy. El flujo de texto no aplica a la voz |

La ventana de Messenger e Instagram también es de 24 h (7 días después de un
anuncio que lleva al chat)
([Messenger](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages)).

**Un solo modelo de opciones para todos los canales:** el flujo arma
`{ texto, opciones: [{id, titulo, descripcion?}], tipo: "botones" | "lista" }`.
Cada canal lo traduce a lo suyo y, si no puede, lo degrada a texto numerado
(D9). **Envío:** `sendWhatsappInteractiveReal` (nueva) en
`whatsappGraph.service.ts`, y el equivalente en `metaSend.service.ts`. Las
dos se clasifican en `modoDemo.catalogo.test.ts` como envío simulado en modo
demo, como las demás `*Real`.

---

## 6. Qué queda registrado en el CRM y cómo se mide

**En la conversación:**

- el mensaje entrante con `option_id` y el título;
- el saliente con `options` y `senderType: AUTOMATION`.

En el CRM se ven como hoy se ven los mensajes de los recordatorios, más los
botones que se ofrecieron. Así una persona que retoma entiende qué eligió el
contacto.

**Marca de auditoría:** cada paso resuelto por código deja en el
`toolCalls` de su mensaje saliente una marca
`{ flujo, paso, opcion, resultado }`, con el mismo patrón que
`AUDITORIA_DE_REGLA_DEL_RUBRO`. Sin tabla nueva.

**En el negocio:**

- el turno creado por el flujo es un turno como cualquier otro (eventos
  `booking.created`, recordatorio, etc.);
- cuando exista `Booking.origin` (`primera-clinica.md`, PR5), queda como
  origen `CHAT_OPCIONES` para separarlo de los que reservó la IA;
- la derivación de "Hablar con alguien" crea la misma tarea que hoy;
- **no se crean notas por cada paso**: serían ruido.

**Medición de IA y de mensajes:**

- **`LlmTurnUsage` no cambia.** Una respuesta por código no llama al modelo y
  no genera fila, como el recordatorio hoy. El ahorro se mide comparando:
  - turnos resueltos por código (las marcas de arriba);
  - turnos con modelo (`llm_turn_usages`);
  - por organización y por mes.
- **Mensajes de Meta (nuevo, por el cobro de §2.1):** contar los salientes de
  servicio por número y por mes, para ver cuánto falta para los 1.000 gratis.
  Al principio alcanza con una consulta sobre `messages`. Si hace falta, se
  suma una tarjeta en el panel de admin de plataforma, junto a
  `LlmUsagePage`.
- **Embudo del flujo:** cuántos entran a "Agendar", cuántos eligen
  prestación, cuántos horario y cuántos confirman. Sale de las mismas marcas.
  Es la métrica para ver si el flujo ayuda o espanta.

---

## 7. Riesgos

### 7.1 Que la IA y el flujo se pisen

- **Mismo lock:** el turno de la IA y el paso del flujo corren bajo
  `conLockDeConversacion`. Un toque que llega mientras la IA redacta se
  encola y corre después, como hoy un mensaje en ráfaga.
- **Texto libre a mitad del flujo:** va a la IA (D5).
  - El estado del flujo **se conserva** hasta su vencimiento, así que si el
    contacto vuelve a tocar la lista, sigue.
  - La IA recibe una línea de contexto ("Estaba eligiendo horario para
    Consulta dermatológica por botones") para no empezar de cero.
  - Si la IA reserva por su cuenta con `create_booking`, el estado se borra.
- **Guardas de salida:** siguen igual para la IA. El texto del flujo es fijo
  y no pasa por ellas, como `respuestaFija`.
- **Persona atendiendo:** el flujo no manda nada, porque el enrutador va
  después de esa compuerta. Si una persona toma la conversación a mitad del
  flujo, el estado se borra.

### 7.2 El horario elegido se ocupó mientras tanto

`createBooking` ya toma el lock del recurso y responde 409 "Ese horario ya
está reservado". Sin profesional elegido, `crearTurnoDeClinica` prueba con el
siguiente libre. El flujo:

- en el paso **confirmar**, vuelve a pedir la disponibilidad antes de
  mostrar el botón;
- ante un 409, responde "Ese horario se acaba de ocupar. Estos son los más
  cercanos:" con una lista nueva, y el estado vuelve a `horario`;
- respeta el resto de lo que hoy valida `create_booking`:
  `bloqueoPorIdentidad`, el tope de 2 turnos futuros (`MAX_RESERVAS_FUTURAS_POR_CONTACTO`),
  `rechazoPorTurnoRepetido`, la prestación de la sede y que no esté en el
  pasado. Para eso **se extraen a una función común** que usan la tool y el
  flujo (§8, PR3), así no se duplican.

### 7.3 El contacto toca un botón viejo

- **Otra versión del id, o un id que no parsea:** va a la IA como texto (el
  título).
- **Id válido pero de un paso anterior** (`reply_to_external_id` distinto de
  `menuExternalId`):
  - las opciones de **entrada** (las tres de la bienvenida, "Mis turnos")
    siempre valen y reinician su flujo;
  - las de **mitad de flujo** valen solo si el valor sigue siendo válido (la
    prestación existe, el horario sigue libre). Si no, se responde "Esa
    opción ya no está disponible" con la lista actual.
- **Estado vencido:** se responde con la lista del paso de entrada.
- **Doble toque:** el compare-and-swap sobre `paso` hace que el segundo vea el
  paso ya avanzado. Además, el wamid ya deduplica el reintento del webhook.
- **Turno ya creado y se vuelve a tocar "Confirmar":** "Tu turno ya quedó
  reservado: …". No se crea otro, por el CAS y por `rechazoPorTurnoRepetido`.

### 7.4 Otros

- **Nombre del perfil de WhatsApp:**
  - si el contacto tiene `name_set_by_channel` (el nombre lo puso el perfil),
    el paso **apellido** pide solo el apellido y la confirmación muestra el
    nombre completo para que lo corrija;
  - si no hay nombre, pide nombre y apellido juntos.
  - Esto también resuelve, en el flujo, el problema de saludar por un nombre y
    después pedir "nombre y apellido".
- **Costo de Meta:** ver §2.1. Si una organización pasa los 1.000 mensajes
  gratis sin medio de pago, Meta deja de entregar. Hay que medir antes de
  prenderlo a muchas.
- **Modo demo:** el envío nuevo se simula en modo demo. Se fija en
  `modoDemo.catalogo.test.ts`.
- **Cambia el contrato del widget web:** el campo nuevo es opcional y los
  widgets viejos lo ignoran.

---

## 8. Plan de PRs, en orden

🗄 = lleva migración y queda abierto hasta que Rocco lo autorice (regla de
CLAUDE.md). Los que tocan el agente corren antes del merge los escenarios de
`scripts/eval-agente-real.ts` con el modelo de producción. Cada PR que cambia
lo que ve un usuario actualiza `docs/guia-de-uso/`.

**Congelamiento de migraciones (Rocco, 2026-11-27):** mientras dure el ensayo
y el corte de la mudanza a Fly.io (plan en `docs-privados/`, local), ningún PR
con migración se mergea. **PR0, PR1 y el resto de los 🗄** pueden quedar
abiertos con el CI en verde, pero se mergean recién al terminar el ensayo y el
corte, o cuando Rocco levante el congelamiento por escrito.

| # | PR | 🗄 | Contenido |
|---|---|---|---|
| PR0 | `feat(whatsapp): identidad por BSUID (user_id)` | 🗄 | Tarea aparte de D12, antes de PR1 (§10.1) |
| PR1 | `feat(whatsapp): enviar mensajes con opciones y leer la opción tocada` | 🗄 | `messages.option_id`, `reply_to_external_id` y `options`. `sendWhatsappInteractiveReal` (botones y lista) y su clasificación en modo demo. El parser lee `id` y `context.id` de `button_reply` y `list_reply`. Sin uso todavía: no cambia nada visible |
| PR2 | `feat(agente): estado del flujo y enrutador de opciones` | 🗄 | `conversations.flow_state` y `agents.options_config` (los dos en una sola migración). El enrutador en `responderSinMedir`, en el orden de §1.5, apagado salvo `activo`. Registro del aviso de privacidad en las respuestas por código. Tests de orden: urgencia, humano, recordatorio |
| PR3 | `feat(clinicas): reserva por opciones` | — | Flujo prestación → (profesional) → horario → apellido → confirmación, con las validaciones de `create_booking` extraídas a una función común que usan la tool y el flujo. Casos de §7.2 y §7.3. **Primero en clínicas**, prendido solo con `activo` |
| PR4 | `feat(clinicas): bienvenida y "Mis turnos"` | — | La bienvenida (§4.1) con sus tres botones. "Hablar con alguien" usa `ejecutarHandoff` con el agente callado (`callaDespuesDeDerivar`). "Mis turnos" (§4.2) reutiliza `reprogramarTurno` y `cancelBooking` |
| PR5 | `feat(agente): pantalla de mensajes con opciones` | — | Tarjeta "Mensajes con opciones" en `AgentFormPage` (entre Capacidades y Reglas), validación de largos y vista previa. Guía de uso |
| PR6 | `feat(clinicas): "Más información" por temas` | 🗄 | `branches.address` y los temas de §3.2. `PREGUNTA` pasa a la IA. Pantalla de la sede para la dirección |
| PR7 | `feat(widget): opciones en el chat web` | — | Chips en `frontend/src/widget/` y el contrato de §5 |
| PR8 | `feat(meta): respuestas rápidas en Messenger e Instagram` | — | Envío y lectura de `quick_reply.payload` y postbacks, verificado con un webhook real |
| PR9 | `feat(metricas): uso de opciones y mensajes de Meta` | — | Embudo y conteo por número (§6) |
| PR10 | `feat(automotora): bienvenida y visita por opciones` | — | Defaults de automotora (§3.3). Hasta acá la automotora queda igual: lo fija "automotora sin cambios" |

Este plan reemplaza los PR10 y PR11 de la segunda fase de
`docs/primera-clinica.md` §7.2. PR1–PR4 alcanzan para la primera clínica.

---

## 9. Decisiones (Rocco, 2026-11-27)

Rocco aceptó todas las recomendadas. Las opciones descartadas quedan en el
historial del PR (#664).

| # | Pregunta | Decisión |
|---|---|---|
| D1 | ¿Dónde vive el estado del flujo? | Columna JSON `conversations.flow_state` (§1.6). Sin tabla nueva |
| D2 | ¿La bienvenida a todo primer mensaje? | Solo si el mensaje es un saludo o muy corto (§4.1); el que pide algo concreto va directo a la IA |
| D3 | ¿Cada cuánto vuelve a mostrarse? | Después de **7 días** sin mensajes del contacto, configurable (`volverAMostrarTrasDias`) |
| D4 | ¿Cómo se llama la asistente en el saludo? | Campo opcional `nombreDeLaAsistente`. Si falta: "Soy la asistente virtual de {organización}". `agents.name` sigue siendo interno |
| D5 | ¿Texto libre a mitad del flujo? | Responde la IA, con una línea de contexto. El flujo se conserva 30 min (§7.1) |
| D6 | ¿La dirección, estructurada? | Columna `branches.address`, más un link de mapa opcional (§3.2, PR6) |
| D7 | ¿Se elige profesional? | Solo si la prestación tiene más de uno, con la fila "Cualquiera" primero |
| D8 | ¿Paso de confirmación antes de reservar? | Sí. Resumen y botones **Confirmar** / **Cambiar** en **un solo mensaje** (§2.1) |
| D9 | Canal sin botones | Texto numerado interpretado por código **en la bienvenida**; **en mitad de flujo**, degradar a la IA |
| D10 | ¿Funciona con la IA apagada? | Sí. Menú y reserva por código, y el texto libre se deriva como hoy |
| D11 | Costo de Meta y política de AI Providers | Prender por organización y medir 1 mes: mensajes por reserva, embudo y cuánto falta para los 1.000 gratis. Confirmar en la revisión legal que la plataforma no es "AI Provider" (§2.1) |
| D12 | Identidad por `user_id` (BSUID) | **Tarea aparte, antes de PR1** (PR0, §10.1) |
| D13 | ¿El aviso de privacidad, dentro de la bienvenida? | **No por ahora**: va aparte, como hoy. Se revisa cuando el abogado vea el aviso |

---

## 10. Pendientes

### 10.1 PR0: identidad por BSUID (D12)

Meta empezó a mandar en abril de 2026 un identificador nuevo por usuario y por
portafolio de negocio, el **BSUID** (`user_id`, formato `UY.` + hasta 128
caracteres alfanuméricos). Lo manda en **todos** los webhooks de mensajes.
Con los nombres de usuario de WhatsApp, que se despliegan de a poco en 2026 y
que el usuario adopta si quiere, **el teléfono (`from`, `wa_id`) puede no
venir**. Meta lo exige: *"you must support BSUID to avoid losing the ability
to process their messages"*
([business-scoped user IDs](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids)).

Hoy el contacto de WhatsApp se identifica por el teléfono. Un mensaje sin
`from` no podría atarse a nadie. El alcance de PR0:

- **🗄 guardar el BSUID del contacto:** columna nueva en `contacts`, única por
  organización. El portafolio de Meta es el de la organización, porque cada
  clínica tiene su WABA;
- **leerlo en el webhook:**
  - `messages[].from_user_id` / `contacts[].user_id`;
  - `statuses[].recipient_user_id`;
  - el mensaje de sistema de cambio de número, porque el BSUID se regenera;
- **resolver el contacto por teléfono o por BSUID.** El que llega sin teléfono
  se crea con el BSUID y queda sin identidad para turnos, porque
  `datosQueFaltanParaActuar` pide teléfono o email;
- **mandar a un BSUID** (`recipient` en lugar de `to`) cuando no hay teléfono,
  salvo plantillas de autenticación, que lo exigen;
- **revisar las salidas de modo demo** y el aviso de "nadie respondió".

Va antes de PR1 para que el parser nuevo de opciones ya lea el usuario por los
dos lados.

### 10.2 Otros pendientes

- **[Rocco] Verificar que OpenRouter y sus proveedores no entrenen con
  nuestros mensajes**, en la configuración de OpenRouter (política de datos y
  proveedores habilitados). Los términos de WhatsApp Business no permiten usar
  los datos de la plataforma para entrenar modelos (§2.1).
- **[Revisión legal] Clasificación de "AI Provider"** de Meta (D11) y el aviso
  de privacidad dentro de la bienvenida (D13).
- **Actualizar `docs/primera-clinica.md` §3.3 y §7.2** para que apunten a este
  documento cuando arranque PR1.
