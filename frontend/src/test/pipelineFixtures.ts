import type { Pipeline } from "../features/pipeline/types";

// Fixture compartida entre los tests de features/pipeline/.
export function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: "pl1",
    organizationId: "org-1",
    name: "Ventas",
    isDefault: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}
