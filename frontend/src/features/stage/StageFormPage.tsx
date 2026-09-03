import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { useCreateStage, useUpdateStage } from "./mutations";
import { useStage } from "./queries";
import type { CreateStageInput, Stage, UpdateStageInput } from "./types";
import { useFormDraft } from "../../lib/useFormDraft";

interface StageFormValues {
  name: string;
  order: string;
  probability: string;
  isWon: boolean;
  isLost: boolean;
}

const EMPTY_FORM: StageFormValues = {
  name: "",
  order: "",
  probability: "",
  isWon: false,
  isLost: false,
};

// pipelineId nunca es parte de los values del form: es fijo desde la
// ruta, inmutable (no existe en UpdateStageInput — ver types.ts), y no se
// muestra como campo editable.
function toCreateInput(values: StageFormValues, pipelineId: string): CreateStageInput {
  return {
    pipelineId,
    name: values.name,
    order: values.order ? Number(values.order) : undefined,
    probability: values.probability ? Number(values.probability) : undefined,
    isWon: values.isWon,
    isLost: values.isLost,
  };
}

function toUpdateInput(values: StageFormValues): UpdateStageInput {
  return {
    name: values.name,
    order: values.order ? Number(values.order) : undefined,
    probability: values.probability ? Number(values.probability) : undefined,
    isWon: values.isWon,
    isLost: values.isLost,
  };
}

// Valores del formulario derivados de un registro ya persistido. Antes esto
// vivía adentro de un useEffect que hacía setValues; ahora es una función pura
// y el estado local aparece recién cuando el usuario edita algo — ver
// lib/useFormDraft.ts para por qué ese efecto perdía datos.
function toFormValues(data: Stage): StageFormValues {
  return {
    name: data.name,
    order: String(data.order),
    // probability llega como string (Decimal) — Number() para poder
    // editarlo como campo numérico, nunca el string crudo tal cual.
    probability: String(Number(data.probability)),
    isWon: data.isWon,
    isLost: data.isLost,
  };
}

// Un único componente para create y edit, mismo patrón que
// CompanyFormPage/PipelineFormPage. isWon/isLost se desmarcan mutuamente
// en el cliente como cortesía visual (evita un 409 previsible en el caso
// común) — la autoridad real sigue siendo el 409/CHECK del backend, esto
// no lo reemplaza ni lo duplica como validación de integridad. Siguen
// siendo checkboxes nativos dentro de FormField, como en SourceFormPage.
export function StageFormPage() {
  const { pipelineId, stageId } = useParams<{ pipelineId: string; stageId?: string }>();
  const isEditMode = stageId !== undefined;
  const navigate = useNavigate();

  const stageQuery = useStage(pipelineId ?? "", isEditMode ? stageId : undefined);
  const createStageMutation = useCreateStage(pipelineId ?? "");
  const updateStageMutation = useUpdateStage(pipelineId ?? "");

  const [values, setValues] = useFormDraft<StageFormValues>(
    stageQuery.data?.id,
    stageQuery.data ? toFormValues(stageQuery.data) : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);

  const isSubmitting = createStageMutation.isPending || updateStageMutation.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      if (isEditMode && stageId) {
        await updateStageMutation.mutateAsync({ id: stageId, input: toUpdateInput(values) });
      } else {
        await createStageMutation.mutateAsync(toCreateInput(values, pipelineId ?? ""));
      }
      navigate(`/pipelines/${pipelineId}/stages`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la etapa");
    }
  }

  if (isEditMode && stageQuery.isLoading) {
    return <LoadingState />;
  }

  if (isEditMode && stageQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar la etapa
        {stageQuery.error instanceof Error ? `: ${stageQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>{isEditMode ? "Editar etapa" : "Nueva etapa"}</h1>
      <FormField label="Nombre">
        <input
          type="text"
          value={values.name}
          onChange={(event) => setValues({ ...values, name: event.target.value })}
          required
        />
      </FormField>
      <FormField label="Orden">
        <input
          type="number"
          min={1}
          value={values.order}
          onChange={(event) => setValues({ ...values, order: event.target.value })}
        />
      </FormField>
      {!isEditMode ? <p className="ds-hint">Si se omite, la etapa se agrega al final.</p> : null}
      <FormField label="Probabilidad (%)">
        <input
          type="number"
          min={0}
          max={100}
          value={values.probability}
          onChange={(event) => setValues({ ...values, probability: event.target.value })}
        />
      </FormField>
      <FormField label="Ganada">
        <input
          type="checkbox"
          checked={values.isWon}
          onChange={(event) => setValues({ ...values, isWon: event.target.checked, isLost: false })}
        />
      </FormField>
      <FormField label="Perdida">
        <input
          type="checkbox"
          checked={values.isLost}
          onChange={(event) => setValues({ ...values, isLost: event.target.checked, isWon: false })}
        />
      </FormField>
      {error ? <ErrorState>{error}</ErrorState> : null}
      <Button type="submit" variant="primary" disabled={isSubmitting}>
        {isSubmitting ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}
