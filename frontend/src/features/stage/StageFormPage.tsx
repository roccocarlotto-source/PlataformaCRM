import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useCreateStage, useUpdateStage } from "./mutations";
import { useStage } from "./queries";
import type { CreateStageInput, UpdateStageInput } from "./types";

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

// Un único componente para create y edit, mismo patrón que
// CompanyFormPage/PipelineFormPage. isWon/isLost se desmarcan mutuamente
// en el cliente como cortesía visual (evita un 409 previsible en el caso
// común) — la autoridad real sigue siendo el 409/CHECK del backend, esto
// no lo reemplaza ni lo duplica como validación de integridad.
export function StageFormPage() {
  const { pipelineId, stageId } = useParams<{ pipelineId: string; stageId?: string }>();
  const isEditMode = stageId !== undefined;
  const navigate = useNavigate();

  const stageQuery = useStage(pipelineId ?? "", isEditMode ? stageId : undefined);
  const createStageMutation = useCreateStage(pipelineId ?? "");
  const updateStageMutation = useUpdateStage(pipelineId ?? "");

  const [values, setValues] = useState<StageFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isEditMode && stageQuery.data) {
      setValues({
        name: stageQuery.data.name,
        order: String(stageQuery.data.order),
        // probability llega como string (Decimal) — Number() para poder
        // editarlo como campo numérico, nunca el string crudo tal cual.
        probability: String(Number(stageQuery.data.probability)),
        isWon: stageQuery.data.isWon,
        isLost: stageQuery.data.isLost,
      });
    }
  }, [isEditMode, stageQuery.data]);

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
    return <p>Cargando…</p>;
  }

  if (isEditMode && stageQuery.isError) {
    return (
      <p role="alert">
        No pudimos cargar la etapa
        {stageQuery.error instanceof Error ? `: ${stageQuery.error.message}` : "."}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>{isEditMode ? "Editar etapa" : "Nueva etapa"}</h1>
      <label>
        Nombre
        <input
          type="text"
          value={values.name}
          onChange={(event) => setValues({ ...values, name: event.target.value })}
          required
        />
      </label>
      <label>
        Orden
        <input
          type="number"
          min={1}
          value={values.order}
          onChange={(event) => setValues({ ...values, order: event.target.value })}
        />
      </label>
      {!isEditMode ? <p>Si se omite, la etapa se agrega al final.</p> : null}
      <label>
        Probabilidad (%)
        <input
          type="number"
          min={0}
          max={100}
          value={values.probability}
          onChange={(event) => setValues({ ...values, probability: event.target.value })}
        />
      </label>
      <label>
        Ganada
        <input
          type="checkbox"
          checked={values.isWon}
          onChange={(event) =>
            setValues({ ...values, isWon: event.target.checked, isLost: false })
          }
        />
      </label>
      <label>
        Perdida
        <input
          type="checkbox"
          checked={values.isLost}
          onChange={(event) =>
            setValues({ ...values, isLost: event.target.checked, isWon: false })
          }
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Guardando…" : "Guardar"}
      </button>
    </form>
  );
}
