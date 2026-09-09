# Integración con Resea (Plataforma-QR) — estado real y pendientes

Documento agregado 28/08/2026 desde una sesión de análisis cross-repo (proyecto "Sistema Saas", que consolida la visión de producto y coordina lo que se construye en paralelo en este repo y en `Plataforma-QR`). No reemplaza `docs/roadmap-implementacion.md` §P1/§2.4 — los complementa con hallazgos verificados contra el código real de ambos repos hoy, y con una decisión pendiente del lado de Resea que conviene conocer antes de construir esto.

## 1. Contrato vigente (resumen)

Diseñado en `contrato_integracion_crm_resea.md` (carpeta "Sistema Saas", fuera de este repo — pegar acá lo esencial para que este documento sea autocontenido):

- Granularidad: **Sucursal (CRM) ↔ business (Resea)**, 1 a 1, vía una tabla genérica `BranchIntegration` (sucursalId, provider, externalId, config, status) — no una tabla específica de Resea, para reusar el mecanismo con futuras integraciones.
- Autenticación: API key de servicio emitida por Resea para el CRM como caller confiable, mismo patrón que `ApiKey`/`Source` de este repo pero en dirección inversa (ver §3).
- Flujo: Resea expone un endpoint que devuelve un link/QR de reseña para un `business_id`; el motor de automatizaciones del CRM lo llama cuando `Opportunity.status → WON`; **el CRM arma y envía el WhatsApp/email al cliente final**, no Resea.

## 2. Hallazgo nuevo: `Sucursal` no existe todavía como entidad

Verificado contra `prisma/schema.prisma` (28/08/2026): el único nivel de tenant en el schema hoy es `Organization` — `Company`, `Contact`, `Opportunity`, etc. cuelgan directo de ahí. No hay modelo `Sucursal`/`Branch`.

Esto importa porque tanto el contrato como `docs/roadmap-implementacion.md` §2.4 dan por sentado un `sucursalId` al que colgar `BranchIntegration`, pero esa entidad todavía no se construyó — es un prerrequisito real, no solo la tabla de integración. Antes de `BranchIntegration` hace falta decidir cómo se modela `Sucursal` (entidad propia bajo `Organization`, con sus propios horarios/agentes/KB/automatizaciones según la sección 3 del documento funcional de "Sistema Saas") y migrar el resto del schema para colgar de `sucursalId` donde corresponda, o al menos para las entidades que la integración necesita tocar primero.

## 3. Hallazgo: el `ApiKey` actual es de ingesta entrante, no sirve tal cual para esto

Verificado en `src/middlewares/authenticateApiKey.ts` y `src/services/apiKey.service.ts`: el sistema `Source`/`ApiKey` autentica a un tercero *entrando* al CRM (una landing page que empuja leads). Lo que pide el contrato es la dirección inversa: el CRM autenticándose *ante Resea* como caller confiable. Es el mismo patrón de diseño (clave hasheada, prefijo visible, revocación), pero es código nuevo — no una reutilización directa del `ApiKey` existente.

## 4. Prerrequisito ya conocido: motor de eventos salientes

Verificado en `src/services/opportunity.service.ts`: `updateOpportunity` valida y persiste el cambio de `status`, pero no dispara nada — ningún webhook, evento ni hook cuando pasa a `WON`. Esto ya está anotado como P1 en `docs/roadmap-implementacion.md` (motor de eventos salientes, patrón outbox) y es prerrequisito de esta integración además del recordatorio de turno y del resto de las automatizaciones futuras. No tiene sentido empezar `BranchIntegration` o la acción "enviar QR" antes de que exista.

## 5. Importante: el lado Resea todavía no confirmó quién envía el mensaje final

Esto no estaba en el contrato original y apareció recién en la revisión de código del 28/08 contra el propio tracking interno de `Plataforma-QR` (`state/engagement-qr-reviews-mvp/tracked-followups.md`, TF-012):

- `DEC-068` (Cycle 29, confirmada) dice que la integración es API-level, con el CRM como quien dispara el envío del link/QR, **"per el contrato ya definido en el repo Sistema Saas"** — es decir, consistente con §1 de este documento (Resea entrega el link, el CRM arma y envía).
- Pero en el mismo Cycle 29, `DEL-025`/`DEL-027` (TF-012) investigaron una arquitectura distinta: un Edge Function `send-qr-notification` donde **Resea mismo enviaría** el WhatsApp/email usando una API de proveedor propia, recibiendo el contacto del cliente final como parámetro. Esto choca con `DEC-051` ("ningún dato de contacto del cliente final llega al backend de Resea") — la propia revisión de seguridad de Resea lo marcó como conflicto sin resolver (`RV-SECURITY-005`, Finding 1), y la propuesta de extender `DEC-051` para permitirlo (`DEL-027`) **todavía no está confirmada** como decisión activa (sería `DEC-069`, pendiente de que el operador la confirme explícitamente).

Mientras eso no se resuelva del lado de Resea, **construir este lado del CRM asumiendo el contrato original de §1** (Resea solo entrega el link/QR, el CRM arma y envía usando su propio canal de WhatsApp — el mismo que se está diseñando en `docs/roadmap-implementacion.md` §2.2) es la opción más segura: es la única confirmada (`DEC-068`), y si Resea termina resolviendo lo contrario, el cambio de este lado sería acotado (dejar de armar/enviar el mensaje y pasar el contacto como parámetro a Resea) en vez de una reescritura.

## 6. Pendientes concretos en este repo, en orden

1. **Decidir y modelar `Sucursal`** como entidad real (nuevo — no estaba explícito en el roadmap).
2. **Motor de eventos salientes** (ya en P1 del roadmap) — trigger mínimo: `Opportunity.status → WON`.
3. **Tabla `BranchIntegration`** + endpoint/UI de administración (depende de 1).
4. **Mecanismo de API key de servicio saliente** — CRM autenticándose ante Resea (dirección inversa al `ApiKey` de ingesta actual, código nuevo aunque mismo patrón).
5. **Acción "enviar QR"** en el motor de automatizaciones, disparada por el evento de 2 cuando exista `BranchIntegration` activa para la sucursal.

No tiene sentido avanzar 3-5 hasta que Resea confirme qué endpoint expone y con qué forma (ver §5) — coordinar antes de escribir el código del lado Resea de esta integración.
