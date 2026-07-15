import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listOpportunities } from "../opportunity/api";
import { opportunityKeys, useOpportunity } from "../opportunity/queries";
import type { Opportunity } from "../opportunity/types";

interface OpportunitySelectProps {
  id?: string;
  label: string;
  value: string | undefined;
  onChange: (opportunityId: string) => void;
}

const SEARCH_DEBOUNCE_MS = 300;

// amount siempre llega como string (Prisma.Decimal, ver opportunity/types.ts)
// — Number() antes de formatear, nunca .toFixed() directo sobre el string
// crudo. Mismo cuidado que OpportunityListPage.
function formatOpportunityLabel(opportunity: Opportunity): string {
  return `${opportunity.title} — ${opportunity.status} — ${Number(opportunity.amount).toFixed(2)} ${opportunity.currency}`;
}

// Selector de Opportunity para Activity — búsqueda server-side por título
// (GET /api/opportunities?search=..., cubre `title` vía contains, ver
// opportunity.repository.ts). Mismo patrón que CompanySelect/ContactSelect:
// nunca precarga un listado por default, solo busca cuando hay término
// (enabled: debouncedTerm.length > 0).
//
// Deliberadamente SIN resolver Company por resultado: cada opción usa
// título + status + monto/moneda, datos que YA vienen en el propio
// resultado de GET /api/opportunities — resolver Company agregaría un
// fetch por fila (N+1) para un selector de búsqueda, sin evidencia de que
// haga falta para elegir correctamente.
export function OpportunitySelect({ id, label, value, onChange }: OpportunitySelectProps) {
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedTerm(term), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [term]);

  // useQuery directo en vez de useOpportunities (opportunity/queries.ts):
  // ese hook no acepta `enabled` — Opportunity nunca tuvo antes un selector
  // de búsqueda propio que lo necesitara. No se modifica opportunity/
  // queries.ts para esto (fuera del alcance de M6, ver informe de diseño);
  // se arma la query acá con la misma queryKey factory (opportunityKeys.list)
  // para que el cache siga siendo compatible con el resto de la app.
  const listQuery = {
    search: debouncedTerm || undefined,
    pageSize: 20,
    sortBy: "title" as const,
    sortOrder: "asc" as const,
  };
  const searchQuery = useQuery({
    queryKey: opportunityKeys.list(listQuery),
    queryFn: ({ signal }) => listOpportunities(listQuery, signal),
    enabled: debouncedTerm.length > 0,
  });

  // Siembra opportunityKeys.detail(id) con los resultados de la búsqueda —
  // mismo criterio que CompanySelect/ContactSelect: si esa misma
  // Opportunity hace falta resolver después (ej. useOpportunityNames en
  // ActivityListPage), useQuery la encuentra fresca sin repetir el fetch.
  useEffect(() => {
    if (!searchQuery.data) return;
    for (const opportunity of searchQuery.data.data) {
      queryClient.setQueryData(opportunityKeys.detail(opportunity.id), opportunity);
    }
  }, [searchQuery.data, queryClient]);

  // Resuelve el valor ya seleccionado aunque no esté entre los resultados
  // de búsqueda actuales — un único GET /api/opportunities/:id puntual
  // (mismo mecanismo que selectedCompanyQuery/selectedContactQuery), nunca
  // se precarga el catálogo completo para lograr esto.
  const selectedOpportunityQuery = useOpportunity(value);

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {value ? (
        <p>
          Seleccionada:{" "}
          {selectedOpportunityQuery.data
            ? formatOpportunityLabel(selectedOpportunityQuery.data)
            : selectedOpportunityQuery.isLoading
              ? "Cargando…"
              : "No pudimos cargar la oportunidad seleccionada."}
        </p>
      ) : null}
      <input
        id={id}
        type="text"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Buscar oportunidad por título…"
      />
      {debouncedTerm ? (
        <ul>
          {searchQuery.isLoading ? <li>Buscando…</li> : null}
          {searchQuery.isError ? <li role="alert">No pudimos buscar oportunidades.</li> : null}
          {searchQuery.isSuccess && searchQuery.data.data.length === 0 ? (
            <li>Sin resultados.</li>
          ) : null}
          {searchQuery.isSuccess
            ? searchQuery.data.data.map((opportunity) => (
                <li key={opportunity.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(opportunity.id);
                      setTerm("");
                    }}
                  >
                    {formatOpportunityLabel(opportunity)}
                  </button>
                </li>
              ))
            : null}
        </ul>
      ) : null}
    </div>
  );
}
