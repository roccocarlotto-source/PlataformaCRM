# Ordenamiento: un núcleo y dos productos

> Documento de diseño. Estado: **plan aprobado, sin código**. Fecha: 2026-11-21.
> Las referencias `archivo:línea` son al código de `master` en el merge de #631
> (`c9d4b427`). Sirven para ubicar las cosas: las líneas se corren con cada PR.
> Rocco cerró D1, D2, D3, D5 y D7 el 2026-11-21 (§6). D4 y D6 siguen abiertas.
> **Alcance actual: P0 a P3.** Después se frena el ordenamiento para trabajar en
> la primera clínica, y P4–P10 se retoman más adelante.

## 0. Qué se busca

Hoy el repo es "un CRM de automotoras con un anexo de clínicas". Se busca que
sea **una plataforma con un núcleo compartido y dos productos encima**:
automotoras y clínicas.

- Un solo repo, una base y un deploy (rubros B1). No se duplica código.
- **No cambia ningún comportamiento.** No cambian las rutas de la API, ni los
  nombres de las tablas, ni las migraciones. Ningún texto que ve un usuario
  cambia, salvo en el PR de marca (§5.4), que es aparte y lo decide Rocco.
- La regla firme de `docs/rubros.md` §0.3 sigue valiendo: cada PR que toca el
  núcleo demuestra que la automotora no cambia.

### 0.1 El diagnóstico en tres números

| Medida | Valor |
|---|---|
| Archivos del núcleo (sin tests) que importan de `src/clinicas/` | **39** |
| Archivos de autos que viven en el núcleo y se pueden mover enteros | **~33 del backend + 60 del frontend** (más sus tests) |
| Archivos que hoy tiene `src/automotora/` | 2 + `demo/` |

Lo de clínicas se separó bien en carpeta, pero **la dependencia apunta al
revés**: el núcleo llama a `clinicas/` desde el loop del agente, la agenda,
WhatsApp, usuarios y organizaciones. Lo de autos nunca se separó: el stock,
las cotizaciones, los pagos y las entregas viven en `src/services`,
`src/controllers` y `frontend/src/features` como si fueran núcleo. Además,
`src/automotora/` depende de `src/clinicas/`, porque las tools de turnos que
usan los dos rubros quedaron en la carpeta de clínicas.

### 0.2 La regla que define "núcleo limpio"

> **El núcleo no importa de las carpetas de producto.** Solo lo hacen los
> puntos de registro: un archivo por mecanismo que junta lo que aporta cada
> producto (rutas, workers, tools, módulos del gate, textos del agente,
> automatizaciones).

Un **punto de registro** (o punto de extensión) es un lugar del núcleo que no
sabe nada de autos ni de clínicas: recibe una lista de lo que cada producto
aporta y la usa. `reglasDelRubro.ts` ya funciona así para las tools de turnos y
`vocabulario.ts` para el vocabulario. El plan generaliza ese patrón; no inventa
uno nuevo.

---

## 1. Inventario: lo de clínicas que vive fuera de su carpeta

Las carpetas de clínicas son `src/clinicas/` y `frontend/src/features/clinica/`.
Las categorías son:

- **(a)** se mueve a la carpeta de clínicas tal cual, cambiando solo imports;
- **(b)** se queda en el núcleo porque es un punto de extensión compartido
  (gate, vocabulario por rubro, roles, loop del agente, registro o montaje);
- **(c)** es una mezcla: conviene partirla en una parte de núcleo y una de
  clínicas, casi siempre con un punto de extensión nuevo.

Dos datos antes de la lista. Fuera de `src/clinicas` ningún código de producción
usa directamente los modelos `ClinicSettings`, `ClinicBranchSettings` ni
`ClinicHealthSettingsChange`: todo pasa por
`src/clinicas/repositories/clinicSettings.repository`. Y `src/app.ts` no tiene
nada de clínicas.

### 1.1 Gate, configuración y montaje (backend)

| Dónde | Qué es | Cat. |
|---|---|---|
| `src/config/ediciones.ts:72-76, 108-111` | Módulos de clínica (`agenda_clinica`, `recordatorios_de_turno`, `post_turno`) y `SOLO_CLINICA` | b |
| `src/config/ediciones.ts:131, 146-147` | `FUERA_DE_CLINICA`, `MODULOS_POR_RUBRO` | b |
| `src/config/ediciones.ts:245-252` | Llave `CLINICA_HABILITADA`, `rubrosDisponibles` | b |
| `src/config/ediciones.ts:261-263` | `ROLES_POR_RUBRO` (CLINICA: ADMIN, RECEPCION) | b |
| `src/config/ediciones.ts:296-301, 334-354` | `MODULOS_SIN_RUTAS`; rutas de platform admin de Clínica Demo y WABA | b |
| `src/config/ediciones.ts:593-626` | `RUTAS_POR_MODULO` de `agenda_clinica` y `post_turno` (rutas `/api/clinica/...`) | c: la lista puede vivir en `src/clinicas/config` y sumarse al mapa del núcleo |
| `src/config/ediciones.ts:785-796, 810` | `MODULO_DE_LA_TOOL_DE_CLINICA`, `TOOLS_FUERA_DEL_RUBRO`, chequeo de rubro en `toolDelRubro` | c: el mapa es dato de clínicas; `toolDelRubro` queda en el núcleo |
| `src/config/vocabulario.ts:2, 38-39` | Importa `vocabularioDeClinica` y elige por rubro | b (ya delega) |
| `src/middlewares/moduloDeLaEdicion.ts:72-77` | 403 `RUBRO` para módulos `SOLO_CLINICA` | b |
| `src/routes/index.ts:2, 114` | Monta `agendaClinicaRouter` | b |
| `src/routes/organizationAdmin.routes.ts:51-55` | Monta el alta de Clínica Demo | b |
| `src/routes/agentAdmin.routes.ts:77-100` | Rutas de WABA propio de la clínica | c: router de clínicas montado en `index.ts` |
| `src/server.ts:22-24, 96, 177, 182` | Arranca eventos de turno, cierre automático y recordatorios | b (podría ser un solo `iniciarClinicas()`) |

### 1.2 Agente y tools

| Dónde | Qué es | Cat. |
|---|---|---|
| `src/services/reglasDelRubro.ts:3-4, 48, 170` | Registro de reglas por rubro; campo `saludDeLaClinica` con nombre de clínica | b (el campo podría llamarse genérico) |
| `src/services/agentOrchestration.service.ts:1258, 1449-1452` | `ENCABEZADO_INDICACIONES`: bloque de prompt de clínica escrito en el loop | c |
| `src/services/agentOrchestration.service.ts:1778-1799, 1856-1864` | `respaldoDeClinica`: a quién va la derivación | c |
| `src/services/agentOrchestration.service.ts:2106-2178` | La tarea de derivación va a la recepcionista de la sede | c |
| `src/services/agentOrchestration.service.ts:466, 3615` | Aviso de privacidad antes de la respuesta | c |
| `src/services/agent.service.ts:183` | No se activa un agente sin aviso de privacidad | c |
| `src/services/agent.service.ts:419-456` | Validar el número contra el WABA de la clínica (textos dicen "clínica") | c |
| `src/services/helpAssistantPrompt.ts:137-183, 334` | Regla de clínica y nombre de rol en el asistente de ayuda | c (chica) |
| `src/services/helpAssistant.service.ts:241-257`, `helpAssistantBusqueda.ts:128`, `controllers/helpAssistant.controller.ts:91-92` | Rubro en el asistente de ayuda (sinónimos, enums) | b |

### 1.3 Automatizaciones, WhatsApp y workers

| Dónde | Qué es | Cat. |
|---|---|---|
| `src/services/automationRegistrations.ts:11-12, 51-54` | Registra acciones de clínica | b |
| `src/services/automationTriggers.ts:4, 60-65, 210-211` | Triggers de turno; reexporta `TRIGGER_BOOKING_REMINDER_DUE` | b |
| `src/services/automationActions/inquiryFollowUp.ts:36-40, 97-99, 251-253, 336-390` | Seguimiento de consultas: esquema y reglas de clínica en la acción común | c |
| `src/workers/inquiryFollowUpWorker.ts:51, 107-109, 152-153, 238-243, 284-286` | Mismo seguimiento, del lado del worker | c |
| `src/workers/inquiryStalledWorker.ts:116-124` | Filtro distinto si es CLINICA | c |
| `src/repositories/inquiryFollowUp.repository.ts:9, 64` | `sinTurnoQueFrene` de clínicas | c |
| `src/services/automationActions/createFollowUpActivity.ts:17, 89, 117-119` | Rama `booking.completed` (tarea post-turno) | c |
| `src/services/automation.service.ts:19-20, 106` | Al desactivar una regla, cancela recordatorios pendientes | c |
| `src/services/automationWhatsapp.service.ts:77-91, 179-251` | "La clínica tiene que conectar su número" | c |
| `src/services/whatsappTemplate.service.ts:42-64, 239-318` | Botones y variables del recordatorio de turno | c |
| `src/utils/whatsappTemplateText.ts:60-64, 86, 124` | Variables de plantilla de clínica, `EJEMPLO_LUGAR` | c |
| `src/services/whatsappWebhook.service.ts:20-21, 224, 497-549` | Respuesta por botón al recordatorio | c |
| `src/workers/agentInboundWorker.ts:59-60, 499-510, 641-645` | Corta antes del modelo si es respuesta al recordatorio; avisos de privacidad pendientes | c |
| `src/services/whatsappBusinessConnection.service.ts` (archivo entero) | Conectar y desconectar el WABA propio de una clínica | a (si el WABA propio sigue siendo solo de clínicas, D6) |
| `src/controllers/agentAdmin.controller.ts:139-185` | Handlers del WABA de la clínica | a (junto con el anterior) |
| `src/workers/googleCalendarChannelWorker.ts:144` | Renueva canales de profesionales | c |
| `src/services/contact.service.ts:94` | Limpia recordatorios al borrar un contacto | c |

### 1.4 Agenda, usuarios, sedes y organización

| Dónde | Qué es | Cat. |
|---|---|---|
| `src/services/booking.service.ts:7-13, 130-135, 273-385, 532-565, 609-616` | Sobreturnos, bloqueos, profesional por prestación y eventos de turno dentro del flujo común | c |
| `src/services/availability.service.ts:1-2, 60, 176, 310` | Bloqueos y profesional por prestación en la disponibilidad | c |
| `src/services/resource.service.ts:18-22, 153-172` | Archivar un profesional (reprograma sus turnos) | c |
| `src/services/googleCalendarSync.service.ts:284, 343-362, 424-456` | `aplicarCambioEnClinica` | c |
| `src/services/googleCalendarConnection.service.ts:86-98`, `googleCalendar.service.ts:77-78` | Permiso extra de Google si es CLINICA | c |
| `src/controllers/booking.controller.ts:68, 123` | Google por profesional; `sinCamposDeClinica` | c |
| `src/controllers/{activity,contact,resource,serviceType,knowledgeBaseEntry}.controller.ts` | Filtro `sinCamposDeClinica` en la respuesta | b |
| `src/services/user.service.ts:34-48, 90-123` y `invitation.service.ts:58-103` | `conSedesSiEsClinica`, **duplicada** en los dos | c |
| `src/controllers/user.controller.ts:42-56`, `invitation.controller.ts:35-58` | Sedes del usuario solo en CLINICA | c |
| `src/controllers/me.controller.ts:38-98` | `/me` lee la configuración de la clínica (término del contacto) | c |
| `src/services/conversationReply.service.ts:800-825`, `conversation.service.ts:73-157` | Aviso a recepción | c |
| `src/repositories/user.repository.ts:79` | SQL con `o.industry = 'CLINICA' AND r.name = 'RECEPCION'` | b (anotar: rubro escrito en SQL) |
| `src/types/auth.ts:6-11, 54-57`, `src/services/permisos.ts:61-137` | Rol RECEPCION y sedes en la matriz de permisos | b |
| `src/services/activity.service.ts:66-67`, `repositories/activity.repository.ts:23-91` | Recepción ve las actividades de sus sedes | b |
| `src/services/organizationAdmin.service.ts:4-5, 279-346, 602-614` | Crear la configuración de clínica al dar de alta o cambiar de rubro | c |
| `src/services/branch.service.ts:125-126, 278-290` | Configuración de sede; textos de clínica en errores | c |
| `src/services/organization.service.ts:57-202`, `controllers/organization.controller.ts:42-55` | Término del contacto y aviso de privacidad | c |
| `src/services/reinicioDeDemo.service.ts:19, 78` | Elige el reinicio de demo por rubro | b |
| `src/automotora/demo/config.ts:9` | **La automotora importa una constante de la demo de clínicas** | c: a `src/compartido/` |
| `src/automotora/toolsDeTurnos.ts:8-14` | **La automotora usa `clinicas/toolsDeTurnos` y `clinicas/services/reprogramar`** | c: a `src/compartido/turnos/` |
| `src/services/testOrganizationsPurge.service.ts:131-247` | Patrones de slug de los tests de clínica | b |
| `src/compartido/guia/guia.ts:40-52, 184-216, 344-355`, `anclas.ts:63-68, 104` | Secciones de la guía por rubro | b |

### 1.5 Frontend

| Dónde | Qué es | Cat. |
|---|---|---|
| `frontend/src/app/router.tsx:52, 78-81, 268-269, 414-415, 483` | Rutas `/clinica/...` | b (podría ser un arreglo exportado por `features/clinica`) |
| `frontend/src/layout/MenuDeClinica.tsx` (archivo entero) | Menú lateral de clínicas | a |
| `frontend/src/layout/AppLayout.tsx:143-144, 171-172` | Elige el menú por rubro | b |
| `frontend/src/auth/vocabulario.ts:52-72`, `AuthContext.tsx:20-70`, `permisos.ts:29, 50` | Vocabulario, rol y sedes | b |
| `features/booking/BookingCalendarPage.tsx:27-48, 139-475` | Seis imports de `../clinica`, props solo de CLINICA | c |
| `features/booking/BookingListPage.tsx`, `BookingDetailDialog.tsx:29-33`, `format.ts:20-26` | Rótulos y ranura de acciones | b |
| `features/branch/BranchFormPage.tsx:15-16, 102` | Secciones de clínica en el formulario de sede | c |
| `features/invitation/InvitationFormPage.tsx:15, 47`, `features/user/UserListPage.tsx:23-227` | Sedes del usuario | c |
| `features/conversation/ConversationListPage.tsx:20, 60, 153` | `sedes.ts` es un helper compartido que vive en `clinica/` | b |
| `features/organization/MensajesDeSaludSection.tsx` + `TerminosField.tsx` (archivos enteros) | Mensajes de salud | a (con sus partes de `api.ts`, `queries.ts`, `mutations.ts`, `types.ts`) |
| `features/organization/OrganizationSettingsPage.tsx:53-102, 279-334` | Término, aviso de privacidad y mensajes de salud | c |
| `features/platformAdmin/WabaDeLaClinicaPage.tsx` (archivo entero) | Pantalla del WABA propio | a (D6) |
| `features/platformAdmin/clinicaDemo.ts:13-25`, `NewOrganizationPage.tsx:104-132` | `esClinicaDemo` junto a `esDemo` (genérico) | c |
| `features/automation/catalog.ts:59-63, 99, 184-222, 562-575, 719-743, 880-900` | Triggers, acciones, textos y validaciones de clínica dentro del catálogo | c (la mezcla más grande del frontend) |
| `features/automation/whatsappPreview.ts:16-34`, `MensajeDeWhatsappCard.tsx:159` | Variables y botones del recordatorio | c |
| `features/agent/tools.ts:115, 173-181, 225-293`, `features/internalAgent/tools.ts:39-64` | Opciones de tools de clínica (espejo a mano del backend) | c |
| `features/{agent,contact,contactCustomField,serviceType,activity,knowledgeBase,resource,dashboard,guia}/…` | Variantes de texto y campos por rubro | b |

### 1.6 Tests

- **Solo de clínica, fuera de su carpeta (a):**
  `src/services/whatsappWabaPorClinica.integration-test.ts`,
  `features/organization/MensajesDeSaludSection.test.tsx`,
  `features/platformAdmin/WabaDeLaClinicaPage.test.tsx`,
  `features/platformAdmin/clinicaDemo.test.ts`.
- **Mixtos que tocan modelos de clínica:** `routes/gateDeModulos.test-helper.ts:115-117`,
  `repositories/tenant-isolation.integration-test.ts:165-214` y cuatro más. Se
  quedan donde están.
- Unos 60 tests más reciben `CLINICA` como parámetro. Son del núcleo y no se mueven.

**Cuenta:** 137 hallazgos. **(a)** 8, **(b)** ~75, **(c)** ~54. Lo que
pesa son las (c): ahí el núcleo llama a clínicas.

---

## 2. Inventario: lo de automotoras que vive fuera de su carpeta

`src/servicios/` (taller de postventa) es solo de AUTOMOTORA
(`ediciones.ts:142`, `docs/servicios.md` §0.2). En este documento cuenta como
parte del producto automotora (ver D2).

Criterio de alcance: oportunidades, pipelines, empresas y el dashboard
comercial tampoco existen en CLINICA (`ediciones.ts:131-143`), pero son
conceptos de CRM de ventas genéricos. Quedan en el núcleo. De ellos solo cuenta
como automotora lo de vehículo, financiación y permuta.

### 2.1 Backend: módulos que se mueven enteros (a)

| Módulo | Archivos de producción | Tests |
|---|---|---|
| Stock | `controllers/vehicle.controller.ts`, `routes/vehicle.routes.ts`, `services/vehicle.service.ts`, `repositories/vehicle.repository.ts` | 5 |
| Fotos | `controllers/vehiclePhoto.controller.ts`, `services/vehiclePhoto.service.ts`, `repositories/vehiclePhoto.repository.ts`, `utils/vehiclePhoto.ts`, `middlewares/vehiclePhotoUpload.ts` | 5 |
| Stock a base de conocimiento | `services/vehicleKnowledgeBaseSync.service.ts` | 2 |
| Ayudas del agente | `utils/busquedaDeVehiculo.ts`, `utils/vehicleLabels.ts` | 1 |
| Cotizaciones | `controllers/quote.controller.ts`, `routes/quote.routes.ts`, `services/quote.service.ts`, `repositories/quote.repository.ts` | 4 |
| Pagos | `controllers/payment.controller.ts`, `routes/payment.routes.ts`, `services/payment.service.ts`, `repositories/payment.repository.ts`, `repositories/paymentChange.repository.ts` | 3 |
| Entregas | `controllers/delivery.controller.ts`, `routes/delivery.routes.ts`, `services/delivery.service.ts`, `repositories/delivery.repository.ts` | 4 |
| Importación de stock | `services/importacionFotos.service.ts`, `workers/importPhotoWorker.ts`, `repositories/vehiclePhotoImport.repository.ts`, `services/importacionSync.service.ts`, `workers/importSyncWorker.ts`, `repositories/importSync.repository.ts` (la sincronización con Sheets es solo de vehículos, `importacionSync.service.ts:71`) | 1 |
| Tests del núcleo que prueban cosas de autos | — | `opportunityFinancing`, `opportunityVehicle`, `vehicleTradeIn`, `vehiculoDeInteres` (`.integration-test.ts`) |

Total: **~33 archivos de producción y ~29 tests.**

No son de autos, aunque lo parezcan: `services/estadosDeEntregaRetenidos.service.ts`
(estado de entrega de mensajes de WhatsApp), `utils/formatoDeMonto.ts` y el
tipo de cambio (`exchangeRate.*`, `workers/exchangeRateWorker.ts`): los usan
`organization.service.ts:18-20` y la importación. Quedan en el núcleo.

**Quién los importa desde el núcleo** (lo que hace riesgoso moverlos):
`opportunity.service.ts:38-56`, `contact.service.ts:69`, `branch.service.ts:27`,
`knowledgeBaseEntry.controller.ts:12`, `importacion.service.ts:17`,
`importacionPromocion.service.ts:48` y `agentTools.service.ts:29-59`. Ni
`clinicas/` ni `servicios/` los importan. `src/automotora/demo/datosDeEjemplo.ts`
ya los importa: al moverlos, esa dependencia queda dentro del producto.

### 2.2 Backend: archivos del núcleo con partes de autos (b/c)

| Dónde | Qué es | Cat. |
|---|---|---|
| `src/config/ediciones.ts:46-80, 131-143, 464-480, 563-592, 636-643, 698-727, 760-797` | Módulos de autos (stock, cotizaciones, pagos, entregas, financiación, permutas, servicios), sus rutas, campos y tools | b, con la lista movible (igual que §1.1) |
| `src/config/vocabulario.ts:21-30` | `VOCABULARIO_AUTOMOTORA` | b/c: el de clínica ya vive en `clinicas/config/rubro.ts`; el de autos puede ir a `src/automotora/config/` |
| `src/services/reglasDelRubro.ts:2, 163-170` | `REGLAS_DE_AUTOMOTORA` | b (ya es registro) |
| `prisma/schema.prisma` (modelos `Vehicle` :4059, `Quote` :4563, `Delivery` :4633, `Payment` :4688 y otros; campos en `Contact` :1239 y `Opportunity` :1409) | Modelo de datos | b: **no se toca** (regla del pedido) |
| `src/services/opportunity.service.ts:250-330, 503-515, 766-853, 918-932` | Reservar la unidad, crear la entrega, bloquear cambios con entrega confirmada | c: el acople más importante del núcleo con autos |
| `src/controllers/opportunity.controller.ts:44-86, 119-125, 184-190` | Esquemas de financiación y `vehicleId` | c |
| `src/repositories/opportunity.repository.ts:163-243, 329, 350` | Tipos y consultas con vehículo | c (`countOpportunitiesHoldingVehicle` y `findSaleOfVehicle` son a) |
| `src/repositories/contact.repository.ts:87-159, 330, 923, 1089` y `services/contact.service.ts:672-698` | Vehículo de interés del contacto | c |
| `src/services/contactMerge.service.ts:81-83, 140-141, 246-248, 422` | Unir contactos: vehículo de interés y tablas de servicios | c |
| `src/services/branch.service.ts:251-287, 416-418` | No se borra una sucursal con stock | c |
| `src/routes/knowledgeBaseEntry.routes.ts:95-99`, `controllers/knowledgeBaseEntry.controller.ts:211-216`, `repositories/knowledgeBaseEntry.repository.ts:127-213` | `sync-vehicles` | c: va con el módulo de stock (la URL no cambia) |
| `utils/importacionMapeo.ts:126, 1190`, `schemas/importacion.schema.ts`, `services/importacionPromocion.service.ts:496-557`, `importacionResolutor.ts:469-598`, `importacionAnalisis`, `importacionDeshacer` | El motor de importación conoce `VEHICLE` | c |
| `src/services/helpAssistantPrompt.ts:106-115`, `compartido/guia/guia.ts:184-301`, `anclas.ts:39-47` | Guía y asistente de ayuda por rubro | b/c |
| `src/utils/whatsappTemplateText.ts:59, 84, 120-172` | Variable `{vehiculo}` y su ejemplo | c |
| `src/routes/index.ts:15-48, 63-71, 278` y `src/server.ts:20-28` | Montaje de rutas y arranque de workers de autos | b |
| `src/services/organizationAdmin.service.ts:293-339`, `reinicioDeDemo.service.ts:22` | Taller Demo | b |

### 2.3 Agente

| Dónde | Qué es | Cat. |
|---|---|---|
| `src/services/agentTools.service.ts` (3179 líneas, ~180 menciones de vehículos) | `resolverVehiculo` :449-617, `reserveVehicleTool` :1311-1418, `anotarVehiculoDeInteres` :2019-2061, `getPaymentInfoTool` :2280-2300, `searchVehiclesTool` :2577-2905 | a: se pueden mover a `src/automotora/tools/` |
| `agentTools.service.ts:736-1066, 1170, 1943` | `create_opportunity` / `update_opportunity` con argumento de vehículo | c |
| `agentTools.service.ts:3074` | `CATALOGO_DE_TOOLS` | b: pasaría a ser núcleo + tools del rubro (el mecanismo ya existe para las de turnos) |
| `src/services/agentOrchestration.service.ts:521-664` | Textos del prompt de autos (permuta, financiación, prueba de manejo, `textosDeAutomotora` :598, `MENSAJE_DE_FUGA` :659) | c: `TextosDelPrompt` (:573) ya es el punto de extensión; los de clínica viven en `clinicas/config/textosDelAgente.ts` |
| `agentOrchestration.service.ts:1270-1293` | Filtro del stock en la base de conocimiento | c |
| `src/utils/iniciativaDelCliente.ts:19-26` | Iniciativas (prueba de manejo, financiación, permuta) | c |
| `src/services/agentNivelDeIa.ts:136-173`, `src/voz/esperaDeVoz.ts:52`, `services/inquiryFollowUpDraft.service.ts:38-109` | Menciones de stock en primer contacto, voz y borradores | c (chicas) |

### 2.4 Automatizaciones y workers

| Dónde | Qué es | Cat. |
|---|---|---|
| `src/services/automationActions/inquiryFollowUp.ts:72, 129-153, 292` | Plantilla por defecto con `{vehiculo}` y test drive | c (la misma acción mezcla los dos rubros) |
| `src/workers/inquiryFollowUpWorker.ts:24, 43, 317` | `TOKEN_VEHICULO` | c |
| `src/services/automationTriggers.ts:8-16, 68-93, 194-278`, `automationRegistrations.ts:13, 56` | Triggers y acción de servicios | b (importan la configuración de `servicios/` directo) |
| `src/services/automationActions/createFollowUpActivity.ts:100, 154-166` | Rama de recambio de servicios | c |

### 2.5 Frontend

| Dónde | Qué es | Cat. |
|---|---|---|
| `frontend/src/features/{vehicle,quote,payment,delivery}/` | 60 archivos (17 tests) | a: a `features/automotora/…`; vuelven al núcleo vía `opportunity/boardMove` y `opportunity/types` |
| `frontend/src/layout/MenuDeAutomotora.tsx` | Menú de autos (308 líneas) | a |
| `frontend/src/test/{vehicle,quote,delivery}Fixtures.ts` | Fixtures (los usan 12 tests, incluidos dos de oportunidades) | a |
| `frontend/src/app/router.tsx:40-48, 221-222, 455-458` | Rutas de stock y servicios (imports no perezosos) | b |
| `features/opportunity/OpportunityFormPage.tsx:26-33, 71-269, 443-468, 780-966` | Unidad, financiación y las secciones de cotización, entrega, permuta y pagos | c: la mezcla más grande del frontend |
| `features/opportunity/{OpportunityListPage.tsx,labels.ts,types.ts}` | Columnas y rótulos de unidad y financiación | c |
| `features/contact/{ContactFormPage,ContactListPage,ConsultasSinIdentificarTab}.tsx`, `types.ts`, `labels.ts` | Vehículo de interés | c |
| `features/dashboard/DashboardPage.tsx:9, 60-94` | Tarjetas de stock y del taller | c |
| `features/knowledgeBase/KnowledgeBaseListPage.tsx:113-180` | Botón de sincronizar stock | c |
| `features/importacion/` (`PasoMapeo.tsx` y otros) | Importar vehículos | c |
| `features/agent/tools.ts:47, 79, 89, 199, 228-230`, `features/automation/catalog.ts:118, 558, 582`, `whatsappPreview.ts:15-61` | Tools, test drive y `{vehiculo}` | c |
| `layout/AppLayout.tsx:144-150` | Elige el menú por rubro | b |
| `design-system/design-system.css:749, 4052` | Estilos de cotización, entrega y permuta | a (opcional) |

### 2.6 Scripts y tests

- `scripts/cargar-kb-automax-demo.ts`: se puede mover a `scripts/automotora/` (a).
- `scripts/seed-dev-data.ts`, `sonda-matriz-crm.ts` (importa `CATALOGO_DE_TOOLS`),
  `sonda-de-prompt.ts`, `eval-agente-real.ts`: mezclados. Se rompen si cambian
  los exports del agente. El typecheck de scripts (`tsconfig.scripts.json`) los
  cubre.
- **`src/services/vehicle.test-helper.ts` es en la práctica un helper genérico**
  (`montar`/`desmontar`/`capturar`, :43-93) que importan **23 archivos**. Solo
  :102-131 es de vehículos. Hay que partirlo antes de mover el stock.
- **`src/services/testOrganizationsPurge.service.ts` guarda rutas de tests como
  texto** (:83-86 bases, :100, :137, :147, :157, :340, :346), y
  `testOrganizationsPurge.service.test.ts` falla si una ruta no existe. Eso es
  bueno: mover un integration-test sin actualizar el catálogo rompe el
  unitario, no la limpieza.

**Cuenta:** backend ~33 de producción movibles y ~22 archivos mixtos. Frontend:
60 movibles más el menú y los fixtures, y ~20 mixtos. Puntos de extensión: ~10.

---

## 3. Nombres: "Plataforma CRM" y el renombre a `plataforma-xentech`

### 3.1 Dónde aparece el nombre

| Tipo | Dónde | ¿Se renombra? |
|---|---|---|
| **Marca visible** | `src/config/terminos.ts:51` (`MARCA`, la fuente que viaja en `/me`), `frontend/src/auth/vocabulario.ts:22` (respaldo), `frontend/src/design-system/tituloDeLaPestana.ts:13`, `frontend/index.html:11` | Sí, en un PR aparte (§5.4). Cambia lo que ve el usuario: lo decide Rocco. Tests y snapshots que lo fijan: `vocabulario.test.ts:64`, `PageHeader.test.tsx:57-62`, `test/rubroFixtures.ts:24-35`, `menuPorRubro.test.tsx` (7 pares), `textosDelRubro.test.tsx.snap:724, 769`, `automotoraSinCambios.test.ts:490` |
| **Identificadores criptográficos** | El texto `plataforma-crm:…` con que se derivan las claves en `src/utils/encryption.ts:129`, `oauthState.ts:80`, `metaOauthState.ts:46`, `webhookToken.ts:56`, `helpAssistantFirma.ts:24`; el emisor `plataforma-crm` de los tokens en `oauthState.ts:77`, `metaOauthState.ts:43`, `webhookToken.ts:50` | **No.** Cambiarlos deja ilegibles los secretos ya guardados en la base y rompe los canales vivos de Google Calendar. Son identificadores internos, no marca |
| **Claves de navegador y del widget** | `frontend/src/theme/theme.ts:23` y `index.html:31` (tema), `frontend/src/widget/session.ts:12`, `widget/main.ts:46` (global), `widget/ui.ts:17` (id del DOM), `widget/config.ts:29`, `vite.widget.config.ts:37` | **No.** Cambiarlas borra el tema guardado y la sesión del widget, y el widget vive en las webs de los clientes |
| User-Agent | `src/lib/fetchPublico.ts:207` | Opcional (lo ven servidores de terceros; no afecta nada) |
| Paquetes | `package.json:2`, `frontend/package.json:2` | Opcional (privados, sin efecto externo) |
| Infra | `supabase/config.toml:5` (`project_id` local), `.github/workflows/ci.yml:488, 500` (tag local de Docker) | Opcional. Cambiar el `project_id` arranca un stack local nuevo y deja los volúmenes viejos |
| **CI** | `.github/workflows/keep-alive.yml:37`: `if: github.repository == 'roccocarlotto-source/PlataformaCRM'` | **Obligatorio** antes de renombrar el repo: si no, el job se saltea en silencio y el backend se duerme |
| URLs | `plataformacrm.onrender.com` (~15 lugares en docs, scripts y fixtures de tests), `plataforma-crm-chi.vercel.app` (`docs/deployment.md:500-504`), links a PRs de GitHub (`docs/bitacora-2026-08-30.md:20`, `bitacora-2026-08-31.md:23`) | No hace falta: el renombre del repo no cambia esas URLs |
| Docs | `README.md:1`, `CLAUDE.md:49, 167, 218`, `docs/project-overview.md:1, 122`, `authentication-architecture.md:1`, `roadmap-implementacion.md:1`, `data-classification.md:3`, `rubros.md:69, 436`, `qr-integration.md` (~10), `frontend-cambios-pendientes.md` (~4), `guia-de-uso/01-primeros-pasos.md:3, 177-178`, `guia-de-uso/clinicas/01-primeros-pasos.md:3, 149` | Sí, junto con la marca. "Plataforma" en `guia-de-uso/14-plataforma.md` es el grupo del menú del platform admin, no el producto: no se toca |

"CRM" como concepto (el grupo "CRM" del menú, "registrado en el CRM" en el
prompt del agente) aparece más de 400 veces y no es la marca. No se toca: el
prompt de la automotora está fijado byte a byte por
`src/clinicas/__snapshots__/prompt-automotora.txt`.

Dato desactualizado: `docs/rubros.md:69` dice que la marca está escrita en
`AppLayout.tsx:269` y `:567`. Ya no: desde R17 sale de `marcaDe(me)`.

### 3.2 Qué implica renombrar el repo a `plataforma-xentech`

| Pieza | Qué pasa | Qué hacer |
|---|---|---|
| GitHub (git y web) | Las URLs viejas redirigen (comportamiento general de GitHub) mientras nadie cree un repo con el nombre viejo | `git remote set-url` en cada clon y worktree |
| `keep-alive.yml:37` | Deja de correr | PR previo: que la condición acepte el dueño (`github.repository_owner`) o los dos nombres |
| Render | Sigue el repo por la app de GitHub; el subdominio sale del nombre del servicio, no del repo | Confirmar que el auto-deploy sigue andando después del renombre |
| Vercel | Sigue el repo por id. El dominio sale del nombre del proyecto | **No renombrar el proyecto de Vercel**: la lista de redirecciones de Supabase depende del patrón `plataforma-crm-*.vercel.app` |
| Ruleset "Proteger master" | Va atado al repo y sobrevive al renombre | Verificar |
| Imágenes de PRs viejos | Viven en la rama `pr-assets` por `raw.githubusercontent.com`. La redirección de raw es menos segura | No renombrar esa rama. Revisar 2 o 3 PRs viejos después del renombre |
| Supabase, Meta, Google | Apuntan a la API, no a GitHub | Nada |
| Carpeta local `proyectos/plataforma-crm` | Renombrarla rompe los worktrees y cambia la carpeta de memoria de Claude Code | No hace falta renombrarla. Si se hace: `git worktree repair` y mover la carpeta de memoria |
| Registro de Xentech | `../../PROYECTOS.md:9` tiene el nombre, la ruta y el repo; la skill `plataforma-crm-implement-change` lleva el nombre | Actualizar a mano (fuera de este repo) |

---

## 4. Estructura final propuesta

**No se mueve el núcleo.** El núcleo es todo lo que no está en una carpeta de
producto, y sigue en `src/routes`, `src/services`, etc. Moverlo a `src/nucleo/`
tocaría unos 700 archivos sin ganar nada que no dé la regla de §0.2 (ver D1).

```
src/
  app.ts, server.ts            ← sin cambios; server.ts llama a iniciar() de cada producto
  config/ediciones.ts          ← mecanismo del gate; junta los catálogos de cada producto
  config/vocabulario.ts        ← elige por rubro; los textos viven en cada producto
  services/reglasDelRubro.ts   ← el contrato del rubro (hooks), sin textos propios
  routes/ controllers/ services/ repositories/ workers/ …   ← núcleo
  compartido/
    guia/                      ← ya existe
    turnos/                    ← toolsDeTurnos y reprogramar (hoy en clinicas/, los usan los dos)
    demo/                      ← constantes comunes de las demos
  automotora/
    index.ts                   ← lo único que importa el núcleo: rutas, workers, reglas, catálogos
    config/                    ← módulos y rutas del gate, vocabulario, textos del agente
    stock/                     ← vehicle*, fotos, sync a la base, búsqueda, rótulos
    cotizaciones/ pagos/ entregas/
    importacion/               ← fotos y sincronización de stock
    tools/                     ← search_vehicles, reserve_vehicle, get_payment_info
    servicios/                 ← hoy src/servicios (D2)
    demo/                      ← ya existe
  clinicas/
    index.ts                   ← idem
    …                          ← como hoy, más lo que vuelve de §1

frontend/src/
  app/router.tsx               ← junta las rutas que exporta cada producto
  layout/AppLayout.tsx         ← elige el menú por rubro
  features/<módulo>/           ← núcleo
  features/automotora/
    vehicle/ quote/ payment/ delivery/ servicios/   ← hoy features/vehicle, …
    MenuDeAutomotora.tsx, rutas.tsx
  features/clinica/
    MenuDeClinica.tsx, rutas.tsx, …
  test/                        ← fixtures del núcleo; los de autos van a features/automotora/test/
```

Dentro de cada producto, cada módulo puede seguir por capas
(`stock/vehicle.controller.ts`, `stock/vehicle.service.ts`…) o con
subcarpetas `routes/controllers/services/repositories` como `src/clinicas/`
hoy. Lo práctico: el mismo molde que ya usa `src/clinicas/` (D3).

**Contrato del rubro.** `ReglasDelRubro` (`src/services/reglasDelRubro.ts`) se
amplía con los hooks que hoy faltan. Cada hook es opcional y, si un producto no
lo define, el núcleo hace lo de hoy. La lista sale de las (c) de §1 y §2:

- prompt y agente: `textos`, `toolsExclusivas` (ya existen), `bloqueExtraDelPrompt`,
  `responsableDeRespaldo`, `mensajesAntesDeResponder`, `precondicionDeActivacion`,
  `interceptarAntesDelModelo`;
- oportunidad: `alCrearOportunidad`, `alActualizarOportunidad`, `alBorrarOportunidad`
  (reserva de unidad y entrega);
- datos: `bloqueosParaBorrarSucursal`, `alBorrarContacto`, `alCrearOrganizacion`,
  `datosDeMe`;
- agenda: `reglasDeAgenda` (sobreturnos, bloqueos, profesional por prestación);
- WhatsApp y automatizaciones: plantillas y variables por acción,
  `respuestaPorBoton`, `alDesactivarRegla`;
- importación: entidades importables registradas (CONTACT, COMPANY y ACTIVITY
  en el núcleo; VEHICLE en automotora).

Esto es una decisión de arquitectura (D5). No todos los hooks valen la pena:
algunos sacan un `if` de dos líneas y agregan una indirección. §5 los ordena y
marca cuáles son opcionales.

---

## 5. Plan de PRs

Orden de menor a mayor riesgo. Cada PR es un solo tema, no cambia rutas, tablas
ni migraciones, y no cambia ningún texto visible (salvo §5.4).

### 5.0 Cómo se demuestra "no cambia nada" (para todos)

1. **Lo que ya corre el CI:** typecheck (los tres tsconfig, incluidos scripts),
   lint, `npm test`, `npm run test:integration` (serie), y en el frontend
   typecheck, lint, vitest y build. En la PC: vitest con `--maxWorkers=2`,
   node:test con `--test-concurrency=2`, y un comando pesado a la vez.
2. **Suites de no-cambio que ya existen:** "automotora sin cambios"
   (`src/clinicas/automotoraSinCambios.*`, con el prompt de la automotora byte a
   byte) y "sin el módulo sin cambios" (`src/servicios/sinElModuloSinCambios.*`).
3. **Para los PR que solo mueven:** `git diff -M --stat master` muestra cada
   archivo como renombre (`R` con similitud ≥ 95 %), y lo único que cambia
   adentro son las líneas de `import`. Se adjunta en el cuerpo del PR.
4. **Caracterizaciones nuevas (PR 1):** fotos fijas de lo que el ordenamiento
   no puede cambiar, comparadas contra valores escritos en el test (no contra
   el código que se mueve):
   - la lista de rutas montadas (`MÉTODO /api/...`) en orden;
   - el catálogo de tools del agente por rubro y edición, en orden;
   - los mapas del gate (`RUTAS_POR_MODULO`, `CAMPOS_POR_RUTA`,
     `MODULO_DE_LA_TOOL`, `MODULOS_POR_RUBRO`) completos;
   - en el frontend, las rutas del router por rubro y edición.

### 5.1 Preparación (riesgo muy bajo)

| PR | Qué hace | Cómo se demuestra | Riesgo |
|---|---|---|---|
| **P0** | Este documento. Corrige `rubros.md:69` y suma el link en el índice del `README.md` | Solo docs | Nulo |
| **P1** | Caracterizaciones de §5.0.4. Solo agrega tests | Pasan sobre `master` sin tocar código | Muy bajo |
| **P2** | Regla de ESLint `no-restricted-imports`: el núcleo no importa de `automotora/`, `clinicas/` ni `servicios/`. Las violaciones de hoy van a una lista de excepciones, que solo puede achicarse. Mismo criterio en el frontend para `features/automotora` y `features/clinica` | `npm run lint` verde; el diff no toca código de producción | Muy bajo. Frena que entren dependencias nuevas mientras dura el plan |
| **P3** | Partir `vehicle.test-helper.ts`: lo genérico a `src/test-helpers/` (o similar), lo de vehículos queda. Actualiza los 23 imports y `testOrganizationsPurge.service.ts:340` | Unit + integración verdes; solo cambian imports de tests | Bajo |

### 5.2 Mover sin cambiar lógica (riesgo bajo)

Cada uno: solo `git mv` e imports. Si mueve integration-tests, actualiza
`PATRONES_DE_SLUG_DE_PRUEBA`; su unitario lo exige.

| PR | Qué mueve | Riesgo |
|---|---|---|
| **P4** | `clinicas/toolsDeTurnos.ts` y `clinicas/services/reprogramar.service.ts` a `src/compartido/turnos/`; `MODELO_DEL_AGENTE_DE_LA_DEMO` a `src/compartido/demo/`. Corta la dependencia automotora → clínicas | Bajo. El snapshot del prompt de la automotora lo cubre |
| **P5** | Frontend de clínicas: `MenuDeClinica.tsx`, `MensajesDeSaludSection.tsx`, `TerminosField.tsx` (con sus partes de `api/queries/mutations/types`), `clinicaDemo.test.ts`; `WabaDeLaClinicaPage.tsx` si D6 dice "solo clínicas" | Bajo |
| **P6** | Backend de clínicas: `whatsappBusinessConnection.service.ts`, los handlers de WABA de `agentAdmin.controller.ts` y su integration-test (D6). La ruta se sigue montando en el mismo lugar | Bajo |
| **P7** | Backend de autos: stock, fotos, sync a la base, búsqueda, rótulos, cotizaciones, pagos y entregas a `src/automotora/` (§2.1). `routes/index.ts` los sigue montando en el mismo orden. Requiere P3 | Bajo-medio por tamaño (~33 archivos + tests). La foto de rutas de P1 lo cubre |
| **P8** | Importación de stock (fotos y Sheets) a `src/automotora/importacion/`. Los workers se siguen arrancando desde `server.ts` | Bajo |
| **P9** | Frontend de autos: `features/{vehicle,quote,payment,delivery}`, `MenuDeAutomotora.tsx` y los tres fixtures a `features/automotora/`. Se mueven los `__snapshots__` junto con su test | Bajo-medio por tamaño (60+ archivos). La foto del router de P1 lo cubre |
| **P10** | `src/servicios/` a `src/automotora/servicios/` y `features/servicios/` a `features/automotora/servicios/` (D2) | Medio-bajo: toca los patrones de slug y la doc de servicios |

### 5.3 Puntos de registro (riesgo medio a alto)

Acá ya no alcanza con mover: se cambia **cómo** el núcleo llama al producto. El
comportamiento tiene que ser idéntico; lo demuestran las caracterizaciones y
las suites de no-cambio. Cada PR achica la lista de excepciones de P2.

| PR | Qué hace | Cómo se demuestra | Riesgo |
|---|---|---|---|
| **P11** | Textos del agente de autos (`textosDeAutomotora` y las constantes de `agentOrchestration.service.ts:521-664`) a `src/automotora/config/textosDelAgente.ts`, igual que los de clínicas. `VOCABULARIO_AUTOMOTORA` a `src/automotora/config/` | Snapshot del prompt byte a byte | Bajo-medio |
| **P12** | Catálogos del gate por producto: cada uno exporta sus módulos, rutas, campos y tools; `ediciones.ts` solo los junta | Foto de los mapas del gate (P1) + `ediciones.test.ts` + gate | Medio |
| **P13** | `src/automotora/index.ts` y `src/clinicas/index.ts`: routers y workers de cada producto. `routes/index.ts` y `server.ts` llaman a uno por producto | Foto de rutas (P1) + el job del CI que arranca la imagen (#619) | Medio: el orden de montaje importa |
| **P14** | Tools de autos a `src/automotora/tools/`, registradas como `toolsExclusivas`. `CATALOGO_DE_TOOLS` = núcleo + rubro, en el mismo orden | Foto del catálogo de tools (P1) + snapshot del prompt + `sonda-matriz-crm` en typecheck | Medio |
| **P15** | Sedes de usuario: `conSedesSiEsClinica` (duplicada) a `clinicas/services/sedesDeUsuarios`, y `datosDeMe` como hook | Integración de usuarios, invitaciones y `rolRecepcion` + `/me` de la automotora en "automotora sin cambios" | Medio |
| **P16** | Contacto, sucursal y base de conocimiento: vehículo de interés, bloqueo al borrar sucursal con stock, `sync-vehicles` | Tests de contacto, unión y sucursal + `vehiculoDeInteres` | Medio |
| **P17** | Frontend con ranuras por rubro: secciones de `OpportunityFormPage`, `BookingCalendarPage`, `BranchFormPage`, `OrganizationSettingsPage`, y el catálogo de automatizaciones partido por producto | vitest + snapshots de textos por rubro + foto del router | Medio-alto (pantallas grandes) |
| **P18** | Hooks de clínica en el agente: indicaciones, respaldo de derivación, aviso de privacidad, precondición de activación | Snapshot del prompt + integración del agente de clínica + "automotora sin cambios" | Alto: es el loop del agente |
| **P19** | Recordatorios por WhatsApp: plantillas y variables por acción, respuesta por botón, corte antes del modelo | Integración de recordatorios, webhook y worker de entrada | Alto |
| **P20** | Agenda: sobreturnos, bloqueos y profesional por prestación detrás de `reglasDeAgenda` | Toda la integración de `src/clinicas` de agenda + booking del núcleo | Alto |
| **P21** | Seguimiento de consultas: partir `inquiryFollowUp` y su worker por rubro | Integración de seguimiento de los dos rubros | Alto |
| **P22** | Ciclo de vida de la oportunidad: reservar la unidad y crear la entrega pasan a hooks de automotora | `opportunityVehicle`, `opportunityFinancing`, `vehicleTradeIn`, entregas y cierre | **El más alto**: es el flujo de venta de los clientes que pagan |
| **P23** | Motor de importación con entidades registradas (VEHICLE en automotora) | `importacionAdmin.integration-test.ts` + `importacionMapeo.test.ts` | Alto |

P18 a P23 son **opcionales** (D5). Después de P17 el núcleo ya no tiene
módulos de autos ni dependencias nuevas, y lo que queda son `if` por rubro en
flujos delicados. Cada uno se decide por separado, mirando cuánto se
simplifica contra cuánto riesgo agrega.

### 5.4 Nombres (aparte del ordenamiento)

| PR | Qué hace | Riesgo |
|---|---|---|
| **N1** | `keep-alive.yml:37` acepta el nombre viejo y el nuevo (o el dueño). Se mergea **antes** del renombre | Muy bajo |
| **N2** | Renombre del repo en GitHub (lo hace Rocco desde Settings) y checklist de §3.2 | Bajo, operativo |
| **N3** | Docs: `README.md`, `CLAUDE.md`, títulos de los docs de diseño y links al repo | Muy bajo |
| **N4** | Marca visible: `MARCA` y su respaldo, la pestaña e `index.html`, con sus tests, snapshots y la guía de uso. **Cambia lo que ve el usuario**: requiere el nombre decidido (D4) y no entra en la garantía de "no cambia nada" | Bajo técnicamente, pero es decisión de producto |
| — | Identificadores criptográficos, emisor de tokens, claves de navegador y del widget: **no se renombran** | — |

---

## 6. Decisiones

### 6.1 Lo que decidió Rocco (2026-11-21)

| # | Decisión |
|---|---|
| D1 | **(a)** No se mueve el núcleo a `src/nucleo/`: núcleo = lo que no es producto. |
| D2 | **(a)** `src/servicios/` pasa a `src/automotora/servicios/` (P10). |
| D3 | **(a)** Autos se ordena por módulo (`stock/`, `cotizaciones/`…). Clínicas sigue como está. |
| D4 | **Pendiente.** Rocco elige el nombre del producto antes de N4. |
| D5 | **(c)** P1 a P17 primero; cada uno de P18 a P23 se decide por separado, con su propio análisis. |
| D6 | **Pendiente.** Solo afecta a P5 y P6, que quedan fuera del alcance actual. |
| D7 | **Sí.** La regla de ESLint con lista de excepciones entra en P2. |

**Alcance y orden:** P0 a P3, un PR a la vez. Después se frena el ordenamiento
para trabajar en la primera clínica. P4–P10 se retoman más adelante.

### 6.2 Las opciones que se plantearon

| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| D1 | ¿Mover el núcleo a `src/nucleo/`? | (a) No: núcleo = lo que no es producto. (b) Sí | **(a).** Mover ~700 archivos no agrega separación: la da la regla de imports de P2 |
| D2 | ¿`src/servicios/` pasa a `src/automotora/servicios/`? | (a) Sí, en P10. (b) Queda como módulo aparte | **(a).** Es solo de automotoras por diseño. Si algún día lo usa otro rubro, se sube a `compartido/` |
| D3 | Molde interno de cada producto | (a) Por módulo (`stock/`, `cotizaciones/`…). (b) Por capas, como `src/clinicas/` | **(a) para autos**: son módulos bien separados entre sí. Clínicas sigue como está |
| D4 | Nombre del producto | Neutro de plataforma, o una marca por rubro (rubros §0.3 lo deja preparado por configuración) | Decidirlo antes de N4. N1 a N3 no lo necesitan |
| D5 | ¿Hasta dónde llegan los hooks? | (a) Hasta P17. (b) Todos (P18-P23). (c) Uno por uno | **(c)**: P1 a P17 primero, y después cada uno de P18 a P23 con su propio análisis |
| D6 | ¿El WABA propio es solo de clínicas? | (a) Sí: va a `clinicas/`. (b) Puede servirle a una automotora: queda en el núcleo con un flag por rubro | Depende del producto. Si no hay planes de ofrecérselo a automotoras, (a) |
| D7 | ¿Regla de ESLint con lista de excepciones (P2) desde el principio? | Sí / no | **Sí.** Es lo único que evita que el núcleo vuelva a mezclarse mientras dura el plan |
