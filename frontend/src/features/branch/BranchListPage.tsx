import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { ActionsMenu } from "../../design-system/ActionsMenu";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Pagination } from "../../design-system/Pagination";
import { Select } from "../../design-system/Select";
import { SortOrderSelect } from "../../design-system/SortOrderSelect";
import { Table } from "../../design-system/Table";
import { useDeleteBranch } from "./mutations";
import { useBranches } from "./queries";
import type { BranchSortBy, SortOrder } from "./types";

const PAGE_SIZE = 20;

// SIN el gate `isAdmin` que usan CompanyListPage/ContactListPage, mismo
// criterio que SourceListPage: toda la escritura de /api/branches es
// ADMIN-only (branch.routes.ts) y esta pantalla vive dentro de AdminRoute — un
// USER no llega nunca, así que un `isAdmin ?` sería una condición que jamás
// evalúa a false. GET /api/branches sí es de lectura abierta, pero un USER ya
// ve las sucursales donde las necesita (BranchSelect en QR y Vehículo); acá no
// hay nada para él más que botones que el backend rechazaría.
export function BranchListPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<BranchSortBy>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const branchesQuery = useBranches({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    sortBy,
    sortOrder,
  });

  const deleteBranchMutation = useDeleteBranch();

  // Ítem 75 — el callback de Google Calendar vuelve ACÁ, y no al formulario de
  // la sucursal, cuando no pudo saber de qué sucursal se trataba (un state
  // vencido o manipulado: la sucursal solo se toma de un state con firma
  // válida). El mensaje se muestra tal cual lo armó el backend.
  const [searchParams] = useSearchParams();
  const calendarError = searchParams.get("calendarError");

  function handleDelete(id: string) {
    // window.confirm, igual que Source/Pipeline. El RESTRICT (recursos,
    // servicios, QRs activos o Google Calendar conectado) NO se anticipa acá:
    // lo decide el backend y su 400 trae el mensaje a mostrar, ver abajo.
    if (!window.confirm("¿Eliminar esta sucursal?")) {
      return;
    }
    deleteBranchMutation.mutate(id);
  }

  return (
    <div>
      <div className="ds-page-header">
        <h1>Sucursales</h1>
        <Link to="/branches/new" className="ds-link-button">
          <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
          Nueva sucursal
        </Link>
      </div>

      {calendarError ? (
        <ErrorState>No se pudo conectar Google Calendar: {calendarError}</ErrorState>
      ) : null}

      <div className="ds-list-card">
        <h2 className="ds-filters-title">Filtros</h2>
        <div className="ds-filters">
          <label>
            {/* Solo para lectores de pantalla: el placeholder ya dice "Buscar…" y el
                rótulo visible lo repetía (docs/frontend-cambios-pendientes.md §4.b). */}
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

        {branchesQuery.isLoading ? <LoadingState variant="rows" /> : null}

        {branchesQuery.isError ? (
          <ErrorState>
            No pudimos cargar las sucursales
            {branchesQuery.error instanceof Error ? `: ${branchesQuery.error.message}` : "."}
          </ErrorState>
        ) : null}

        {/* El mensaje del backend va tal cual, mismo patrón que el RESTRICT de
            PipelineListPage: en el 400 del DELETE viene un texto pensado para la
            persona ("No se puede eliminar una sucursal que tiene recursos
            activos. Eliminá primero sus recursos."), que ya dice qué hacer. */}
        {deleteBranchMutation.isError ? (
          <ErrorState>
            No pudimos eliminar la sucursal
            {deleteBranchMutation.error instanceof Error
              ? `: ${deleteBranchMutation.error.message}`
              : "."}
          </ErrorState>
        ) : null}

        {branchesQuery.isSuccess && branchesQuery.data.data.length === 0 ? (
          <EmptyState>No hay sucursales para mostrar.</EmptyState>
        ) : null}

        {branchesQuery.isSuccess && branchesQuery.data.data.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Zona horaria</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {branchesQuery.data.data.map((branch) => (
                <tr key={branch.id}>
                  <td>{branch.name}</td>
                  {/* El identificador IANA crudo, no la etiqueta de timezones.ts:
                      una sucursal creada por API puede tener una zona fuera de
                      esa lista, y el dato real es más útil que "—". */}
                  <td>{branch.timezone}</td>
                  <td>
                    <ActionsMenu
                      actions={[
                        { label: "Editar", to: `/branches/${branch.id}/edit` },
                        {
                          label: "Eliminar",
                          onClick: () => handleDelete(branch.id),
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

        {branchesQuery.isSuccess ? (
          <Pagination
            page={page}
            totalPages={branchesQuery.data.pagination.totalPages}
            onPrevious={() => setPage((current) => current - 1)}
            onNext={() => setPage((current) => current + 1)}
          />
        ) : null}
      </div>
    </div>
  );
}
