import type { BadgeVariant } from "../../design-system/Badge";
import type { DeliveryStatus } from "./types";

// Estado de una entrega en español, mismo criterio que QUOTE_STATUS_LABEL: el
// enum queda en inglés en el contrato, la UI no.
export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  PENDING: "Pendiente de entrega",
  DELIVERED: "Entregada",
};

// Pendiente como "en curso"; entregada en verde, es el cierre del ciclo.
export const DELIVERY_STATUS_VARIANT: Record<DeliveryStatus, BadgeVariant> = {
  PENDING: "info",
  DELIVERED: "success",
};
