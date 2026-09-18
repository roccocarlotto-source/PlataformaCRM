import { Select } from "../../design-system/Select";
import { useStageOptions } from "./queries";

interface StageSelectProps {
  id?: string;
  label: string;
  pipelineId: string | undefined;
  value: string | undefined;
  onChange: (stageId: string) => void;
  // Obligatorio: "*" de .ds-required en el rótulo Y `required` en el input del
  // selector, siempre juntos (mismo contrato que PipelineSelect). Ojo: el
  // selector deshabilitado de "sin pipeline" no participa de la validación
  // nativa aunque lleve required, y el real solo existe con la lista cargada;
  // el formulario que lo exige cubre esos huecos en su submit.
  required?: boolean;
}

// Combobox del design system (Select, §46 de docs/frontend-cambios-pendientes.md),
// de una sola línea y con búsqueda local sobre la página ya traída — misma
// plantilla que PipelineSelect y BranchSelect.
//
// Deshabilitado/vacío sin pipelineId — un Stage siempre pertenece a un único
// Pipeline (ver stage/types.ts) y Opportunity exige que stageId pertenezca
// al pipelineId indicado (opportunity.service.ts, validateStageId). La
// query se DESACTIVA por completo (enabled:false, ver stage/queries.ts) sin
// pipelineId — nunca dispara un GET /stages sin scope. Recarga sus opciones
// cada vez que pipelineId cambia (useStages ya está scoped por pipelineId
// vía stageKeys.byPipeline, así que un cambio de pipelineId es una queryKey
// distinta, sin necesidad de invalidación manual acá).
export function StageSelect({
  id,
  label,
  pipelineId,
  value,
  onChange,
  required = false,
}: StageSelectProps) {
  // Una sola página de 100 ordenada por `order`, definida en queries.ts
  // (useStageOptions) para compartir la misma queryKey con
  // OpportunityFormPage, que necesita los flags isWon/isLost de la etapa
  // elegida — ver §50.
  const stagesQuery = useStageOptions(pipelineId);

  // Sin pipeline no hay etapas que ofrecer: el selector queda deshabilitado y
  // su fila vacía es el cartel ("Elegí primero un proceso de venta…"), que
  // cerrado se lee como placeholder — exactamente lo que mostraba el <select>
  // vacío y deshabilitado de antes.
  if (!pipelineId) {
    return (
      <Select
        id={id}
        label={label}
        value=""
        onChange={() => undefined}
        options={[]}
        emptyOption={{ label: "Elegí primero un proceso de venta…" }}
        required={required}
        disabled
      />
    );
  }

  // Con la lista cargada, Select trae su propio div > label[for] + input.
  // Mientras carga o si falló, se conserva el rótulo con el aviso debajo.
  if (stagesQuery.isSuccess) {
    return (
      <Select
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        options={stagesQuery.data.data.map((stage) => ({
          value: stage.id,
          label: stage.name,
        }))}
        // Igual que PipelineSelect: la fila vacía reemplaza a la <option
        // value="" disabled> y solo se ofrece mientras no hay etapa elegida.
        emptyOption={value ? undefined : { label: "Elegí una etapa…" }}
        required={required}
      />
    );
  }

  return (
    <div>
      <label htmlFor={id}>{required ? <span className="ds-required">{label}</span> : label}</label>
      {stagesQuery.isLoading ? <p>Cargando…</p> : null}
      {stagesQuery.isError ? (
        <p role="alert">
          No pudimos cargar las etapas
          {stagesQuery.error instanceof Error ? `: ${stagesQuery.error.message}` : "."}
        </p>
      ) : null}
    </div>
  );
}
