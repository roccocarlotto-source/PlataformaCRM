import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { RequiredFieldsHint } from "../../design-system/RequiredFieldsHint";
import { useToast } from "../../design-system/useToast";
import { StageEditor } from "../stage/StageEditor";
import { useCreatePipeline, useUpdatePipeline } from "./mutations";
import { pipelineKeys, usePipeline } from "./queries";
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
//
// DEBAJO DEL FORMULARIO VA EL EDITOR DE ETAPAS (features/stage/StageEditor,
// docs/frontend-cambios-pendientes.md §11): el flujo de venta real de un
// pipeline son sus etapas, y hasta ahora solo se configuraban en una pantalla
// aparte (StageListPage, que sigue existiendo de respaldo). El editor guarda
// cada etapa por su cuenta, al toque; el "Guardar" de esta página sigue
// acotado a Nombre/Default. En creación el editor no puede existir todavía
// (no hay pipelineId) y en su lugar va un aviso.
//
// El editor es un HERMANO del <form>, no un hijo: cada fila del editor es su
// propio <form> (Enter guarda, `required` frena), y un form adentro de otro
// es HTML inválido. Por eso el esqueleto es div.ds-form > [form, editor] y no
// form.ds-form > todo, como en los demás formularios.
export function PipelineFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

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
        toast.show("Pipeline guardado");
        navigate("/pipelines");
      } else {
        const created = await createPipelineMutation.mutateAsync(toInput(values));
        // EXCEPCIÓN AL PATRÓN "crear → navegar a la lista" — A PROPÓSITO.
        //
        // Todos los demás formularios (Company, Contact, Opportunity…) vuelven
        // a su listado después de crear, y este también lo hacía. Pipeline es
        // distinto porque un pipeline recién creado no sirve para nada hasta
        // que tiene etapas (createPipeline no crea ninguna por defecto), y
        // las etapas se configuran acá abajo, en el editor integrado, que
        // necesita el id real del pipeline para existir. Mandar a la persona
        // a la lista para que vuelva a entrar a "Editar" y recién ahí cargar
        // las etapas es exactamente el rodeo que §11 de
        // docs/frontend-cambios-pendientes.md decidió evitar.
        //
        // Por eso, al crear, la página pasa a modo edición EN EL MISMO LUGAR:
        // navega a /pipelines/:id/edit (misma pantalla, ahora con el editor
        // de etapas habilitado) en vez de a /pipelines. Con `replace` para que
        // "Atrás" no vuelva al formulario vacío de "Nuevo pipeline" sino a
        // donde estaba la persona antes (la lista). En modo edición, guardar
        // SÍ sigue navegando a la lista, como siempre.
        //
        // NO "corregir" esto buscando consistencia con los otros formularios:
        // es una decisión confirmada, no un descuido.
        //
        // La respuesta del POST se siembra en la caché del detail para que el
        // modo edición arranque con los datos ya cargados (sin pasar por
        // LoadingState) y sin un GET redundante mientras sean frescos.
        queryClient.setQueryData(pipelineKeys.detail(created.id), created);
        toast.show("Pipeline guardado");
        navigate(`/pipelines/${created.id}/edit`, { replace: true });
      }
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
    <div className="ds-form">
      <h1>{isEditMode ? "Editar pipeline" : "Nuevo pipeline"}</h1>
      <div className="ds-stack">
        <form onSubmit={handleSubmit} className="ds-stack">
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
            <RequiredFieldsHint />
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </form>

        {isEditMode ? (
          <StageEditor pipelineId={id} />
        ) : (
          <Card heading="Etapas">
            <EmptyState>Guardá el pipeline para poder agregar sus etapas.</EmptyState>
          </Card>
        )}
      </div>
    </div>
  );
}
