import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CompanySelect } from "../company/CompanySelect";
import { PipelineSelect } from "../pipeline/PipelineSelect";
import { StageSelect } from "../stage/StageSelect";
import { UserSelect } from "../user/UserSelect";
import { ContactSelect } from "./ContactSelect";
import { useCreateOpportunity, useUpdateOpportunity } from "./mutations";
import { useOpportunity } from "./queries";
import type { CreateOpportunityInput, OpportunityStatus, UpdateOpportunityInput } from "./types";

interface OpportunityFormValues {
  title: string;
  amount: string;
  currency: string;
  status: OpportunityStatus;
  lostReason: string;
  companyId: string | undefined;
  contactId: string | undefined;
  pipelineId: string | undefined;
  stageId: string | undefined;
  ownerId: string | undefined;
  expectedCloseDate: string;
  actualCloseDate: string;
}

const EMPTY_FORM: OpportunityFormValues = {
  title: "",
  amount: "",
  currency: "USD",
  status: "OPEN",
  lostReason: "",
  companyId: undefined,
  contactId: undefined,
  pipelineId: undefined,
  stageId: undefined,
  ownerId: undefined,
  expectedCloseDate: "",
  actualCloseDate: "",
};

// Create: campos vacíos se omiten (undefined) — el backend NO admite null
// en create para expectedCloseDate/actualCloseDate/lostReason (a diferencia
// de update, ver types.ts). pipelineId/stageId son obligatorios en el
// contrato real; si el usuario no eligió ninguno se envía "" y el backend
// lo rechaza con su propio mensaje ("pipelineId inválido") — no se
// duplica esa validación acá.
function toCreateInput(values: OpportunityFormValues): CreateOpportunityInput {
  return {
    title: values.title,
    amount: values.amount ? Number(values.amount) : undefined,
    currency: values.currency || undefined,
    status: values.status,
    lostReason: values.lostReason || undefined,
    companyId: values.companyId,
    contactId: values.contactId,
    pipelineId: values.pipelineId ?? "",
    stageId: values.stageId ?? "",
    ownerId: values.ownerId || undefined,
    expectedCloseDate: values.expectedCloseDate || undefined,
    actualCloseDate: values.actualCloseDate || undefined,
  };
}

// Update: campos vacíos envían `null` explícito — limpia el valor existente
// (a diferencia de create; reabre el camino WON/LOST → OPEN sin arrastrar
// datos de un cierre anterior). companyId/contactId/pipelineId/stageId/
// ownerId permanecen `string | undefined` (nunca null): el backend los
// trata con chequeo truthy (opportunity.service.ts), no se pueden limpiar
// vía PATCH.
function toUpdateInput(values: OpportunityFormValues): UpdateOpportunityInput {
  return {
    title: values.title,
    amount: values.amount ? Number(values.amount) : undefined,
    currency: values.currency || undefined,
    status: values.status,
    lostReason: values.lostReason || null,
    companyId: values.companyId,
    contactId: values.contactId,
    pipelineId: values.pipelineId,
    stageId: values.stageId,
    ownerId: values.ownerId || undefined,
    expectedCloseDate: values.expectedCloseDate || null,
    actualCloseDate: values.actualCloseDate || null,
  };
}

// Un único componente para create y edit, mismo patrón que
// CompanyFormPage/ContactFormPage/PipelineFormPage/StageFormPage.
export function OpportunityFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();

  const opportunityQuery = useOpportunity(isEditMode ? id : undefined);
  const createOpportunityMutation = useCreateOpportunity();
  const updateOpportunityMutation = useUpdateOpportunity(id ?? "");

  const [values, setValues] = useState<OpportunityFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isEditMode && opportunityQuery.data) {
      const opportunity = opportunityQuery.data;
      setValues({
        title: opportunity.title,
        // amount llega como string (Decimal) — Number() para poder
        // editarlo como campo numérico, nunca el string crudo tal cual.
        amount: String(Number(opportunity.amount)),
        currency: opportunity.currency,
        status: opportunity.status,
        lostReason: opportunity.lostReason ?? "",
        companyId: opportunity.companyId ?? undefined,
        contactId: opportunity.contactId ?? undefined,
        pipelineId: opportunity.pipelineId,
        stageId: opportunity.stageId,
        ownerId: opportunity.ownerId,
        // Lectura ISO → slice(0,10): nunca new Date(iso) + formateo local
        // (evita corrimiento de día por timezone).
        expectedCloseDate: opportunity.expectedCloseDate?.slice(0, 10) ?? "",
        actualCloseDate: opportunity.actualCloseDate?.slice(0, 10) ?? "",
      });
    }
  }, [isEditMode, opportunityQuery.data]);

  const isSubmitting = createOpportunityMutation.isPending || updateOpportunityMutation.isPending;

  // Cambiar pipelineId limpia stageId — justificado por una regla real del
  // backend (opportunity.service.ts validateStageId: un stage de otro
  // pipeline es rechazado). A diferencia de Company/Contact (abajo), acá SÍ
  // hay reset.
  function handlePipelineChange(pipelineId: string) {
    setValues((current) => ({ ...current, pipelineId, stageId: undefined }));
  }

  // Company y Contact son independientes — el backend no exige que Contact
  // pertenezca a Company en Opportunity (validateCompanyId/validateContactId
  // en opportunity.service.ts no se cruzan entre sí, ver ContactSelect.tsx).
  // Cambiar uno NUNCA modifica el otro.
  function handleCompanyChange(companyId: string) {
    setValues((current) => ({ ...current, companyId }));
  }

  function handleContactChange(contactId: string) {
    setValues((current) => ({ ...current, contactId }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      if (isEditMode) {
        await updateOpportunityMutation.mutateAsync(toUpdateInput(values));
      } else {
        await createOpportunityMutation.mutateAsync(toCreateInput(values));
      }
      navigate("/opportunities");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la oportunidad");
    }
  }

  if (isEditMode && opportunityQuery.isLoading) {
    return <p>Cargando…</p>;
  }

  if (isEditMode && opportunityQuery.isError) {
    return (
      <p role="alert">
        No pudimos cargar la oportunidad
        {opportunityQuery.error instanceof Error ? `: ${opportunityQuery.error.message}` : "."}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>{isEditMode ? "Editar oportunidad" : "Nueva oportunidad"}</h1>
      <label>
        Título
        <input
          type="text"
          value={values.title}
          onChange={(event) => setValues({ ...values, title: event.target.value })}
          required
        />
      </label>
      <label>
        Monto
        <input
          type="number"
          min={0}
          step="0.01"
          value={values.amount}
          onChange={(event) => setValues({ ...values, amount: event.target.value })}
        />
      </label>
      <label>
        Moneda
        <input
          type="text"
          maxLength={3}
          value={values.currency}
          onChange={(event) => setValues({ ...values, currency: event.target.value })}
        />
      </label>
      <label>
        Estado
        <select
          value={values.status}
          onChange={(event) =>
            setValues({ ...values, status: event.target.value as OpportunityStatus })
          }
        >
          <option value="OPEN">OPEN</option>
          <option value="WON">WON</option>
          <option value="LOST">LOST</option>
        </select>
      </label>
      {/* Siempre visible y editable, sin importar status (ver
          docs/project-overview.md: decisión de M5 corregida — el backend
          no sincroniza lostReason con status, no se inventa esa
          sincronización ni se oculta el campo). */}
      <label>
        Motivo de pérdida
        <input
          type="text"
          value={values.lostReason}
          onChange={(event) => setValues({ ...values, lostReason: event.target.value })}
        />
      </label>
      <p>Especialmente relevante cuando el estado es LOST.</p>
      <CompanySelect
        id="opportunity-form-company"
        label="Empresa"
        value={values.companyId}
        onChange={handleCompanyChange}
      />
      <ContactSelect
        id="opportunity-form-contact"
        label="Contacto"
        value={values.contactId}
        onChange={handleContactChange}
      />
      <PipelineSelect
        id="opportunity-form-pipeline"
        label="Pipeline"
        value={values.pipelineId}
        onChange={handlePipelineChange}
      />
      <StageSelect
        id="opportunity-form-stage"
        label="Etapa"
        pipelineId={values.pipelineId}
        value={values.stageId}
        onChange={(stageId) => setValues({ ...values, stageId })}
      />
      <UserSelect
        id="opportunity-form-owner"
        label="Propietario"
        value={values.ownerId}
        onChange={(ownerId) => setValues({ ...values, ownerId: ownerId || undefined })}
      />
      <label>
        Fecha estimada de cierre
        <input
          type="date"
          value={values.expectedCloseDate}
          onChange={(event) => setValues({ ...values, expectedCloseDate: event.target.value })}
        />
      </label>
      <label>
        Fecha real de cierre
        <input
          type="date"
          value={values.actualCloseDate}
          onChange={(event) => setValues({ ...values, actualCloseDate: event.target.value })}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Guardando…" : "Guardar"}
      </button>
    </form>
  );
}
