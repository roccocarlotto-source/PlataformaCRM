import { usePipelines } from "./queries";

interface PipelineSelectProps {
  id?: string;
  label: string;
  value: string | undefined;
  onChange: (pipelineId: string) => void;
}

// <select> simple, sin búsqueda de texto — a diferencia de CompanySelect,
// se asume baja cardinalidad de Pipelines por organización (dominio: CRM de
// ventas, "MVP: uno por organización" según el comentario del schema,
// aunque el modelo soporte varios). GET /api/pipelines sí tiene `search`
// (pipeline.repository.ts), pero no se usa acá — un <select> con hasta 100
// resultados es más simple y suficiente para el volumen esperado. Límite de
// 100 documentado como riesgo residual (ver docs/project-overview.md).
export function PipelineSelect({ id, label, value, onChange }: PipelineSelectProps) {
  const pipelinesQuery = usePipelines({ pageSize: 100, sortBy: "name", sortOrder: "asc" });

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {pipelinesQuery.isLoading ? <p>Cargando…</p> : null}
      {pipelinesQuery.isError ? (
        <p role="alert">
          No pudimos cargar los pipelines
          {pipelinesQuery.error instanceof Error ? `: ${pipelinesQuery.error.message}` : "."}
        </p>
      ) : null}
      {pipelinesQuery.isSuccess ? (
        <select id={id} value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
          <option value="" disabled>
            Elegí un pipeline…
          </option>
          {pipelinesQuery.data.data.map((pipeline) => (
            <option key={pipeline.id} value={pipeline.id}>
              {pipeline.name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
