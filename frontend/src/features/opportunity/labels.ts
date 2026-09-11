import type { OpportunityFinancingType, OpportunityLeadSource, OpportunityStatus } from "./types";

// ---------------------------------------------------------------------------
// Rótulos en español de los enums de Opportunity. Mismo criterio que
// features/vehicle/labels.ts: los valores son los del schema, acá solo el
// texto que ve la persona, y Record<Enum, string> para que un valor nuevo sin
// rótulo no compile. Los <select> del formulario iteran estos mapas, así que
// agregar un valor acá es agregar la opción.
//
// FINANCING_TYPE_LABELS y LEAD_SOURCE_LABELS llegaron con el módulo de stock
// de vehículos (Fase 2c). STATUS_LABEL vivía en OpportunityListPage.tsx (filtro
// y badge) y se movió acá en el ítem 18.E de docs/frontend-cambios-pendientes.md
// para que el select de Estado del formulario use la misma traducción en vez
// del enum crudo.
// ---------------------------------------------------------------------------

export const STATUSES: OpportunityStatus[] = ["OPEN", "WON", "LOST"];

// Traducción del enum real a texto. Es el mismo status que ya se leía crudo;
// no hay ningún estado inventado.
export const STATUS_LABEL: Record<OpportunityStatus, string> = {
  OPEN: "Abierta",
  WON: "Ganada",
  LOST: "Perdida",
};

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
