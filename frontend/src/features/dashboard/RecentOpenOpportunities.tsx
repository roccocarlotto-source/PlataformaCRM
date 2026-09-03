import { useAuth } from "../../auth/AuthContext";
import { Card } from "../../design-system/Card";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
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
//
// Filas dentro de la tarjeta: título + empresa a la izquierda, monto a la
// derecha. Sin avatar ni ícono: una oportunidad no es una persona.
export function RecentOpenOpportunities() {
  const { me } = useAuth();
  const query = useMyRecentOpenOpportunities(me?.id);
  const rows = query.data?.data ?? [];

  const companyIds = rows
    .map((opportunity) => opportunity.companyId)
    .filter((id): id is string => id !== null);
  const companyNames = useCompanyNames(companyIds);

  return (
    <Card
      aria-label="Mis oportunidades abiertas recientes"
      heading="Mis oportunidades abiertas recientes"
    >
      {query.isLoading ? <LoadingState /> : null}

      {query.isError ? (
        <ErrorState>
          No pudimos cargar tus oportunidades recientes
          {query.error instanceof Error ? `: ${query.error.message}` : "."}
        </ErrorState>
      ) : null}

      {query.isSuccess && rows.length === 0 ? (
        <EmptyState>No tenés oportunidades abiertas propias.</EmptyState>
      ) : null}

      {query.isSuccess && rows.length > 0 ? (
        <ul className="ds-list">
          {rows.map((opportunity) => (
            <li key={opportunity.id} className="ds-list-row">
              <span className="ds-list-main">
                <span className="ds-list-primary">{opportunity.title}</span>
                <span className="ds-list-secondary">
                  {opportunity.companyId
                    ? (companyNames.byId.get(opportunity.companyId)?.name ?? "—")
                    : "—"}
                </span>
              </span>
              <span className="ds-list-trailing">
                {formatAmount(opportunity.amount, opportunity.currency)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
