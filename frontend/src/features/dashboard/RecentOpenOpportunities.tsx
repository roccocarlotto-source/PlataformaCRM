import { useAuth } from "../../auth/AuthContext";
import { useCompanyNames } from "../opportunity/relationResolution";
import { useMyRecentOpenOpportunities } from "./queries";

// amount siempre llega como string desde la API (Prisma.Decimal) — mismo
// criterio que OpportunityListPage.tsx.
function formatAmount(amount: string, currency: string): string {
  return `${Number(amount).toFixed(2)} ${currency}`;
}

// Sin link a /opportunities/:id/edit a propósito: esa ruta vive bajo
// AdminRoute (solo ADMIN puede abrirla) y esta sección se muestra a
// cualquier rol — un link roto/redirigido para USER sería la misma clase de
// error que ya se evitó en Quick Actions.
export function RecentOpenOpportunities() {
  const { me } = useAuth();
  const query = useMyRecentOpenOpportunities(me?.id);
  const rows = query.data?.data ?? [];

  const companyIds = rows
    .map((opportunity) => opportunity.companyId)
    .filter((id): id is string => id !== null);
  const companyNames = useCompanyNames(companyIds);

  return (
    <section aria-label="Mis oportunidades abiertas recientes">
      <h2>Mis oportunidades abiertas recientes</h2>

      {query.isLoading ? <p>Cargando…</p> : null}

      {query.isError ? (
        <p role="alert">
          No pudimos cargar tus oportunidades recientes
          {query.error instanceof Error ? `: ${query.error.message}` : "."}
        </p>
      ) : null}

      {query.isSuccess && rows.length === 0 ? (
        <p>No tenés oportunidades abiertas propias.</p>
      ) : null}

      {query.isSuccess && rows.length > 0 ? (
        <ul>
          {rows.map((opportunity) => (
            <li key={opportunity.id}>
              <span>{opportunity.title}</span>
              <span>
                {opportunity.companyId
                  ? (companyNames.byId.get(opportunity.companyId)?.name ?? "—")
                  : "—"}
              </span>
              <span>{formatAmount(opportunity.amount, opportunity.currency)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
