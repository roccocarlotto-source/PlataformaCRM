import type { BadgeVariant } from "../../design-system/Badge";
import type { QuoteStatus } from "./types";

// Estado de una cotización en español, mismo criterio que STATUS_LABEL de
// opportunity/labels.ts: el enum queda en inglés en el contrato, la UI no.
export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  DRAFT: "Borrador",
  SENT: "Enviada",
  ACCEPTED: "Aceptada",
  REJECTED: "Rechazada",
  EXPIRED: "Vencida",
  SUPERSEDED: "Reemplazada",
};

// El color lo decide el feature (ver Badge.tsx): aceptada en verde,
// rechazada en rojo, enviada como "en curso"; el resto neutro.
export const QUOTE_STATUS_VARIANT: Record<QuoteStatus, BadgeVariant> = {
  DRAFT: "neutral",
  SENT: "info",
  ACCEPTED: "success",
  REJECTED: "danger",
  EXPIRED: "neutral",
  SUPERSEDED: "neutral",
};
