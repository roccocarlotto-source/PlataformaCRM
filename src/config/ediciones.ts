import type { OrganizationEdition, OrganizationIndustry } from "@prisma/client";
import type { RoleName } from "../types/auth";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Catálogo de módulos por edición y por rubro (docs/ediciones.md §5,
// docs/rubros.md §1.2). ÚNICA fuente de verdad de qué puede usar una
// organización según su edición y su rubro, que se combinan por intersección
// en modulosDe:
//
//   - el gate de rutas (middlewares/moduloDeLaEdicion.ts, que corre dentro de
//     `authenticate`) lo lee para responder 403 MODULO_NO_INCLUIDO;
//   - los bloqueos por campo (400 CAMPO_NO_INCLUIDO) salen de CAMPOS_POR_RUTA;
//   - /api/me devuelve `modulos` desde acá, para que el frontend no tenga una
//     tabla propia que se desincronice;
//   - las tools del agente de clientes se filtran con toolDelRubro.
//
// COMPLETA + AUTOMOTORA (todas las organizaciones de hoy) tiene TODOS los
// módulos: para ella el gate es un no-op total.
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
  // El dashboard de atención (§6.4), en las dos ediciones.
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
  // Solo CLINICA (docs/rubros.md §2): en las dos ediciones, y AUTOMOTORA no lo
  // tiene (SOLO_CLINICA). La agenda de clínica: varios profesionales por
  // prestación (§4.3, R5); bloqueos, sobreturnos y lo demás de §4 se suman acá
  // con sus PR.
  "agenda_clinica",
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

// Los módulos de cada rubro (docs/rubros.md §2). AUTOMOTORA es todo lo que
// existía antes de los rubros: con ella, modulosDe(e, "AUTOMOTORA") es
// exactamente lo que era modulosDe(e) (lo fija
// src/clinicas/automotoraSinCambios.test.ts). Los módulos propios de clínica
// entran a MODULOS con el PR que les da rutas, y a SOLO_CLINICA para que
// AUTOMOTORA no los tenga: agenda_clinica (R5); recordatorios_de_turno,
// post_turno y recepcion llegan con los suyos.
export const SOLO_CLINICA: ReadonlySet<Modulo> = new Set<Modulo>(["agenda_clinica"]);

// Lo que una clínica no tiene (docs/rubros.md §2 y §2.1, D3): el stock de
// vehículos (con sync-vehicles, que es del módulo stock), las oportunidades y
// todo lo que cuelga de ellas.
const FUERA_DE_CLINICA: ReadonlySet<Modulo> = new Set<Modulo>([
  "stock",
  "oportunidades",
  "procesos_de_venta",
  "cotizaciones",
  "pagos",
  "entregas",
  "empresas",
  "dashboard_comercial",
  "financiacion",
  "permutas",
]);

export const MODULOS_POR_RUBRO: Readonly<Record<OrganizationIndustry, ReadonlySet<Modulo>>> = {
  AUTOMOTORA: new Set<Modulo>(MODULOS.filter((m) => !SOLO_CLINICA.has(m))),
  CLINICA: new Set<Modulo>(MODULOS.filter((m) => !FUERA_DE_CLINICA.has(m))),
};

// Las cuatro combinaciones, precalculadas: el gate no arma sets por request.
const MODULOS_POR_COMBINACION: ReadonlyMap<string, ReadonlySet<Modulo>> = (() => {
  const mapa = new Map<string, ReadonlySet<Modulo>>();
  for (const [edition, deLaEdicion] of Object.entries(MODULOS_POR_EDICION)) {
    for (const [industry, delRubro] of Object.entries(MODULOS_POR_RUBRO)) {
      mapa.set(
        `${edition}/${industry}`,
        new Set<Modulo>(MODULOS.filter((m) => deLaEdicion.has(m) && delRubro.has(m))),
      );
    }
  }
  return mapa;
})();

/** Los módulos de una organización: los de su edición Y los de su rubro (el
 *  rubro nunca agrega lo que la edición quita, docs/rubros.md §0.4). La única
 *  función que decide: el gate, /api/me y las tools la usan. */
export function modulosDe(
  edition: OrganizationEdition,
  industry: OrganizationIndustry,
): ReadonlySet<Modulo> {
  const modulos = MODULOS_POR_COMBINACION.get(`${edition}/${industry}`);
  if (!modulos) throw new Error(`Combinación sin catálogo: ${edition}/${industry}`);
  return modulos;
}

/** Por qué una organización no tiene un módulo (D12 de docs/rubros.md). Si su
 *  rubro no lo tiene, "RUBRO", aunque la edición tampoco lo tenga: subir de
 *  edición no se lo daría. Si no, "EDICION". */
export type MotivoDeExclusion = "EDICION" | "RUBRO";

export function motivoDeExclusion(
  modulo: Modulo,
  industry: OrganizationIndustry,
): MotivoDeExclusion {
  return MODULOS_POR_RUBRO[industry].has(modulo) ? "EDICION" : "RUBRO";
}

// ---------------------------------------------------------------------------
// ESENCIAL se ofrece desde H1 (docs/ediciones.md §10): el camino A–G ya dejó
// todo lo que una organización ESENCIAL necesita. Es la ÚNICA llave: el alta
// la consulta por edicionesDisponibles() y la pantalla de Plataforma se entera
// por GET /api/admin/organizations/editions, sin una constante propia. En
// false, el alta vuelve a rechazar ESENCIAL con 400 (las organizaciones que ya
// existen no cambian).
// ---------------------------------------------------------------------------
export const ESENCIAL_HABILITADA = true;

/** Las ediciones que se pueden elegir al dar de alta una organización, en el
 *  orden en que se muestran. */
export function edicionesDisponibles(
  esencialHabilitada: boolean = ESENCIAL_HABILITADA,
): readonly OrganizationEdition[] {
  return esencialHabilitada ? ["COMPLETA", "ESENCIAL"] : ["COMPLETA"];
}

// ---------------------------------------------------------------------------
// CLINICA todavía no se ofrece (docs/rubros.md §15, R3): el alta y la
// configuración existen, pero sin el resto del plan una clínica quedaría a
// medias. Mismo molde que ESENCIAL_HABILITADA: es la ÚNICA llave, el alta y el
// cambio de rubro la consultan por rubrosDisponibles() y la pantalla de
// Plataforma se entera por GET /api/admin/organizations/industries. Se pone en
// true en un PR posterior, cuando haya un mínimo usable.
// ---------------------------------------------------------------------------
export const CLINICA_HABILITADA = false;

/** Los rubros que se pueden elegir al dar de alta una organización (o al
 *  cambiarle el rubro), en el orden en que se muestran. */
export function rubrosDisponibles(
  clinicaHabilitada: boolean = CLINICA_HABILITADA,
): readonly OrganizationIndustry[] {
  return clinicaHabilitada ? ["AUTOMOTORA", "CLINICA"] : ["AUTOMOTORA"];
}

/** Los roles que admite cada rubro (docs/rubros.md §11.1, D21), en el orden
 *  en que se muestran. Lo validan las invitaciones y el cambio de rol de un
 *  usuario (400 ROL_NO_DISPONIBLE_EN_EL_RUBRO), y el cambio de rubro (D1: 409
 *  si la organización tiene usuarios con un rol que el rubro nuevo no admite).
 *  /api/me lo devuelve como rolesAsignables: la pantalla no tiene una tabla
 *  propia. */
export const ROLES_POR_RUBRO: Readonly<Record<OrganizationIndustry, readonly RoleName[]>> = {
  AUTOMOTORA: ["ADMIN", "USER"],
  CLINICA: ["ADMIN", "RECEPCION"],
};

export const ROL_NO_DISPONIBLE_EN_EL_RUBRO = "ROL_NO_DISPONIBLE_EN_EL_RUBRO";

/** 400 ROL_NO_DISPONIBLE_EN_EL_RUBRO si el rubro no admite el rol: USER en una
 *  clínica, RECEPCION en una automotora. */
export function exigirRolDelRubro(rol: RoleName, industry: OrganizationIndustry): void {
  if (!ROLES_POR_RUBRO[industry].includes(rol)) {
    throw new AppError(`El rol ${rol} no está disponible en este rubro.`, 400, true, {
      code: ROL_NO_DISPONIBLE_EN_EL_RUBRO,
      rol,
      industry,
    });
  }
}

/** El proceso de venta fijo de ESENCIAL (§2.1): se crea en el alta, en la
 *  misma transacción, y queda invisible (ESENCIAL no tiene /pipelines ni
 *  /stages). Vendida y Perdida son las etapas ganada y perdida a las que el
 *  ítem 154 mueve una oportunidad con status WON o LOST. */
export const PROCESO_DE_VENTA_FIJO = {
  name: "Ventas",
  stages: [
    { name: "En curso", order: 1, probability: 0, isWon: false, isLost: false },
    { name: "Vendida", order: 2, probability: 100, isWon: true, isLost: false },
    { name: "Perdida", order: 3, probability: 0, isWon: false, isLost: true },
  ],
} as const;

/** Módulos sin rutas propias: el test de clasificación los tolera.
 *  financiacion y permutas son solo campos. */
export const MODULOS_SIN_RUTAS: ReadonlySet<Modulo> = new Set<Modulo>(["financiacion", "permutas"]);

export const RUTAS_POR_MODULO: Readonly<Record<Modulo, readonly string[]>> = {
  comun: ["GET /api/me", "GET /api/organization", "PATCH /api/organization"],
  // Protegidas por requirePlatformAdmin; el gate nunca las bloquea (están en
  // las dos ediciones). La edición de la organización DESTINO de una
  // importación es asunto del PR 9, no del gate.
  plataforma: [
    "GET /api/admin/organizations",
    "POST /api/admin/organizations",
    "GET /api/admin/organizations/editions",
    "PATCH /api/admin/organizations/:organizationId/edition",
    // Rubros (docs/rubros.md §15, R3): los que se pueden elegir en el alta, y
    // cambiar el rubro de una organización sin datos (D1).
    "GET /api/admin/organizations/industries",
    "PATCH /api/admin/organizations/:organizationId/industry",
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
    // Vuelca el stock a la base de conocimiento: sin stock no hay nada que
    // volcar (docs/rubros.md §2, "Sin sync-vehicles"). Las dos ediciones
    // tienen stock, así que pasar acá desde base_de_conocimiento no cambia
    // nada para una automotora.
    "POST /api/knowledge-base/sync-vehicles",
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
  dashboard_atencion: ["GET /api/dashboard/atencion"],
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
  agenda_clinica: [
    "GET /api/clinica/prestaciones",
    "GET /api/clinica/prestaciones/:serviceTypeId/profesionales",
    "PUT /api/clinica/prestaciones/:serviceTypeId/profesionales",
    "GET /api/clinica/disponibilidad",
    "POST /api/clinica/turnos",
  ],
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

/** Bloqueos por campo (docs/ediciones.md §5.3, docs/rubros.md §1.2): un campo
 *  de un módulo que la organización no tiene, por edición o por rubro, con un
 *  valor distinto de null, da 400 CAMPO_NO_INCLUIDO. Una sola lista para los
 *  dos: el módulo del campo decide, con modulosDe, igual que en las rutas.
 *  pipelineId y stageId de oportunidades son de procesos_de_venta: sin ese
 *  módulo, la oportunidad vive en el proceso fijo y el servidor lo elige
 *  (paso B de docs/ediciones.md §10). */
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
  const procesoDeVenta = ["pipelineId", "stageId"].map((campo) => ({
    campo,
    modulo: "procesos_de_venta" as const,
  }));
  // Los que hoy solo excluye el rubro (CLINICA): las dos ediciones tienen
  // stock y oportunidades.
  const vehiculoDeInteres = [{ campo: "vehicleOfInterestId", modulo: "stock" as const }];
  const oportunidad = [{ campo: "opportunityId", modulo: "oportunidades" as const }];
  return {
    "POST /api/contacts": empresa,
    "PATCH /api/contacts/:id": [...empresa, ...vehiculoDeInteres],
    "POST /api/activities": [...empresa, ...oportunidad],
    "PATCH /api/activities/:id": [...empresa, ...oportunidad],
    "POST /api/bookings": oportunidad,
    "POST /api/opportunities": [...empresa, ...financiacion, ...procesoDeVenta],
    "PATCH /api/opportunities/:id": [...empresa, ...financiacion, ...procesoDeVenta],
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

// ---------------------------------------------------------------------------
// Tools del agente de clientes por rubro (docs/rubros.md §5.1): los mismos
// módulos que las rutas. Una tool está en el rubro si su módulo está en
// modulosDe. Se aplica en los dos lugares de siempre: toolsHabilitadas (lo
// que se le ofrece al modelo) y puedeEjecutarTool (lo que se ejecuta).
//
// AUTOMOTORA no filtra NADA, en ninguna edición: el filtro por edición y por
// nivel de IA es el PR 6 de docs/ediciones.md.
// ---------------------------------------------------------------------------

/** El módulo de cada tool de CATALOGO_DE_TOOLS (agentTools.service.ts).
 *  src/clinicas/automotoraSinCambios.test.ts falla si falta una.
 *  request_human_handoff no está: es la tool del sistema y se ofrece siempre. */
export const MODULO_DE_LA_TOOL: Readonly<Record<string, Modulo>> = {
  search_vehicles: "stock",
  reserve_vehicle: "stock",
  create_opportunity: "oportunidades",
  update_opportunity: "oportunidades",
  get_service_types: "agenda",
  get_availability: "agenda",
  create_booking: "agenda",
  get_contact_info: "contactos",
  create_lead: "contactos",
  update_lead: "contactos",
  mark_no_interest: "contactos",
  update_contact_custom_fields: "campos_personalizados",
  get_contact_activities: "tareas",
  // No usa el módulo de pagos: lee el link de pago y los datos de
  // transferencia de la sucursal (docs/ediciones.md D11). En CLINICA queda
  // afuera por TOOLS_FUERA_DEL_RUBRO, no por su módulo.
  get_payment_info: "sucursales",
};

/** Tools que un rubro no tiene aunque tenga su módulo. En CLINICA el agente
 *  informa precios y medios de pago, pero no manda un link de pago
 *  (docs/rubros.md §5.1 y §5.5, B7). */
const TOOLS_FUERA_DEL_RUBRO: Readonly<Record<OrganizationIndustry, ReadonlySet<string>>> = {
  AUTOMOTORA: new Set<string>(),
  CLINICA: new Set<string>(["get_payment_info"]),
};

/** Si una tool está en el rubro de la organización. En AUTOMOTORA, siempre.
 *  En otro rubro, una tool sin módulo conocido no está (falla cerrado). */
export function toolDelRubro(
  nombre: string,
  edition: OrganizationEdition,
  industry: OrganizationIndustry,
): boolean {
  if (industry === "AUTOMOTORA") return true;
  if (TOOLS_FUERA_DEL_RUBRO[industry].has(nombre)) return false;
  const modulo = Object.hasOwn(MODULO_DE_LA_TOOL, nombre) ? MODULO_DE_LA_TOOL[nombre] : undefined;
  return modulo !== undefined && modulosDe(edition, industry).has(modulo);
}
