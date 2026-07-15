import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import type { ActivityType, CreateActivityInput, UpdateActivityInput } from "./types";

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

// Un único componente para create y edit, mismo patrón que
// CompanyFormPage/ContactFormPage/OpportunityFormPage.
export function ActivityFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();

  const activityQuery = useActivity(isEditMode ? id : undefined);
  const createActivityMutation = useCreateActivity();
  const updateActivityMutation = useUpdateActivity(id ?? "");

  const [values, setValues] = useState<ActivityFormValues>(EMPTY_FORM);
  const [originalRelations, setOriginalRelations] = useState<RelationState>(EMPTY_RELATIONS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isEditMode && activityQuery.data) {
      const activity = activityQuery.data;
      const relations: RelationState = {
        companyId: activity.companyId,
        contactId: activity.contactId,
        opportunityId: activity.opportunityId,
      };
      setValues({
        type: activity.type,
        subject: activity.subject,
        body: activity.body ?? "",
        // dueDate/completedAt son DateTime reales (con hora) — se hidratan
        // con toDatetimeLocalValue, nunca con un slice directo del ISO UTC
        // (ver datetimeLocal.ts).
        dueDate: activity.dueDate ? toDatetimeLocalValue(activity.dueDate) : "",
        completedAt: activity.completedAt ? toDatetimeLocalValue(activity.completedAt) : "",
        assigneeId: activity.assigneeId,
        companyId: relations.companyId,
        contactId: relations.contactId,
        opportunityId: relations.opportunityId,
      });
      setOriginalRelations(relations);
    }
  }, [isEditMode, activityQuery.data]);

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
    return <p>Cargando…</p>;
  }

  if (isEditMode && activityQuery.isError) {
    return (
      <p role="alert">
        No pudimos cargar la actividad
        {activityQuery.error instanceof Error ? `: ${activityQuery.error.message}` : "."}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>{isEditMode ? "Editar actividad" : "Nueva actividad"}</h1>
      <label>
        Tipo
        <select
          value={values.type}
          onChange={(event) => setValues({ ...values, type: event.target.value as ActivityType })}
        >
          {ACTIVITY_TYPES.map((type) => (
            <option key={type} value={type}>
              {ACTIVITY_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Asunto
        <input
          type="text"
          value={values.subject}
          onChange={(event) => setValues({ ...values, subject: event.target.value })}
          required
        />
      </label>
      <label>
        Notas
        <textarea
          value={values.body}
          onChange={(event) => setValues({ ...values, body: event.target.value })}
        />
      </label>
      <label>
        Vencimiento
        <input
          type="datetime-local"
          value={values.dueDate}
          onChange={(event) => setValues({ ...values, dueDate: event.target.value })}
        />
      </label>
      <label>
        Completada
        <input
          type="datetime-local"
          value={values.completedAt}
          onChange={(event) => setValues({ ...values, completedAt: event.target.value })}
        />
      </label>
      {/* assigneeId nunca se autoasigna al omitirse (a diferencia de
          ownerId en Opportunity) — emptyOptionLabel refleja eso. */}
      <UserSelect
        id="activity-form-assignee"
        label="Asignado a"
        value={values.assigneeId ?? undefined}
        onChange={(assigneeId) => setValues({ ...values, assigneeId: assigneeId || null })}
        emptyOptionLabel="Sin asignar"
      />
      <CompanySelect
        id="activity-form-company"
        label="Empresa"
        value={values.companyId ?? undefined}
        onChange={(companyId) => setValues({ ...values, companyId })}
      />
      {values.companyId ? (
        <button type="button" onClick={() => setValues({ ...values, companyId: null })}>
          Quitar empresa
        </button>
      ) : null}
      <ContactSelect
        id="activity-form-contact"
        label="Contacto"
        value={values.contactId ?? undefined}
        onChange={(contactId) => setValues({ ...values, contactId })}
      />
      {values.contactId ? (
        <button type="button" onClick={() => setValues({ ...values, contactId: null })}>
          Quitar contacto
        </button>
      ) : null}
      <OpportunitySelect
        id="activity-form-opportunity"
        label="Oportunidad"
        value={values.opportunityId ?? undefined}
        onChange={(opportunityId) => setValues({ ...values, opportunityId })}
      />
      {values.opportunityId ? (
        <button type="button" onClick={() => setValues({ ...values, opportunityId: null })}>
          Quitar oportunidad
        </button>
      ) : null}
      <p>Debe indicar Empresa, Contacto, Oportunidad, o una combinación de estos.</p>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Guardando…" : "Guardar"}
      </button>
    </form>
  );
}
