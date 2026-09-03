import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { CompanySelect } from "../company/CompanySelect";
import { PipelineSelect } from "../pipeline/PipelineSelect";
import { StageSelect } from "../stage/StageSelect";
import { UserSelect } from "../user/UserSelect";
import { ContactSelect } from "./ContactSelect";
import { useCreateOpportunity, useUpdateOpportunity } from "./mutations";
import { useOpportunity } from "./queries";
import type {
  CreateOpportunityInput,
  Opportunity,
  OpportunityStatus,
  UpdateOpportunityInput,
} from "./types";
import { useFormDraft } from "../../lib/useFormDraft";

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

// Valores del formulario derivados de un registro ya persistido. Antes esto
// vivía adentro de un useEffect que hacía setValues; ahora es una función pura
// y el estado local aparece recién cuando el usuario edita algo — ver
// lib/useFormDraft.ts para por qué ese efecto perdía datos.
function toFormValues(data: Opportunity): OpportunityFormValues {
  return {
    title: data.title,
    // amount llega como string (Decimal) — Number() para poder
    // editarlo como campo numérico, nunca el string crudo tal cual.
    amount: String(Number(data.amount)),
    currency: data.currency,
    status: data.status,
    lostReason: data.lostReason ?? "",
    companyId: data.companyId ?? undefined,
    contactId: data.contactId ?? undefined,
    pipelineId: data.pipelineId,
    stageId: data.stageId,
    ownerId: data.ownerId,
    // Lectura ISO → slice(0,10): nunca new Date(iso) + formateo local
    // (evita corrimiento de día por timezone).
    expectedCloseDate: data.expectedCloseDate?.slice(0, 10) ?? "",
    actualCloseDate: data.actualCloseDate?.slice(0, 10) ?? "",
  };
}

// Moneda: texto libre normalizado a 3 letras mayúsculas, que es exactamente
// el regex del backend (^[A-Z]{3}$, opportunity.controller.ts). NO es un
// <select> cerrado como en el diseño: el backend acepta cualquier código
// ISO 4217 a propósito y una lista de 3 o 4 opciones inventaría una
// restricción que no existe.
function normalizeCurrency(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 3);
}

// Un único componente para create y edit, mismo patrón que
// CompanyFormPage/ContactFormPage/PipelineFormPage/StageFormPage.
//
// Campos agrupados en tarjetas como en "Nueva oportunidad": "Oportunidad"
// (título y a quién se asocia) y "Embudo y valor". Estado, Motivo de pérdida
// y Fecha real de cierre van en una tercera tarjeta SOLO en edición: el
// diseño no los tiene en creación porque toda oportunidad nueva arranca
// abierta (EMPTY_FORM.status es "OPEN") y el cierre se haría desde el
// Kanban; pero el Kanban todavía no existe, así que sacarlos también de la
// edición dejaría sin forma de cerrar una oportunidad. En edición su
// comportamiento no cambia en nada.
//
// Los selectores (CompanySelect, ContactSelect, PipelineSelect, StageSelect,
// UserSelect) se montan sueltos, sin FormField: traen su propio <label
// htmlFor>, y FormField ES un <label>. Mismo trato que en CompanyFormPage.
export function OpportunityFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();

  const opportunityQuery = useOpportunity(isEditMode ? id : undefined);
  const createOpportunityMutation = useCreateOpportunity();
  const updateOpportunityMutation = useUpdateOpportunity(id ?? "");

  const [values, setValues] = useFormDraft<OpportunityFormValues>(
    opportunityQuery.data?.id,
    opportunityQuery.data ? toFormValues(opportunityQuery.data) : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);

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
    return <LoadingState />;
  }

  if (isEditMode && opportunityQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar la oportunidad
        {opportunityQuery.error instanceof Error ? `: ${opportunityQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>{isEditMode ? "Editar oportunidad" : "Nueva oportunidad"}</h1>
      <div className="ds-stack">
        <Card heading="Oportunidad">
          <FormField label="Título">
            <input
              type="text"
              value={values.title}
              onChange={(event) => setValues({ ...values, title: event.target.value })}
              required
            />
          </FormField>
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
        </Card>

        <Card heading="Embudo y valor">
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
          <div className="ds-field-row">
            <FormField label="Monto">
              <input
                type="number"
                min={0}
                step="0.01"
                value={values.amount}
                onChange={(event) => setValues({ ...values, amount: event.target.value })}
              />
            </FormField>
            <FormField label="Moneda">
              <input
                type="text"
                maxLength={3}
                pattern="[A-Z]{3}"
                title="Código de 3 letras (ISO 4217), por ejemplo USD o UYU"
                value={values.currency}
                onChange={(event) =>
                  setValues({ ...values, currency: normalizeCurrency(event.target.value) })
                }
              />
            </FormField>
          </div>
          <FormField label="Fecha estimada de cierre">
            <input
              type="date"
              value={values.expectedCloseDate}
              onChange={(event) => setValues({ ...values, expectedCloseDate: event.target.value })}
            />
          </FormField>
          <UserSelect
            id="opportunity-form-owner"
            label="Propietario"
            value={values.ownerId}
            onChange={(ownerId) => setValues({ ...values, ownerId: ownerId || undefined })}
          />
        </Card>

        {isEditMode ? (
          <Card heading="Estado y cierre">
            <FormField label="Estado">
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
            </FormField>
            {/* Siempre visible y editable, sin importar status (ver
                docs/project-overview.md: decisión de M5 corregida — el backend
                no sincroniza lostReason con status, no se inventa esa
                sincronización ni se oculta el campo). */}
            <FormField label="Motivo de pérdida">
              <input
                type="text"
                value={values.lostReason}
                onChange={(event) => setValues({ ...values, lostReason: event.target.value })}
              />
            </FormField>
            <p className="ds-hint">Especialmente relevante cuando el estado es LOST.</p>
            <FormField label="Fecha real de cierre">
              <input
                type="date"
                value={values.actualCloseDate}
                onChange={(event) => setValues({ ...values, actualCloseDate: event.target.value })}
              />
            </FormField>
          </Card>
        ) : null}

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
