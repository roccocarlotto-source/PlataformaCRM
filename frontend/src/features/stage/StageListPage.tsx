import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Pagination } from "../../design-system/Pagination";
import { Table } from "../../design-system/Table";
import { usePipeline } from "../pipeline/queries";
import { useDeleteStage, useUpdateStage } from "./mutations";
import { useStages } from "./queries";

// R1.10 — mismo tamaño de página que el resto de los módulos (ver
// CompanyListPage.tsx). Antes fijo en 100 (el máximo que acepta
// listQuerySchema) sin paginar: un pipeline con más de 100 etapas
// truncaba en silencio. Sort queda fijo en "order" a propósito — es el
// único orden bajo el que "Subir"/"Bajar" (que operan sobre el vecino
// visual inmediato) tienen sentido; agregar un selector de orden acá
// rompería esa semántica, no es parte de este punto del Roadmap A.
const PAGE_SIZE = 20;

// probability siempre llega como string desde la API (Prisma.Decimal,
// ver types.ts) — Number() antes de formatear, nunca .toFixed() directo
// sobre el valor crudo.
function formatProbability(probability: string): string {
  return `${Number(probability)}%`;
}

// Ancho de la barra de probabilidad: el dato real acotado a 0–100. El
// backend ya lo valida en ese rango; el clamp solo evita que un valor
// fuera de rango (o NaN) dibuje una barra rota.
function probabilityWidth(probability: string): number {
  const value = Number(probability);
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

// Diseño de referencia: "Etapas del embudo". Filas con nombre, barra de
// probabilidad + porcentaje, un único badge de estado (solo en la etapa
// ganada o perdida) y acciones. El ícono de arrastrar para reordenar del
// diseño NO se implementa: drag-and-drop es funcionalidad nueva, no un
// restyle; "Subir"/"Bajar" siguen tal cual.
export function StageListPage() {
  const { pipelineId } = useParams<{ pipelineId: string }>();
  const { me } = useAuth();
  const isAdmin = me?.role === "ADMIN";

  // Gate obligatorio: si el pipeline padre no existe (incluye el caso de
  // un pipeline soft-deleted — findPipelineById filtra deletedAt: null),
  // esta página nunca debe renderizar la tabla de etapas debajo de un
  // header fantasma. Un stage creado antes de que su pipeline se
  // soft-eliminara sigue siendo listable por GET /stages?pipelineId=X
  // (findManyStages no valida el estado del pipeline padre) — este gate
  // es la defensa del frontend ante esa inconsistencia real del backend,
  // que no se puede corregir sin tocar backend (fuera de alcance de M4).
  const pipelineQuery = usePipeline(pipelineId);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const stagesQuery = useStages(pipelineId ?? "", {
    pipelineId,
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    sortBy: "order",
    sortOrder: "asc",
  });

  const deleteStageMutation = useDeleteStage(pipelineId ?? "");
  const updateStageMutation = useUpdateStage(pipelineId ?? "");

  function handleDelete(id: string) {
    if (!window.confirm("¿Eliminar esta etapa?")) return;
    deleteStageMutation.mutate(id);
  }

  // Nunca reordena localmente antes de la respuesta del backend: solo
  // propone el order del vecino inmediato y confía en el refetch (vía
  // invalidación de stageKeys.byPipeline) para reflejar el order final
  // que reindexStages calculó server-side.
  function handleMove(id: string, targetOrder: number) {
    updateStageMutation.mutate({ id, input: { order: targetOrder } });
  }

  if (pipelineQuery.isLoading) {
    return <LoadingState />;
  }

  if (pipelineQuery.isError || !pipelineQuery.data) {
    return (
      <ErrorState>
        No pudimos cargar el pipeline
        {pipelineQuery.error instanceof Error ? `: ${pipelineQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  const pipeline = pipelineQuery.data;

  return (
    <div>
      <div className="ds-page-header">
        <h1>Etapas de {pipeline.name}</h1>
        {isAdmin ? (
          <Link to={`/pipelines/${pipelineId}/stages/new`} className="ds-link-button">
            Nueva etapa
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
      </div>

      {stagesQuery.isLoading ? <LoadingState /> : null}

      {stagesQuery.isError ? (
        <ErrorState>
          No pudimos cargar las etapas
          {stagesQuery.error instanceof Error ? `: ${stagesQuery.error.message}` : "."}
        </ErrorState>
      ) : null}

      {deleteStageMutation.isError ? (
        <ErrorState>
          No pudimos eliminar la etapa
          {deleteStageMutation.error instanceof Error
            ? `: ${deleteStageMutation.error.message}`
            : "."}
        </ErrorState>
      ) : null}

      {updateStageMutation.isError ? (
        <ErrorState>
          No pudimos mover la etapa
          {updateStageMutation.error instanceof Error
            ? `: ${updateStageMutation.error.message}`
            : "."}
        </ErrorState>
      ) : null}

      {stagesQuery.isSuccess && stagesQuery.data.data.length === 0 ? (
        <EmptyState>No hay etapas para mostrar.</EmptyState>
      ) : null}

      {stagesQuery.isSuccess && stagesQuery.data.data.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <th>Orden</th>
              <th>Nombre</th>
              <th>Probabilidad</th>
              {/* Ganada y Perdida eran dos columnas booleanas ("Sí"/""); en el
                  diseño es un solo badge inline, y como el backend garantiza
                  que una etapa no es ambas a la vez (409/CHECK), una columna
                  alcanza. Los tests ubican la celda por cabecera. */}
              <th>Estado</th>
              {isAdmin ? <th>Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {stagesQuery.data.data.map((stage, index) => {
              // R1.10 — antes de paginar, index===0/length-1 SÍ era "primera/
              // última etapa del pipeline". Con páginas de 20, el primer o
              // último elemento de una página intermedia ya no lo es —
              // "Subir"/"Bajar" deben deshabilitarse solo en el borde real
              // (primera página / última página), no en el borde de la
              // página actual.
              const { page: currentPage, totalPages } = stagesQuery.data.pagination;
              const isFirstOverall = currentPage === 1 && index === 0;
              const isLastOverall =
                currentPage === totalPages && index === stagesQuery.data.data.length - 1;

              return (
                <tr key={stage.id}>
                  <td>{stage.order}</td>
                  <td>{stage.name}</td>
                  <td>
                    {/* La barra es decorativa: el porcentaje de al lado ya es
                        el dato. Ancho = probability real, 0–100. */}
                    <span className="ds-meter-inline">
                      <span className="ds-meter-track" aria-hidden="true">
                        <span
                          className="ds-meter-fill"
                          style={{ width: `${probabilityWidth(stage.probability)}%` }}
                        />
                      </span>
                      <span className="ds-meter-value">{formatProbability(stage.probability)}</span>
                    </span>
                  </td>
                  <td>
                    {stage.isWon ? <Badge variant="success">Etapa de Ganada</Badge> : null}
                    {stage.isLost ? <Badge variant="danger">Etapa de Perdida</Badge> : null}
                  </td>
                  {isAdmin ? (
                    <td>
                      {/* Los tres botones siguen siendo hermanos directos y en
                          este orden: los tests ubican "Subir" como el segundo
                          <button> de la fila. */}
                      <Link to={`/pipelines/${pipelineId}/stages/${stage.id}/edit`}>Editar</Link>{" "}
                      <Button variant="danger" onClick={() => handleDelete(stage.id)}>
                        Eliminar
                      </Button>{" "}
                      <Button
                        disabled={isFirstOverall}
                        onClick={() => handleMove(stage.id, stage.order - 1)}
                      >
                        Subir
                      </Button>{" "}
                      <Button
                        disabled={isLastOverall}
                        onClick={() => handleMove(stage.id, stage.order + 1)}
                      >
                        Bajar
                      </Button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : null}

      {stagesQuery.isSuccess ? (
        <Pagination
          page={page}
          totalPages={stagesQuery.data.pagination.totalPages}
          onPrevious={() => setPage((current) => current - 1)}
          onNext={() => setPage((current) => current + 1)}
        />
      ) : null}
    </div>
  );
}
