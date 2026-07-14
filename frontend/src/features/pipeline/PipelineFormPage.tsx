import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useCreatePipeline, useUpdatePipeline } from "./mutations";
import { usePipeline } from "./queries";
import type { CreatePipelineInput } from "./types";

interface PipelineFormValues {
  name: string;
  isDefault: boolean;
}

const EMPTY_FORM: PipelineFormValues = {
  name: "",
  isDefault: false,
};

function toInput(values: PipelineFormValues): CreatePipelineInput {
  return {
    name: values.name,
    isDefault: values.isDefault,
  };
}

// Un único componente para create y edit, mismo patrón que CompanyFormPage.
// isDefault se puede marcar Y desmarcar libremente (Decisión A del informe
// de diseño de M4): el backend garantiza a lo sumo un default, nunca
// exactamente uno — desmarcar el default actual es una operación válida
// que puede dejar la organización en cero defaults, y este formulario no
// inventa una restricción que el backend no tiene.
export function PipelineFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();

  const pipelineQuery = usePipeline(isEditMode ? id : undefined);
  const createPipelineMutation = useCreatePipeline();
  const updatePipelineMutation = useUpdatePipeline(id ?? "");

  const [values, setValues] = useState<PipelineFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isEditMode && pipelineQuery.data) {
      setValues({
        name: pipelineQuery.data.name,
        isDefault: pipelineQuery.data.isDefault,
      });
    }
  }, [isEditMode, pipelineQuery.data]);

  const isSubmitting = createPipelineMutation.isPending || updatePipelineMutation.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      if (isEditMode) {
        await updatePipelineMutation.mutateAsync(toInput(values));
      } else {
        await createPipelineMutation.mutateAsync(toInput(values));
      }
      navigate("/pipelines");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el pipeline");
    }
  }

  if (isEditMode && pipelineQuery.isLoading) {
    return <p>Cargando…</p>;
  }

  if (isEditMode && pipelineQuery.isError) {
    return (
      <p role="alert">
        No pudimos cargar el pipeline
        {pipelineQuery.error instanceof Error ? `: ${pipelineQuery.error.message}` : "."}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>{isEditMode ? "Editar pipeline" : "Nuevo pipeline"}</h1>
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
        Default
        <input
          type="checkbox"
          checked={values.isDefault}
          onChange={(event) => setValues({ ...values, isDefault: event.target.checked })}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Guardando…" : "Guardar"}
      </button>
    </form>
  );
}
