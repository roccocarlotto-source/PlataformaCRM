import type { ServiceType } from "../features/serviceType/types";

// Fixture compartida entre los tests de features/serviceType/ y el listado de
// Reservas — ítem 75.
export function makeServiceType(overrides: Partial<ServiceType> = {}): ServiceType {
  return {
    id: "s1",
    organizationId: "org-1",
    branchId: "b1",
    resourceId: "r1",
    name: "Consulta general",
    durationMin: 30,
    capacity: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}
