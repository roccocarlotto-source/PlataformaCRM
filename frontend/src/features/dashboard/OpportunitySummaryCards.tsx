import { useOpportunitySummary } from "./queries";

const CARDS: Array<{ key: "open" | "won" | "lost"; label: string }> = [
  { key: "open", label: "Oportunidades abiertas" },
  { key: "won", label: "Oportunidades ganadas" },
  { key: "lost", label: "Oportunidades perdidas" },
];

// Solo conteos exactos (pagination.total) — sin amount, sin win rate, sin
// forecasting: ver informe de diseño de M8, ninguna de esas es category A
// con el contrato actual del backend.
export function OpportunitySummaryCards() {
  const summary = useOpportunitySummary();

  return (
    <section aria-label="Resumen comercial">
      <h2>Resumen</h2>
      <dl>
        {CARDS.map(({ key, label }) => {
          const card = summary[key];
          return (
            <div key={key}>
              <dt>{label}</dt>
              <dd>
                {card.isLoading ? "Cargando…" : null}
                {card.isError ? (
                  <span role="alert">
                    No pudimos cargar este dato{card.error ? `: ${card.error.message}` : "."}
                  </span>
                ) : null}
                {!card.isLoading && !card.isError ? card.total : null}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
