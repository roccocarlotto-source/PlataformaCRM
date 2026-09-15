import { Badge } from "../../design-system/Badge";
import { Card } from "../../design-system/Card";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Table } from "../../design-system/Table";
import { formatAmount } from "../opportunity/format";
import { STATUS_BADGE_VARIANT, STATUS_LABEL } from "../opportunity/labels";
import { useOpportunities } from "../opportunity/queries";
import { useCompanyNames } from "../opportunity/relationResolution";

const RECENT_LIMIT = 5;

// "Recent deals" del mockup (§30 de docs/frontend-cambios-pendientes.md): las
// últimas 5 oportunidades creadas en la organización, de cualquier dueño y
// estado. Sin "Deal ID": Opportunity no tiene ningún código legible (a
// diferencia de Vehicle.internalCode), así que la primera columna es el
// título, que es un dato real. La columna de estado usa la misma paleta y el
// mismo texto que el listado de oportunidades (labels.ts).
//
// Sin link a /opportunities/:id/edit, por lo mismo que las secciones de M8:
// esa ruta es ADMIN-only y esta tarjeta la ve cualquier rol.
const RECENT_QUERY = {
  sortBy: "createdAt",
  sortOrder: "desc",
  pageSize: RECENT_LIMIT,
} as const;

export function RecentDealsTable() {
  const query = useOpportunities(RECENT_QUERY);
  const rows = query.data?.data ?? [];

  const companyIds = rows
    .map((opportunity) => opportunity.companyId)
    .filter((id): id is string => id !== null);
  const companyNames = useCompanyNames(companyIds);

  return (
    <Card aria-label="Oportunidades recientes" heading="Oportunidades recientes">
      {query.isLoading ? <LoadingState /> : null}

      {query.isError ? (
        <ErrorState>
          No pudimos cargar las oportunidades recientes
          {query.error instanceof Error ? `: ${query.error.message}` : "."}
        </ErrorState>
      ) : null}

      {query.isSuccess && rows.length === 0 ? (
        <EmptyState>Todavía no hay oportunidades.</EmptyState>
      ) : null}

      {query.isSuccess && rows.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <th>Título</th>
              <th>Empresa</th>
              <th>Monto</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((opportunity) => (
              <tr key={opportunity.id}>
                <td>{opportunity.title}</td>
                <td>
                  {opportunity.companyId
                    ? (companyNames.byId.get(opportunity.companyId)?.name ?? "—")
                    : "—"}
                </td>
                <td>{formatAmount(opportunity.amount, opportunity.currency)}</td>
                <td>
                  <Badge variant={STATUS_BADGE_VARIANT[opportunity.status]}>
                    {STATUS_LABEL[opportunity.status]}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
    </Card>
  );
}
