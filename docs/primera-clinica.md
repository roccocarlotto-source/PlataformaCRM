# Primera organización CLINICA en producción

> Documento de diseño. Estado: **plan aprobado, sin código**. Fecha: 2026-11-21.
> Las referencias `archivo:línea` son al código de `master` en el merge de #635
> (`f3d5cb72`). Las decisiones se tomaron con Rocco el mismo día (§9).
> Lo propio de la clienta (nombre, slug, datos a pedirle, condiciones de la
> prueba) está en `docs-privados/primera-clinica-clienta.md`, que es local.

## 0. De qué se trata

La primera organización real del rubro CLINICA es un **centro de belleza con
peluquería**, no una clínica médica. Tiene peluquería, cortes masculinos,
masajes, estética facial, tratamientos corporales y uñas. Usa el término
CLIENTE y arranca en ESENCIAL, con una prueba gratis.

La demo que vio tenía una web, una reserva en pasos (servicio → profesional →
día y hora → datos → confirmación), un WhatsApp simulado con un menú de tres
botones y el panel de turnos. Además prometía cosas que hoy no existen (§2.3,
§3, §4):

- la confirmación por WhatsApp al instante;
- cambiar el turno respondiendo ese mensaje;
- la marca "reservó solo/a" en el panel.

**Regla de siempre:** nada de esto cambia el comportamiento de una automotora
(`docs/rubros.md` §0.3). Cada PR que toca el núcleo lo demuestra con la suite
"automotora sin cambios" y con las fotos del ordenamiento
(`src/compartido/ordenamientoSinCambios.test.ts`).

---

## 1. Prender CLINICA para una organización

### 1.1 El plan de rubros: qué está hecho

De R0 a R20 está todo mergeado (rubros §15). Además se mergeó el WABA propio
por clínica (#506). Falta solo R21, que borra las columnas viejas de los
canales de Google: va cuando R7 lleve un tiempo en producción y no bloquea
nada de esto.

### 1.2 "Antes del primer cliente real" (rubros §15)

| Ítem | Estado | Qué hacer |
|---|---|---|
| R4 (guardrails) y R16 (aviso de privacidad) desplegados | Mergeados. Render aplica las migraciones en cada deploy, pero ningún doc registra que estén en producción | Confirmarlo con `npm run verify:schema` contra producción, en solo lectura |
| Lista de §10 respondida | **Sin responder.** No es para un profesional de salud: son 15 preguntas sobre la ley 18.331 y datos de salud, para un abogado | Para un centro de belleza sin datos de salud, alcanza con una revisión corta hecha por alguien con matrícula (§9, Q6): aviso de privacidad, el Anexo del MSA como contrato de encargado de datos y el registro de la base en la URCDP. La lista completa queda para la primera clínica médica |
| §6.6 confirmado con Meta o el BSP | **Sin confirmar** | Lo más riesgoso de §6.6 (la política de productos médicos) casi no aplica a un salón. Igual hay que confirmar el opt-in (el aviso del primer contacto) y las categorías: confirmación y recordatorio son UTILITY. Va en el trámite con Meta (§3.4) |
| Render en Virginia, `OPCIONES_DE_TRANSACCION_LARGA`, `DATABASE_URL` en modo sesión, `AGENT_TURN_MAX_CONCURRENT` 4 | La URL, la concurrencia y la constante están documentadas (`docs/deployment.md` §2.3; `src/lib/prisma.ts:52`). La región figura como "sin verificar" | Verificar la región en el panel de Render |

Hay dos cosas más que la lista no tenía:

- **Render Free:** el backend vive en el plan gratis, y lo mantiene despierto
  un job de keep-alive (`docs/deployment.md`). Con una clienta real, un
  recordatorio que no sale porque el proceso estaba dormido es inaceptable.
  **Se pasa a un plan pago antes del primer día** (lo hace Rocco).
- **Supabase:** el plan no está documentado. Hay que revisar en el panel si el
  proyecto se pausa por inactividad y qué respaldos tiene **antes de cargar
  datos reales**. Si está en el plan gratis, se pasa a Pro (lo hace Rocco).

### 1.3 `CLINICA_HABILITADA`

Es una constante global del código (`src/config/ediciones.ts:245`), no una
lista por organización. Solo la lee `rubrosDisponibles()`, que habilita tres
cosas: el alta con rubro CLINICA, el cambio de rubro por API y
`GET /api/admin/organizations/industries`.

**Decisión: pasarla a `true`.** Para las automotoras:

- **Las existentes:** nada. El flag solo decide si se puede crear una
  organización CLINICA o cambiarle el rubro a una. El test "el alta de una
  automotora no crea nada de clínica, aunque CLINICA se habilite"
  (`automotoraSinCambios.test.ts:547-587`) ya corre con el flag prendido.
- **El alta de una nueva:** aparece el selector "Rubro" en Plataforma →
  Nueva organización, obligatorio y sin valor por defecto
  (`NewOrganizationPage.tsx:92-93`). Desde ese momento, el platform admin elige
  "Automotora" a mano. Es lo que se diseñó (rubros §1.1).

Hay dos tests que fijan el flag en `false` y se actualizan en el mismo PR:
`configuracion.test.ts:15-17` y `clinicaDemo.integration-test.ts:205`.

---

## 2. Reserva en línea

### 2.1 Qué hay y qué falta

**Se reutiliza:**

- `disponibilidadDeLaPrestacion` (`src/clinicas/services/agendaClinica.service.ts:143-200`):
  los horarios libres de una prestación, con un profesional o con cualquiera,
  sin sobreturnos salvo que se pidan.
- `crearTurnoDeClinica` (`agendaClinica.service.ts:292-376`): con "cualquier
  profesional", elige el primero libre y reintenta con el siguiente si hay
  un 409.
- La creación del turno con bloqueo de fila
  (`src/services/booking.service.ts:323-398`): no hay doble reserva. Emite
  `booking.created`, que ya programa el recordatorio.
- `resolverContactoPorTelefono` (`src/services/whatsappContact.service.ts:67-102`):
  busca o crea el contacto por teléfono, bajo el bloqueo de la organización.
- Las reglas del agente en la web: no sobrescribe la identidad de un contacto
  existente (`contact.service.ts:1160-1173`), nunca devuelve datos guardados
  (`agentTools.service.ts:180-188`) y tiene un tope de 2 turnos futuros por
  contacto (`agentTools.service.ts:229`).

**Falta:**

- todo endpoint público de reservas;
- una página pública en el SPA. Hoy, fuera de la sesión, solo hay login,
  recuperar contraseña e invitación;
- algo que registre cómo se creó un turno;
- captcha;
- la confirmación por WhatsApp al instante.

### 2.2 Diseño (decisiones Q8, Q11–Q16)

**Dónde vive:** una página propia en nuestro dominio,
`/reservar/<slug de la organización>`, fuera de `ProtectedRoute`. La web de la
clienta la abre desde el botón "Reservar". El mismo link sirve para la bio de
Instagram y, más adelante, para el botón "Agendar" de WhatsApp. Al vivir en
nuestro dominio, usa el CORS global de la app y no el del widget.

**Cómo se activa:** un interruptor "reservas en línea" y la sede que atiende,
en `ClinicSettings`. Es apagable por organización y no depende de que haya un
agente.

**Qué se ofrece:**

- toda prestación de la sede con al menos un profesional;
- **nunca** sobreturnos;
- anticipación fija: mínimo 2 horas y máximo 30 días. Se confirman con la
  clienta antes de programarlo;
- el rango de disponibilidad que se puede pedir de una vez es corto, de 7 días
  (el de los controladores internos es de 62).

**Endpoints nuevos** (en `RUTAS_PUBLICAS`, sin `authenticate`). Como el gate de
edición no los cubre, cada uno chequea que la organización sea CLINICA, tenga
el módulo `agenda_clinica` y tenga las reservas en línea activadas:

| Ruta | Devuelve |
|---|---|
| `GET /api/public/reservas/:slug` | Nombre de la sede, zona horaria, prestaciones con su duración y sus profesionales (`{id, nombre}`), y el aviso de privacidad |
| `GET /api/public/reservas/:slug/disponibilidad?prestacion&profesional?&desde&hasta` | Horarios libres. Solo horas y profesional: nunca datos de clientes |
| `POST /api/public/reservas/:slug/turnos` | Crea el turno. Recibe prestación, profesional (opcional), inicio, nombre, apellido, teléfono, el token de Turnstile y el campo trampa. Responde solo con la prestación, el profesional y la hora |

**Quién reserva (Q11, Q12):**

- El turno se crea **confirmado** y con origen `PUBLICO` (§4).
- Al instante sale la confirmación por WhatsApp (§2.3) a ese teléfono, con un
  botón "No lo pedí yo" que cancela el turno y deja una tarea para recepción.
  Esto prueba que quien reservó es dueño del teléfono sin agregar un código
  ni un estado pendiente.
- **Si el teléfono ya es de un cliente:** el turno se cuelga de ese cliente sin
  tocar su nombre ni su email. Lo que la persona escribió queda como nota del
  turno para recepción, y la respuesta nunca dice si el teléfono ya existía.

**Protección (Q14).** Cada reserva dispara un WhatsApp desde el número de la
clienta. Por eso un abuso no son solo turnos falsos: son mensajes a
desconocidos que pueden bajar la calidad del número en Meta o hacer que lo
bloqueen.

- **Cloudflare Turnstile** desde el día 1. El backend verifica el token antes
  de hacer cualquier otra cosa. La clave secreta va en las variables de Render
  y la del sitio en las de Vercel (lo hace Rocco).
- **Tope por organización:** 8 reservas en línea por hora. Si se alcanza, se
  responde con un error amable y se avisa a recepción con una tarea. El
  contador vive en memoria, igual que los otros limitadores
  (`src/middlewares/rateLimit.ts`), y se reinicia con cada deploy.
- **Tope por teléfono:** 2 turnos futuros, como el agente.
- **Campo trampa:** un campo invisible para personas. Si llega con algo, se
  descarta en silencio.
- **Sin `trust proxy`:** ningún limitador cuenta por IP.

**Se revisa con `/cso` antes del merge:** es la primera superficie pública que
escribe datos de negocio.

### 2.3 Confirmación al instante (Q7)

Hoy los mensajes del turno son `REMINDER`, `REVIEW_QR` y `CONTROL`
(`BookingMessageKind`). Se agrega `CONFIRMATION`:

- Sale al crearse el turno, sea cual sea su origen, para que también la reciba
  quien reserva por recepción. Usa una plantilla UTILITY con tres botones:
  "Confirmo", "Quiero cambiarlo" y "No lo pedí yo".
- **"Confirmo"** marca `patientConfirmedAt`, como el recordatorio.
- **"Quiero cambiarlo"** pasa al agente, que reprograma o cancela con las tools
  de R11. Si no hay agente activo, se crea una tarea para recepción.
- **"No lo pedí yo"** cancela el turno y crea una tarea.
- **Si el turno es para el mismo día**, el recordatorio del día anterior no
  sale. Es lo que ya hace la programación de R13.

Necesita una migración: el valor nuevo del enum y los nuevos valores de
respuesta.

---

## 3. WhatsApp: número, confirmación, recordatorios y menú

### 3.1 Qué existe

- **WABA propio por clínica** (#506): el admin de plataforma lo conecta a mano
  (`docs/whatsapp-alta-clinica.md`). La clínica comparte su WABA con la
  plataforma como socia, y el token siempre es el de la plataforma.
- **Plantillas** con botones de respuesta rápida, sincronizadas con Meta
  (`whatsappTemplate.service.ts`). Su aprobación llega por webhook.
- **Webhook:** lee texto, audio, imagen, ubicación y los botones de las
  plantillas, con su payload.
- **Envío:** solo texto y plantillas. **No hay mensajes interactivos**
  (botones o listas fuera de plantilla).

### 3.2 El número de la clienta: tres casos

Su WhatsApp de empresa ya está conectado a alguna herramienta además de la
app. Hoy no sabemos a cuál. **Es lo primero que se le pregunta**: las
preguntas están en el doc privado.

| Caso | Qué implica | Qué se puede hacer |
|---|---|---|
| **A. Coexistencia:** sigue usando la app WhatsApp Business en el teléfono y además lo conectamos a la plataforma | Meta lo permite desde 2025, pero solo con Embedded Signup. **No está construido**: requiere registrarse como Tech Provider (`docs/roadmap-implementacion.md:58`, sin hacer) y suscribirse a los ecos de la app (`smb_message_echoes`). Hoy el webhook los descartaría, y las respuestas que ella escriba desde el teléfono no aparecerían en la plataforma | Es un proyecto aparte, de semanas. **No va en la primera versión** |
| **B. Migrar su número** desde la herramienta actual a un WABA suyo, compartido con la plataforma | Si la herramienta es otro proveedor de la API de WhatsApp: desactivar la verificación en dos pasos allá y migrar el número. Si el WABA ya es de ella: sumar la plataforma como socia y **desconectar la otra herramienta**, para que no contesten las dos. En los dos casos deja de usar la app en el teléfono para ese número (`whatsapp-alta-clinica.md:29-31`) | Todo el plan, con el flujo de alta que ya existe |
| **C. Número nuevo** solo para la plataforma | Su número actual sigue como está. La web, Instagram y los mensajes de turnos usan el nuevo | Todo el plan. Es lo más rápido, pero sus clientes conocen el número viejo |

**Qué queda bloqueado hasta saber el caso:**

- la confirmación y los recordatorios: necesitan el WABA y sus plantillas
  aprobadas;
- **la reserva en línea en producción**: su verificación depende de la
  confirmación (§2.2). El código se puede mergear antes, pero la página no se
  activa;
- el agente por WhatsApp y el menú de bienvenida (§3.3).

**No queda bloqueado:** el alta de la organización, la carga de servicios,
profesionales y horarios, el panel y la agenda interna, la marca, el perfil
`ESTETICA` y la web.

### 3.3 Menú de bienvenida (segunda fase, Q9)

"Agendar", "Más información" y "Prefiero que me contesten" son botones de
respuesta de un mensaje interactivo. Como es la respuesta a un mensaje
entrante, va dentro de la ventana de 24 h y no necesita plantilla. Falta todo
esto:

1. **Enviar** mensajes interactivos (`type: "interactive"`) en
   `whatsappGraph.service.ts`, y conectarlo en la salida del worker
   (`agentInboundWorker.ts:248-280`), que hoy solo manda texto.
2. **Leer el id del botón:** el webhook lee solo el título
   (`whatsappWebhook.service.ts:211-216`).
3. **Rutear cada botón** antes del modelo, como ya se hace con la respuesta al
   recordatorio (`agentInboundWorker.ts:503-535`):
   - "Agendar" manda el link de la reserva en línea;
   - "Más información" hace un turno normal del agente;
   - "Prefiero que me contesten" pasa la conversación a una persona y el
     agente se calla. Esto necesita un mecanismo nuevo:
     `request_human_handoff` hoy avisa, pero el agente sigue contestando
     (`agentOrchestration.service.ts:2680-2684`).
4. **Cuándo se muestra:** en el primer contacto, o después de X horas sin
   mensajes (con `findLastInboundAt`).
5. **El orden con lo demás:** el aviso de privacidad sale antes, porque el
   worker ya lo hace; la urgencia gana siempre; y no se manda si una persona
   está atendiendo.
6. **Los textos por organización**, en `ClinicSettings`.

### 3.4 Trámite con Meta (empieza ya, en paralelo)

Tiene tiempos de espera que no dependen de nosotros:

- **Verificación del negocio** en el portfolio de la clienta: documentos de la
  empresa, y puede tardar días. Sin ella, el número tiene límites diarios de
  conversaciones.
- **Nombre visible del número**, aprobado por Meta.
- **Plantillas UTILITY** de confirmación (§2.3) y de recordatorio (la de R13
  ya existe). Se crean en el WABA donde quede el número, así que dependen del
  caso de §3.2. La aprobación suele tardar entre minutos y un día (dato general
  de Meta, a confirmar).
- Confirmar los puntos de rubros §6.6 que aplican: opt-in y categorías.

---

## 4. Guardrails de salud para un centro de belleza (Q2)

**El problema, medido** con `clasificarMensajeDeSalud` sobre frases típicas de
un salón:

| Mensaje | Hoy |
|---|---|
| "quiero cortarme el pelo", "cortarle el pelo a mi hijo", "shock de keratina", "ojos hinchados después del lifting de pestañas" | **URGENCIA**: mensaje del 911, tarea urgente y el agente queda callado |
| "dolor de espalda" (masaje), "masajes para embarazadas", "perdón la molestia", "alisado sin químicos", "alérgica a la tintura", "manchas en la cara" | **CLINICA**: mensaje fijo, derivación y el agente queda callado |
| "limpieza de piel", "hacerme las uñas", "depilación", "color" | Nada |

La capa 3 (la respuesta del modelo) además bloquearía consejos comunes del
rubro: "no te laves el pelo 48 horas", "aplicate…", "es normal".

**Decisión: un perfil de salud por organización** en `ClinicSettings`,
`MEDICO` o `ESTETICA`:

- **`MEDICO` es el valor por defecto y queda exactamente como hoy.** Lo fija un
  test de caracterización con las listas y los mensajes actuales.
- **`ESTETICA`:**
  - **Urgencia:** solo emergencias reales, con frases inequívocas ("no puedo
    respirar", "me desmayé", "sangra mucho"…). No palabras sueltas como
    "cortarme" o "shock".
  - **Sin derivación por términos clínicos:** en un salón, "dolor de espalda"
    es un pedido de masaje.
  - **La capa 3 deja pasar los consejos de cuidado del rubro** (pelo, piel,
    uñas). Sigue bloqueando diagnósticos y medicamentos.
  - **Instrucción de salud del prompt** sin "centro de salud", "paciente" ni
    "profesional de la salud".
  - **Mensajes fijos por defecto** sin "indicaciones médicas".
- **Lo elige el admin de plataforma**, junto al rubro. No lo cambia la clínica.

**Además, para los dos perfiles,** se arreglan las coincidencias por tolerancia
a errores de tipeo que tocan palabras de otro rubro:

- "químicos" coincide con `quimio*`;
- "cortarle" y "cortarse" coinciden con "cortarme".

Todas las frases de la tabla pasan a los tests, con el resultado esperado
para cada perfil.

**Textos con "paciente" fijo**, que están mal con el término CLIENTE. Se pasan
al término de la organización sin importar el perfil:

- `TERMINO_DE_LAS_TOOLS` y los textos del agente (`textosDelAgente.ts:112-129`);
- las descripciones de las tools (`toolsDeAgenda.ts`, `toolsDeTurnos.ts`,
  `toolDeIndicaciones.ts`);
- el respaldo del nombre en el recordatorio (`recordatorioWorker.ts:188`);
- las tareas para el equipo;
- en pantalla: `features/agent/tools.ts:118-129`, "Clínica" en la
  configuración y "Clínica Ejemplo" en la vista previa de WhatsApp.

El snapshot del prompt de la automotora no cambia.

---

## 5. Métricas desde el día 1

| Métrica | Hoy | Qué falta |
|---|---|---|
| Reservas por origen (solas, por el agente o por recepción) | No se registra el origen | **Migración:** `Booking.origin` (`PANEL`, `AGENTE`, `PUBLICO`) y `createdByUserId`, que se cargan en los tres caminos (Q13). Los turnos anteriores quedan sin origen. La marca "reservó solo/a" sale de acá |
| Confirmaciones y recordatorios enviados | Se pueden deducir: `BookingMessage` con `kind`, `status` y `sentAt` | Solo la consulta y la tarjeta |
| Confirmados por botón, sin respuesta | Se pueden deducir: `response`, `respondedAt`, `noResponseTaskAt`, `Booking.patientConfirmedAt` | Solo la consulta y la tarjeta |
| Ausencias | Se pueden deducir: `NO_SHOW` sobre `COMPLETED` + `NO_SHOW`, por `startsAt` | Solo la consulta y la tarjeta |
| Reservas en línea rechazadas por el tope | No existe | Contarlas en la tarea de aviso a recepción (§2.2) |

**Dónde se ven:** tarjetas nuevas en el dashboard de una clínica, que hoy
muestra el dashboard de atención (`DashboardPage.tsx:75-87`). Se calculan por
consulta, sin tablas nuevas.

---

## 6. Marca (Q10)

Hoy una clínica ve "Plataforma CRM" en la barra lateral. Eso viene de `MARCA`
(`src/config/terminos.ts:51`), la misma constante para los dos rubros, que
viaja en `/me` como `vocabulario.marca`. Ve el mismo nombre en la pestaña antes
de que cargue el nombre de la organización (`tituloDeLaPestana.ts:13`), y los
mails salen como "Xentech CRM", según la configuración de Supabase.

**Decisión:** las clínicas ven **"Xentech"**:

- `vocabularioDeClinica().marca` (`src/clinicas/config/rubro.ts:27`) pasa a una
  constante propia;
- la pestaña usa la marca de `/me` cuando la hay.

La automotora sigue con "Plataforma CRM", y su snapshot de vocabulario no
cambia. D4 (el nombre definitivo del producto) sigue abierta: esto es lo de
mientras tanto.

---

## 7. Plan

### 7.1 Tareas sin código (en paralelo, desde ya)

| # | Tarea | Quién | Bloquea |
|---|---|---|---|
| T1 | Preguntarle a la clienta por su número de WhatsApp (§3.2) | Rocco | T3 (plantillas), PR6 en producción, PR8 en producción y la fase 2 |
| T2 | Verificación del negocio y nombre visible en Meta | La clienta, con Rocco | Los límites de envío del número |
| T3 | Plantillas UTILITY de confirmación y recordatorio, aprobadas | Plataforma, en el WABA de T1 | La confirmación y los recordatorios en producción |
| T4 | Render a plan pago | Rocco | El día 1 |
| T5 | Supabase: pausa y respaldos; si hace falta, pasar a Pro | Rocco | Cargar datos reales |
| T6 | Revisión legal corta (Q6) y Anexo del MSA | Rocco, con alguien matriculado | Activar el agente y la reserva en línea |
| T7 | Turnstile: crear el sitio y cargar las claves en Render y Vercel | Rocco | PR8 en producción |
| T8 | Dominio a nombre de la clienta, DNS y publicación de su web en Cloudflare Pages (el deploy lo corre Rocco a mano) | Rocco y la clienta | El botón "Reservar" en su web |
| T9 | Juntar los datos de la clienta (lista en el doc privado) y cargarlos | Rocco | El día 1 |
| T10 | Confirmar R4 y R16 en producción con `verify:schema`, en solo lectura | Claude o Rocco | PR4 |

### 7.2 PRs, en orden

🗄 = lleva migración y queda abierto hasta que Rocco lo autorice (regla de
CLAUDE.md). Cada PR suma su parte de la guía de uso de clínicas.

| # | PR | 🗄 | Riesgo | Contenido | Bloqueado por |
|---|---|---|---|---|---|
| PR1 | `fix(clinicas): tolerancia del detector y frases de un salón` | — | Bajo | Arreglo de la tolerancia a errores de tipeo y las frases de §4 en los tests. Hoy no hay ninguna clínica real: no cambia nada en producción | — |
| PR2 | `feat(clinicas): perfil de salud ESTETICA` | 🗄 | Medio | Columna de perfil en `ClinicSettings`, con `MEDICO` por defecto; urgencia acotada, sin derivación clínica y capa 3 relajada en `ESTETICA`; instrucción y mensajes por defecto; selector del admin de plataforma; test de caracterización de `MEDICO` | PR1 |
| PR3 | `fix(clinicas): textos con el término del contacto` | — | Bajo-medio | "paciente" fijo → término de la organización (§4). El snapshot del prompt de la automotora no cambia | — |
| PR4 | `feat(clinicas): marca Xentech y CLINICA habilitada` | — | Bajo | Marca de §6, `CLINICA_HABILITADA = true` y los dos tests que lo fijaban | PR1–PR3 mergeados, T10 |
| PR5 | `feat(agenda): origen del turno` | 🗄 | Medio | `Booking.origin` y `createdByUserId` en los tres caminos, más la marca "reservó solo/a" en la agenda de una clínica. Toca la creación de turnos del núcleo: la automotora guarda el dato y no cambia nada más | — |
| PR6 | `feat(clinicas): confirmación al instante` | 🗄 | Medio-alto | `CONFIRMATION` y sus respuestas, la plantilla, la programación al crearse el turno y la respuesta por botón (§2.3) | PR5. En producción: T1 y T3 |
| PR7 | `feat(clinicas): configuración de reservas en línea` | 🗄 | Bajo | Interruptor y sede en `ClinicSettings`, y su pantalla | — |
| PR8 | `feat(clinicas): reserva en línea` | — | **Alto** | Los tres endpoints públicos, Turnstile, topes, campo trampa, reglas del contacto existente y la página `/reservar/:slug`. Pasa por `/cso` antes del merge | PR5, PR6, PR7. En producción: T1, T3, T6 y T7 |
| PR9 | `feat(clinicas): métricas de turnos` | — | Bajo | Tarjetas de §5 en el dashboard de una clínica | PR5 |
| — | **Día 1**: alta de la organización (CLINICA, ESENCIAL, CLIENTE, `ESTETICA`), carga de datos, panel y agenda | — | — | — | PR1–PR4, T4, T5, T9 |
| — | **Reserva en línea activa** | — | — | — | PR8 y sus tareas |

**Segunda fase** (después de T1):

- **PR10** `feat(whatsapp): mensajes interactivos y id del botón`;
- **PR11** `feat(clinicas): menú de bienvenida`: ruteo de los tres botones,
  mecanismo para que el agente se calle, textos por organización (🗄);
- **PR12** activar el agente por WhatsApp con el perfil `ESTETICA` probado
  sobre sus mensajes reales;
- **si T1 da el caso A:** un proyecto aparte con Embedded Signup y
  coexistencia.

**Fuera de este plan:**

- el ordenamiento P4–P10 (`docs/ordenamiento-productos.md`), que se retoma
  después;
- D4 (el nombre definitivo del producto);
- D6 (si el WABA propio es solo de clínicas): este plan usa el WABA propio
  como está hoy, solo para clínicas.

---

## 8. Qué cambia para las automotoras

Nada. Por PR:

- **PR1–PR3, PR6, PR7 y PR8** tocan solo código de `src/clinicas/` o ramas de
  CLINICA. Lo cubren "automotora sin cambios" y el snapshot del prompt.
- **PR4** cambia la marca solo en el vocabulario de clínica. El flag no toca a
  las organizaciones existentes; solo agrega el selector en el alta.
- **PR5** agrega una columna que la automotora también llena, pero no cambia
  ninguna respuesta ni pantalla suya: lo prueban las fotos del ordenamiento y
  un caso nuevo en "automotora sin cambios".
- **PR9** agrega tarjetas solo en el dashboard de una clínica.

## 9. Decisiones (Rocco, 2026-11-21)

| # | Decisión |
|---|---|
| Q1 | Diseño en `docs/`; lo propio de la clienta en `docs-privados/` |
| Q2 | Perfil de salud por organización (`MEDICO` / `ESTETICA`), más el arreglo de la tolerancia con las frases en los tests |
| Q3 | `CLINICA_HABILITADA = true` |
| Q4 | ESENCIAL |
| Q5 | Render a plan pago antes del día 1 (Rocco) |
| Q6 | Revisión legal corta con alguien matriculado; §10 completa para la primera clínica médica |
| Q7 | Confirmación al instante en la primera versión |
| Q8 | La web de la demo pasa a ser su web real; la reserva en línea en nuestro dominio |
| Q9 | Menú de WhatsApp en la segunda fase |
| Q10 | "Xentech" como marca de las clínicas mientras D4 siga abierta |
| Q11 | Turno confirmado al instante, con "No lo pedí yo" en la confirmación |
| Q12 | Teléfono existente: se cuelga del cliente sin tocar su identidad |
| Q13 | `Booking.origin` con migración |
| Q14 | Turnstile desde el día 1, 8 reservas en línea por hora por organización con aviso, 2 turnos futuros por teléfono, campo trampa, rango corto, sin datos de terceros, sin `trust proxy` |
| Q15 | `/reservar/<slug>`, con interruptor y sede en `ClinicSettings` |
| Q16 | Toda prestación con profesional; anticipación de 2 h a 30 días, a confirmar con la clienta |
| Q17 | Sin chat en la web el día 1 |
| Q18 | Dominio a nombre de la clienta, web en el Cloudflare Pages de Xentech |
| Q19 | Supabase lo revisa Rocco antes de cargar datos reales |
