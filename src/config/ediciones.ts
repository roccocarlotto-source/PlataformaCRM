import type { OrganizationEdition } from "@prisma/client";

// ---------------------------------------------------------------------------
// Catálogo de módulos por edición (docs/ediciones.md §5). ÚNICA fuente de
// verdad de qué puede usar una organización según su edición:
//
//   - el gate de rutas (middlewares/moduloDeLaEdicion.ts, que corre dentro de
//     `authenticate`) lo lee para responder 403 MODULO_NO_INCLUIDO;
//   - los bloqueos por campo (400 CAMPO_NO_INCLUIDO) salen de CAMPOS_POR_RUTA;
//   - /api/me devuelve `modulos` desde acá, para que el frontend no tenga una
//     tabla propia que se desincronice.
//
// COMPLETA tiene TODOS los módulos: para ella el gate es un no-op total.
//
// Cada ruta montada está clasificada: o en RUTAS_POR_MODULO (rutas con
// `authenticate`) o en RUTAS_PUBLICAS (rutas sin sesión de usuario: health,
// webhooks, ingesta por API key, widget, callbacks de OAuth, enlaces públicos).
// src/config/ediciones.test.ts recorre el router real y falla si aparece una
// ruta sin clasificar, o una clasificada que ya no existe. En runtime, una
// ruta autenticada sin clasificar se PERMITE en COMPLETA y se BLOQUEA en
// ESENCIAL (falla cerrado): ver moduloDeLaEdicion.ts.
//
// Las rutas se escriben como "MÉTODO patrón", con el patrón tal como lo
// registra Express (req.baseUrl + req.route.path): "/api/quotes/:id".
// ---------------------------------------------------------------------------

export const MODULOS = [
  // En las dos ediciones.
  "comun",
  "plataforma",
  "usuarios",
  "contactos",
  "conversaciones",
  "agentes",
  "canales",
  "base_de_conocimiento",
  "sucursales",
  "agenda",
  "stock",
  "tareas",
  "cupones_y_qr",
  "automatizaciones",
  "oportunidades",
  "campos_personalizados",
  "agente_interno",
  "ingesta",
  // Reservado sin rutas todavía: el dashboard de atención es el PR 8 (§6.4).
  "dashboard_atencion",
  // Solo COMPLETA.
  "procesos_de_venta",
  "cotizaciones",
  "pagos",
  "entregas",
  "empresas",
  "dashboard_comercial",
  // Solo COMPLETA y sin rutas propias: son campos de otras rutas (la
  // financiación es un grupo de columnas de la oportunidad; la permuta, una
  // columna del vehículo). Los cubre CAMPOS_POR_RUTA.
  "financiacion",
  "permutas",
] as const;

export type Modulo = (typeof MODULOS)[number];

const SOLO_COMPLETA: ReadonlySet<Modulo> = new Set<Modulo>([
  "procesos_de_venta",
  "cotizaciones",
  "pagos",
  "entregas",
  "empresas",
  "dashboard_comercial",
  "financiacion",
  "permutas",
]);

export const MODULOS_POR_EDICION: Readonly<Record<OrganizationEdition, ReadonlySet<Modulo>>> = {
  COMPLETA: new Set<Modulo>(MODULOS),
  ESENCIAL: new Set<Modulo>(MODULOS.filter((m) => !SOLO_COMPLETA.has(m))),
};

/** Los módulos de una organización. La única función que decide: el gate y
 *  /api/me la usan (docs/rubros.md la extiende con el rubro). */
export function modulosDe(edition: OrganizationEdition): ReadonlySet<Modulo> {
  return MODULOS_POR_EDICION[edition];
}

/** Módulos sin rutas propias: el test de clasificación los tolera.
 *  dashboard_atencion está reservado (su ruta llega con el PR 8 y entonces
 *  sale de esta lista); financiacion y permutas son solo campos. */
export const MODULOS_SIN_RUTAS: ReadonlySet<Modulo> = new Set<Modulo>([
  "dashboard_atencion",
  "financiacion",
  "permutas",
]);

export const RUTAS_POR_MODULO: Readonly<Record<Modulo, readonly string[]>> = {
  comun: ["GET /api/me", "GET /api/organization", "PATCH /api/organization"],
  // Protegidas por requirePlatformAdmin; el gate nunca las bloquea (están en
  // las dos ediciones). La edición de la organización DESTINO de una
  // importación es asunto del PR 9, no del gate.
  plataforma: [
    "GET /api/admin/organizations",
    "POST /api/admin/organizations",
    "GET /api/admin/llm-usage",
    "PUT /api/admin/agents/:agentId/facebook-page",
    "PUT /api/admin/agents/:agentId/model",
    "PUT /api/admin/agents/:agentId/whatsapp-phone-number",
    "PUT /api/admin/organizations/:organizationId/internal-agent/model",
    "GET /api/admin/organizations/:organizationId/integrations/meta",
    "DELETE /api/admin/organizations/:organizationId/integrations/meta",
    "POST /api/admin/organizations/:organizationId/integrations/meta/connect",
    "POST /api/admin/organizations/:organizationId/integrations/meta/complete",
    "GET /api/admin/organizations/:organizationId/imports",
    "POST /api/admin/organizations/:organizationId/imports",
    "GET /api/admin/organizations/:organizationId/imports/options",
    "POST /api/admin/organizations/:organizationId/imports/sheets",
    "GET /api/admin/organizations/:organizationId/imports/syncs",
    "DELETE /api/admin/organizations/:organizationId/imports/syncs/:syncId",
    "POST /api/admin/organizations/:organizationId/imports/syncs/:syncId/pause",
    "POST /api/admin/organizations/:organizationId/imports/syncs/:syncId/resume",
    "GET /api/admin/organizations/:organizationId/imports/:batchId",
    "POST /api/admin/organizations/:organizationId/imports/:batchId/cancel",
    "GET /api/admin/organizations/:organizationId/imports/:batchId/changes.csv",
    "PUT /api/admin/organizations/:organizationId/imports/:batchId/config",
    "POST /api/admin/organizations/:organizationId/imports/:batchId/confirm",
    "GET /api/admin/organizations/:organizationId/imports/:batchId/failed.csv",
    "GET /api/admin/organizations/:organizationId/imports/:batchId/photos.csv",
    "GET /api/admin/organizations/:organizationId/imports/:batchId/rows",
    "PATCH /api/admin/organizations/:organizationId/imports/:batchId/rows",
    "POST /api/admin/organizations/:organizationId/imports/:batchId/undo",
  ],
  usuarios: [
    "GET /api/users",
    "PATCH /api/users/:id",
    "DELETE /api/users/:id",
    "GET /api/invitations",
    "POST /api/invitations",
    "DELETE /api/invitations/:id",
  ],
  contactos: [
    "GET /api/contacts",
    "POST /api/contacts",
    "GET /api/contacts/:id",
    "PATCH /api/contacts/:id",
    "DELETE /api/contacts/:id",
    "POST /api/contacts/:id/descartar",
    "POST /api/contacts/:id/erase-personal-data",
    "GET /api/contacts/:id/merge-preview",
    "POST /api/contacts/:id/merge",
  ],
  conversaciones: [
    "GET /api/conversations",
    "GET /api/conversations/:id",
    "PATCH /api/conversations/:id",
    "POST /api/conversations/:id/close",
    "POST /api/conversations/:id/generate-brief",
    "POST /api/conversations/:id/messages",
    "POST /api/conversations/:id/messages/:messageId/retry",
    "POST /api/conversations/:id/return-to-agent",
  ],
  agentes: [
    "GET /api/agents",
    "POST /api/agents",
    "POST /api/agents/guardrails/translate",
    "GET /api/agents/:id",
    "PATCH /api/agents/:id",
    "DELETE /api/agents/:id",
    "POST /api/agents/:id/test-message",
    "GET /api/agents/:id/embed-tokens",
    "POST /api/agents/:id/embed-tokens",
    "DELETE /api/agents/:id/embed-tokens/:tokenId",
  ],
  canales: ["GET /api/integrations/meta"],
  base_de_conocimiento: [
    "GET /api/knowledge-base",
    "POST /api/knowledge-base",
    "POST /api/knowledge-base/extract-text",
    "POST /api/knowledge-base/sync-vehicles",
    "GET /api/knowledge-base/:id",
    "PATCH /api/knowledge-base/:id",
    "DELETE /api/knowledge-base/:id",
  ],
  sucursales: [
    "GET /api/branches",
    "POST /api/branches",
    "GET /api/branches/:id",
    "PATCH /api/branches/:id",
    "DELETE /api/branches/:id",
    "GET /api/branches/:id/business-hours",
    "PATCH /api/branches/:id/business-hours",
  ],
  agenda: [
    "GET /api/branches/:branchId/google-calendar",
    "POST /api/branches/:branchId/google-calendar/connect",
    "DELETE /api/branches/:branchId/google-calendar",
    "GET /api/resources",
    "POST /api/resources",
    "GET /api/resources/:id",
    "PATCH /api/resources/:id",
    "DELETE /api/resources/:id",
    "GET /api/resources/:resourceId/working-hours",
    "PUT /api/resources/:resourceId/working-hours",
    "GET /api/service-types",
    "POST /api/service-types",
    "GET /api/service-types/:id",
    "PATCH /api/service-types/:id",
    "DELETE /api/service-types/:id",
    "GET /api/availability",
    "GET /api/bookings",
    "POST /api/bookings",
    "GET /api/bookings/:id",
    "PATCH /api/bookings/:id/cancel",
  ],
  stock: [
    "GET /api/vehicles",
    "POST /api/vehicles",
    "GET /api/vehicles/:id",
    "PATCH /api/vehicles/:id",
    "DELETE /api/vehicles/:id",
    "GET /api/vehicles/:id/change-log",
    "POST /api/vehicles/:id/photos",
    "PUT /api/vehicles/:id/photos/reorder",
    "PATCH /api/vehicles/:id/photos/:photoId",
    "DELETE /api/vehicles/:id/photos/:photoId",
  ],
  tareas: [
    "GET /api/activities",
    "POST /api/activities",
    "GET /api/activities/:id",
    "PATCH /api/activities/:id",
    "DELETE /api/activities/:id",
  ],
  cupones_y_qr: [
    "GET /api/qr",
    "POST /api/qr/digital",
    "GET /api/qr/next-display-number",
    "PATCH /api/qr/:id",
    "DELETE /api/qr/:id",
    "POST /api/vouchers",
    "POST /api/vouchers/:id/redeem",
    "GET /api/vouchers/:id/whatsapp",
    "POST /api/vouchers/:id/whatsapp",
    // El path empieza con /contacts, pero es del router de cupones.
    "GET /api/contacts/:id/vouchers",
  ],
  automatizaciones: [
    "GET /api/automations",
    "POST /api/automations",
    "GET /api/automations/:id",
    "PATCH /api/automations/:id",
    "DELETE /api/automations/:id",
    "POST /api/automations/:id/whatsapp-approval/refresh",
  ],
  oportunidades: [
    "GET /api/opportunities",
    "POST /api/opportunities",
    "GET /api/opportunities/:id",
    "PATCH /api/opportunities/:id",
    "DELETE /api/opportunities/:id",
  ],
  campos_personalizados: [
    "GET /api/contact-custom-fields",
    "POST /api/contact-custom-fields",
    "GET /api/contact-custom-fields/:id",
    "PATCH /api/contact-custom-fields/:id",
    "DELETE /api/contact-custom-fields/:id",
    "GET /api/contact-custom-fields/:id/option-usage",
  ],
  agente_interno: [
    "GET /api/internal-agent",
    "PUT /api/internal-agent",
    "GET /api/internal-agent/messages",
    "POST /api/internal-agent/messages",
  ],
  ingesta: [
    "GET /api/sources",
    "POST /api/sources",
    "GET /api/sources/:id",
    "PATCH /api/sources/:id",
    "DELETE /api/sources/:id",
    "GET /api/api-keys",
    "POST /api/api-keys",
    "DELETE /api/api-keys/:id",
    "POST /api/imports",
    "POST /api/imports/preview",
    "GET /api/imports/:batchId",
    "GET /api/ingestion-events",
    "POST /api/ingestion-events/:id/retry",
  ],
  dashboard_atencion: [],
  procesos_de_venta: [
    "GET /api/pipelines",
    "POST /api/pipelines",
    "GET /api/pipelines/:id",
    "PATCH /api/pipelines/:id",
    "DELETE /api/pipelines/:id",
    "GET /api/stages",
    "POST /api/stages",
    "GET /api/stages/:id",
    "PATCH /api/stages/:id",
    "DELETE /api/stages/:id",
  ],
  cotizaciones: [
    "GET /api/quotes",
    "POST /api/quotes",
    "GET /api/quotes/:id",
    "PATCH /api/quotes/:id",
  ],
  pagos: [
    "GET /api/payments",
    "POST /api/payments",
    "GET /api/payments/:id",
    "PATCH /api/payments/:id",
    "DELETE /api/payments/:id",
  ],
  entregas: ["GET /api/deliveries", "GET /api/deliveries/:id", "PATCH /api/deliveries/:id"],
  empresas: [
    "GET /api/companies",
    "POST /api/companies",
    "GET /api/companies/:id",
    "PATCH /api/companies/:id",
    "DELETE /api/companies/:id",
  ],
  dashboard_comercial: [
    "GET /api/opportunities/dashboard-summary",
    "GET /api/opportunities/revenue-series",
  ],
  financiacion: [],
  permutas: [],
};

/** Rutas sin sesión de usuario (sin `authenticate`). No dependen de la
 *  edición de nadie y el gate no las ve: corre dentro de `authenticate`. */
export const RUTAS_PUBLICAS: readonly string[] = [
  "GET /health",
  // Webhooks entrantes de canales y de Google Calendar.
  "GET /webhooks/whatsapp",
  "POST /webhooks/whatsapp",
  "GET /webhooks/meta",
  "POST /webhooks/meta",
  "POST /api/webhooks/google-calendar",
  // Ingesta por API key (landing).
  "POST /api/ingest",
  // Widget web (token de embed, no sesión).
  "POST /api/public/agents/:agentId/web/messages",
  "POST /api/public/agents/:agentId/web/thread",
  // Callbacks de OAuth y enlaces públicos.
  "GET /api/integrations/google-calendar/callback",
  "GET /api/integrations/meta/callback",
  "GET /qr/resolve/:qrId",
  "GET /qr-images/:tipo/:archivo",
  "GET /vouchers/resolve/:id",
  // Sin organización todavía.
  "POST /api/onboarding",
  "POST /api/onboarding/otp",
  "POST /api/invitations/accept",
];

/** Bloqueos por campo (docs/ediciones.md §5.3): un campo de un módulo que la
 *  edición no tiene, con un valor distinto de null, da 400 CAMPO_NO_INCLUIDO.
 *  pipelineId y stageId de oportunidades van en el PR 5, junto con el
 *  pipeline fijo. */
export const CAMPOS_POR_RUTA: Readonly<
  Record<string, readonly { campo: string; modulo: Modulo }[]>
> = (() => {
  const empresa = [{ campo: "companyId", modulo: "empresas" as const }];
  const financiacion = [
    "financingType",
    "financingLender",
    "financingDownPayment",
    "financingInstallmentCount",
    "financingInstallmentAmount",
  ].map((campo) => ({ campo, modulo: "financiacion" as const }));
  const permuta = [{ campo: "tradeInOpportunityId", modulo: "permutas" as const }];
  return {
    "POST /api/contacts": empresa,
    "PATCH /api/contacts/:id": empresa,
    "POST /api/activities": empresa,
    "PATCH /api/activities/:id": empresa,
    "POST /api/opportunities": [...empresa, ...financiacion],
    "PATCH /api/opportunities/:id": [...empresa, ...financiacion],
    "POST /api/vehicles": permuta,
    "PATCH /api/vehicles/:id": permuta,
  };
})();

const MODULO_DE_LA_RUTA: ReadonlyMap<string, Modulo> = (() => {
  const mapa = new Map<string, Modulo>();
  for (const modulo of MODULOS) {
    for (const ruta of RUTAS_POR_MODULO[modulo]) {
      if (mapa.has(ruta)) throw new Error(`Ruta clasificada dos veces: ${ruta}`);
      mapa.set(ruta, modulo);
    }
  }
  return mapa;
})();

/** El módulo de una ruta autenticada, o undefined si no está clasificada. */
export function moduloDeLaRuta(ruta: string): Modulo | undefined {
  return MODULO_DE_LA_RUTA.get(ruta);
}
