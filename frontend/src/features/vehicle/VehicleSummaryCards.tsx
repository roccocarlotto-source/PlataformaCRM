import { AnimatedNumber } from "../../design-system/AnimatedNumber";
import { Card } from "../../design-system/Card";
import { useVehicleSummary } from "./queries";

const CARDS: Array<{ key: "inStock" | "available"; label: string }> = [
  { key: "inStock", label: "Unidades en stock" },
  { key: "available", label: "Disponibles" },
];

// Conteos enteros; Math.round porque los frames intermedios del conteo (§37)
// son fraccionarios.
const formatCount = (n: number) => String(Math.round(n));

// Calco del resumen comercial de M8 (hoy dashboard/OpportunityKpiCards.tsx,
// que ya tiene montos): solo conteos exactos
// (pagination.total con pageSize=1), sin "valor de stock" ni "días promedio
// en stock" — ver useVehicleSummary en queries.ts por qué esas dos quedan
// afuera. Un <dl>: cada tarjeta es un par término/valor; loading y error
// independientes por tarjeta.
//
// En el Dashboard el número cuenta desde 0 al llegar (§37), igual que las KPI
// comerciales. Es opt-in (`countUp`) porque este componente también encabeza
// el listado de stock (VehicleListPage), y el pedido fue para el Dashboard. Acá
// alcanza con la regla propia de AnimatedNumber (solo la primera llegada de
// cada instancia): estas cards no siguen al selector de período, así que el
// número no se desmonta después de la primera carga — un refetch de fondo
// mantiene el dato y no pasa por isLoading. Tampoco sirve un flag único para
// las dos, como en OpportunityKpiCards: son dos requests independientes, y el
// primero en llegar apagaría la animación del segundo.
export function VehicleSummaryCards({ countUp = false }: { countUp?: boolean }) {
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
                <dd className="ds-kpi-value">
                  <AnimatedNumber
                    value={card.total}
                    format={formatCount}
                    fallback=""
                    animate={countUp}
                  />
                </dd>
              ) : null}
            </Card>
          );
        })}
      </dl>
    </section>
  );
}
