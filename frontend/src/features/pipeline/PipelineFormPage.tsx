import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { useCreatePipeline, useUpdatePipeline } from "./mutations";
import { usePipeline } from "./queries";
import type { CreatePipelineInput, Pipeline } from "./types";
import { useFormDraft } from "../../lib/useFormDraft";

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

// Valores del formulario derivados de un registro ya persistido. Antes esto
// vivía adentro de un useEffect que hacía setValues; ahora es una función pura
// y el estado local aparece recién cuando el usuario edita algo — ver
// lib/useFormDraft.ts para por qué ese efecto perdía datos.
function toFormValues(data: Pipeline): PipelineFormValues {
  return {
    name: data.name,
    isDefault: data.isDefault,
  };
}

// Un único componente para create y edit, mismo patrón que CompanyFormPage.
// isDefault se puede marcar Y desmarcar libremente (Decisión A del informe
// de diseño de M4): el backend garantiza a lo sumo un default, nunca
// exactamente uno — desmarcar el default actual es una operación válida
// que puede dejar la organización en cero defaults, y este formulario no
// inventa una restricción que el backend no tiene.
//
// El checkbox va dentro de FormField como en SourceFormPage ("Activa"): es un
// checkbox nativo, solo hereda el estilo base.
export function PipelineFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();

  const pipelineQuery = usePipeline(isEditMode ? id : undefined);
  const createPipelineMutation = useCreatePipeline();
  const updatePipelineMutation = useUpdatePipeline(id ?? "");

  const [values, setValues] = useFormDraft<PipelineFormValues>(
    pipelineQuery.data?.id,
    pipelineQuery.data ? toFormValues(pipelineQuery.data) : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);

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
    return <LoadingState />;
  }

  if (isEditMode && pipelineQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar el pipeline
        {pipelineQuery.error instanceof Error ? `: ${pipelineQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  // Sin mockup propio ("Pipeline CRM" es el Kanban de oportunidades, ver
  // PipelineListPage): mismo esqueleto que los formularios ya migrados
  // (.ds-form + Card + .ds-field-grid) por consistencia, no para calcar nada.
  // Dos campos a lo ancho; el "*" en Nombre porque el input lleva `required`.
  // El checkbox sigue siendo el mismo FormField (label > span + input): la
  // regla .ds-field:has(input[type="checkbox"]) solo lo pone en fila.
  return (
    <form onSubmit={handleSubmit} className="ds-form">
      <h1>{isEditMode ? "Editar pipeline" : "Nuevo pipeline"}</h1>
      <div className="ds-stack">
        <Card heading="Datos del pipeline">
          <div className="ds-field-grid">
            <div className="ds-field-grid--full">
              <FormField label={<span className="ds-required">Nombre</span>}>
                <input
                  type="text"
                  value={values.name}
                  onChange={(event) => setValues({ ...values, name: event.target.value })}
                  required
                />
              </FormField>
            </div>
            <div className="ds-field-grid--full">
              <FormField label="Default">
                <input
                  type="checkbox"
                  checked={values.isDefault}
                  onChange={(event) => setValues({ ...values, isDefault: event.target.checked })}
                />
              </FormField>
            </div>
          </div>
        </Card>
        {error ? <ErrorState>{error}</ErrorState> : null}
        <div>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </form>
  );
}
