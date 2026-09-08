import type { OpportunityFinancingType, OpportunityLeadSource } from "./types";

// ---------------------------------------------------------------------------
// Rótulos en español de los enums de Opportunity que llegaron con el módulo
// de stock de vehículos (Fase 2c). Mismo criterio que features/vehicle/
// labels.ts: los valores son los del schema, acá solo el texto que ve la
// persona, y Record<Enum, string> para que un valor nuevo sin rótulo no
// compile. Los <select> del formulario iteran estos mapas, así que agregar un
// valor acá es agregar la opción.
// ---------------------------------------------------------------------------

export const FINANCING_TYPE_LABELS: Record<OpportunityFinancingType, string> = {
  NONE: "Sin financiación",
  INSTALLMENT_24M: "Crédito prendario 24 meses",
  INSTALLMENT_36M: "Crédito prendario 36 meses",
  OWN_FINANCING: "Financiación propia",
};

export const LEAD_SOURCE_LABELS: Record<OpportunityLeadSource, string> = {
  PORTAL_MERCADOLIBRE: "Portal · MercadoLibre",
  WEBSITE: "Sitio web",
  SHOWROOM: "Showroom",
  REFERRAL: "Referido",
  WHATSAPP: "WhatsApp",
};
