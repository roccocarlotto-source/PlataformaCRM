import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useDeletePipeline } from "./mutations";
import { usePipelines } from "./queries";
import type { PipelineSortBy, SortOrder } from "./types";

const PAGE_SIZE = 20;

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
      <h1>Pipelines</h1>
      {isAdmin ? <Link to="/pipelines/new">Nuevo pipeline</Link> : null}

      <div>
        <input
          type="search"
          placeholder="Buscar por nombre"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
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
        <select
          value={sortOrder}
          onChange={(event) => setSortOrder(event.target.value as SortOrder)}
        >
          <option value="desc">Descendente</option>
          <option value="asc">Ascendente</option>
        </select>
      </div>

      {pipelinesQuery.isLoading ? <p>Cargando…</p> : null}

      {pipelinesQuery.isError ? (
        <p role="alert">
          No pudimos cargar los pipelines
          {pipelinesQuery.error instanceof Error ? `: ${pipelinesQuery.error.message}` : "."}
        </p>
      ) : null}

      {deletePipelineMutation.isError ? (
        <p role="alert">
          No pudimos eliminar el pipeline
          {deletePipelineMutation.error instanceof Error
            ? `: ${deletePipelineMutation.error.message}`
            : "."}
        </p>
      ) : null}

      {pipelinesQuery.isSuccess && pipelinesQuery.data.data.length === 0 ? (
        <p>No hay pipelines para mostrar.</p>
      ) : null}

      {pipelinesQuery.isSuccess && pipelinesQuery.data.data.length > 0 ? (
        <table>
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
                <td>{pipeline.isDefault ? "Default" : ""}</td>
                <td>
                  <Link to={`/pipelines/${pipeline.id}/stages`}>Ver etapas</Link>
                </td>
                {isAdmin ? (
                  <td>
                    <Link to={`/pipelines/${pipeline.id}/edit`}>Editar</Link>
                    <button type="button" onClick={() => handleDelete(pipeline.id)}>
                      Eliminar
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {pipelinesQuery.isSuccess ? (
        <div>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            Anterior
          </button>
          <span>
            Página {pipelinesQuery.data.pagination.page} de{" "}
            {pipelinesQuery.data.pagination.totalPages || 1}
          </span>
          <button
            type="button"
            disabled={page >= pipelinesQuery.data.pagination.totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Siguiente
          </button>
        </div>
      ) : null}
    </div>
  );
}
