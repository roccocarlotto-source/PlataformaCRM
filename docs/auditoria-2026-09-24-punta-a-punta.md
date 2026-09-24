# Auditoría de punta a punta — 2026-09-24

Auditoría de solo lectura de la plataforma (CRM + agente de IA + WhatsApp +
widget + automatizaciones + agenda + pagos + QR), hecha en una sesión en la
nube. **No se modificó ningún archivo salvo este.** Convención de severidad y
formato heredados de `docs/auditoria-2026-08-29.md`.

> **Estado de este documento:** en construcción — se escribe a medida que
> avanza la auditoría, con un commit por avance. Las secciones marcadas
> `(pendiente)` todavía no se completaron.

---

## 0. Alcance y método

### 0.1 Repositorios y commits auditados

| Repo | Commit | Rama de origen | Estado |
|---|---|---|---|
| `roccocarlotto-source/PlataformaCRM` | `c49fc11c619a716677927e410544caf79d53d011` (= `origin/master` al 2026-09-24) | `master` | auditado |
| `roccocarlotto-source/plataforma-qr` | — | — | **NO ACCESIBLE desde esta sesión.** `add_repo` devolvió "you don't have access to roccocarlotto-source/plataforma-qr" y `list_repos` no lo lista. Todo lo que se dice del Worker de Cloudflare, del `admin/` y del Supabase de QR sale de `docs/qr-integration.md` y del lado CRM del contrato, y queda marcado como **VERIFICAR**. |

### 0.2 Qué se leyó

En `PlataformaCRM`, antes del código: `CLAUDE.md`, `docs/project-overview.md`,
`docs/roadmap-implementacion.md`, `docs/auditoria-2026-08-21.md`,
`docs/auditoria-2026-08-29.md`, `docs/verificacion-v1-v14-estado.md`,
`docs/deployment.md`, `BITACORA.md`, `PLAN-AUTONOMO.md`; y por subagentes
(con verificación posterior de cada afirmación contra el código): las
arquitecturas (`authentication-`, `ingestion-`, `ai-agent-`, `automations-`,
`booking-architecture.md`, `qr-integration.md`, `integracion-resea-crm.md`,
`data-classification.md`, `matriz-de-datos-crm.md`,
`agent-testing-scenarios.md`), las bitácoras `docs/bitacora-*.md` y
`docs/frontend-cambios-pendientes.md` (ítems 90–124 y pendientes).

Código: `src/**` completo (101.010 líneas de TS en 5 + 77 + 12 + 26 + 43 + 41 +
6 + 144 + 4 + 45 + 10 archivos por carpeta), `prisma/schema.prisma` (3.168
líneas, 40 modelos + enums), las 49 migraciones de `prisma/migrations/`,
`prisma/sql/*.sql`, `scripts/*.ts`, `.github/workflows/ci.yml`, `Dockerfile`,
`frontend/src/**` (518 archivos, 81.277 líneas) y `frontend/vite*.config.ts`.

Método: igual que el 29/08 — la lectura se repartió en siete pasadas
paralelas (ejes A, B, C, D, E+G, F, docs+H) y **cada hallazgo que entró acá se
re-verificó a mano contra el archivo y la línea** antes de escribirlo. Los
módulos de mayor riesgo (webhook de WhatsApp, loop de orquestación del
agente, widget público, permisos de tools) se leyeron además directamente.

### 0.3 Qué se ejecutó y resultados reales

Todo contra el entorno de la sesión (Node 22.22.2, Postgres 16.13 local en
`localhost:5432`, variables de entorno de prueba: `DATABASE_URL`/`DIRECT_URL`
→ `crm_test` local, `SUPABASE_URL` → `127.0.0.1:54321` **sin nada
escuchando**, claves `dummy-*`). **No se tocó ninguna base, cuenta ni API
real**; no se corrió `scripts/eval-agente-real.ts` ni `scripts/sonda-de-prompt.ts`.

| Qué | Resultado real |
|---|---|
| `npm ci` + `npx prisma generate` (backend), `npm ci --prefix frontend` | OK |
| `npm run typecheck` (3 tsconfig) | OK, sin errores |
| `npm run lint` (backend) | OK, sin salida |
| `npm run format:check` (todo el repo) | "All matched files use Prettier code style!" |
| `npx prisma validate` | schema válido |
| `npm test` (unitarios backend) | **1078 tests, 1078 pass, 0 fail, 0 skip, 0 todo** (20,5 s) |
| `npm run build` | OK (`dist/`, no versionado) |
| `npm audit --omit=dev` (backend) | **4 moderadas, 0 altas/críticas**: `qs` 2.2.5–6.15.3 (GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g) vía `express@4.22.2`; `uuid <11.1.1` (GHSA-w5hq-g745-h8pq) vía `exceljs`. El gate `scripts/audit-gate.ts` de CI bloquea solo high/critical, así que CI está verde con esto. |
| Replica del job `integration` de `ci.yml` contra el Postgres local: stub del schema `auth` de Supabase (`auth.users`, `auth.uid()`, `auth.role()`, roles `anon`/`authenticated`/`service_role`, `pg_trgm`) creado a mano; después `npm run migrate:deploy` | **49 migraciones aplicadas + `manual_constraints.sql` + `rls_policies.sql` OK**. Sin el stub, la migración `20260821140000` falla con `schema "auth" does not exist` (esperado: el esquema depende de objetos de Supabase). |
| `npm run prisma:seed` | OK (roles ADMIN, USER) |
| `npm run verify:schema` | **14/14 chequeos afirmados en verde** (FKs compuestas, 56 FKs conocidas, CHECKs, triggers, índices parciales, grants) |
| `npm run test:integration` (con `SECRET_ENCRYPTION_KEY` efímera de `gen:encryption-key`) | **1076 tests: 343 pass, 733 fail**. Las 733 fallas son todas por ausencia de GoTrue/Storage locales (`ECONNREFUSED 127.0.0.1:54321` ×182 en los `before` que crean usuarios reales con la Admin API; 928 `fetch failed`; los 2 tests de platform-admin dan 502 por el `inviteUserByEmail`). **No se encontró ninguna falla de integración atribuible al código.** Los 343 que pasan son los que solo necesitan Postgres (colas, outbox, locks, aislamiento, repositorios, worker de ingesta, etc.). |
| Frontend: `typecheck`, `lint`, `test`, `build`, `npm audit` | ver eje F / eje H (sección 3) |

Lo que **no** se pudo ejecutar: la suite de integración completa (necesita
`supabase start` con Docker — no hay Docker en el contenedor), los tests de
`plataforma-qr/supabase/tests` (repo no accesible), `docker build` de la
imagen.

### 0.4 Limitaciones

1. `plataforma-qr` no accesible (ver 0.1): el eje D-QR y la sección 4 se
   auditan de un solo lado.
2. La rama de trabajo asignada por el entorno era `claude/great-heisenberg-ptafjy`;
   el prompt pidió explícitamente `audit/punta-a-punta-2026-09-XX`, así que
   el documento se publica en `audit/punta-a-punta-2026-09-24`.
3. (se completa a medida que avanza)

### 0.5 Convención de severidad

| Nivel | Criterio |
|---|---|
| **CRÍTICO** | Pérdida de datos, fuga de secretos, fuga de aislamiento entre tenants, caída del servidor |
| **ALTO** | Bug funcional real bajo condiciones alcanzables en producción |
| **MEDIO** | Bug real pero de bajo impacto o difícil de alcanzar |
| **BAJO** | Mejora, deuda técnica o inconsistencia menor sin impacto funcional claro |
| **VERIFICAR** | No está claro si es bug o decisión, o no se pudo comprobar en este entorno |

---

## 1. Resumen ejecutivo

(pendiente)

---

## 2. Lo que vi: mapa de la plataforma

### 2.1 Arquitectura real

Como está hoy en el código (`src/app.ts`, `src/server.ts`,
`docs/deployment.md` §"Cómo se desplegó la primera vez"):

```
navegador ──► frontend CRM (SPA Vite/React 19, Vercel: plataforma-crm-chi.vercel.app)
   │             │ VITE_API_URL (Bearer JWT de Supabase Auth)
   │             ▼
   │        backend (1 contenedor Node 22/Express, Render: plataformacrm.onrender.com)
   │             ├─► Postgres (Supabase, pooler 6543 / directo 5432)
   │             ├─► Supabase Auth (Admin API: invitaciones, OTP de onboarding; JWKS ES256 para verificar)
   │             ├─► Supabase Storage (bucket vehicle-photos)
   │             ├─► OpenRouter (LLM del agente; default google/gemma-4-31b-it:free)
   │             ├─► Meta Graph API v25.0 (envío de WhatsApp, un WHATSAPP_ACCESS_TOKEN global)
   │             ├─► Google Calendar API (OAuth por sucursal, refresh token cifrado)
   │             ├─► MercadoPago (solo lee el preapproval al recibir su webhook — QR billing)
   │             └─► API pública de cotización (worker de cotizaciones, cada 24 h)
   │        5 workers in-process (setTimeout encadenado, arrancan en server.ts):
   │          ingesta (5 s) · outbox (5 s) · canales Google (1 h) · cotizaciones (24 h) · oportunidades estancadas (24 h)
   │
   ├──► Supabase Auth directo desde el navegador (login password, reset, aceptar invitación)
   │
sitio del cliente ──► widget.js (IIFE compilado por vite.widget.config.ts) ──► POST /api/public/agents/:id/web/messages (x-embed-token)
Meta ──► POST /webhooks/whatsapp (firma X-Hub-Signature-256)
MercadoPago ──► POST webhook QR (firma x-signature)
Google ──► POST /api/webhooks/google-calendar (token firmado por canal)
landing pages ──► POST /api/ingest (x-api-key)
Cloudflare Worker (repo plataforma-qr, no accesible) ──► GET /qr/resolve/:qrId (x-internal-proxy-secret)
```

Orden de middlewares en `src/app.ts` (importa para lo público): `helmet` →
`Cache-Control: no-store` global → `pino-http` → **router público del widget
con su propio CORS/parser/auth** (antes del `cors()` global) → `cors()`
(`CORS_ORIGIN`) → `compression` → ingesta (parser propio) → webhook
MercadoPago (firma antes del parser) → webhook WhatsApp (parser con
`rawBody`) → `express.json` global → `/api/*` → 404 → `errorHandler`.

Diferencias con los docs: `docs/deployment.md` §1 dibuja **cuatro** workers;
hoy son **cinco** (falta el de oportunidades estancadas, que sí aparece en
`src/server.ts`). `docs/deployment.md` sigue diciendo "Estado: esqueleto"
aunque la tabla final ya tiene Render/Vercel reales.

### 2.2 Fichas por módulo

(pendiente)

### 2.3 Modelo de datos resumido

40 modelos en `prisma/schema.prisma`. Regla estructural (verificada por
`verify:schema` fila 14 y 16, en verde): toda FK entre tablas con
`organization_id` es compuesta `(organization_id, x) → padre(organization_id, id)`.

**Con `organizationId` y `branchId`** (la sucursal como unidad comercial):
`Branch`, `Resource`, `ServiceType`, `GoogleCalendarConnection` (1 por
sucursal), `Booking`, `Agent`, `Conversation`, `QrCode`, `Vehicle`,
`KnowledgeBaseEntry`.

**Solo `organizationId`** (viven a nivel cuenta): `User` (**sin sucursal**: un
usuario ve todas las sucursales de su organización), `Invitation`, `Company`,
`Contact` (con las columnas de calificación de lead `leadScore`, `leadIntent`,
`leadServiceOfInterest`, `leadUrgency`, `leadBudget*`, `leadLocation`,
`leadNotes`, `leadAiData` y `lifecycleStage` — **no existe un modelo `Lead`**;
"Lead" es un `Contact` con `lifecycleStage`), `Pipeline`, `Stage`,
`Opportunity`, `Activity`, `Source`, `ApiKey`, `AgentEmbedToken`,
`IngestionEvent`, `OutboxEvent`, `Automation` (**sin sucursal**: las reglas son
por organización), `AutomationExecution`, `WorkingHours` (por `resourceId`,
no por sucursal directa), `Message` (por `conversationId`), `PaymentEvent`,
`QrSubscriptionStatusChange`, `QrBillingExemptionChange`, `VehiclePhoto`,
`VehicleChangeLog`, `Quote`, `Delivery`, `Payment`.

**Sin `organizationId`** (globales por diseño): `Role` (catálogo ADMIN/USER),
`PlatformAdmin`, `ExchangeRate`.

Relaciones clave: `Agent` ↔ `Branch` (N:1), `Agent.whatsappPhoneNumberId`
único global (así el webhook resuelve tenant por número), `Conversation` →
`Agent`+`Contact`+`Branch`, `Message.externalMessageId` (wamid) único por
organización, `KnowledgeBaseEntry.sourceVehicleId` único por organización
(sincronización stock→KB), `Quote`/`Delivery`/`Payment` → `Opportunity`,
`Vehicle.tradeInOpportunityId` → `Opportunity`, `Booking` → `Resource` +
`ServiceType` + `Contact` (+ `Opportunity` opcional).

Soft delete (`deletedAt`): entidades de negocio del CRM, `Branch`, `Agent`,
`Automation`, `KnowledgeBaseEntry`, `Vehicle`, etc. **Sin** soft delete:
`Conversation`, `Message`, `Booking` (usa `status`), `Payment`, `Quote`
(`status`), `Delivery`.

Campos personalizados: `Contact.customFields` es un `Json` libre ("sin
catálogo de definiciones todavía", `src/services/contact.service.ts:347`);
no hay modelo de definición de campos ni UI que los edite (ver eje I).

### 2.4 Catálogos: tools del agente, triggers/acciones de automatización, variables de entorno

**Tools del agente** (`src/services/agentTools.service.ts`; + la tool de
sistema `request_human_handoff` que vive en
`src/services/agentOrchestration.service.ts:123` y siempre se ofrece):

| Tool | Lee/escribe | Habilitación |
|---|---|---|
| `search_vehicles` | lee `Vehicle` de la sucursal (filtros make/model/precio/carrocería/etc.) | `Agent.enabledTools` |
| `get_service_types` | lee `ServiceType` de la sucursal | ídem |
| `get_availability` | lee agenda (`availability.service`) | ídem |
| `create_booking` | **escribe** `Booking` (vía `booking.service.createBooking`, mismo camino que el panel) | ídem |
| `create_lead` / `update_lead` | **escribe** columnas `lead*` del `Contact` (`qualifyLead`) | ídem |
| `create_opportunity` | **escribe** `Opportunity` en el pipeline default, primera etapa, owner del contacto o default de la sucursal | ídem |
| `update_opportunity` | **escribe** `Opportunity` (título/monto/etapa/vehículo; no owner ni pipeline) | ídem |
| `get_contact_info` | lee `Contact` de la conversación | ídem |
| `get_contact_activities` | lee `Activity` pendientes del contacto | ídem |
| `get_payment_info` | lee `Branch.paymentLinkUrl` / `bankTransferDetails` (datos estáticos por sucursal; **no genera links de pago**) | ídem |
| `request_human_handoff` | **escribe** `Activity` de derivación + `Conversation.status = TRANSFERRED_TO_HUMAN` | siempre |

No existe `create_payment_link` (el principio 3 de §1 del prompt lo nombra;
hoy el "link" es un dato estático por sucursal). No existe una tool de
reserva de unidad de stock (pendiente anotado en `BITACORA.md`).

**Automatizaciones** (`src/services/automationTriggers.ts`,
`automationRegistrations.ts`): triggers = eventTypes del outbox, lista
cerrada de **2**: `opportunity.won` (productor: `opportunity.service.ts:79`)
y `opportunity.stale` (productor: `workers/opportunityStaleWorker.ts:154`,
regla única por organización). Acciones registradas: **2**
(`createFollowUpActivity`, `draftFollowUpMessage` — esta última llama al
LLM). **No hay capa de "Condition"**: `Automation` tiene `triggerConfig` y
`actionConfig`, nada más. Ver eje I.

**Variables de entorno realmente leídas** (`src/config/env.ts` es el único
`process.env` de `src/`): `NODE_ENV`, `PORT`, `CORS_ORIGIN` (**la única
requerida**), `LOG_LEVEL`, `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `INGEST_RATE_LIMIT_WINDOW_MS`,
`INGEST_RATE_LIMIT_MAX`, `INGEST_WORKER_ENABLED`, `INGEST_WORKER_POLL_MS`,
`INGEST_WORKER_BATCH_SIZE`, `INGEST_MAX_ATTEMPTS`, `INGEST_BACKOFF_BASE_MS`,
`INGEST_BACKOFF_MAX_MS`, `OUTBOX_WORKER_ENABLED`, `OUTBOX_WORKER_POLL_MS`,
`OUTBOX_WORKER_BATCH_SIZE`, `OUTBOX_MAX_ATTEMPTS`, `OUTBOX_BACKOFF_BASE_MS`,
`OUTBOX_BACKOFF_MAX_MS`, `OUTBOX_HANDLER_TIMEOUT_MS`, `SHUTDOWN_TIMEOUT_MS`,
`SECRET_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REDIRECT_URI`, `GOOGLE_WEBHOOK_URL`, `GOOGLE_CHANNEL_WORKER_ENABLED`,
`GOOGLE_CHANNEL_WORKER_POLL_MS`, `GOOGLE_CHANNEL_RENEW_MARGIN_MS`,
`GOOGLE_CHANNEL_TTL_SECONDS`, `EXCHANGE_RATE_WORKER_ENABLED`,
`EXCHANGE_RATE_WORKER_POLL_MS`, `OPPORTUNITY_STALE_WORKER_ENABLED`,
`OPPORTUNITY_STALE_WORKER_POLL_MS`, `MERCADOPAGO_WEBHOOK_SECRET`,
`MERCADOPAGO_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`,
`WHATSAPP_ACCESS_TOKEN`, `QR_RESOLVE_PROXY_SECRET`,
`QR_RESOLVE_PROXY_SECRET_PREVIOUS`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`,
`OPENROUTER_BASE_URL`. Todas las de integraciones son opcionales y validadas
en el punto de uso (falla con 500 explícito). Qué falta en `.env.example`: ver
eje E.

### 2.5 Documentación vs. código

(pendiente)

---

## 3. Hallazgos por eje

### A. Aislamiento multi-tenant y autorización

(pendiente)

### B. Agente de IA y herramientas

(pendiente)

### C. Integridad de datos y concurrencia

(pendiente)

### D. Integraciones externas

(pendiente)

### E. Secretos, configuración y seguridad general

(pendiente)

### F. Frontend

(pendiente)

### G. Operación y despliegue

(pendiente)

### H. Tests y CI

(pendiente)

### I. Alineación con el producto

(pendiente)

---

## 4. Contratos entre repos

(pendiente)

---

## 5. Auditorías previas: siguen abiertos / confirmados resueltos

(pendiente)

---

## 6. Sugerencias

### 6.1 Correcciones

(pendiente)

### 6.2 Cambios

(pendiente)

### 6.3 Mejoras

(pendiente)

---

## 7. Qué no se pudo verificar

(pendiente)

---

## 8. Orden de trabajo recomendado

(pendiente)
