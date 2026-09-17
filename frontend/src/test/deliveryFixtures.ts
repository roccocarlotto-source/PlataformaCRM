import type { Delivery } from "../features/delivery/types";

// Fixture compartida de los tests de features/delivery/. Una entrega PENDING
// recién nacida, con el checklist default del backend
// (delivery.service.ts, DEFAULT_DELIVERY_CHECKLIST_LABELS) y la unidad SOLD.
export function makeDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: "d1",
    organizationId: "org-1",
    opportunityId: "op1",
    vehicleId: "v1",
    checklist: [
      { label: "Documentación de transferencia", checked: false },
      { label: "Manual del vehículo", checked: false },
      { label: "Llave de repuesto", checked: false },
      { label: "Kit de herramientas / gato", checked: false },
      { label: "Service al día", checked: false },
    ],
    scheduledAt: null,
    deliveredAt: null,
    deliveredById: null,
    status: "PENDING",
    createdAt: "2026-09-16T15:00:00.000Z",
    updatedAt: "2026-09-16T15:00:00.000Z",
    deliveredBy: null,
    vehicle: {
      id: "v1",
      internalCode: "STK-000006",
      make: "Toyota",
      model: "Corolla",
      trim: "XEI",
      year: 2022,
      status: "SOLD",
    },
    ...overrides,
  };
}
