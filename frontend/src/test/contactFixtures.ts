import type { Contact } from "../features/contact/types";

// Fixture compartida entre los tests de features/contact/ — mismo criterio
// que companyFixtures.ts.
export function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "ct1",
    organizationId: "org-1",
    companyId: null,
    ownerId: null,
    firstName: "Juana",
    lastName: "Pérez",
    email: "juana@example.com",
    phone: null,
    jobTitle: null,
    lifecycleStage: "LEAD",
    source: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}
