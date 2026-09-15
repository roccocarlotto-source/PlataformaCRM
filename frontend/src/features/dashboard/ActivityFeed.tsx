import { useAuth } from "../../auth/AuthContext";
import { Badge } from "../../design-system/Badge";
import { Card } from "../../design-system/Card";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { useActivities } from "../activity/queries";
import { resolveUserLabel, useOpportunityNames } from "../activity/relationResolution";
import { ACTIVITY_TYPE_LABELS } from "../activity/types";
import { useCompaniesByIds } from "../contact/companyResolution";
import { useContactNames, useOwnerNames } from "../opportunity/relationResolution";

const FEED_LIMIT = 8;

// "Activity" del mockup (§30 de docs/frontend-cambios-pendientes.md): las
// últimas 8 actividades creadas, con el MISMO alcance que ya aplica el
// backend (§25: un USER ve solo las suyas, un ADMIN todas) — acá no hay
// ningún filtro ni autorización nueva, es GET /activities ordenado por
// createdAt desc. Los nombres se resuelven con los mismos hooks que
// ActivityListPage (empresa, contacto, oportunidad y, solo para ADMIN, el
// autor vía GET /api/users) y la fecha con el mismo toLocaleString() de las
// demás columnas de fecha del proyecto: sin "hace 5 minutos" nuevo.
const FEED_QUERY = { sortBy: "createdAt", sortOrder: "desc", pageSize: FEED_LIMIT } as const;

export function ActivityFeed() {
  const { me } = useAuth();
  const isAdmin = me?.role === "ADMIN";

  const query = useActivities(FEED_QUERY);
  const rows = query.data?.data ?? [];

  const companyNames = useCompaniesByIds(
    rows.map((activity) => activity.companyId).filter((id): id is string => id !== null),
  );
  const contactNames = useContactNames(
    rows.map((activity) => activity.contactId).filter((id): id is string => id !== null),
  );
  const opportunityNames = useOpportunityNames(
    rows.map((activity) => activity.opportunityId).filter((id): id is string => id !== null),
  );
  const userNames = useOwnerNames(isAdmin);

  return (
    <Card aria-label="Actividad reciente" heading="Actividad reciente">
      {query.isLoading ? <LoadingState /> : null}

      {query.isError ? (
        <ErrorState>
          No pudimos cargar la actividad reciente
          {query.error instanceof Error ? `: ${query.error.message}` : "."}
        </ErrorState>
      ) : null}

      {query.isSuccess && rows.length === 0 ? (
        <EmptyState>Todavía no hay actividades.</EmptyState>
      ) : null}

      {query.isSuccess && rows.length > 0 ? (
        <ul className="ds-list">
          {rows.map((activity) => {
            // A quién/qué está relacionada: las relaciones que tenga, en el
            // mismo orden que las columnas de "Actividades".
            const related = [
              activity.companyId ? (companyNames.byId.get(activity.companyId)?.name ?? "—") : null,
              activity.contactId ? (contactNames.byId.get(activity.contactId) ?? "—") : null,
              activity.opportunityId
                ? (opportunityNames.byId.get(activity.opportunityId) ?? "—")
                : null,
            ].filter((name): name is string => name !== null);
            const author = resolveUserLabel(activity.authorId, {
              meId: me?.id,
              isAdmin,
              names: userNames.byId,
            });

            return (
              <li key={activity.id} className="ds-list-row">
                <span className="ds-list-main">
                  <span className="ds-cell-inline">
                    <Badge variant="neutral">{ACTIVITY_TYPE_LABELS[activity.type]}</Badge>
                    <span className="ds-list-primary">{activity.subject}</span>
                  </span>
                  <span className="ds-list-secondary">
                    {related.join(" · ")}
                    {related.length > 0 && author ? " · " : ""}
                    {author ? `por ${author}` : ""}
                  </span>
                </span>
                <span className="ds-list-trailing ds-list-secondary">
                  {new Date(activity.createdAt).toLocaleString()}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}
