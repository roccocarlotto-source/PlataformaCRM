import { useDefaultPipelineStageSummary } from "./queries";

// Sin Pipeline default: empty state explícito, NUNCA error — no dispara
// GET /stages ni conteos de Opportunities (ver useDefaultPipelineStageSummary).
export function PipelineStageSummary() {
  const summary = useDefaultPipelineStageSummary();

  return (
    <section aria-label="Pipeline">
      <h2>Pipeline</h2>

      {summary.isLoadingPipelines ? <p>Cargando…</p> : null}

      {summary.isErrorPipelines ? (
        <p role="alert">
          No pudimos cargar el pipeline
          {summary.errorPipelines ? `: ${summary.errorPipelines.message}` : "."}
        </p>
      ) : null}

      {!summary.isLoadingPipelines && !summary.isErrorPipelines && !summary.hasDefaultPipeline ? (
        <p>No hay un pipeline configurado como predeterminado.</p>
      ) : null}

      {summary.hasDefaultPipeline ? (
        <>
          {summary.isLoadingStages ? <p>Cargando etapas…</p> : null}

          {summary.isErrorStages ? (
            <p role="alert">
              No pudimos cargar las etapas
              {summary.errorStages ? `: ${summary.errorStages.message}` : "."}
            </p>
          ) : null}

          {!summary.isLoadingStages && !summary.isErrorStages && summary.stages.length === 0 ? (
            <p>El pipeline predeterminado todavía no tiene etapas.</p>
          ) : null}

          {summary.stages.length > 0 ? (
            <ul>
              {summary.stages.map((stage) => (
                <li key={stage.stageId}>
                  {stage.name}: {stage.isLoading ? "Cargando…" : null}
                  {stage.isError ? <span role="alert">No pudimos cargar este dato.</span> : null}
                  {!stage.isLoading && !stage.isError ? stage.total : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
