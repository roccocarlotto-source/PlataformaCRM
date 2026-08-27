import type { ApiKey, CreatedApiKey } from "../features/apiKey/types";

// Fixture compartida entre los tests de features/apiKey/ — mismo criterio que
// sourceFixtures.ts y contactFixtures.ts.
//
// Sin `keyHash` ni `key`: la proyección pública del backend no los devuelve. El
// secreto solo existe en makeCreatedApiKey, que modela el 201 del POST.
export function makeApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: "ak1",
    organizationId: "org-1",
    sourceId: "src1",
    keyPrefix: "crm_AbCdEfGh",
    lastUsedAt: null,
    revokedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// El 201 de POST /api/api-keys: la proyección pública MÁS la clave en claro.
export function makeCreatedApiKey(overrides: Partial<CreatedApiKey> = {}): CreatedApiKey {
  return {
    ...makeApiKey(),
    key: "crm_AbCdEfGh_secreto_de_prueba_no_real",
    ...overrides,
  };
}
