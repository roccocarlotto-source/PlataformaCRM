import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Pagination } from "../../design-system/Pagination";
import { Table } from "../../design-system/Table";
import { useDeletePipeline } from "./mutations";
import { usePipelines } from "./queries";
import type { PipelineSortBy, SortOrder } from "./types";

const PAGE_SIZE = 20;

// Esta pantalla no tiene diseño de referencia entre las 17 exportadas
// ("Pipeline CRM" es un Kanban de oportunidades, otra cosa): restyle genérico
// con el sistema de diseño, mismas columnas y mismo orden que antes.
export function PipelineListPage() {
  const { me } = useAuth();
  // Ocultar acciones de escritura para no-ADMIN es cortesía de UX: la
  // autorización real la sigue aplicando authorize("ADMIN") en el backend.
  const isAdmin = me?.role === "ADMIN";

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<PipelineSortBy>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const pipelinesQuery = usePipelines({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    sortBy,
    sortOrder,
  });

  const deletePipelineMutation = useDeletePipeline();

  function handleDelete(id: string) {
    if (!window.confirm("¿Eliminar este pipeline?")) return;
    deletePipelineMutation.mutate(id);
  }

  return (
    <div>
      <div className="ds-page-header">
        <h1>Pipelines</h1>
        {isAdmin ? (
          <Link to="/pipelines/new" className="ds-link-button">
            Nuevo pipeline
          </Link>
        ) : null}
      </div>

      <div className="ds-filters">
        <label>
          Buscar
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
        <label>
          Ordenar por
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as PipelineSortBy)}
          >
            <option value="createdAt">Fecha de creación</option>
            <option value="name">Nombre</option>
          </select>
        </label>
        <label>
          Orden
          <select
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value as SortOrder)}
          >
            <option value="desc">Descendente</option>
            <option value="asc">Ascendente</option>
          </select>
        </label>
      </div>

      {pipelinesQuery.isLoading ? <LoadingState /> : null}

      {pipelinesQuery.isError ? (
        <ErrorState>
          No pudimos cargar los pipelines
          {pipelinesQuery.error instanceof Error ? `: ${pipelinesQuery.error.message}` : "."}
        </ErrorState>
      ) : null}

      {deletePipelineMutation.isError ? (
        <ErrorState>
          No pudimos eliminar el pipeline
          {deletePipelineMutation.error instanceof Error
            ? `: ${deletePipelineMutation.error.message}`
            : "."}
        </ErrorState>
      ) : null}

      {pipelinesQuery.isSuccess && pipelinesQuery.data.data.length === 0 ? (
        <EmptyState>No hay pipelines para mostrar.</EmptyState>
      ) : null}

      {pipelinesQuery.isSuccess && pipelinesQuery.data.data.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Default</th>
              <th>Etapas</th>
              {isAdmin ? <th>Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {pipelinesQuery.data.data.map((pipeline) => (
              <tr key={pipeline.id}>
                <td>{pipeline.name}</td>
                {/* Sin badge inventado cuando no es default: reflejar
                    fielmente que puede haber cero defaults (ver types.ts). */}
                <td>{pipeline.isDefault ? <Badge variant="neutral">Default</Badge> : null}</td>
                <td>
                  <Link to={`/pipelines/${pipeline.id}/stages`}>Ver etapas</Link>
                </td>
                {isAdmin ? (
                  <td>
                    <Link to={`/pipelines/${pipeline.id}/edit`}>Editar</Link>{" "}
                    <Button variant="danger" onClick={() => handleDelete(pipeline.id)}>
                      Eliminar
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}

      {pipelinesQuery.isSuccess ? (
        <Pagination
          page={page}
          totalPages={pipelinesQuery.data.pagination.totalPages}
          onPrevious={() => setPage((current) => current - 1)}
          onNext={() => setPage((current) => current + 1)}
        />
      ) : null}
    </div>
  );
}
