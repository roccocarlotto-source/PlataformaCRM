import { Card } from "../../design-system/Card";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { useDefaultPipelineStageSummary } from "./queries";

// Sin Pipeline default: empty state explícito, NUNCA error — no dispara
// GET /stages ni conteos de Opportunities (ver useDefaultPipelineStageSummary).
//
// Cada etapa lleva una barra proporcional a su conteo REAL respecto del
// máximo entre etapas (la etapa más cargada ocupa el 100% de la pista). Es
// el "Resumen del embudo" del diseño reducido a lo que el backend sabe hoy:
// conteos por etapa, nada de series temporales ni comparación de períodos.
// Mientras un conteo carga o falla, su barra queda vacía; nunca se pinta un
// ancho que no salga de stage.total.
export function PipelineStageSummary() {
  const summary = useDefaultPipelineStageSummary();

  const maxTotal = Math.max(0, ...summary.stages.map((stage) => stage.total ?? 0));

  return (
    <Card aria-label="Pipeline" heading="Pipeline">
      {summary.isLoadingPipelines ? <LoadingState /> : null}

      {summary.isErrorPipelines ? (
        <ErrorState>
          No pudimos cargar el pipeline
          {summary.errorPipelines ? `: ${summary.errorPipelines.message}` : "."}
        </ErrorState>
      ) : null}

      {!summary.isLoadingPipelines && !summary.isErrorPipelines && !summary.hasDefaultPipeline ? (
        <EmptyState>No hay un pipeline configurado como predeterminado.</EmptyState>
      ) : null}

      {summary.hasDefaultPipeline ? (
        <>
          {summary.isLoadingStages ? <LoadingState>Cargando etapas…</LoadingState> : null}

          {summary.isErrorStages ? (
            <ErrorState>
              No pudimos cargar las etapas
              {summary.errorStages ? `: ${summary.errorStages.message}` : "."}
            </ErrorState>
          ) : null}

          {!summary.isLoadingStages && !summary.isErrorStages && summary.stages.length === 0 ? (
            <EmptyState>El pipeline predeterminado todavía no tiene etapas.</EmptyState>
          ) : null}

          {summary.stages.length > 0 ? (
            <ul className="ds-meter-list">
              {summary.stages.map((stage) => {
                const total = !stage.isLoading && !stage.isError ? stage.total : null;
                const percent = total !== null && maxTotal > 0 ? (total / maxTotal) * 100 : 0;
                return (
                  <li key={stage.stageId} className="ds-meter">
                    <div className="ds-meter-row">
                      {/* El ":" se mantiene en el rótulo: es el texto que ya
                          se muestra ("Prospecto: 3") y por el que se lo busca. */}
                      <span>{stage.name}:</span>
                      <span className="ds-meter-value">
                        {stage.isLoading ? "Cargando…" : null}
                        {stage.isError ? (
                          <span role="alert">No pudimos cargar este dato.</span>
                        ) : null}
                        {total !== null ? total : null}
                      </span>
                    </div>
                    {/* Decorativa: el número de al lado ya es el dato. */}
                    <div className="ds-meter-track" aria-hidden="true">
                      <div className="ds-meter-fill" style={{ width: `${percent}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
