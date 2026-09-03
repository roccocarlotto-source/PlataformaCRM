import { Card } from "../../design-system/Card";
import { useOpportunitySummary } from "./queries";

const CARDS: Array<{ key: "open" | "won" | "lost"; label: string }> = [
  { key: "open", label: "Oportunidades abiertas" },
  { key: "won", label: "Oportunidades ganadas" },
  { key: "lost", label: "Oportunidades perdidas" },
];

// Solo conteos exactos (pagination.total) — sin amount, sin win rate, sin
// forecasting: ver informe de diseño de M8, ninguna de esas es category A
// con el contrato actual del backend. Por lo mismo, sin variación porcentual
// ni comparación con el período anterior como en el mockup: no hay dato real
// que la respalde, así que no se muestra.
//
// Tres tarjetas KPI en fila (rótulo arriba, número grande abajo). Sigue
// siendo un <dl>: cada tarjeta es un par término/valor. Loading y error
// siguen siendo independientes por tarjeta.
export function OpportunitySummaryCards() {
  const summary = useOpportunitySummary();

  return (
    <section aria-label="Resumen comercial">
      <dl className="ds-card-grid">
        {CARDS.map(({ key, label }) => {
          const card = summary[key];
          return (
            <Card as="div" key={key} className="ds-kpi">
              <dt className="ds-kpi-label">{label}</dt>
              {card.isLoading ? <dd className="ds-kpi-state">Cargando…</dd> : null}
              {card.isError ? (
                <dd className="ds-kpi-state" role="alert">
                  No pudimos cargar este dato{card.error ? `: ${card.error.message}` : "."}
                </dd>
              ) : null}
              {!card.isLoading && !card.isError ? (
                <dd className="ds-kpi-value">{card.total}</dd>
              ) : null}
            </Card>
          );
        })}
      </dl>
    </section>
  );
}
