import type { OpportunityRevenueGranularity } from "../opportunity/types";
import { Card } from "../../design-system/Card";
import { buildKpiCards, kpiLabels } from "./kpi";
import { useDashboardSummary } from "./queries";

interface OpportunityKpiCardsProps {
  // El período elegido en el header de la página (§35). Baja por prop en vez
  // de leerse de un contexto: son tres consumidores hermanos y un solo dueño
  // del estado, DashboardPage.
  granularity: OpportunityRevenueGranularity;
}

// Reemplaza a OpportunitySummaryCards (M8: tres conteos por status, sin
// montos porque el backend no exponía SUM). Desde el §30 de
// docs/frontend-cambios-pendientes.md existe GET /opportunities/dashboard-
// summary, y las cards salen de ahí, cada una con su variación calculada en
// kpi.ts. "Perdidas" ya no tiene card propia: vive en el denominador de la
// tasa de cierre.
//
// Desde el §35 miden la ventana que dice el selector (mes/semana/día) y la
// card de "creadas" cambió de significado: dejó de ser "cuántas están
// abiertas ahora" para ser "cuántas se crearon en el período". Desde el §36
// son tres —creadas, ganado y tasa de cierre—: "Valor del pipeline" se sacó
// porque el embudo de Oportunidades ya muestra lo mismo, por pipeline y
// multi-moneda.
//
// Un solo request para las tres (a diferencia de M8, que hacía uno por
// card): loading y error son de la fila entera, y siguen siendo
// independientes del resto del Dashboard. Sigue siendo un <dl>: cada card es
// un término (rótulo) con dos descripciones (valor y variación).
export function OpportunityKpiCards({ granularity }: OpportunityKpiCardsProps) {
  const summary = useDashboardSummary(granularity);
  const cards = summary.data ? buildKpiCards(summary.data) : null;
  // Rótulos para pintar el esqueleto de las cards mientras el resumen
  // carga o falla: así la fila no cambia de forma cuando llegan los datos. Los
  // mismos que produce buildKpiCards, de la misma función.
  const labels = kpiLabels(granularity);

  return (
    <section aria-label="Resumen comercial">
      <dl className="ds-card-grid ds-kpi-row">
        {labels.map(({ key, label }) => {
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
