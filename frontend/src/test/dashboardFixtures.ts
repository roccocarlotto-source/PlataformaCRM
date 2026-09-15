import type { OpportunityDashboardSummary } from "../features/opportunity/types";

// Fixture del resumen comercial (§30) para los tests de features/dashboard/.
// Montos como string, fiel al contrato (Prisma.Decimal → toJSON() string),
// mismo criterio que opportunityFixtures.ts. La serie tiene 6 meses en orden
// cronológico, como la manda el backend.
export function makeDashboardSummary(
  overrides: Partial<OpportunityDashboardSummary> = {},
): OpportunityDashboardSummary {
  return {
    currency: "USD",
    openCount: 3,
    openValue: "4500.00",
    createdThisMonth: { count: 5, value: "2000.00" },
    createdLastMonth: { count: 3, value: "1000.00" },
    wonThisMonth: { count: 2, value: "3000.00" },
    wonLastMonth: { count: 1, value: "1500.00" },
    lostCountThisMonth: 2,
    lostCountLastMonth: 1,
    revenueByMonth: [
      { month: "2025-10", value: "100.00" },
      { month: "2025-11", value: "0.00" },
      { month: "2025-12", value: "250.00" },
      { month: "2026-01", value: "900.00" },
      { month: "2026-02", value: "1500.00" },
      { month: "2026-03", value: "3000.00" },
    ],
    ...overrides,
  };
}
