# Prueba en vivo contra producción — AutoMax — 2026-09-29

- **Backend:** https://plataformacrm.onrender.com · **Frontend:** https://plataforma-crm-chi.vercel.app
- **Organización:** AutoMax `3af9d937-2c84-492f-8443-99f167bb7eb5` · sucursal `529ed9df…` · agente `8d6ae14e…`
- **Usuario:** el usuario ADMIN de Rocco (email omitido en la copia del repo, que es público). Token de Supabase Auth; la anon key se tomó del bundle público del frontend (la de `frontend/.env` es la del Supabase local).
- **Herramientas:** scripts Node en esta carpeta (`lib.mjs`, `f1…f10`); cada request queda en `llamadas.log`, cada entidad creada en `creados.jsonl`, cada resultado en `resultados.jsonl`, cada turno del agente en `turnos-agente.jsonl`.
- **Consumo:** 6 turnos del agente (5 por test-message + 1 por WhatsApp entrante; 13 contando la sesión anterior) · 2 WhatsApp salientes a Rocco (plantilla + respuesta del agente; tope 5) · el repo no se tocó (solo lectura de código).

---

## 1. Auth, organización, sucursales, usuarios (solo lectura)

| Flujo | Método y ruta | Resultado | Evidencia |
|---|---|---|---|
| Identidad | `GET /api/me` | OK | 200 · role=ADMIN, organizationId correcto |
| Organización | `GET /api/organization` | OK | 200 · name=AutoMax, preferredCurrency=null, exchangeRates=[] |
| Sucursales | `GET /api/branches`, `/api/branches/:id` | OK | 200 · 1 sucursal "AutoMax - Sucursal Palermo", paymentLinkUrl y datos de transferencia cargados |
| Usuarios | `GET /api/users` | OK | 200 · 1 usuario (Rocco, ADMIN) |
| Token ausente / basura / firma alterada | `GET /api/me` | OK | 401 `Falta el token de autenticación` · 401 · 401 |
| Id inexistente / no-UUID | `GET /api/companies/0000…`, `/companies/no-es-uuid` | OK | 404 · 400 |
| Id válido pero **ajeno** (otra org) | — | NO PROBADO | No tengo un id real de otra organización sin salir de AutoMax; el aislamiento lo cubren los tests de integración en CI. Los ids inexistentes devuelven 404 igual que uno ajeno (no hay oráculo de existencia). |
| Token **vencido** | — | NO PROBADO | El token dura 1 h y no se forjó uno vencido (haría falta la clave privada). Firma alterada = 401. |

## 2. CRM

| Flujo | Método y ruta | Resultado | Evidencia |
|---|---|---|---|
| Empresas: crear/editar/validar | `POST/PATCH/GET /api/companies` | OK | crear 201 · patch 200 city=Montevideo · name vacío 400 `name es requerido` |
| Contactos/leads: crear (LEAD, MQL) sin teléfono | `POST /api/contacts` | OK | 201 ×3, lifecycle=LEAD/MQL. "Lead" no es una entidad propia: es `Contact.lifecycleStage=LEAD` (+ campos de calificación que llena el agente) |
| Contactos: validaciones | `POST /api/contacts` | OK | email inválido 400 · sin lastName 400 · companyId inexistente 400 · email duplicado 409 `Ya existe un contacto con ese email en esta organización` |
| Contactos: editar | `PATCH /api/contacts/:id` | OK | 200 · LEAD→SQL, `jobTitle:null` limpia el campo |
| Búsqueda, filtros, paginación | `GET /api/contacts?search&page&pageSize&email&lifecycleStage` | OK | p1=[Vivo3,Vivo4] p2=[Vivo5] total=3 · pageSize=101 → 400 |
| Oportunidades: crear | `POST /api/opportunities` | OK | 201 ×2 (con leadSource=WEBSITE) |
| Oportunidades: mover de etapa | `PATCH /api/opportunities/:id {stageId}` | OK | 200 · Nuevo Lead → Contactado; a "Cierre Perdido" → status=LOST con lostReason |
| Oportunidades: negativas | `PATCH/POST /api/opportunities` | OK | stage inexistente 400 · amount<0 400 · id inexistente 404 · body vacío 400 |
| Vista pipeline (por etapa) | `GET /api/opportunities?stageId&search` | OK | 200 · la oportunidad aparece en su etapa |
| Actividades/tareas | `POST/PATCH/GET /api/activities` | OK | TASK 201 · NOTE 201 · completar 200 (completedAt) · tipo `WHATSAPP` 400 · listar por oportunidad 1 |
| Soft delete de [TEST] | `DELETE /api/contacts/:id` → `GET` | OK | 204 · GET 404 · no aparece en la lista · 2º DELETE 404 |
| Campos personalizados | — | NO PROBADO | `Contact.customFields` existe en `prisma/schema.prisma:911` pero ningún schema de `/api/contacts` lo acepta ni hay endpoint de definición: **no está expuesto por API** |
| ¿El CRM funciona sin IA? | todas las fases | OK | Todo el CRUD (empresas, contactos, oportunidades, etapas, actividades, cotizaciones, pagos, reservas, QR, ingesta) funciona sin invocar al agente |

## 3. Ingesta

| Flujo | Método y ruta | Resultado | Evidencia |
|---|---|---|---|
| Source WEBHOOK + API key | `POST /api/sources`, `POST /api/api-keys` | OK | 201 · 201 (la clave `crm_…` se devuelve una sola vez) · fieldMapping en WEBHOOK → 400 |
| Webhook de landing | `POST /api/ingest` (`x-api-key`, `x-external-id`) | OK | 202 `{status:PENDING,duplicate:false}` · mismo externalId → 202 `duplicate:true`, mismo id |
| Negativas | `POST /api/ingest` | OK | sin key 401 · key alterada 401 · text/plain 415 · JSON roto 400 · firstName vacío 202 → evento FAILED `firstName es requerido` (por diseño: se valida en el worker) |
| Evento → Contact | `GET /api/ingestion-events?sourceId`, `GET /api/contacts?email` | OK | PROCESSED con promotedContactId; contacto con source = nombre de la fuente |
| Import CSV (2 válidas + 1 inválida) | `POST /api/imports/preview`, `POST /api/imports`, `GET /api/imports/:batchId` | OK | preview 200 encabezados · import 202 filasLeidas=3 · resumen promovidos=2 fallidos=1 con motivo · `.exe` → 415 |

## 4. Stock, cotizaciones, pagos, tipo de cambio

| Flujo | Método y ruta | Resultado | Evidencia |
|---|---|---|---|
| Vehículos | `POST/PATCH/GET /api/vehicles`, `/vehicles/:id/change-log` | OK | alta 201 STK-000037 AVAILABLE · patch precio 200 · change-log 1 entrada · filtro maxPriceUsd OK · year=1800 400 · sucursal inexistente 400 |
| Cotizaciones | `POST/PATCH/GET /api/quotes` | OK | DRAFT 201 · editar borrador 200 · SENT 200 · status+contenido juntos 400 · editar enviada 409 |
| Pagos (registro manual, no cobro) | `POST /api/payments` | OK | 201 · method/fecha inválidos 400 · campo extra 400 (`.strict`) |
| Link de pago | `GET /api/branches/:id` + tool del agente | OK | No hay generación de links: es `Branch.paymentLinkUrl` fijo; el agente lo entregó (turno 4) |
| Tipo de cambio | `GET /api/organization` | NO PROBADO | preferred/alternateCurrency=null, exchangeRates=[]; configurarlo exige `PATCH /api/organization` (cambio de config) |

## 5. Knowledge Base

| Flujo | Método y ruta | Resultado | Evidencia |
|---|---|---|---|
| Listar / crear [TEST] / validar | `GET/POST /api/knowledge-base` | OK | crear 201 · title vacío 400. Nota: `search` busca solo por título (decisión documentada en `knowledgeBaseEntry.repository.ts:18`) |
| ¿El agente la usa? | `POST /api/agents/:id/test-message` (turno 4) | OK | Respondió "domingos de 9 a 11 … TORNASOL-29 … lavado gratis", dato que solo existe en la entrada [TEST] |

## 6. Agente de IA y widget

Todos los turnos por `POST /api/agents/:id/test-message`, canal WEB, contacto `[TEST] Vivo4` (sin teléfono), conversación `510c1e43…`.

| Turno | Pedido | Tools | Verificado en la base | Resultado |
|---|---|---|---|---|
| 1 | Sedán usado hasta USD 18.000 | `search_vehicles`, `update_lead` | contacto: budgetAmount=18000 USD, intent guardado | OK (16 s) |
| 2 | Test drive del Civic el jueves 11:00 | `get_service_types`, `create_opportunity`, `get_availability` | opp `8e6b0ca3` "Compra de Honda Civic EXL" 15800 USD, Nuevo Lead; 11:00 ocupado → ofreció 12:15 | PARCIAL (ver F2) |
| 3 | "Agendalo a las 12:15" | `create_opportunity` (reused=true), `create_booking` | booking `c25fd14e` CONFIRMED 01/10 12:15 AR, googleEventId=null | PARCIAL (ver F3) |
| 4 | Link de seña + domingo/TORNASOL-29 | `get_payment_info` | link + datos bancarios; usó la KB [TEST] | OK |
| 5 | Hablar con una persona | `request_human_handoff` | conversación TRANSFERRED_TO_HUMAN, asignada al vendedor, brief generado, tarea "Conversación derivada…" creada | OK |

| Flujo | Método y ruta | Resultado | Evidencia |
|---|---|---|---|
| Embed token | `POST /api/agents/:id/embed-tokens` | OK | 201 `embed_…` (se devuelve una vez) |
| Endpoint público: rechazos | `POST /api/public/agents/:id/web/messages` | OK | sin token 401 · token falso 401 · sin Origin 401 · Origin no registrado 401 · agente inexistente 401 · text/plain 415 |
| Conversación por el widget | ídem | NO PROBADO | `Agent.allowedOrigins = []` → todo Origin se rechaza (`widgetAuth.service.ts:59-64`); habilitarlo es cambio de config |

## 7. WhatsApp

| Flujo | Método y ruta | Resultado | Evidencia |
|---|---|---|---|
| Envío saliente a Rocco | Ganar opp [TEST] `b9c875e6` del contacto [TEST] Rocco → regla **preexistente** "Prueba: seguimiento WhatsApp al ganar (Rocco)" (`opportunity.send_qr_followup`, delay 0) | OK | Rocco confirmó recepción ~13:3x: "Hola Rocco, gracias por tu compra… {link}". Plantilla `seguimiento_postventa` APPROVED |
| Link del mensaje | `qrFollowUpWorker.ts:217` | OK (observación) | Manda `QrCode.destinationUrl` directo (YouTube). Es intencional (`schema.prisma:2610-2623`, `docs/qr-integration.md` ~l.1700) y `/qr/resolve` tampoco registra clics. Ver O1 |
| Registro del envío en el CRM | `GET /api/conversations?contactId`, `GET /api/activities?contactId` | FALLA | Ambos vacíos: ver F1 |
| Respuesta del agente a un mensaje entrante | webhook `/webhooks/whatsapp` → worker de entrantes | OK | Rocco escribió "Hola, ¿tienen alguna pickup usada?" (17:05:54 UTC). Se asoció al contacto **preexistente "."** (`0d09ca56`, `+598XXXXXXXX`), no al [TEST] (`598XXXXXXXX`): ver F5. Conversación WHATSAPP `b6299dc4` (existente, ACTIVE). El agente respondió en 13 s (OUTBOUND SENT, WhatsApp #2) con `search_vehicles {bodyType:PICKUP, condition:USED}` → 3 pickups reales (Hilux DX, Hilux SRV, Amarok). En la base: solo los 2 mensajes (con toolCalls y externalMessageId); el contacto no cambió (updatedAt 22/09) y no se creó ninguna oportunidad. El primer intento fallido fue porque el mensaje todavía no se había mandado. |
| WhatsApp desde una regla NUEVA | — | NO PROBADO | Exige dar de alta una plantilla y que Meta la apruebe (config externa) |

## 8. Automatizaciones

| Flujo | Método y ruta | Resultado | Evidencia |
|---|---|---|---|
| Catálogo | código + mensajes de error | OK | triggers: `opportunity.won`, `opportunity.stale`; acciones: `activity.create_follow_up`, `agent.draft_follow_up`, `opportunity.send_qr_followup`, `opportunity.send_discount_voucher` (no hay endpoint de catálogo; se lee del 400) |
| Validaciones | `POST /api/automations` | OK | trigger desconocido 400 · acción desconocida 400 · par stale+create_follow_up 400 · config inválida 400 |
| Regla [TEST] disparada | `POST /api/automations` → ganar opp [TEST] → `GET /api/activities?opportunityId` | OK | 1 TASK "[TEST] Seguimiento post-venta automático", due +2 días, asignada al vendedor. Regla desactivada enseguida (`PATCH isActive:false`) |

**Precaución aplicada:** los triggers son de toda la organización. La regla preexistente de Rocco manda WhatsApp al contacto de CUALQUIER oportunidad ganada; solo se ganaron oportunidades de contactos [TEST] sin teléfono, más la del contacto de Rocco (intencional).

## 9. Agenda, QR

| Flujo | Método y ruta | Resultado | Evidencia |
|---|---|---|---|
| Disponibilidad + reserva manual | `GET /api/availability`, `POST /api/bookings` | OK | 9 turnos · reserva 201 para [TEST] Vivo3 · googleEventId=null (sucursal **sin Google Calendar conectado**: no se sincroniza nada) |
| Negativas | `POST /api/bookings` | OK | doble reserva 409 · fecha pasada 400 · fuera de horario 400 |
| QR digital | `POST /api/qr/digital`, `PATCH /api/qr/:id`, `GET /qr/resolve/:id` | OK | 201 · 200 · `javascript:` 400 · resolve sin secreto de proxy 404 |
| Google Calendar / Messenger-Instagram | `GET /api/branches/:id/google-calendar`, `GET /api/integrations/meta` | NO PROBADO | 404 no conectados; conectar es cambio de config |

## 10. Frontend

| Flujo | Método | Resultado | Evidencia |
|---|---|---|---|
| Login + datos creados por API | `/browse`: `/login`, `/`, `/contacts`, `/opportunities`, `/conversations/:id` | OK | Login OK, sin errores de consola. Dashboard con oportunidades/actividades [TEST]; `/contacts` con los [TEST] (incluye ingesta y CSV); `/opportunities` con su etapa; la conversación muestra brief, mensajes y tool calls. Capturas: `ui-oportunidades.png`, `ui-conversacion.png` |

---

## Fallas y hallazgos

### F1 — El WhatsApp automático no deja rastro en el CRM · MEDIO
**Estado:** hecho (PR #343)
- **Pasos:** con la regla `opportunity.won → opportunity.send_qr_followup` activa, ganar una oportunidad cuyo contacto tiene teléfono; esperar al worker; `GET /api/conversations?contactId=…` y `GET /api/activities?contactId=…`.
- **Esperado:** el vendedor ve en la ficha / inbox que al cliente se le mandó un WhatsApp (mensaje OUTBOUND en una conversación, o al menos una actividad).
- **Obtenido:** nada. El envío solo queda en `qr_follow_ups`, que no tiene endpoint. Si el cliente contesta, el agente no tiene ese mensaje en el historial.
- **Probable:** `src/workers/qrFollowUpWorker.ts:211-218` (manda la plantilla y solo actualiza la fila de seguimiento). Mismo patrón en `discountVoucherFollowUpWorker.ts`.

### F2 — `create_opportunity` del agente no vincula el vehículo · MEDIO
**Estado:** hecho (PR #342) — resuelto sin vincular vehicleId, por el ítem 175
Pendiente de producto: campo 'vehículo de interés' separado de la reserva (requiere migración)
- **Pasos:** turno "Me interesa el Honda Civic EXL…" → tool `create_opportunity {vehiculo:"Honda Civic EXL"}` → `GET /api/opportunities/8e6b0ca3…`.
- **Esperado:** `vehicleId` del Civic (la tool devuelve `unidad: "Honda Civic EXL 2018"` y el monto sale de su precio).
- **Obtenido:** `vehicleId: null`. El vendedor ve la oportunidad sin la unidad, y la unidad no queda reservada ni con historial.
- **Probable:** `src/services/agentTools.service.ts:571-579` (el `createOpportunity` no recibe `vehicleId`; el comentario de la l.549 lo admite: "hoy no puede"). Limitación conocida, pero engaña al modelo porque la respuesta dice "unidad".

### F3 — La reserva del agente no se vincula a la oportunidad · BAJO
**Estado:** hecho (PR #342)
- **Pasos:** turnos 2-3 (el agente crea la oportunidad y después la reserva en la misma conversación) → `GET /api/bookings/c25fd14e…`.
- **Esperado:** `opportunityId` = la oportunidad abierta del contacto.
- **Obtenido:** `opportunityId: null`.
- **Probable:** `src/services/agentTools.service.ts:1325-1331` (no pasa `opportunityId` a `createBooking`).

### F4 — La tarea que crea la automatización no aparece en la ficha del contacto · BAJO
**Estado:** hecho (PR #342)
- **Pasos:** ganar una oportunidad con la regla `activity.create_follow_up` activa → `GET /api/activities?contactId=<contacto de la opp>`.
- **Esperado:** la tarea aparece también por contacto.
- **Obtenido:** `contactId: null` (solo `opportunityId`); la lista por contacto viene vacía.
- **Probable:** `src/services/automationActions/createFollowUpActivity.ts:116-120` (no pasa `contactId` de la oportunidad).

### F5 — Teléfonos duplicados por formato; el match de WhatsApp es ambiguo · MEDIO
**Estado:** hecho (PR #341)
- **Pasos:** `POST /api/contacts {phone:"598XXXXXXXX"}` cuando ya existe un contacto con `+598XXXXXXXX`.
- **Esperado:** normalizar a `+598…` y avisar o rechazar el duplicado (como con el email → 409).
- **Obtenido:** 201; conviven "." (`+598XXXXXXXX`, creado por WhatsApp entrante) y "[TEST] Rocco WhatsApp" (`598XXXXXXXX`). El entrante matchea por dígitos (`findContactIdByNormalizedPhone`) y agarra uno de los dos.
- **Probable:** `src/services/contact.service.ts:190` (`phone: input.phone ?? null` sin normalizar) frente a `src/services/whatsappContact.service.ts:64-85`.

### F6 — Latencia alta en todos los endpoints autenticados · MEDIO
**Estado:** fuera de alcance (infraestructura)
- **Evidencia:** 401 sin token ≈ 0,2 s; cualquier request autenticado, aunque sea un 400 de validación, ≈ 1,2 s; `PATCH /api/opportunities` 5-7 s; `POST /api/bookings` 6-8 s; un turno del agente 16 s.
- **Probable:** cada query paga la latencia Render ↔ Supabase `sa-east-1` (`docs/deployment.md:333`). `authenticate` hace al menos una query por request (`src/services/auth.service.ts:9`). Conviene revisar la región de Render.

### O1 — (observación, no falla) El seguimiento con QR manda el destino final · BAJO
Intencional (`qrFollowUpWorker.ts:217`). Consecuencias: si se cambia el destino del QR, los mensajes ya enviados siguen apuntando al viejo, y no hay métrica de clics. Igualmente `/qr/resolve` tampoco registra clics hoy, así que mandar ese link no alcanzaría sin agregar tracking.

---

## Pendientes / no probados por requerir config

- **Requieren cambiar config (no se hizo):** conversación real por el widget (allowedOrigins), tipo de cambio (monedas de la org), Google Calendar, Messenger/Instagram, WhatsApp desde una regla nueva (alta de plantilla en Meta).

## Tabla resumen

| # | Área | Resultado |
|---|---|---|
| 1 | Auth / me / org / sucursales / usuarios | OK |
| 2 | Auth negativa (sin token, basura, firma alterada) | OK |
| 3 | Id ajeno / token vencido | NO PROBADO |
| 4 | Empresas | OK |
| 5 | Contactos / leads (CRUD, validaciones, búsqueda, paginación) | OK |
| 6 | Oportunidades (crear, mover etapa, perder, ganar, negativas) | OK |
| 7 | Actividades / tareas | OK |
| 8 | Soft delete | OK |
| 9 | Campos personalizados | NO PROBADO (no expuestos por API) |
| 10 | Ingesta: source + API key + webhook | OK |
| 11 | Ingesta: import CSV | OK |
| 12 | Vehículos / stock | OK |
| 13 | Cotizaciones | OK |
| 14 | Pagos manuales / link de pago | OK |
| 15 | Tipo de cambio | NO PROBADO (config) |
| 16 | Knowledge Base (CRUD + uso por el agente) | OK |
| 17 | Agente: stock + presupuesto | OK |
| 18 | Agente: oportunidad + reserva | PARCIAL (F2, F3) |
| 19 | Agente: link de pago | OK |
| 20 | Agente: derivación a humano | OK |
| 21 | Widget: embed token + rechazos | OK |
| 22 | Widget: conversación real | NO PROBADO (config) |
| 23 | WhatsApp saliente (plantilla) | OK |
| 24 | WhatsApp: registro en el CRM | FALLA (F1) |
| 25 | WhatsApp: respuesta del agente a entrante | OK (se asoció al contacto ".", ver F5) |
| 26 | Automatizaciones: catálogo + validaciones | OK |
| 27 | Automatización [TEST] disparada | OK (F4 menor) |
| 28 | Agenda: disponibilidad, reserva, negativas | OK |
| 29 | QR digital | OK |
| 30 | Google Calendar / Messenger-Instagram | NO PROBADO (config) |
| 31 | Frontend | OK |
| 32 | Teléfonos duplicados por formato | FALLA (F5) |
| 33 | Latencia | FALLA (F6) |

## Limpieza

Hecha con el OK de Rocco el 29/09, con `limpieza.mjs`. Se borró solo lo que figura en `creados.jsonl`: 28 entidades de esta sesión (el contacto Vivo5 ya estaba borrado) más las 13 de la sesión anterior. Resultado en `limpieza-resultado.json`: **41 operaciones, 0 errores**.

- **Reservas:** 3 canceladas (`PATCH /api/bookings/:id/cancel` → 200).
- **Conversaciones:** 2 cerradas (`POST /api/conversations/:id/close` → 200).
- **Actividades (7), pago, oportunidades (6), contactos (7), empresas (2), vehículos (2), KB (2), QR y automatización:** DELETE → 204 (soft delete).
- **Embed tokens (2) y API key:** DELETE → 200 (revocados).
- **Sources (2):** DELETE → 204.
- **Cotizaciones (2):** pasadas a REJECTED (200) porque no hay DELETE. Después de borrar su oportunidad, `GET /api/quotes/:id` devuelve 404.

**Verificación** (`verificar-limpieza.mjs` → `verificacion-limpieza.json`):
- Quedan 0 [TEST] en contactos, empresas, oportunidades (incluida "Compra de Honda Civic EXL"), actividades, vehículos, KB, QR y automatizaciones.
- Quedan 0 sources, 0 API keys activas y 0 embed tokens sin revocar.
- No quedan reservas confirmadas de contactos [TEST], y las dos conversaciones [TEST] están cerradas.
- La regla preexistente "Prueba: seguimiento WhatsApp al ganar (Rocco)" sigue intacta y activa.

**Lo que no se pudo borrar por API** (queda en la base, sin endpoint para borrarlo):
- Las 2 cotizaciones: quedan REJECTED, colgando de oportunidades soft-deleted.
- Los IngestionEvent del webhook (1 PROCESSED, 1 FAILED) y el lote de import `09b9ef93` con sus 3 eventos.
- Las filas de `qr_follow_ups` (o1 → debería terminar FAILED por falta de teléfono; la de Rocco → enviada) y las de `automation_executions`.
- Los mensajes de las 2 conversaciones WEB [TEST]: quedan cerradas, no borradas.
- Los 2 mensajes de hoy (entrante de Rocco + respuesta del agente) en la conversación WHATSAPP preexistente `b6299dc4` del contacto ".": es dato preexistente y no se tocó.
- El `change-log` de los vehículos borrados.

