import type { Opportunity } from "../features/opportunity/types";

// Fixture compartida entre los tests de features/opportunity/. amount se
// fija como string, fiel al contrato real (Prisma.Decimal → toJSON()
// string) — mismo criterio que stageFixtures.ts con probability.
export function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "op1",
    organizationId: "org-1",
    companyId: "co1",
    contactId: null,
    ownerId: "u1",
    pipelineId: "pl1",
    stageId: "st1",
    title: "Renovación anual",
    amount: "1500.00",
    currency: "USD",
    expectedCloseDate: null,
    actualCloseDate: null,
    status: "OPEN",
    lostReason: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}
