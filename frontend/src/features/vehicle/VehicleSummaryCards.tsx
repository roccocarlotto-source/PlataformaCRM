import { Card } from "../../design-system/Card";
import { useVehicleSummary } from "./queries";

const CARDS: Array<{ key: "inStock" | "available"; label: string }> = [
  { key: "inStock", label: "Unidades en stock" },
  { key: "available", label: "Disponibles" },
];

// Calco de dashboard/OpportunitySummaryCards.tsx: solo conteos exactos
// (pagination.total con pageSize=1), sin "valor de stock" ni "días promedio
// en stock" — ver useVehicleSummary en queries.ts por qué esas dos quedan
// afuera. Un <dl>: cada tarjeta es un par término/valor; loading y error
// independientes por tarjeta.
export function VehicleSummaryCards() {
  const summary = useVehicleSummary();

  return (
    <section aria-label="Resumen de stock">
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
