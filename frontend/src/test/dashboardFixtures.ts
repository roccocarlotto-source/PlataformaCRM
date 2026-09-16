import type {
  OpportunityDashboardSummary,
  OpportunityRevenueGranularity,
  OpportunityRevenueSeries,
} from "../features/opportunity/types";

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

// Serie de ingresos del gráfico (§33), GET /opportunities/revenue-series.
// Los mismos montos que revenueByMonth arriba, para que los tests que ya
// existían sobre el gráfico sigan leyendo los mismos números.
export function makeRevenueSeries(
  overrides: Partial<OpportunityRevenueSeries> = {},
): OpportunityRevenueSeries {
  return {
    currency: "USD",
    granularity: "month",
    points: [
      { label: "2025-10", value: "100.00" },
      { label: "2025-11", value: "0.00" },
      { label: "2025-12", value: "250.00" },
      { label: "2026-01", value: "900.00" },
      { label: "2026-02", value: "1500.00" },
      { label: "2026-03", value: "3000.00" },
    ],
    ...overrides,
  };
}

// Serie de N buckets contiguos rotulados con fechas "YYYY-MM-DD", para las
// granularidades semanal (lunes, paso 7) y diaria (paso 1). El valor de cada
// bucket es su índice + 1, así cada punto es distinguible en las aserciones.
export function makeDateRevenueSeries(
  granularity: Exclude<OpportunityRevenueGranularity, "month">,
  count: number,
  lastLabel = "2026-03-09",
): OpportunityRevenueSeries {
  const step = granularity === "week" ? 7 : 1;
  const last = new Date(`${lastLabel}T00:00:00.000Z`);
  return {
    currency: "USD",
    granularity,
    points: Array.from({ length: count }, (_, index) => {
      const day = new Date(last.getTime() - (count - 1 - index) * step * 86_400_000);
      return { label: day.toISOString().slice(0, 10), value: `${index + 1}.00` };
    }),
  };
}
