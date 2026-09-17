import type { VehicleStatus } from "../vehicle/types";

// Contrato de /api/deliveries (§40 de docs/frontend-cambios-pendientes.md),
// tal como lo serializa el backend (delivery.controller.ts /
// delivery.repository.ts).

// PENDING nace sola al ganar la oportunidad con unidad vinculada; DELIVERED la
// pone "Confirmar entrega" y la vuelve inmutable.
export type DeliveryStatus = "PENDING" | "DELIVERED";

export interface DeliveryChecklistItem {
  label: string;
  checked: boolean;
}

export interface Delivery {
  id: string;
  organizationId: string;
  opportunityId: string;
  // FOTO de la unidad vendida al crear la entrega, como Quote.vehicleId.
  vehicleId: string | null;
  checklist: DeliveryChecklistItem[];
  // Fecha sola serializada como ISO a medianoche UTC ("2026-09-30T00:00:00.000Z").
  scheduledAt: string | null;
  // Instante real de la entrega; null mientras está PENDING.
  deliveredAt: string | null;
  deliveredById: string | null;
  status: DeliveryStatus;
  createdAt: string;
  updatedAt: string;
  deliveredBy: { id: string; fullName: string } | null;
  vehicle: {
    id: string;
    internalCode: string;
    make: string;
    model: string;
    trim: string | null;
    year: number;
    status: VehicleStatus;
  } | null;
}

// GET /deliveries?opportunityId=: 0 o 1 entrega (UNIQUE por oportunidad).
export interface DeliveryListResponse {
  data: Delivery[];
}

// Solo para una PENDING. Nunca junto con status: son dos formas distintas del
// PATCH y el backend rechaza la mezcla. El checklist viaja ENTERO: agregar o
// quitar un ítem es mandar la lista nueva.
export interface UpdateDeliveryInput {
  checklist?: DeliveryChecklistItem[];
  // "YYYY-MM-DD"; null = sin fecha programada.
  scheduledAt?: string | null;
}
