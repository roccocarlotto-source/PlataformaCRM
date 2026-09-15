import { Card } from "../../design-system/Card";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { formatAmount } from "../opportunity/format";
import { useOpportunities } from "../opportunity/queries";
import { useDashboardSummary } from "./queries";

const TOP_LIMIT = 5;

// "Top deals" del mockup (§30 de docs/frontend-cambios-pendientes.md): las 5
// oportunidades ABIERTAS de mayor monto, con una barra proporcional al monto
// de la más grande — las mismas clases .ds-meter-* que PipelineStageSummary,
// sin CSS nuevo. Filtra por la moneda de la organización (la misma que usa
// "Valor del pipeline"), porque comparar barras de monedas distintas sería
// un dato inventado; esa moneda sale del resumen ya cargado
// (useDashboardSummary, request compartido), y hasta tenerla no se pide
// nada: `enabled` gatea el listado, mismo patrón que useStages.
export function TopDealsList() {
  const summary = useDashboardSummary();
  const currency = summary.data?.currency;

  const query = useOpportunities(
    {
      status: "OPEN",
      currency,
      sortBy: "amount",
      sortOrder: "desc",
      pageSize: TOP_LIMIT,
    },
    { enabled: currency !== undefined },
  );
  const rows = query.data?.data ?? [];
  const maxAmount = Math.max(0, ...rows.map((opportunity) => Number(opportunity.amount)));

  const isLoading = summary.isLoading || (summary.isSuccess && query.isLoading);
  const error = summary.isError ? summary.error : query.isError ? query.error : null;
  const isError = summary.isError || query.isError;

  return (
    <Card aria-label="Mayores oportunidades abiertas" heading="Mayores oportunidades abiertas">
      {isLoading ? <LoadingState /> : null}

      {isError ? (
        <ErrorState>
          No pudimos cargar las mayores oportunidades
          {error instanceof Error ? `: ${error.message}` : "."}
        </ErrorState>
      ) : null}

      {query.isSuccess && rows.length === 0 ? (
        <EmptyState>No hay oportunidades abiertas en {currency}.</EmptyState>
      ) : null}

      {query.isSuccess && rows.length > 0 ? (
        <ul className="ds-meter-list">
          {rows.map((opportunity) => {
            const amount = Number(opportunity.amount);
            const percent = maxAmount > 0 ? (amount / maxAmount) * 100 : 0;
            return (
              <li key={opportunity.id} className="ds-meter">
                <div className="ds-meter-row">
                  <span>{opportunity.title}</span>
                  <span className="ds-meter-value">
                    {formatAmount(opportunity.amount, opportunity.currency)}
                  </span>
                </div>
                {/* Decorativa: el monto de al lado ya es el dato. */}
                <div className="ds-meter-track" aria-hidden="true">
                  <div className="ds-meter-fill" style={{ width: `${percent}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}
