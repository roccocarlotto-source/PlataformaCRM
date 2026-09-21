import type { Resource } from "../features/resource/types";

// Fixture compartida entre los tests de features/resource/ y los que consumen
// ResourceSelect (Tipos de servicio, Reservas) — ítem 75.
export function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: "r1",
    organizationId: "org-1",
    branchId: "b1",
    name: "Dra. López",
    type: "PERSON",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}
