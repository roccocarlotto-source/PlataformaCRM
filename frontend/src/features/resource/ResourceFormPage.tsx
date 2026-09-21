import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { RequiredFieldsHint } from "../../design-system/RequiredFieldsHint";
import { Select } from "../../design-system/Select";
import { useFormDraft } from "../../lib/useFormDraft";
import { BranchSelect } from "../branch/BranchSelect";
import { RESOURCE_TYPE_OPTIONS } from "./labels";
import { useCreateResource, useReplaceWorkingHours, useUpdateResource } from "./mutations";
import { useResource, useWorkingHours } from "./queries";
import type { Resource, ResourceType, WorkingHoursSlot } from "./types";
import { WorkingHoursEditor } from "./WorkingHoursEditor";
import {
  agruparPorDia,
  aplanar,
  horarioVacio,
  validarHorario,
  type HorarioSemanal,
} from "./workingHours";

// El mismo tope que el backend (resource.controller.ts). El maxLength del
// navegador es comodidad; quien valida es Zod.
const MAX_NAME = 255;

interface ResourceFormValues {
  branchId: string | undefined;
  name: string;
  type: ResourceType | "";
  horario: HorarioSemanal;
}

const EMPTY_FORM: ResourceFormValues = {
  branchId: undefined,
  name: "",
  type: "",
  horario: horarioVacio(),
};

function toFormValues(resource: Resource, slots: WorkingHoursSlot[]): ResourceFormValues {
  return {
    branchId: resource.branchId,
    name: resource.name,
    type: resource.type,
    horario: agruparPorDia(slots),
  };
}

// ---------------------------------------------------------------------------
// Alta y edición de un recurso de la Agenda (ítem 75) — el modo se distingue
// del propio param de ruta (:id), mismo patrón que BranchFormPage.
//
// LA SUCURSAL NO SE PUEDE CAMBIAR EN EDICIÓN: updateResourceSchema no la
// acepta (un recurso no se muda, ver resource.service.ts) y mandarla sería un
// 400. Se muestra deshabilitada en vez de esconderla, mismo criterio que el
// branchId de AgentFormPage: que el dato esté a la vista informa más que su
// ausencia. El TIPO sí se puede cambiar: el PATCH lo acepta.
//
// EL HORARIO LABORAL VIVE ACÁ ADENTRO y no en una pantalla propia, y solo en
// edición: cuelga del id del recurso (PUT /resources/:id/working-hours), que en
// el alta todavía no existe. Se guarda con el MISMO botón que el resto —un solo
// "Guardar" como en todos los formularios— pero son dos requests: primero el
// PATCH del recurso y después el PUT con la semana entera. Si el segundo falla,
// la pantalla lo dice y no navega, para no perder el horario tipeado.
// ---------------------------------------------------------------------------
export function ResourceFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();

  const resourceQuery = useResource(isEditMode ? id : undefined);
  const hoursQuery = useWorkingHours(isEditMode ? id : undefined);
  const createResourceMutation = useCreateResource();
  const updateResourceMutation = useUpdateResource(id ?? "");
  const replaceHoursMutation = useReplaceWorkingHours(id ?? "");

  // El borrador se hidrata cuando llegaron LAS DOS lecturas: con una sola, el
  // formulario arrancaría con el horario vacío y se quedaría así.
  const cargado =
    resourceQuery.data !== undefined && hoursQuery.data !== undefined
      ? toFormValues(resourceQuery.data, hoursQuery.data.workingHours)
      : undefined;
  const [values, setValues] = useFormDraft<ResourceFormValues>(
    cargado ? resourceQuery.data?.id : undefined,
    cargado ?? EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);

  const isSubmitting =
    createResourceMutation.isPending ||
    updateResourceMutation.isPending ||
    replaceHoursMutation.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // Los dos selects: mientras la lista carga, BranchSelect no renderiza
    // ningún input que el navegador pueda frenar (el hueco que el propio
    // componente documenta), y el `required` del combobox de Tipo tampoco
    // alcanza para un valor vacío.
    if (!isEditMode && !values.branchId) {
      setError("Elegí la sucursal a la que pertenece este recurso.");
      return;
    }
    if (values.type === "") {
      setError("Elegí el tipo de recurso.");
      return;
    }

    if (!isEditMode) {
      try {
        await createResourceMutation.mutateAsync({
          branchId: values.branchId as string,
          name: values.name,
          type: values.type,
        });
        navigate("/resources");
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo guardar el recurso");
      }
      return;
    }

    // En edición el horario se valida ANTES de mandar nada: si está mal, no
    // tiene sentido guardar la mitad.
    const errorDeHorario = validarHorario(values.horario);
    if (errorDeHorario) {
      setError(errorDeHorario);
      return;
    }

    try {
      await updateResourceMutation.mutateAsync({ name: values.name, type: values.type });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el recurso");
      return;
    }

    try {
      await replaceHoursMutation.mutateAsync(aplanar(values.horario));
      navigate("/resources");
    } catch (err) {
      setError(
        `Los datos del recurso se guardaron, pero el horario no${
          err instanceof Error ? `: ${err.message}` : "."
        }`,
      );
    }
  }

  if (isEditMode && (resourceQuery.isLoading || hoursQuery.isLoading)) {
    return <LoadingState />;
  }

  if (isEditMode && (resourceQuery.isError || hoursQuery.isError)) {
    const causa = resourceQuery.error ?? hoursQuery.error;
    return (
      <ErrorState>
        No pudimos cargar el recurso
        {causa instanceof Error ? `: ${causa.message}` : "."}
      </ErrorState>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="ds-form">
      <h1>{isEditMode ? "Editar recurso" : "Nuevo recurso"}</h1>
      <div className="ds-stack">
        <Card heading="Datos del recurso">
          <div className="ds-field-grid">
            <FormField label={<span className="ds-required">Nombre</span>}>
              <input
                type="text"
                value={values.name}
                maxLength={MAX_NAME}
                placeholder="Consultorio 1"
                onChange={(event) => setValues({ ...values, name: event.target.value })}
                required
              />
            </FormField>

            {/* Sueltos, sin FormField: Select y BranchSelect traen su propio
                <label htmlFor> y FormField ES un <label>. */}
            <Select
              label="Tipo"
              required
              value={values.type}
              options={RESOURCE_TYPE_OPTIONS}
              emptyOption={{ label: "Elegir tipo…" }}
              onChange={(type) => setValues({ ...values, type })}
            />

            <BranchSelect
              id="resource-form-branch"
              label="Sucursal"
              value={values.branchId}
              onChange={(branchId) => setValues({ ...values, branchId: branchId || undefined })}
              required={!isEditMode}
              disabled={isEditMode}
            />
            {isEditMode ? (
              <p className="ds-hint ds-field-grid--full">
                Un recurso no se cambia de sucursal. Si quedó en la equivocada, creá uno nuevo en la
                correcta.
              </p>
            ) : (
              <p className="ds-hint ds-field-grid--full">
                Una persona, una sala o una clase: lo que se reserva. El horario en que atiende se
                carga después de crearlo.
              </p>
            )}
          </div>
        </Card>

        {isEditMode ? (
          <Card heading="Horario laboral">
            <p className="ds-hint">
              En qué días y horas se puede reservar este recurso, en la zona horaria de su sucursal.
              Un día puede tener varias franjas (por ejemplo, mañana y tarde). Sin ninguna franja,
              el recurso no atiende y no se le ofrecen turnos.
            </p>
            <WorkingHoursEditor
              value={values.horario}
              onChange={(horario) => setValues({ ...values, horario })}
              disabled={isSubmitting}
            />
          </Card>
        ) : null}

        {error ? <ErrorState>{error}</ErrorState> : null}

        <div>
          <RequiredFieldsHint />
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </form>
  );
}
