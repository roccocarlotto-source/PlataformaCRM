import { useState } from "react";
import type {
  OpportunityDashboardSummary,
  OpportunityRevenueGranularity,
} from "../opportunity/types";
import { AnimatedNumber } from "../../design-system/AnimatedNumber";
import { Card } from "../../design-system/Card";
import { buildKpiCards, kpiLabels } from "./kpi";
import { useDashboardSummary } from "./queries";
import { Skeleton } from "../../design-system/Skeleton";

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

  // §37: los números grandes cuentan desde 0 SOLO la primera vez que llega un
  // resumen; cambiar de período después los actualiza directo (confirmado con
  // Rocco). El flag vive acá y no en cada AnimatedNumber porque, al pedir un
  // período todavía no visto, la card vuelve a "Cargando…" y el número se
  // desmonta: la instancia que se monta con el dato nuevo no tiene cómo saber
  // que la fila ya animó. Este componente no se desmonta al cambiar de período.
  //
  // Cómo se apaga, sin efecto: se recuerda el PRIMER resumen recibido y, en
  // cuanto summary.data deja de ser ese objeto (undefined al pedir otro
  // período, u otro resumen), la animación queda apagada para siempre. El
  // flag cambia en ese mismo render, antes de que se monte ninguna instancia
  // nueva; las de la primera llegada ya tomaron su decisión (useCountUp la
  // toma una sola vez) y el cambio del prop no las interrumpe. Pegajoso a
  // propósito: comparar solo contra el primer resumen haría que volver a ese
  // período (misma referencia en la caché) animara otra vez.
  const [firstSummary, setFirstSummary] = useState<OpportunityDashboardSummary | null>(null);
  const [arrivalDone, setArrivalDone] = useState(false);
  if (firstSummary === null) {
    if (summary.data) setFirstSummary(summary.data);
  } else if (!arrivalDone && summary.data !== firstSummary) {
    setArrivalDone(true);
  }

  return (
    <section aria-label="Resumen comercial">
      <dl className="ds-card-grid ds-kpi-row">
        {labels.map(({ key, label }) => {
          const card = cards?.find((candidate) => candidate.key === key);
          return (
            <Card as="div" key={key} className="ds-kpi">
              <dt className="ds-kpi-label">{label}</dt>
              {summary.isLoading ? (
                <dd className="ds-kpi-state">
                  {/* Un bloque animado del tamaño del número que viene, para
                      que la card no cambie de alto al llegar el dato. El texto
                      del estado sigue existiendo para lectores de pantalla. */}
                  <Skeleton width="55%" height="1.75rem" />
                  <span className="ds-sr-only">Cargando…</span>
                </dd>
              ) : null}
              {summary.isError ? (
                <dd className="ds-kpi-state" role="alert">
                  No pudimos cargar este dato
                  {summary.error instanceof Error ? `: ${summary.error.message}` : "."}
                </dd>
              ) : null}
              {card ? (
                <>
                  <dd className="ds-kpi-value">
                    <AnimatedNumber
                      value={card.numericValue}
                      format={card.formatValue}
                      fallback={card.value}
                      animate={!arrivalDone}
                    />
                  </dd>
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
