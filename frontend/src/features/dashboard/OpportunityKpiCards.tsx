import { Card } from "../../design-system/Card";
import { buildKpiCards, type KpiCard } from "./kpi";
import { useDashboardSummary } from "./queries";

// Rótulos fijos para pintar el esqueleto de las cuatro cards mientras el
// resumen carga o falla: así la fila no cambia de forma cuando llegan los
// datos. Los mismos rótulos que produce buildKpiCards.
const LABELS: Array<{ key: KpiCard["key"]; label: string }> = [
  { key: "open", label: "Oportunidades abiertas" },
  { key: "pipelineValue", label: "Valor del pipeline" },
  { key: "wonThisMonth", label: "Ganado este mes" },
  { key: "winRate", label: "Tasa de cierre del mes" },
];

// Reemplaza a OpportunitySummaryCards (M8: tres conteos por status, sin
// montos porque el backend no exponía SUM). Desde el §30 de
// docs/frontend-cambios-pendientes.md existe GET /opportunities/dashboard-
// summary, y las cuatro cards del mockup salen de ahí: abiertas, valor del
// pipeline, ganado este mes y tasa de cierre, cada una con su variación
// contra el mes anterior calculada en kpi.ts. "Perdidas" ya no tiene card
// propia: vive en el denominador de la tasa de cierre.
//
// Un solo request para las cuatro (a diferencia de M8, que hacía uno por
// card): loading y error son de la fila entera, y siguen siendo
// independientes del resto del Dashboard. Sigue siendo un <dl>: cada card es
// un término (rótulo) con dos descripciones (valor y variación).
export function OpportunityKpiCards() {
  const summary = useDashboardSummary();
  const cards = summary.data ? buildKpiCards(summary.data) : null;

  return (
    <section aria-label="Resumen comercial">
      <dl className="ds-card-grid ds-kpi-row">
        {LABELS.map(({ key, label }) => {
          const card = cards?.find((candidate) => candidate.key === key);
          return (
            <Card as="div" key={key} className="ds-kpi">
              <dt className="ds-kpi-label">{label}</dt>
              {summary.isLoading ? <dd className="ds-kpi-state">Cargando…</dd> : null}
              {summary.isError ? (
                <dd className="ds-kpi-state" role="alert">
                  No pudimos cargar este dato
                  {summary.error instanceof Error ? `: ${summary.error.message}` : "."}
                </dd>
              ) : null}
              {card ? (
                <>
                  <dd className="ds-kpi-value">{card.value}</dd>
                  <dd className={`ds-kpi-delta ds-kpi-delta--${card.delta.direction}`}>
                    {card.delta.text}
                  </dd>
                </>
              ) : null}
            </Card>
          );
        })}
      </dl>
    </section>
  );
}
