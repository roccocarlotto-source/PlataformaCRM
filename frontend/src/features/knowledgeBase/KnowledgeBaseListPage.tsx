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
import { useDeleteKnowledgeBaseEntry } from "./mutations";
import { useKnowledgeBaseEntries } from "./queries";
import type { KnowledgeBaseSortBy, SortOrder } from "./types";

const PAGE_SIZE = 20;

// Lo que se muestra cuando una sucursal no se pudo resolver (fuera de las
// primeras 100, o un fallo puntual de esa request) — mismo criterio que
// AgentListPage y QrListPage.
const SIN_RESOLVER = "—";

// SIN el gate `isAdmin` que usan CompanyListPage/ContactListPage, mismo
// criterio que AgentListPage y BranchListPage: la pantalla entera vive dentro
// de AdminRoute (ver app/router.tsx), así que un `isAdmin ?` sería una
// condición que nunca evalúa a false. GET /api/knowledge-base sí es de lectura
// abierta a cualquier autenticado, pero hoy no hay ninguna pantalla que le
// muestre estas entradas a un USER — quien las "lee" de verdad es el agente,
// del lado del backend.
//
// SIN columna de contenido: son hasta 10.000 caracteres por entrada y un
// recorte en la tabla no dice nada que el título no diga mejor. Para leerlo
// está el formulario.
export function KnowledgeBaseListPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  const [isActive, setIsActive] = useState<"" | "true" | "false">("");
  const [sortBy, setSortBy] = useState<KnowledgeBaseSortBy>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const entriesQuery = useKnowledgeBaseEntries({
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
  // AgentListPage.
  const branchesQuery = useBranches(BRANCHES_PARA_SELECT);
  const nombreDeSucursal = new Map(
    (branchesQuery.data?.data ?? []).map((branch) => [branch.id, branch.name]),
  );

  const deleteEntryMutation = useDeleteKnowledgeBaseEntry();

  function handleDelete(id: string) {
    // window.confirm, igual que Agent/Branch/Source. El borrado es lógico; lo
    // que se dice acá es la consecuencia que no se ve en la pantalla: los
    // agentes de esa sucursal dejan de tener esa información.
    if (
      !window.confirm(
        "¿Eliminar esta entrada? Los agentes de esa sucursal dejan de usarla para responder.",
      )
    ) {
      return;
    }
    deleteEntryMutation.mutate(id);
  }

  return (
    <div>
      <div className="ds-page-header">
        <h1>Base de conocimiento</h1>
        <Link to="/knowledge-base/new" className="ds-link-button">
          <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
          Nueva entrada
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
              placeholder="Buscar por título"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <BranchSelect
            id="knowledge-base-list-branch"
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
              { value: "title", label: "Título" },
            ]}
            onChange={(value) => {
              if (value) setSortBy(value);
            }}
          />
          <SortOrderSelect value={sortOrder} onChange={setSortOrder} />
        </div>

        {entriesQuery.isLoading ? <LoadingState /> : null}

        {entriesQuery.isError ? (
          <ErrorState>
            No pudimos cargar la base de conocimiento
            {entriesQuery.error instanceof Error ? `: ${entriesQuery.error.message}` : "."}
          </ErrorState>
        ) : null}

        {deleteEntryMutation.isError ? (
          <ErrorState>
            No pudimos eliminar la entrada
            {deleteEntryMutation.error instanceof Error
              ? `: ${deleteEntryMutation.error.message}`
              : "."}
          </ErrorState>
        ) : null}

        {entriesQuery.isSuccess && entriesQuery.data.data.length === 0 ? (
          <EmptyState>No hay entradas para mostrar.</EmptyState>
        ) : null}

        {entriesQuery.isSuccess && entriesQuery.data.data.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>Título</th>
                <th>Sucursal</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {entriesQuery.data.data.map((entry) => (
                <tr key={entry.id}>
                  <td className="ds-cell-primary">{entry.title}</td>
                  <td>{nombreDeSucursal.get(entry.branchId) ?? SIN_RESOLVER}</td>
                  <td>
                    {/* Estado real y editable: una entrada inactiva existe,
                        se puede volver a activar, y simplemente no entra al
                        prompt de ningún agente de la sucursal. */}
                    <Badge variant={entry.isActive ? "success" : "neutral"}>
                      {entry.isActive ? "Activa" : "Inactiva"}
                    </Badge>
                  </td>
                  <td>
                    <ActionsMenu
                      actions={[
                        { label: "Editar", to: `/knowledge-base/${entry.id}/edit` },
                        {
                          label: "Eliminar",
                          onClick: () => handleDelete(entry.id),
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

        {entriesQuery.isSuccess ? (
          <Pagination
            page={page}
            totalPages={entriesQuery.data.pagination.totalPages}
            onPrevious={() => setPage((current) => current - 1)}
            onNext={() => setPage((current) => current + 1)}
          />
        ) : null}
      </div>
    </div>
  );
}
