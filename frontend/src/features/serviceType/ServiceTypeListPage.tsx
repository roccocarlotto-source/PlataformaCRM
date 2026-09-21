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
import { ResourceSelect } from "../resource/ResourceSelect";
import { RESOURCES_PARA_SELECT, useResources } from "../resource/queries";
import { formatDuracion } from "./format";
import { useDeleteServiceType } from "./mutations";
import { useServiceTypes } from "./queries";
import type { ServiceTypeSortBy, SortOrder } from "./types";

const PAGE_SIZE = 20;

const SIN_RESOLVER = "—";

// Tipos de servicio de la Agenda (ítem 75): qué se reserva, cuánto dura y
// contra qué recurso. Sin gate `isAdmin`, mismo criterio que ResourceListPage:
// la pantalla vive entera dentro de AdminRoute.
export function ServiceTypeListPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  const [resourceId, setResourceId] = useState<string | undefined>(undefined);
  const [sortBy, setSortBy] = useState<ServiceTypeSortBy>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const serviceTypesQuery = useServiceTypes({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    branchId,
    resourceId,
    sortBy,
    sortOrder,
  });

  // Las mismas queries que BranchSelect y ResourceSelect (mismo key): alimentan
  // los filtros y la resolución de nombres de las filas con una request cada una.
  const branchesQuery = useBranches(BRANCHES_PARA_SELECT);
  const nombreDeSucursal = new Map(
    (branchesQuery.data?.data ?? []).map((branch) => [branch.id, branch.name]),
  );
  const resourcesQuery = useResources(RESOURCES_PARA_SELECT);
  const nombreDeRecurso = new Map(
    (resourcesQuery.data?.data ?? []).map((resource) => [resource.id, resource.name]),
  );

  const deleteServiceTypeMutation = useDeleteServiceType();

  function aplicarFiltro(cambio: () => void) {
    cambio();
    setPage(1);
  }

  function handleDelete(id: string) {
    // El RESTRICT (reservas activas de este servicio) llega como error del
    // backend y se muestra tal cual.
    if (!window.confirm("¿Eliminar este tipo de servicio?")) return;
    deleteServiceTypeMutation.mutate(id);
  }

  const serviceTypes = serviceTypesQuery.data?.data ?? [];

  return (
    <div>
      <div className="ds-page-header">
        <h1>Tipos de servicio</h1>
        <Link to="/service-types/new" className="ds-link-button">
          <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
          Nuevo tipo de servicio
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
            id="service-type-list-branch"
            label="Sucursal"
            value={branchId}
            emptyOptionLabel="Todas"
            onChange={(nuevo) =>
              aplicarFiltro(() => {
                setBranchId(nuevo || undefined);
                // El recurso elegido puede no ser de la sucursal nueva: se
                // limpia en vez de dejar un filtro que ya no se ve en el select.
                setResourceId(undefined);
              })
            }
          />
          <ResourceSelect
            id="service-type-list-resource"
            label="Recurso"
            value={resourceId}
            branchId={branchId}
            emptyOptionLabel="Todos"
            onChange={(nuevo) => aplicarFiltro(() => setResourceId(nuevo || undefined))}
          />
          <Select
            label="Ordenar por"
            value={sortBy}
            options={[
              { value: "createdAt", label: "Fecha de creación" },
              { value: "name", label: "Nombre" },
              { value: "durationMin", label: "Duración" },
            ]}
            onChange={(value) => {
              if (value) setSortBy(value);
            }}
          />
          <SortOrderSelect value={sortOrder} onChange={setSortOrder} />
        </div>

        {serviceTypesQuery.isLoading ? <LoadingState /> : null}

        {serviceTypesQuery.isError ? (
          <ErrorState>
            No pudimos cargar los tipos de servicio
            {serviceTypesQuery.error instanceof Error
              ? `: ${serviceTypesQuery.error.message}`
              : "."}
          </ErrorState>
        ) : null}

        {deleteServiceTypeMutation.isError ? (
          <ErrorState>
            No pudimos eliminar el tipo de servicio
            {deleteServiceTypeMutation.error instanceof Error
              ? `: ${deleteServiceTypeMutation.error.message}`
              : "."}
          </ErrorState>
        ) : null}

        {serviceTypesQuery.isSuccess && serviceTypes.length === 0 ? (
          <EmptyState>No hay tipos de servicio para mostrar.</EmptyState>
        ) : null}

        {serviceTypesQuery.isSuccess && serviceTypes.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Recurso</th>
                <th>Sucursal</th>
                <th>Duración</th>
                <th>Cupo</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {serviceTypes.map((serviceType) => (
                <tr key={serviceType.id}>
                  <td className="ds-cell-primary">{serviceType.name}</td>
                  <td>{nombreDeRecurso.get(serviceType.resourceId) ?? SIN_RESOLVER}</td>
                  <td>{nombreDeSucursal.get(serviceType.branchId) ?? SIN_RESOLVER}</td>
                  <td>{formatDuracion(serviceType.durationMin)}</td>
                  <td>{serviceType.capacity}</td>
                  <td>
                    <ActionsMenu
                      actions={[
                        { label: "Editar", to: `/service-types/${serviceType.id}/edit` },
                        {
                          label: "Eliminar",
                          onClick: () => handleDelete(serviceType.id),
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

        {serviceTypesQuery.isSuccess ? (
          <Pagination
            page={page}
            totalPages={serviceTypesQuery.data.pagination.totalPages}
            onPrevious={() => setPage((current) => current - 1)}
            onNext={() => setPage((current) => current + 1)}
          />
        ) : null}
      </div>
    </div>
  );
}
