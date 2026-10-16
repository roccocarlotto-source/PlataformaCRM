import type { Opportunity, OpportunityListItem } from "../features/opportunity/types";

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
    vehicleId: null,
    financingType: null,
    leadSource: null,
    financingLender: null,
    financingDownPayment: null,
    financingInstallmentCount: null,
    financingInstallmentAmount: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

// Una fila de GET /api/opportunities: la oportunidad más los nombres de sus
// relaciones. Por defecto salen de los ids, con los nombres de siempre en estos
// tests; un override de contact/company/pipeline/stage los pisa (null = borrada).
export function makeOpportunityListItem(
  overrides: Partial<OpportunityListItem> = {},
): OpportunityListItem {
  const opportunity = makeOpportunity(overrides);
  return {
    contact: opportunity.contactId
      ? { id: opportunity.contactId, firstName: "Ana", lastName: "Pérez" }
      : null,
    company: opportunity.companyId ? { id: opportunity.companyId, name: "Acme Corp" } : null,
    pipeline: { id: opportunity.pipelineId, name: "Ventas" },
    stage: { id: opportunity.stageId, name: "Prospecto" },
    ...overrides,
    ...opportunity,
  };
}
