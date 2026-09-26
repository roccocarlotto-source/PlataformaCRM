import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { ActionsMenu } from "../../design-system/ActionsMenu";
import { Badge } from "../../design-system/Badge";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Pagination } from "../../design-system/Pagination";
import { Select } from "../../design-system/Select";
import { SortOrderSelect } from "../../design-system/SortOrderSelect";
import { Table } from "../../design-system/Table";
import { actionLabel, triggerLabel } from "./catalog";
import { useDeleteAutomation } from "./mutations";
import { useAutomations } from "./queries";
import type { AutomationSortBy, SortOrder } from "./types";

const PAGE_SIZE = 20;

// SIN el gate `isAdmin` que usan CompanyListPage/ContactListPage, mismo
// criterio que KnowledgeBaseListPage y AgentListPage: la pantalla entera vive
// dentro de AdminRoute (ver app/router.tsx), así que un `isAdmin ?` sería una
// condición que nunca evalúa a false. GET /api/automations sí es de lectura
// abierta a cualquier autenticado, pero hoy no hay ninguna pantalla que le
// muestre reglas a un USER — quien las "lee" de verdad es el dispatcher, del
// lado del backend.
//
// SIN columna de configuración de la acción: su forma depende de la acción
// elegida (hoy subject + daysUntilDue, mañana otra cosa) y una columna que
// cambie de significado por fila no se lee. Para verla está el formulario.
//
// SIN filtro por evento aunque el backend lo soporte (`triggerType` en
// listQuerySchema): con un solo trigger en el catálogo, elegir la única opción
// no achica nada — es un filtro que no puede filtrar. El día que haya un
// segundo trigger es un <Select> más sobre TRIGGER_OPTIONS, que ya existe.
export function AutomationListPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [isActive, setIsActive] = useState<"" | "true" | "false">("");
  const [sortBy, setSortBy] = useState<AutomationSortBy>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const automationsQuery = useAutomations({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    isActive: isActive === "" ? undefined : isActive === "true",
    sortBy,
    sortOrder,
  });

  const deleteAutomationMutation = useDeleteAutomation();

  function handleDelete(id: string) {
    // window.confirm, igual que Knowledge Base, Agent, Branch y Source. El
    // borrado es lógico; lo que se dice acá es la consecuencia que no se ve en
    // la pantalla: la regla deja de ejecutarse desde el próximo evento.
    if (
      !window.confirm(
        "¿Eliminar esta automatización? Deja de ejecutarse de inmediato; lo que ya generó no se toca.",
      )
    ) {
      return;
    }
    deleteAutomationMutation.mutate(id);
  }

  return (
    <div>
      <div className="ds-page-header">
        <h1>Automatizaciones</h1>
        <Link to="/automations/new" className="ds-link-button">
          <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
          Nueva automatización
        </Link>
      </div>

      <div className="ds-list-card">
        <h2 className="ds-filters-title">Filtros</h2>
        <div className="ds-filters">
          <label>
            {/* Solo para lectores de pantalla: el placeholder ya dice qué
                busca (docs/frontend-cambios-pendientes.md §4.b). */}
            <span className="ds-sr-only">Buscar</span>
            <input
              type="search"
              placeholder="Buscar por nombre"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <Select
            label="Estado"
            value={isActive}
            options={[
              { value: "true", label: "Activas" },
              { value: "false", label: "Inactivas" },
            ]}
            emptyOption={{ label: "Todas" }}
            onChange={(value) => {
              setIsActive(value);
              setPage(1);
            }}
          />
          <Select
            label="Ordenar por"
            value={sortBy}
            options={[
              { value: "createdAt", label: "Fecha de creación" },
              { value: "name", label: "Nombre" },
            ]}
            onChange={(value) => {
              if (value) setSortBy(value);
            }}
          />
          <SortOrderSelect value={sortOrder} onChange={setSortOrder} />
        </div>

        {automationsQuery.isLoading ? <LoadingState variant="rows" /> : null}

        {automationsQuery.isError ? (
          <ErrorState>
            No pudimos cargar las automatizaciones
            {automationsQuery.error instanceof Error ? `: ${automationsQuery.error.message}` : "."}
          </ErrorState>
        ) : null}

        {deleteAutomationMutation.isError ? (
          <ErrorState>
            No pudimos eliminar la automatización
            {deleteAutomationMutation.error instanceof Error
              ? `: ${deleteAutomationMutation.error.message}`
              : "."}
          </ErrorState>
        ) : null}

        {automationsQuery.isSuccess && automationsQuery.data.data.length === 0 ? (
          <EmptyState>No hay automatizaciones para mostrar.</EmptyState>
        ) : null}

        {automationsQuery.isSuccess && automationsQuery.data.data.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Cuándo</th>
                <th>Qué hace</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {automationsQuery.data.data.map((automation) => (
                <tr key={automation.id}>
                  <td className="ds-cell-primary">{automation.name}</td>
                  {/* La etiqueta legible del catálogo, no el string técnico:
                      "Oportunidad ganada", no "opportunity.won". Un valor que
                      este catálogo todavía no conoce se muestra crudo — ver
                      triggerLabel/actionLabel. */}
                  <td>{triggerLabel(automation.triggerType)}</td>
                  <td>{actionLabel(automation.actionType)}</td>
                  <td>
                    {/* Estado real y editable: una regla inactiva existe, se
                        puede volver a activar, y mientras tanto el dispatcher
                        simplemente la saltea. */}
                    <Badge variant={automation.isActive ? "success" : "neutral"}>
                      {automation.isActive ? "Activa" : "Inactiva"}
                    </Badge>
                  </td>
                  <td>
                    <ActionsMenu
                      actions={[
                        { label: "Editar", to: `/automations/${automation.id}/edit` },
                        {
                          label: "Eliminar",
                          onClick: () => handleDelete(automation.id),
                          destructive: true,
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}

        {automationsQuery.isSuccess ? (
          <Pagination
            page={page}
            totalPages={automationsQuery.data.pagination.totalPages}
            onPrevious={() => setPage((current) => current - 1)}
            onNext={() => setPage((current) => current + 1)}
          />
        ) : null}
      </div>
    </div>
  );
}
