import type { IngestionEvent } from "../features/ingestionEvent/types";

// Fixture compartida entre los tests de features/ingestionEvent/ — mismo
// criterio que sourceFixtures.ts y apiKeyFixtures.ts.
//
// Sin `rawPayload` ni `promotionNotes`: la proyección pública del backend no los
// devuelve. Una fixture que los incluyera describiría una respuesta que la API
// nunca manda.
//
// Default PENDING con los cuatro nullable en null: es el estado de un evento
// recién ingerido, antes de que el worker lo mire.
export function makeIngestionEvent(overrides: Partial<IngestionEvent> = {}): IngestionEvent {
  return {
    id: "ev1",
    organizationId: "org-1",
    sourceId: "src1",
    batchId: null,
    externalId: "ext-1",
    status: "PENDING",
    errorMessage: null,
    promotedContactId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
