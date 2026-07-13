import type { Company } from "../features/company/types";

// Fixture compartida entre los tests de features/company/ — evita duplicar
// el objeto Company completo en cada archivo de test.
export function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: "c1",
    organizationId: "org-1",
    ownerId: null,
    name: "Acme",
    domain: null,
    industry: null,
    phone: null,
    city: null,
    country: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}
