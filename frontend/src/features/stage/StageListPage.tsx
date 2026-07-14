import { useParams, Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { usePipeline } from "../pipeline/queries";
import { useDeleteStage, useUpdateStage } from "./mutations";
import { useStages } from "./queries";

const PAGE_SIZE = 100;

// probability siempre llega como string desde la API (Prisma.Decimal,
// ver types.ts) — Number() antes de formatear, nunca .toFixed() directo
// sobre el valor crudo.
function formatProbability(probability: string): string {
  return `${Number(probability)}%`;
}

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

  const stagesQuery = useStages(pipelineId ?? "", {
    pipelineId,
    pageSize: PAGE_SIZE,
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
    return <p>Cargando…</p>;
  }

  if (pipelineQuery.isError || !pipelineQuery.data) {
    return (
      <p role="alert">
        No pudimos cargar el pipeline
        {pipelineQuery.error instanceof Error ? `: ${pipelineQuery.error.message}` : "."}
      </p>
    );
  }

  const pipeline = pipelineQuery.data;

  return (
    <div>
      <h1>Etapas de {pipeline.name}</h1>
      {isAdmin ? <Link to={`/pipelines/${pipelineId}/stages/new`}>Nueva etapa</Link> : null}

      {stagesQuery.isLoading ? <p>Cargando…</p> : null}

      {stagesQuery.isError ? (
        <p role="alert">
          No pudimos cargar las etapas
          {stagesQuery.error instanceof Error ? `: ${stagesQuery.error.message}` : "."}
        </p>
      ) : null}

      {deleteStageMutation.isError ? (
        <p role="alert">
          No pudimos eliminar la etapa
          {deleteStageMutation.error instanceof Error
            ? `: ${deleteStageMutation.error.message}`
            : "."}
        </p>
      ) : null}

      {updateStageMutation.isError ? (
        <p role="alert">
          No pudimos mover la etapa
          {updateStageMutation.error instanceof Error
            ? `: ${updateStageMutation.error.message}`
            : "."}
        </p>
      ) : null}

      {stagesQuery.isSuccess && stagesQuery.data.data.length === 0 ? (
        <p>No hay etapas para mostrar.</p>
      ) : null}

      {stagesQuery.isSuccess && stagesQuery.data.data.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Orden</th>
              <th>Nombre</th>
              <th>Probabilidad</th>
              <th>Ganada</th>
              <th>Perdida</th>
              {isAdmin ? <th>Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {stagesQuery.data.data.map((stage, index) => (
              <tr key={stage.id}>
                <td>{stage.order}</td>
                <td>{stage.name}</td>
                <td>{formatProbability(stage.probability)}</td>
                <td>{stage.isWon ? "Sí" : ""}</td>
                <td>{stage.isLost ? "Sí" : ""}</td>
                {isAdmin ? (
                  <td>
                    <Link to={`/pipelines/${pipelineId}/stages/${stage.id}/edit`}>Editar</Link>
                    <button type="button" onClick={() => handleDelete(stage.id)}>
                      Eliminar
                    </button>
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => handleMove(stage.id, stage.order - 1)}
                    >
                      Subir
                    </button>
                    <button
                      type="button"
                      disabled={index === stagesQuery.data.data.length - 1}
                      onClick={() => handleMove(stage.id, stage.order + 1)}
                    >
                      Bajar
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
