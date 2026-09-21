import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { ActionsMenu } from "../../design-system/ActionsMenu";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Pagination } from "../../design-system/Pagination";
import { Select } from "../../design-system/Select";
import { SortOrderSelect } from "../../design-system/SortOrderSelect";
import { Table } from "../../design-system/Table";
import { BranchSelect } from "../branch/BranchSelect";
import { BRANCHES_PARA_SELECT, useBranches } from "../branch/queries";
import { RESOURCE_TYPE_LABEL, RESOURCE_TYPE_OPTIONS } from "./labels";
import { useDeleteResource } from "./mutations";
import { useResources } from "./queries";
import type { ResourceSortBy, ResourceType, SortOrder } from "./types";

const PAGE_SIZE = 20;

// Lo que se muestra cuando una sucursal no se pudo resolver — mismo criterio
// que KnowledgeBaseListPage.
const SIN_RESOLVER = "—";

// Recursos de la Agenda (ítem 75): las personas, salas o clases que se
// reservan. SIN el gate `isAdmin`, mismo criterio que KnowledgeBaseListPage y
// BranchListPage: la pantalla entera vive dentro de AdminRoute (ver
// app/router.tsx), así que un `isAdmin ?` sería una condición que nunca evalúa
// a false. GET /api/resources sí es de lectura abierta, y un USER lo consume
// donde lo necesita: el filtro del listado de Reservas.
export function ResourceListPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  const [type, setType] = useState<ResourceType | "">("");
  const [sortBy, setSortBy] = useState<ResourceSortBy>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const resourcesQuery = useResources({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    branchId,
    type: type || undefined,
    sortBy,
    sortOrder,
  });

  // Exactamente la misma query que BranchSelect (mismo key): una sola request
  // alimenta el filtro y la resolución de nombres de las filas.
  const branchesQuery = useBranches(BRANCHES_PARA_SELECT);
  const nombreDeSucursal = new Map(
    (branchesQuery.data?.data ?? []).map((branch) => [branch.id, branch.name]),
  );

  const deleteResourceMutation = useDeleteResource();

  function aplicarFiltro(cambio: () => void) {
    cambio();
    setPage(1);
  }

  function handleDelete(id: string) {
    // window.confirm, igual que Branch/Knowledge Base. El RESTRICT (tipos de
    // servicio activos que usan el recurso) llega como error del backend y se
    // muestra tal cual.
    if (!window.confirm("¿Eliminar este recurso?")) return;
    deleteResourceMutation.mutate(id);
  }

  const resources = resourcesQuery.data?.data ?? [];

  return (
    <div>
      <div className="ds-page-header">
        <h1>Recursos</h1>
        <Link to="/resources/new" className="ds-link-button">
          <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
          Nuevo recurso
        </Link>
      </div>

      <div className="ds-list-card">
        <h2 className="ds-filters-title">Filtros</h2>
        <div className="ds-filters">
          <label>
            <span className="ds-sr-only">Buscar</span>
            <input
              type="search"
              placeholder="Buscar por nombre"
              value={search}
              onChange={(event) => aplicarFiltro(() => setSearch(event.target.value))}
            />
          </label>
          <BranchSelect
            id="resource-list-branch"
            label="Sucursal"
            value={branchId}
            emptyOptionLabel="Todas"
            onChange={(nuevo) => aplicarFiltro(() => setBranchId(nuevo || undefined))}
          />
          <Select
            label="Tipo"
            value={type}
            options={RESOURCE_TYPE_OPTIONS}
            emptyOption={{ label: "Todos" }}
            onChange={(value) => aplicarFiltro(() => setType(value))}
          />
          <Select
            label="Ordenar por"
            value={sortBy}
            options={[
              { value: "createdAt", label: "Fecha de creación" },
              { value: "name", label: "Nombre" },
              { value: "type", label: "Tipo" },
            ]}
            onChange={(value) => {
              if (value) setSortBy(value);
            }}
          />
          <SortOrderSelect value={sortOrder} onChange={setSortOrder} />
        </div>

        {resourcesQuery.isLoading ? <LoadingState /> : null}

        {resourcesQuery.isError ? (
          <ErrorState>
            No pudimos cargar los recursos
            {resourcesQuery.error instanceof Error ? `: ${resourcesQuery.error.message}` : "."}
          </ErrorState>
        ) : null}

        {deleteResourceMutation.isError ? (
          <ErrorState>
            No pudimos eliminar el recurso
            {deleteResourceMutation.error instanceof Error
              ? `: ${deleteResourceMutation.error.message}`
              : "."}
          </ErrorState>
        ) : null}

        {resourcesQuery.isSuccess && resources.length === 0 ? (
          <EmptyState>No hay recursos para mostrar.</EmptyState>
        ) : null}

        {resourcesQuery.isSuccess && resources.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Sucursal</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {resources.map((resource) => (
                <tr key={resource.id}>
                  <td className="ds-cell-primary">{resource.name}</td>
                  <td>{RESOURCE_TYPE_LABEL[resource.type]}</td>
                  <td>{nombreDeSucursal.get(resource.branchId) ?? SIN_RESOLVER}</td>
                  <td>
                    <ActionsMenu
                      actions={[
                        { label: "Editar", to: `/resources/${resource.id}/edit` },
                        {
                          label: "Eliminar",
                          onClick: () => handleDelete(resource.id),
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

        {resourcesQuery.isSuccess ? (
          <Pagination
            page={page}
            totalPages={resourcesQuery.data.pagination.totalPages}
            onPrevious={() => setPage((current) => current - 1)}
            onNext={() => setPage((current) => current + 1)}
          />
        ) : null}
      </div>
    </div>
  );
}
