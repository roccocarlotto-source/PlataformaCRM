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
import { BranchSelect } from "../branch/BranchSelect";
import { BRANCHES_PARA_SELECT, useBranches } from "../branch/queries";
import { CHANNEL_LABEL, modelProviderLabel } from "./labels";
import { useDeleteAgent } from "./mutations";
import { useAgents } from "./queries";
import type { AgentSortBy, SortOrder } from "./types";

const PAGE_SIZE = 20;

// Lo que se muestra cuando una sucursal no se pudo resolver (fuera de las
// primeras 100, o un fallo puntual de esa request) — mismo criterio que
// QrListPage y ApiKeyListPage.
const SIN_RESOLVER = "—";

// SIN el gate `isAdmin` que usan CompanyListPage/ContactListPage, mismo
// criterio que BranchListPage y SourceListPage: la pantalla entera vive dentro
// de AdminRoute (ver app/router.tsx), así que un `isAdmin ?` sería una
// condición que nunca evalúa a false. GET /api/agents sí es de lectura abierta
// a cualquier autenticado, pero hoy no hay ninguna pantalla que le muestre
// agentes a un USER — acá no hay nada para él más que botones que el backend
// rechazaría.
export function AgentListPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  const [isActive, setIsActive] = useState<"" | "true" | "false">("");
  const [sortBy, setSortBy] = useState<AgentSortBy>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const agentsQuery = useAgents({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    branchId,
    isActive: isActive === "" ? undefined : isActive === "true",
    sortBy,
    sortOrder,
  });

  // Exactamente la misma query que BranchSelect (mismo key): una sola request
  // alimenta el filtro y la resolución de nombres de las filas, igual que en
  // QrListPage.
  const branchesQuery = useBranches(BRANCHES_PARA_SELECT);
  const nombreDeSucursal = new Map(
    (branchesQuery.data?.data ?? []).map((branch) => [branch.id, branch.name]),
  );

  const deleteAgentMutation = useDeleteAgent();

  function handleDelete(id: string) {
    // window.confirm, igual que Branch/Source/Pipeline. El borrado es lógico y
    // además revoca los tokens de embed del agente (agent.service.ts): se dice
    // acá porque es la parte que no se puede deshacer desde la pantalla.
    if (
      !window.confirm(
        "¿Eliminar este agente? Deja de responder de inmediato y sus tokens de embed quedan revocados.",
      )
    ) {
      return;
    }
    deleteAgentMutation.mutate(id);
  }

  return (
    <div>
      <div className="ds-page-header">
        <h1>Agentes de IA</h1>
        <Link to="/agents/new" className="ds-link-button">
          <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
          Nuevo agente
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
          <BranchSelect
            id="agent-list-branch"
            label="Sucursal"
            value={branchId}
            emptyOptionLabel="Todas"
            onChange={(nuevo) => {
              setBranchId(nuevo || undefined);
              setPage(1);
            }}
          />
          <Select
            label="Estado"
            value={isActive}
            options={[
              { value: "true", label: "Activos" },
              { value: "false", label: "Inactivos" },
            ]}
            emptyOption={{ label: "Todos" }}
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

        {agentsQuery.isLoading ? <LoadingState /> : null}

        {agentsQuery.isError ? (
          <ErrorState>
            No pudimos cargar los agentes
            {agentsQuery.error instanceof Error ? `: ${agentsQuery.error.message}` : "."}
          </ErrorState>
        ) : null}

        {deleteAgentMutation.isError ? (
          <ErrorState>
            No pudimos eliminar el agente
            {deleteAgentMutation.error instanceof Error
              ? `: ${deleteAgentMutation.error.message}`
              : "."}
          </ErrorState>
        ) : null}

        {agentsQuery.isSuccess && agentsQuery.data.data.length === 0 ? (
          <EmptyState>No hay agentes para mostrar.</EmptyState>
        ) : null}

        {agentsQuery.isSuccess && agentsQuery.data.data.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Sucursal</th>
                <th>Estado</th>
                <th>Canales</th>
                <th>Modelo</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {agentsQuery.data.data.map((agent) => (
                <tr key={agent.id}>
                  <td className="ds-cell-primary">{agent.name}</td>
                  <td>{nombreDeSucursal.get(agent.branchId) ?? SIN_RESOLVER}</td>
                  <td>
                    {/* Este SÍ es un estado real y editable (Agent.isActive),
                        a diferencia del badge fijo que el §53 sacó del módulo
                        QR: un agente inactivo no atiende ninguna conversación. */}
                    <Badge variant={agent.isActive ? "success" : "neutral"}>
                      {agent.isActive ? "Activo" : "Inactivo"}
                    </Badge>
                  </td>
                  {/* Texto y no badges: son hasta dos valores por fila y una
                      fila de pills al lado de la del Estado competiría con
                      ella por la atención. Sin canales el agente no atiende
                      por ningún lado — el guion lo dice sin inventar un
                      estado. */}
                  <td className="ds-cell-muted">
                    {agent.channels.length > 0
                      ? agent.channels.map((channel) => CHANNEL_LABEL[channel]).join(" · ")
                      : SIN_RESOLVER}
                  </td>
                  <td className="ds-cell-muted">
                    {modelProviderLabel(agent.modelProvider)} · {agent.modelName}
                  </td>
                  <td>
                    <ActionsMenu
                      actions={[
                        { label: "Editar", to: `/agents/${agent.id}/edit` },
                        {
                          // El widget del canal Web se instala por agente:
                          // dominios permitidos, tokens de embed y el
                          // <script> para pegar (ítem 63). Está acá y no en
                          // AgentFormPage porque solo existe para un agente
                          // YA guardado — un token cuelga de su id.
                          label: "Instalar en un sitio",
                          to: `/agents/${agent.id}/embed`,
                        },
                        {
                          // El probador (ítem 65): mandarle mensajes a mano
                          // al agente como si fueran del contacto. También
                          // por agente y también solo para uno ya guardado —
                          // y, como la pantalla avisa bien fuerte, NO es un
                          // sandbox: el turno se ejecuta de verdad.
                          label: "Probar agente",
                          to: `/agents/${agent.id}/playground`,
                        },
                        {
                          label: "Eliminar",
                          onClick: () => handleDelete(agent.id),
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

        {agentsQuery.isSuccess ? (
          <Pagination
            page={page}
            totalPages={agentsQuery.data.pagination.totalPages}
            onPrevious={() => setPage((current) => current - 1)}
            onNext={() => setPage((current) => current + 1)}
          />
        ) : null}
      </div>
    </div>
  );
}
