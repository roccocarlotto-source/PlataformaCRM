import { useStages } from "./queries";

interface StageSelectProps {
  id?: string;
  label: string;
  pipelineId: string | undefined;
  value: string | undefined;
  onChange: (stageId: string) => void;
}

const PAGE_SIZE = 100;

// Deshabilitado/vacío sin pipelineId — un Stage siempre pertenece a un único
// Pipeline (ver stage/types.ts) y Opportunity exige que stageId pertenezca
// al pipelineId indicado (opportunity.service.ts, validateStageId). La
// query se DESACTIVA por completo (enabled:false, ver stage/queries.ts) sin
// pipelineId — nunca dispara un GET /stages sin scope. Recarga sus opciones
// cada vez que pipelineId cambia (useStages ya está scoped por pipelineId
// vía stageKeys.byPipeline, así que un cambio de pipelineId es una queryKey
// distinta, sin necesidad de invalidación manual acá).
export function StageSelect({ id, label, pipelineId, value, onChange }: StageSelectProps) {
  const stagesQuery = useStages(
    pipelineId ?? "",
    { pipelineId, pageSize: PAGE_SIZE, sortBy: "order", sortOrder: "asc" },
    { enabled: pipelineId !== undefined },
  );

  if (!pipelineId) {
    return (
      <div>
        <label htmlFor={id}>{label}</label>
        <select id={id} value="" disabled onChange={() => undefined}>
          <option value="">Elegí primero un pipeline…</option>
        </select>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {stagesQuery.isLoading ? <p>Cargando…</p> : null}
      {stagesQuery.isError ? (
        <p role="alert">
          No pudimos cargar las etapas
          {stagesQuery.error instanceof Error ? `: ${stagesQuery.error.message}` : "."}
        </p>
      ) : null}
      {stagesQuery.isSuccess ? (
        <select id={id} value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
          <option value="" disabled>
            Elegí una etapa…
          </option>
          {stagesQuery.data.data.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
