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

Estos dos no son features en sí, son la base que necesitan casi todos los módulos nuevos de abajo:

- [ ] **Motor de eventos salientes** (patrón outbox, análogo al que ya usan para `IngestionEvent` del lado entrante). Hoy no existe ningún mecanismo para que el CRM avise "esto pasó" — ni al motor de automatizaciones, ni a Resea, ni a nada. Lo necesitan: el trigger "Oportunidad → Ganada" del motor de automatizaciones, el aviso a Resea para enviar el QR de reseña, y el recordatorio de WhatsApp antes de un turno agendado. Construir esto una vez, genérico, antes de cablear cualquiera de esos tres casos particulares.
- [ ] **Decisión: modelo de Lead vs. Contact.** El documento de visión original (sección 8) dice explícitamente que Lead debe ser una entidad propia, distinta de Contact. Lo que se construyó hasta ahora en este repo no tiene una entidad `Lead` separada — la capa de ingesta promueve directamente a `Contact`. Esto no bloqueaba nada mientras el CRM se usaba como CRM tradicional, pero si el agente de IA va a tener una tool `create_lead()` (catálogo de herramientas, sección 12 del documento de visión), hay que decidir antes de construirla: ¿se agrega la entidad `Lead` real como estaba pensada, o se actualiza el documento de visión para reflejar que `Contact` con un campo de estado cumple ese rol? Bloquea el diseño de las tools de calificación del agente.

## P2 — Módulos nuevos, en orden de menor a mayor dependencia

### 2.1 Agenda/Booking

Ya diseñado en `docs/booking-architecture.md` (integración con Google Calendar, entidades `Resource`/`ServiceType`/`Booking`/`GoogleCalendarConnection`). Pasos de implementación, copiados de ese documento para que este roadmap sea autocontenido:

- [ ] CRUD de `Resource` y `ServiceType` (sin Google Calendar todavía).
- [ ] Conexión OAuth con Google Calendar por sucursal + `freebusy.query`.
- [ ] `POST /api/bookings` con creación de evento en Google + control de capacidad propio.
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
- `create_lead()` / `update_lead()` — depende de la decisión de P1 (Lead vs. Contact) antes de poder implementarse bien.
- `get_availability()` / `create_booking()` — dependen del módulo de Booking (2.1).
- `send_message()` — depende de la integración de WhatsApp de este mismo módulo.
- `create_payment_link()` — no existe ninguna integración de pagos en este repo hoy (ver 2.3, es un gap nuevo, no cubierto en discusiones anteriores).

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
