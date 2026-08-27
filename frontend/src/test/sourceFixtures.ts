import type { Source } from "../features/source/types";

// Fixture compartida entre los tests de features/source/ — mismo criterio que
// contactFixtures.ts y companyFixtures.ts.
//
// Sin `deletedAt`: SOURCE_PUBLIC_SELECT del backend no lo devuelve (ver
// features/source/types.ts). Una fixture que lo incluyera describiría una
// respuesta que la API nunca manda.
export function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "src1",
    organizationId: "org-1",
    name: "Landing de precios",
    type: "WEBHOOK",
    isActive: true,
    fieldMapping: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
