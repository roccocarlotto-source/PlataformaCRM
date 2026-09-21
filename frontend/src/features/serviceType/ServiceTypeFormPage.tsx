import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { RequiredFieldsHint } from "../../design-system/RequiredFieldsHint";
import { useFormDraft } from "../../lib/useFormDraft";
import { BranchSelect } from "../branch/BranchSelect";
import { ResourceSelect } from "../resource/ResourceSelect";
import { useCreateServiceType, useUpdateServiceType } from "./mutations";
import { useServiceType } from "./queries";
import type { CreateServiceTypeInput, ServiceType } from "./types";

// Los mismos topes que el backend (serviceType.controller.ts).
const MAX_NAME = 255;
const MAX_DURATION = 24 * 60;

interface ServiceTypeFormValues {
  branchId: string | undefined;
  resourceId: string | undefined;
  name: string;
  // Texto y no número: es lo que tiene un <input type="number"> mientras se
  // tipea, y así "vacío" se distingue de 0.
  durationMin: string;
  capacity: string;
}

const EMPTY_FORM: ServiceTypeFormValues = {
  branchId: undefined,
  resourceId: undefined,
  name: "",
  durationMin: "",
  capacity: "",
};

function toFormValues(serviceType: ServiceType): ServiceTypeFormValues {
  return {
    branchId: serviceType.branchId,
    resourceId: serviceType.resourceId,
    name: serviceType.name,
    durationMin: String(serviceType.durationMin),
    capacity: String(serviceType.capacity),
  };
}

function enteroPositivo(valor: string): number | undefined {
  const numero = Number(valor);
  return valor.trim() !== "" && Number.isInteger(numero) && numero >= 1 ? numero : undefined;
}

// ---------------------------------------------------------------------------
// Alta y edición de un tipo de servicio de la Agenda (ítem 75) — mismo patrón
// que ResourceFormPage/BranchFormPage.
//
// LA SUCURSAL SÍ SE PUEDE CAMBIAR, a diferencia de Resource, pero el backend
// exige que viaje JUNTO con el recurso: el recurso viejo pertenece a la
// sucursal vieja. Por eso cambiar la sucursal VACÍA el recurso elegido y
// obliga a elegir uno nuevo de la sucursal nueva — el selector solo ofrece los
// de la sucursal elegida. En edición se mandan los dos siempre, sin
// diferenciar qué cambió, mismo criterio que BranchFormPage.
//
// El cupo es opcional: vacío en el alta, lo pone el backend (1 = turno
// exclusivo); vacío en la edición, no se toca.
// ---------------------------------------------------------------------------
export function ServiceTypeFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();

  const serviceTypeQuery = useServiceType(isEditMode ? id : undefined);
  const createMutation = useCreateServiceType();
  const updateMutation = useUpdateServiceType(id ?? "");

  const [values, setValues] = useFormDraft<ServiceTypeFormValues>(
    serviceTypeQuery.data?.id,
    serviceTypeQuery.data ? toFormValues(serviceTypeQuery.data) : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // Los selectores: mientras sus listas cargan no hay ningún input que el
    // navegador pueda frenar (el hueco que BranchSelect documenta).
    if (!values.branchId) {
      setError("Elegí la sucursal del servicio.");
      return;
    }
    if (!values.resourceId) {
      setError("Elegí el recurso que atiende este servicio.");
      return;
    }
    const durationMin = enteroPositivo(values.durationMin);
    if (durationMin === undefined || durationMin > MAX_DURATION) {
      setError(`La duración tiene que ser un número entero de minutos, entre 1 y ${MAX_DURATION}.`);
      return;
    }
    const capacity = values.capacity.trim() === "" ? undefined : enteroPositivo(values.capacity);
    if (values.capacity.trim() !== "" && capacity === undefined) {
      setError("El cupo tiene que ser un número entero, 1 o más.");
      return;
    }

    const input: CreateServiceTypeInput = {
      branchId: values.branchId,
      resourceId: values.resourceId,
      name: values.name,
      durationMin,
      ...(capacity !== undefined ? { capacity } : {}),
    };

    try {
      if (isEditMode) {
        await updateMutation.mutateAsync(input);
      } else {
        await createMutation.mutateAsync(input);
      }
      navigate("/service-types");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el tipo de servicio");
    }
  }

  if (isEditMode && serviceTypeQuery.isLoading) {
    return <LoadingState />;
  }

  if (isEditMode && serviceTypeQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar el tipo de servicio
        {serviceTypeQuery.error instanceof Error ? `: ${serviceTypeQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="ds-form">
      <h1>{isEditMode ? "Editar tipo de servicio" : "Nuevo tipo de servicio"}</h1>
      <div className="ds-stack">
        <Card heading="Datos del servicio">
          <div className="ds-field-grid">
            <FormField label={<span className="ds-required">Nombre</span>}>
              <input
                type="text"
                value={values.name}
                maxLength={MAX_NAME}
                placeholder="Consulta general"
                onChange={(event) => setValues({ ...values, name: event.target.value })}
                required
              />
            </FormField>

            {/* Sueltos, sin FormField: BranchSelect y ResourceSelect traen su
                propio <label htmlFor> y FormField ES un <label>. */}
            <BranchSelect
              id="service-type-form-branch"
              label="Sucursal"
              value={values.branchId}
              onChange={(branchId) =>
                setValues({
                  ...values,
                  branchId: branchId || undefined,
                  // El recurso viejo es de la sucursal vieja: se vacía y hay
                  // que elegir uno de la nueva (el backend lo exige igual).
                  resourceId: branchId === values.branchId ? values.resourceId : undefined,
                })
              }
              required
            />

            <ResourceSelect
              id="service-type-form-resource"
              label="Recurso"
              value={values.resourceId}
              branchId={values.branchId}
              onChange={(resourceId) =>
                setValues({ ...values, resourceId: resourceId || undefined })
              }
              required
              disabled={!values.branchId}
            />
            <p className="ds-hint ds-field-grid--full">
              {values.branchId
                ? "La persona, sala o clase que atiende este servicio. Solo se ofrecen los recursos de la sucursal elegida."
                : "Elegí primero la sucursal: el recurso tiene que ser de la misma."}
            </p>

            <FormField label={<span className="ds-required">Duración (minutos)</span>}>
              <input
                type="number"
                min={1}
                max={MAX_DURATION}
                step={1}
                value={values.durationMin}
                placeholder="30"
                onChange={(event) => setValues({ ...values, durationMin: event.target.value })}
                required
              />
            </FormField>

            <FormField label="Cupo">
              <input
                type="number"
                min={1}
                step={1}
                value={values.capacity}
                placeholder="1"
                onChange={(event) => setValues({ ...values, capacity: event.target.value })}
              />
            </FormField>
            <p className="ds-hint ds-field-grid--full">
              Cuántas personas pueden reservar el mismo turno. 1 es un turno exclusivo (una
              consulta); más de 1, una clase con cupo. Si lo dejás vacío al crearlo, queda en 1.
            </p>
          </div>
        </Card>

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
