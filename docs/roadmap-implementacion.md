# Roadmap de implementación — Plataforma CRM

Documento vivo — 28/08/2026. Consolida todo lo que falta implementar en este repo, combinando la auditoría interna existente (`auditoria-2026-08-21.md`, bitácoras) con las decisiones tomadas en las sesiones de planificación del proyecto "Sistema Saas" (visión de producto, packs por vertical, integración con Resea, módulo de agenda). No reemplaza `tracked-followups.md`-style tracking si ya tienen uno propio para el CRM — es el punto de partida para armarlo si no.

Orden de prioridad sugerido: primero lo que protege lo ya construido (P0), después lo que es prerrequisito de todo lo demás (P1), después los módulos nuevos en el orden que menos retrabajo genera (P2), y al final lo que puede esperar sin bloquear nada (P3).

## P0 — Deuda técnica ya identificada (auditoría 2026-08-21)

Nada de esto es nuevo, pero se re-lista acá para que quede en un solo lugar junto con el resto:

- [x] Generalizar el chequeo de FKs compuestas por organización — hoy es una lista cerrada de 18 relaciones conocidas en `verify-schema.ts`, no una garantía estructural. Es la base de todo el aislamiento multi-tenant; cerrar esto antes de sumar entidades nuevas (Agent, Conversation, Booking, etc. — ver P2) para que nazcan ya cubiertas.
- [x] Índices `(organizationId, createdAt)` con `deletedAt IS NULL` en las entidades de negocio — necesario antes de que la capa de ingesta y el agente de IA empiecen a generar volumen real.
- [x] `search` con `ILIKE '%x%'` sin `pg_trgm` en los repositorios que lo usan.
- [x] Cascada de soft-delete (Stage → Opportunity, Pipeline → Stage).
- [x] Verificación de email en registro (`email_confirm: true` sin verificación) y validación de `email_verified` al aceptar una invitación.
- [x] ESLint/Prettier/Dockerfile — deuda de higiene, barata de pagar ahora.

## P1 — Prerrequisitos transversales

Estos dos no son features en sí, son la base que necesitan casi todos los módulos nuevos de abajo.

> **Los dos cerrados el 2026-08-28** — ver `docs/bitacora-2026-08-28.md`. Mismo criterio que en P0: los tildes reflejan trabajo terminado y con CI en verde en PRs abiertos (#39 y #40), **todavía sin mergear**. El cierre de Lead vs. Contact abrió un pendiente propio, anotado en P2.2 más abajo: la decisión de entidad está tomada, pero los atributos de calificación siguen sin tener dónde vivir.

- [x] **Motor de eventos salientes** (patrón outbox, análogo al que ya usan para `IngestionEvent` del lado entrante). Hoy no existe ningún mecanismo para que el CRM avise "esto pasó" — ni al motor de automatizaciones, ni a Resea, ni a nada. Lo necesitan: el trigger "Oportunidad → Ganada" del motor de automatizaciones, el aviso a Resea para enviar el QR de reseña, y el recordatorio de WhatsApp antes de un turno agendado. Construir esto una vez, genérico, antes de cablear cualquiera de esos tres casos particulares.
- [x] **Decisión: modelo de Lead vs. Contact.** ~~El documento de visión original (sección 8) dice explícitamente que Lead debe ser una entidad propia, distinta de Contact.~~ **Formalizado (PR #40): `Contact.lifecycleStage` cumple ese rol y no se agrega una entidad separada.** Dos precisiones sobre el enunciado original de este ítem, verificadas leyendo el archivo: eso lo decía la **sección 5 (CRM)**, no la 8 —la 8 es "Knowledge Base y RAG"— y ese documento **ya fue actualizado**, no quedó pendiente. Lo que sigue abierto es un pendiente NUEVO, en P2.2: los atributos de calificación que ese punto asignaba a `Lead` no tienen dónde vivir. Texto original del ítem, para contexto: Lo que se construyó hasta ahora en este repo no tiene una entidad `Lead` separada — la capa de ingesta promueve directamente a `Contact`. Esto no bloqueaba nada mientras el CRM se usaba como CRM tradicional, pero si el agente de IA va a tener una tool `create_lead()` (catálogo de herramientas, sección 12 del documento de visión), hay que decidir antes de construirla: ¿se agrega la entidad `Lead` real como estaba pensada, o se actualiza el documento de visión para reflejar que `Contact` con un campo de estado cumple ese rol? Bloquea el diseño de las tools de calificación del agente.

## P2 — Módulos nuevos, en orden de menor a mayor dependencia

### 2.1 Agenda/Booking

Ya diseñado en `docs/booking-architecture.md` (integración con Google Calendar, entidades `Resource`/`ServiceType`/`Booking`/`GoogleCalendarConnection`). Pasos de implementación, copiados de ese documento para que este roadmap sea autocontenido:

- [x] CRUD de `Resource` y `ServiceType` (sin Google Calendar todavía) — **hecho (PR #41)**, más el prerrequisito que apareció al empezar: **`Branch`** (sucursal) no existía en el schema pese a que `booking-architecture.md` modelaba las tres entidades con `sucursalId`. Se agregó con alcance acotado —solo las entidades de Booking llevan `branchId`, el resto del CRM no se tocó— y sin sucursal obligatoria: cero `Branch` es un estado válido. Las tres FKs cruzadas son compuestas y el chequeo genérico de la fila 14 las toma sin haber tocado nada, que es el primer caso que ejercita esa generalización. Borrado con RESTRICT + locks de fila, criterio de ALTO-8.
- [x] Conexión OAuth con Google Calendar por sucursal + `freebusy.query` — **hecho (PR #42)**: modelo `GoogleCalendarConnection` + migración escrita a mano, flujo OAuth completo (iniciar / callback / desconectar / leer estado), y el wrapper aislado de `freebusy.query` con su test unitario mockeado. Tres cosas que aparecieron al implementar y no estaban en el diseño: (1) **la premisa "cifrar igual que `ApiKey`" era falsa** — `ApiKey` está *hasheada*, no cifrada, y no había ningún módulo de cifrado en el repo; se paró, se consultó por ser una decisión de seguridad, y salió `src/utils/encryption.ts` (AES-256-GCM, genérico, no atado a Google); (2) **`calendar.events` no habilita `freebusy.query`** — verificado contra la doc de Google, hacía falta `calendar.events.freebusy`, y pedir solo lo que decía el documento habría dado un 403 en la primera consulta de disponibilidad; (3) el `state` firmado es lo único que sostiene la frontera de tenant en el callback, que no puede estar autenticado. **`GET /api/availability` NO se construyó**, a propósito: ver el bullet de acá abajo.
  - [x] ~~**Pendiente que este paso destrabó y no podía resolver: el "rango de trabajo" por `Resource`.**~~ **Resuelto (PR #43).** Decisión tomada: horario **por `Resource`** (no por sucursal), semanal recurrente, con **varias franjas por día** (una fila por franja, para el horario partido "9 a 13 y 16 a 20"), en **hora local de la sucursal**. **Sin** excepciones, feriados ni bloqueos puntuales — alcance mínimo, mismo criterio con el que nació `Branch`; se agregan cuando alguien los necesite. Entidad `WorkingHours`, administrada con un `PUT /api/resources/:resourceId/working-hours` que **reemplaza la semana entera** (así se usa de verdad, y la validación que importa —que dos franjas no se pisen— es sobre el conjunto).
- [x] `POST /api/bookings` con creación de evento en Google + control de capacidad propio — **hecho (PR #43)**, junto con `GET /api/availability`, `PATCH /api/bookings/:id/cancel` y el listado. **Los tres pendientes que PR #41 había dejado preparados quedaron cerrados**: (1) `contarReservasActivas()` ahora cuenta reservas reales, y la decisión que estaba abierta se tomó — **solo `CONFIRMED` bloquea**; `COMPLETED`/`NO_SHOW`/`CANCELLED` son historia y bloquear por historia haría imposible dar de baja un servicio con un año de uso; (2) `deleteServiceType` tiene el lock de fila; (3) el `@@unique([organizationId, id])` de `ServiceType`, que ahora sí referencia la FK compuesta de `Booking`.
  - **Decisión de arquitectura del PR:** la llamada a Google va **afuera** de la transacción. El lock del recurso cierra la carrera de capacidad, pero sostenerlo durante un HTTP a un tercero (10 s de timeout) serializaría todas las reservas de ese recurso contra la latencia de Google. Transacción corta (lock + revalidación + insert), commit, y recién después Google + una segunda escritura del `googleEventId`.
  - **Única dependencia nueva del módulo: `luxon`.** Convertir "día de semana + hora local + zona IANA + fecha" a un instante UTC tiene casos borde de horario de verano (la hora que no existe en el salto, la que ocurre dos veces en el retroceso) que escritos a mano producen turnos corridos una hora medio año, sin ningún síntoma. Se verificó primero que el repo no tuviera ya una librería de fechas y que `Temporal` no estuviera en el runtime; no.
  - **Fuera de alcance a propósito:** reprogramar una reserva (revalidación completa: horario, capacidad y Google — hoy el camino es cancelar y crear) y las automatizaciones del outbox (paso 5: emitir un evento sin handler registrado lo manda a `DEAD_LETTER`).
- [ ] Webhook de sincronización inversa + worker de renovación de canales push (expiran a los ~7 días).
- [ ] Conectar automatizaciones (Activity, Opportunity, recordatorio de WhatsApp) — depende del motor de eventos salientes (P1).
- [ ] Tools `get_availability()` / `create_booking()` del agente de IA — depende del módulo de agentes (2.2).

### 2.2 Agentes de IA

No documentado en detalle todavía (a diferencia de Booking) — este roadmap deja el esqueleto, conviene un documento propio (`docs/ai-agent-architecture.md`) antes de empezar a construir, mismo criterio que se usó con booking.

**Entidades nuevas** (bajo el mismo patrón multi-tenant que el resto del schema):
- `Agent` — por sucursal: objetivo/instrucciones, proveedor de modelo, tono, guardrails (temas/acciones prohibidas, cuándo derivar), catálogo de tools habilitadas.
- `Conversation` — por contacto y canal (WhatsApp/Web), estado (activa / derivada a humano / cerrada), agente asignado.
- `Message` — inbound/outbound, con registro de qué tool intentó usar el agente en cada turno (auditoría de acciones, no solo de texto).

**Infraestructura de canal:**
- [ ] Cuenta de WhatsApp Business Platform (Cloud API): Meta Business Account + WhatsApp Business Account (WABA) + app en Meta for Developers + número de teléfono de negocio registrado + verificación del negocio ante Meta (necesaria para escalar el volumen de mensajes más allá del límite inicial de cuentas nuevas — no bloquea el arranque). Tiene tiempos de verificación externos a nuestro control — conviene arrancar este trámite temprano, en paralelo a todo lo demás del roadmap.
- [ ] **Registrarse como Tech Provider de Meta** y construir el onboarding de cada sucursal con **Embedded Signup** — en vez de que cada negocio navegue el Business Manager de Meta a mano, el dueño se autentica dentro de nuestro propio panel y el sistema genera automáticamente la WABA, el número y los tokens de acceso server-to-server.
- [ ] **Decisión de número por cliente** (evaluar caso a caso en el onboarding, dos caminos válidos):
  - *Coexistence* (mismo número que ya usa el negocio, atendido en paralelo desde la app de WhatsApp Business y desde la automatización): requiere que el número ya esté en la **app de WhatsApp Business** (no WhatsApp común) con versión ≥2.24.17. Límite de throughput compartido de 20 mensajes/segundo, sin sincronización de chats grupales, y con mensajes efímeros/ubicación en vivo/listas de difusión deshabilitados en ese número. Sirve para el cliente que insiste en mantener el número que sus clientes ya conocen.
  - *Número dedicado nuevo* (recomendado como default): un número exclusivo para la automatización, sin tocar el personal del dueño del negocio. No tiene ninguna de las limitaciones de Coexistence. El número nuevo se comunica a los clientes del negocio vía el mismo QR/link que ya genera la plataforma (cartel, Instagram, etc.) — no es fricción adicional, reusa una pieza que ya se construye igual.
- [ ] **Proveedor de números virtuales (BSP): decisión — Twilio.** Se evaluó contra 360dialog y Vonage; 360dialog cobra un fee de plataforma fijo por canal (€49-250/mes según plan) exista o no tráfico, lo cual es caro para el perfil de esta plataforma (muchos clientes chicos, bajo volumen cada uno — confirmaciones/recordatorios de turno, no marketing masivo). Twilio no cobra fee fijo de plataforma ni de setup: solo el alquiler del número (~USD 1,15/mes) + USD 0,005 por mensaje (fee propio) + el fee de Meta pasado al costo sin margen. Los mensajes tipo "utility" (confirmaciones/recordatorios) dentro de la ventana de servicio de 24hs no tienen costo de Meta, que es justo el patrón de uso esperado — el costo real por cliente debería quedar muy por debajo del modelo de fee fijo de 360dialog.
  - Estructura de cuentas: **un subaccount de Twilio por cada sucursal cliente** (vía Twilio Accounts API) — aislamiento de datos y facturación separada de entrada, coherente con el resto del modelo multi-tenant.
  - Flujo de alta por cliente (una vez aprobados como Tech Provider e integrado el Partner Solution de Twilio): el cliente hace "Login with Facebook" dentro de nuestro panel (Embedded Signup) → crea/selecciona su Business Portfolio y WABA → se crea su subaccount de Twilio vía API → se registra su número como WhatsApp Sender contra ese subaccount vía la API de Senders de Twilio. Todo scripteable, sin trámite manual por cliente una vez armada la integración.
  - Contrapartida: Twilio da menos "todo resuelto" que 360dialog — la integración con la API de Senders y el manejo de subaccounts corre por nuestra cuenta, a cambio del ahorro en costo variable por cliente.
- [ ] Integración con WhatsApp Business API — recepción de mensajes (webhook) y envío. Hoy no existe nada de esto en el repo. Es, junto con el loop de orquestación del modelo, la pieza de mayor esfuerzo de todo este roadmap.
- [ ] Loop de orquestación del LLM (proveedor a elegir — el documento de visión pide poder abstraer el proveedor desde el diseño aunque se implemente uno solo al principio) con tool-calling.
- [ ] Mecanismo de handoff a humano (pausar el agente en una `Conversation` y derivar).

**Restricción de plataforma a respetar desde el diseño (no solo buena práctica, es cumplimiento):** desde el 15 de enero de 2026, Meta prohíbe en WhatsApp Business API los asistentes de IA de propósito general (tipo "preguntame lo que sea"). Lo que sigue permitido explícitamente es automatización acotada al negocio: calificación de leads, confirmación/recordatorio de turnos, consultas de servicios/precios, soporte de pedidos, autenticación — exactamente el alcance de este agente. La distinción de Meta es si la IA es auxiliar de un servicio de negocio real (nuestro caso) o si la IA es el producto distribuido. Esto refuerza (con motivo de cumplimiento, no solo de producto) el principio de guardrails ya definido en el documento de visión (sección 33): los guardrails de `Agent` deben impedir estructuralmente que la conversación se salga del alcance comercial del negocio, no ser solo una sugerencia en el prompt.

**Tools del catálogo (sección 12/13 del documento de visión) — estado de cada una respecto a lo ya construido:**
- `create_opportunity()` / `update_opportunity()` — bajo esfuerzo: ya existe `opportunity.service.ts`, la tool es un wrapper delgado con la capa de permisos del agente encima.
- `create_lead()` / `update_lead()` — la decisión de P1 (Lead vs. Contact) ya está tomada y formalizada: `Contact.lifecycleStage` cumple ese rol y NO se agrega una entidad separada. Lo que sigue bloqueando a estas dos tools es el bullet de acá abajo, no aquella decisión.
- `get_availability()` / `create_booking()` — dependen del módulo de Booking (2.1).
- `send_message()` — depende de la integración de WhatsApp de este mismo módulo.
- `create_payment_link()` — no existe ninguna integración de pagos en este repo hoy (ver 2.3, es un gap nuevo, no cubierto en discusiones anteriores).

**Pendiente que bloquea las tools de calificación (abierto el 28/08/2026, al formalizar Lead vs. Contact):**

- [ ] Decidir dónde viven los atributos de calificación que el documento de visión asigna a `Lead` (score, intención, presupuesto, urgencia, servicio de interés, datos recopilados por IA, campos personalizados) — columnas nuevas en `Contact` vs. tabla de calificación aparte — **antes** de implementar `create_lead()`/`update_lead()` y las tools de calificación. Ninguno de esos atributos existe hoy en `Contact`, y la sección 9 (Calificación) y el principio rector 14 (Lead Score) del documento de visión dependen de ellos. Ver la nota fechada en `docs/project-overview.md`, sección 5.

**Capa de permisos:** cada tool debe validar contra `Agent.enabledTools` y los guardrails configurados antes de ejecutar — el principio ya establecido de "la IA puede proponer, el backend decide" tiene que vivir acá, no en el prompt del modelo.

### 2.3 Pagos (gap nuevo, no cubierto en las discusiones previas)

La tool `create_payment_link()` del catálogo de agentes no tiene ninguna base construida en este repo — es distinto de la discusión de pagos que se tuvo sobre Resea (esa era sobre la suscripción de Resea como producto, esto es sobre que el CRM pueda cobrarle al cliente final de un negocio, ej. una seña de reserva en el Pack Turnos o el cierre de una venta). Falta:
- [ ] Elegir pasarela de pago para el CRM (podría ser la misma MercadoPago que ya usa Resea, o Stripe si se apunta a mercados fuera de la región — no decidido).
- [ ] Diseñar el flujo (creación de link, webhook de confirmación, actualización de `Opportunity` a `WON`) — mismo patrón que ya está probado y documentado del lado de Resea (`mercadopago-webhook`), se puede reusar el criterio de diseño aunque el código sea nuevo.
- [ ] Decidir si esto es necesario para el primer pack a lanzar (Pack Turnos, si se prioriza la seña anti no-show) o si puede esperar.

### 2.4 Integración con Resea

Ya diseñado en `contrato_integracion_crm_resea.md` (carpeta "Sistema Saas"). Del lado del CRM falta:
- [ ] Tabla `BranchIntegration` (genérica, por sucursal + provider) y su UI/endpoint de administración.
- [ ] Emitir/almacenar la API key de servicio que Resea le entregue al CRM.
- [ ] Acción "enviar QR" en el motor de automatizaciones, disparada por el motor de eventos salientes (P1) cuando `Opportunity` pasa a `WON`.

Nota de prioridad: esto puede esperar a que Resea cierre sus propios pendientes (cycle 29, endpoint de review-link) — no tiene sentido construir el lado CRM de esta integración antes de que el otro lado exista.

## P3 — Puede esperar sin bloquear nada de lo anterior

- [ ] Frontend del CRM (carpeta `frontend/` vacía hoy). No bloquea el agente de IA ni las automatizaciones, que operan sin UI propia; sí hace falta eventualmente para que un administrador configure pipelines, agentes y automatizaciones sin tocar la base de datos a mano.
- [ ] Soporte a más de un proveedor de modelo de IA (hoy alcanza con abstraer la interfaz sin implementar varios).
- [ ] Más canales además de WhatsApp/Web (Instagram, Messenger, Telegram).

## Cómo se relacionan entre sí (para no perder el hilo)

El motor de eventos salientes (P1) es la pieza que atraviesa todo: sin él, ni el recordatorio de turno, ni el envío de QR post-venta, ni ninguna automatización futura tienen forma de dispararse. Por eso va antes que los módulos nuevos, aunque no sea una feature visible por sí sola. La decisión de Lead vs. Contact (P1) es chica en esfuerzo pero cara de revertir si se construyen tools de agente sobre el modelo equivocado — conviene resolverla en una conversación de producto antes de escribir código de agentes. Booking y Agentes de IA se pueden construir en paralelo hasta cierto punto (Booking no depende de Agentes), pero las tools `get_availability()`/`create_booking()` del agente sí dependen de que Booking exista primero.
