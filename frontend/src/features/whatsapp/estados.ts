import type { BadgeVariant } from "../../design-system/Badge";
import type { WhatsappTemplateStatus } from "./types";

// El badge de cada estado de la revisión de Meta. Compartido por la pantalla
// de una regla y el listado (ítem 181), para que digan lo mismo.
export const ESTADOS: Record<WhatsappTemplateStatus, { label: string; variant: BadgeVariant }> = {
  PENDING: { label: "Pendiente", variant: "info" },
  APPROVED: { label: "Aprobada", variant: "success" },
  REJECTED: { label: "Rechazada", variant: "danger" },
};
