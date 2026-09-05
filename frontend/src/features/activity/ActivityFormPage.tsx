import { useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { CompanySelect } from "../company/CompanySelect";
import { ContactSelect } from "../opportunity/ContactSelect";
import { UserSelect } from "../user/UserSelect";
import { OpportunitySelect } from "./OpportunitySelect";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "./datetimeLocal";
import { useCreateActivity, useUpdateActivity } from "./mutations";
import { useActivity } from "./queries";
import {
  buildCreateRelationFields,
  buildRelationPatch,
  hasAtLeastOneRelation,
  type RelationState,
} from "./relationPatch";
import { ACTIVITY_TYPES, ACTIVITY_TYPE_LABELS } from "./types";
import type { Activity, ActivityType, CreateActivityInput, UpdateActivityInput } from "./types";
import { useFormDraft } from "../../lib/useFormDraft";

interface ActivityFormValues {
  type: ActivityType;
  subject: string;
  body: string;
  dueDate: string; // valor de <input type="datetime-local">, "" si vacío
  completedAt: string;
  assigneeId: string | null;
  companyId: string | null;
  contactId: string | null;
  opportunityId: string | null;
}

const EMPTY_FORM: ActivityFormValues = {
  type: "CALL",
  subject: "",
  body: "",
  dueDate: "",
  completedAt: "",
  assigneeId: null,
  companyId: null,
  contactId: null,
  opportunityId: null,
};

const EMPTY_RELATIONS: RelationState = { companyId: null, contactId: null, opportunityId: null };

function relationsFrom(values: ActivityFormValues): RelationState {
  return {
    companyId: values.companyId,
    contactId: values.contactId,
    opportunityId: values.opportunityId,
  };
}

// Create: campos vacíos se omiten (undefined) — el backend NO admite null
// en create (createActivitySchema no tiene .nullable() en ningún campo).
// Las relaciones usan buildCreateRelationFields: solo viajan las que
// tienen valor, nunca se envía null acá.
function toCreateInput(values: ActivityFormValues): CreateActivityInput {
  return {
    type: values.type,
    subject: values.subject,
    body: values.body || undefined,
    dueDate: values.dueDate ? fromDatetimeLocalValue(values.dueDate) : undefined,
    completedAt: values.completedAt ? fromDatetimeLocalValue(values.completedAt) : undefined,
    assigneeId: values.assigneeId || undefined,
    ...buildCreateRelationFields(relationsFrom(values)),
  };
}

// Update: type/subject/body/dueDate/completedAt/assigneeId siempre viajan,
// con `null` explícito si el campo quedó vacío (mismo criterio que
// Opportunity con lostReason/expectedCloseDate/actualCloseDate). Las tres
// relaciones NO siguen ese criterio: usan buildRelationPatch, que compara
// contra el estado ORIGINAL (lo que trajo el GET) y solo incluye una clave
// si el usuario realmente la tocó — agregar un Contact sin tocar la
// Company ya seleccionada nunca limpia esa Company.
function toUpdateInput(values: ActivityFormValues, original: RelationState): UpdateActivityInput {
  return {
    type: values.type,
    subject: values.subject,
    body: values.body || null,
    dueDate: values.dueDate ? fromDatetimeLocalValue(values.dueDate) : null,
    completedAt: values.completedAt ? fromDatetimeLocalValue(values.completedAt) : null,
    assigneeId: values.assigneeId || null,
    ...buildRelationPatch(original, relationsFrom(values)),
  };
}

// Relaciones tal como vinieron del servidor: es el snapshot contra el que
// toUpdateInput calcula el patch. Antes era estado (setOriginalRelations dentro
// del efecto de hidratación) y no hacía falta: nunca cambia después de llegar,
// así que se deriva.
function relationsOf(data: Activity): RelationState {
  return {
    companyId: data.companyId,
    contactId: data.contactId,
    opportunityId: data.opportunityId,
  };
}

// Valores del formulario derivados de una Activity ya persistida. Antes esto
// vivía adentro de un useEffect que hacía setValues; ahora es una función pura
// y el estado local aparece recién cuando el usuario edita algo — ver
// lib/useFormDraft.ts para por qué ese efecto perdía datos.
function toFormValues(data: Activity): ActivityFormValues {
  const relations = relationsOf(data);
  return {
    type: data.type,
    subject: data.subject,
    body: data.body ?? "",
    // dueDate/completedAt son DateTime reales (con hora) — se hidratan
    // con toDatetimeLocalValue, nunca con un slice directo del ISO UTC
    // (ver datetimeLocal.ts).
    dueDate: data.dueDate ? toDatetimeLocalValue(data.dueDate) : "",
    completedAt: data.completedAt ? toDatetimeLocalValue(data.completedAt) : "",
    assigneeId: data.assigneeId,
    companyId: relations.companyId,
    contactId: relations.contactId,
    opportunityId: relations.opportunityId,
  };
}

// Un único componente para create y edit, mismo patrón que
// CompanyFormPage/ContactFormPage/OpportunityFormPage.
//
// Restyle conservador sobre el diseño "Nueva actividad": una sola tarjeta
// "Datos de la actividad". Tres cosas del diseño NO se replican, a
// propósito, porque no reflejan el modelo real:
// - "Relacionado con" como elección única (Contacto | Empresa | Oportunidad
//   | Ninguno): activities_related_entity_check es un OR, no un XOR
//   (relationPatch.ts). Company + Contact + Opportunity a la vez es un
//   estado válido, así que los tres selectores siguen siendo independientes.
// - "Marcar como completada" como switch: completedAt es un datetime
//   completo y este formulario permite cargar la hora real de cierre; un
//   toggle perdería esa precisión. Vencimiento y Completada siguen siendo
//   datetime-local.
// - "Tipo" como fila de botones: sigue siendo un <select>, como en el resto
//   de los formularios migrados.
//
// Los selectores (UserSelect, CompanySelect, ContactSelect, OpportunitySelect)
// se montan sueltos, sin FormField: traen su propio <label htmlFor>, y
// FormField ES un <label>. Mismo trato que en CompanyFormPage.
export function ActivityFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();

  const activityQuery = useActivity(isEditMode ? id : undefined);
  const createActivityMutation = useCreateActivity();
  const updateActivityMutation = useUpdateActivity(id ?? "");

  // Solo en creación: "+ Nueva tarea" de "Mis tareas" llega con assigneeId
  // en la query string para que la tarea nazca asignada a quien la pidió.
  // Valor inicial derivado, igual que EMPTY_FORM (mismo patrón que
  // pipelineId/stageId en OpportunityFormPage): sigue editable, y un id
  // inexistente lo rechaza el backend como siempre. En edición se ignora.
  const [searchParams] = useSearchParams();
  const initialValues: ActivityFormValues = isEditMode
    ? EMPTY_FORM
    : { ...EMPTY_FORM, assigneeId: searchParams.get("assigneeId") };

  const [values, setValues] = useFormDraft<ActivityFormValues>(
    activityQuery.data?.id,
    activityQuery.data ? toFormValues(activityQuery.data) : initialValues,
  );
  const originalRelations: RelationState = activityQuery.data
    ? relationsOf(activityQuery.data)
    : EMPTY_RELATIONS;
  const [error, setError] = useState<string | null>(null);

  const isSubmitting = createActivityMutation.isPending || updateActivityMutation.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // Reduce estados inválidos ANTES de la request — el backend sigue
    // siendo la única autoridad real (activities_related_entity_check): si
    // una carrera concurrente real igual produce el 400 del CHECK, se
    // muestra tal cual más abajo, sin traducirlo ni ocultarlo.
    if (!hasAtLeastOneRelation(relationsFrom(values))) {
      setError("Debe indicar Empresa, Contacto, Oportunidad, o una combinación de estos");
      return;
    }

    try {
      if (isEditMode) {
        await updateActivityMutation.mutateAsync(toUpdateInput(values, originalRelations));
      } else {
        await createActivityMutation.mutateAsync(toCreateInput(values));
      }
      navigate("/activities");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la actividad");
    }
  }

  if (isEditMode && activityQuery.isLoading) {
    return <LoadingState />;
  }

  if (isEditMode && activityQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar la actividad
        {activityQuery.error instanceof Error ? `: ${activityQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  // Grilla de a pares (.ds-field-grid, del restyle de Empresas) en el orden
  // del export: Tipo, Asunto y Notas a lo ancho; las tres relaciones a lo
  // ancho con su "Quitar" y el hint debajo (en el diseño es un único control
  // "Relacionado con", ver arriba; a dos columnas quedaban irregulares porque
  // cada una crece con "Seleccionada" y "Quitar"); Asignado a + Vencimiento
  // como par (el diseño los llama "Responsable" y "Fecha de vencimiento", los
  // rótulos reales no cambian); Completada sola a media columna, donde el
  // diseño pone "Marcar como completada". El "*" va SOLO en Asunto, el único
  // input con `required`: el diseño también marca Tipo y Responsable, pero
  // assigneeId es opcional (toCreateInput) y Tipo siempre tiene un valor, así
  // que un asterisco ahí mentiría.
  return (
    <form onSubmit={handleSubmit} className="ds-form">
      <h1>{isEditMode ? "Editar actividad" : "Nueva actividad"}</h1>
      <div className="ds-stack">
        <Card heading="Datos de la actividad">
          <div className="ds-field-grid">
            <div className="ds-field-grid--full">
              <FormField label="Tipo">
                <select
                  value={values.type}
                  onChange={(event) =>
                    setValues({ ...values, type: event.target.value as ActivityType })
                  }
                >
                  {ACTIVITY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {ACTIVITY_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
            <div className="ds-field-grid--full">
              <FormField label={<span className="ds-required">Asunto</span>}>
                <input
                  type="text"
                  value={values.subject}
                  onChange={(event) => setValues({ ...values, subject: event.target.value })}
                  required
                />
              </FormField>
            </div>
            <div className="ds-field-grid--full">
              <FormField label="Notas">
                <textarea
                  value={values.body}
                  onChange={(event) => setValues({ ...values, body: event.target.value })}
                />
              </FormField>
            </div>
            <div className="ds-field ds-field-grid--full">
              <CompanySelect
                id="activity-form-company"
                label="Empresa"
                value={values.companyId ?? undefined}
                onChange={(companyId) => setValues({ ...values, companyId })}
              />
              {values.companyId ? (
                <Button onClick={() => setValues({ ...values, companyId: null })}>
                  Quitar empresa
                </Button>
              ) : null}
            </div>
            <div className="ds-field ds-field-grid--full">
              <ContactSelect
                id="activity-form-contact"
                label="Contacto"
                value={values.contactId ?? undefined}
                onChange={(contactId) => setValues({ ...values, contactId })}
              />
              {values.contactId ? (
                <Button onClick={() => setValues({ ...values, contactId: null })}>
                  Quitar contacto
                </Button>
              ) : null}
            </div>
            <div className="ds-field ds-field-grid--full">
              <OpportunitySelect
                id="activity-form-opportunity"
                label="Oportunidad"
                value={values.opportunityId ?? undefined}
                onChange={(opportunityId) => setValues({ ...values, opportunityId })}
              />
              {values.opportunityId ? (
                <Button onClick={() => setValues({ ...values, opportunityId: null })}>
                  Quitar oportunidad
                </Button>
              ) : null}
            </div>
            <p className="ds-hint ds-field-grid--full">
              Debe indicar Empresa, Contacto, Oportunidad, o una combinación de estos.
            </p>
            {/* assigneeId nunca se autoasigna al omitirse (a diferencia de
                ownerId en Opportunity) — emptyOptionLabel refleja eso. */}
            <UserSelect
              id="activity-form-assignee"
              label="Asignado a"
              value={values.assigneeId ?? undefined}
              onChange={(assigneeId) => setValues({ ...values, assigneeId: assigneeId || null })}
              emptyOptionLabel="Sin asignar"
            />
            <FormField label="Vencimiento">
              <input
                type="datetime-local"
                value={values.dueDate}
                onChange={(event) => setValues({ ...values, dueDate: event.target.value })}
              />
            </FormField>
            <FormField label="Completada">
              <input
                type="datetime-local"
                value={values.completedAt}
                onChange={(event) => setValues({ ...values, completedAt: event.target.value })}
              />
            </FormField>
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
