import { useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { CurrencyInput } from "../../design-system/CurrencyInput";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { RequiredFieldsHint } from "../../design-system/RequiredFieldsHint";
import { CompanySelect } from "../company/CompanySelect";
import { PipelineSelect } from "../pipeline/PipelineSelect";
import { StageSelect } from "../stage/StageSelect";
import { UserSelect } from "../user/UserSelect";
import { VehicleSelect } from "../vehicle/VehicleSelect";
import { todayIsoDate } from "./boardMove";
import { ContactSelect } from "./ContactSelect";
import { FINANCING_TYPE_LABELS, LEAD_SOURCE_LABELS, STATUS_LABEL, STATUSES } from "./labels";
import { useCreateOpportunity, useUpdateOpportunity } from "./mutations";
import { useOpportunity } from "./queries";
import type {
  CreateOpportunityInput,
  Opportunity,
  OpportunityFinancingType,
  OpportunityLeadSource,
  OpportunityStatus,
  UpdateOpportunityInput,
} from "./types";
import { CURRENCY_OPTIONS, isKnownCurrency } from "../../lib/currencies";
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
  vehicleId: string | undefined;
  financingType: OpportunityFinancingType | "";
  leadSource: OpportunityLeadSource | "";
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
  vehicleId: undefined,
  financingType: "",
  leadSource: "",
};

const FINANCING_TYPE_OPTIONS = Object.keys(FINANCING_TYPE_LABELS) as OpportunityFinancingType[];
const LEAD_SOURCE_OPTIONS = Object.keys(LEAD_SOURCE_LABELS) as OpportunityLeadSource[];

// Moneda: <select> cerrado con las dos monedas de la operación real (ítem
// 18.B de docs/frontend-cambios-pendientes.md). Antes era texto libre
// normalizado a 3 letras porque el backend acepta cualquier código ISO 4217
// (^[A-Z]{3}$, opportunity.controller.ts) y una lista parecía inventar una
// restricción; en la práctica solo generaba tipeos ("usd", "U$S"). El backend
// NO cambia: la restricción es del lado del cliente. Sin opción "Otra". La
// lista vive en lib/currencies.ts desde el ítem 19, compartida con la
// configuración de moneda de la organización.

// Create: campos vacíos se omiten (undefined) — el backend NO admite null
// en create para expectedCloseDate/actualCloseDate/lostReason (a diferencia
// de update, ver types.ts). pipelineId/stageId son obligatorios en el
// contrato real y handleSubmit los exige antes de llegar acá (ítem 10 de
// docs/frontend-cambios-pendientes.md); el `?? ""` es solo para el tipo. Si
// igual llegara vacío, el backend lo rechaza con su propio mensaje
// ("pipelineId inválido").
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
    vehicleId: values.vehicleId,
    financingType: values.financingType || undefined,
    leadSource: values.leadSource || undefined,
  };
}

// Update: campos vacíos envían `null` explícito — limpia el valor existente
// (a diferencia de create; reabre el camino WON/LOST → OPEN sin arrastrar
// datos de un cierre anterior). companyId/contactId/pipelineId/stageId/
// ownerId permanecen `string | undefined` (nunca null): el backend los
// trata con chequeo truthy (opportunity.service.ts), no se pueden limpiar
// vía PATCH. vehicleId/financingType/leadSource siguen el patrón de
// expectedCloseDate: vacío es null explícito, y en vehicleId ese null es
// "quitar el vínculo" (mandar el mismo id que ya tenía es un no-op para el
// backend, que compara contra el vínculo vigente).
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
    vehicleId: values.vehicleId ?? null,
    financingType: values.financingType || null,
    leadSource: values.leadSource || null,
  };
}

// Valores del formulario derivados de un registro ya persistido. Antes esto
// vivía adentro de un useEffect que hacía setValues; ahora es una función pura
// y el estado local aparece recién cuando el usuario edita algo — ver
// lib/useFormDraft.ts para por qué ese efecto perdía datos.
function toFormValues(data: Opportunity): OpportunityFormValues {
  return {
    title: data.title,
    // amount llega como string (Decimal) — Number() para tener el valor
    // canónico que CurrencyInput espera ("1234.5"), nunca el string crudo
    // tal cual ("1234.50").
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
    vehicleId: data.vehicleId ?? undefined,
    financingType: data.financingType ?? "",
    leadSource: data.leadSource ?? "",
  };
}

function isClosed(status: OpportunityStatus): boolean {
  return status === "WON" || status === "LOST";
}

// Un único componente para create y edit, mismo patrón que
// CompanyFormPage/ContactFormPage/PipelineFormPage/StageFormPage.
//
// Campos agrupados en tarjetas como en "Nueva oportunidad": "Oportunidad"
// (título y a quién se asocia), "Embudo y valor" y, desde la Fase 3b del
// módulo de stock, "Vehículo vinculado" (unidad, financiación y origen del
// cliente — ver handleVehicleChange por la interacción con Monto/Moneda).
// Estado, Motivo de pérdida y Fecha real de cierre van en una tercera tarjeta
// SOLO en edición: el diseño no los tiene en creación porque toda oportunidad
// nueva arranca abierta (EMPTY_FORM.status es "OPEN") y el cierre se haría
// desde el Kanban; pero el Kanban todavía no existe, así que sacarlos también
// de la edición dejaría sin forma de cerrar una oportunidad. Dentro de esa
// tarjeta, Motivo y Fecha real aparecen solo al cerrar (ver handleStatusChange).
//
// Los selectores (CompanySelect, ContactSelect, PipelineSelect, StageSelect,
// UserSelect) se montan sueltos, sin FormField: traen su propio <label
// htmlFor>, y FormField ES un <label>. Mismo trato que en CompanyFormPage.
export function OpportunityFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();
  const { me } = useAuth();

  const opportunityQuery = useOpportunity(isEditMode ? id : undefined);
  const createOpportunityMutation = useCreateOpportunity();
  const updateOpportunityMutation = useUpdateOpportunity(id ?? "");

  // Solo en creación: el "+ Añadir" de una columna del embudo llega con
  // pipelineId y stageId en la query string para no tener que elegirlos
  // de nuevo. Son un valor inicial derivado, igual que EMPTY_FORM — el
  // usuario puede cambiarlos, y un id que no exista lo rechaza el backend
  // con su propio mensaje, como cualquier otro. En edición se ignoran.
  //
  // ownerId arranca en quien crea (ítem 7 de
  // docs/frontend-cambios-pendientes.md), mismo criterio que Company y
  // Contact: resolveOwnerId autoasignaría igual si no se mandara nada, pero
  // la opción "Asignado a quien crea (por defecto)" al lado del mismo usuario
  // en la lista era redundante. En edición el valor viene del registro.
  const [searchParams] = useSearchParams();
  const initialValues: OpportunityFormValues = isEditMode
    ? EMPTY_FORM
    : {
        ...EMPTY_FORM,
        pipelineId: searchParams.get("pipelineId") ?? undefined,
        stageId: searchParams.get("stageId") ?? undefined,
        ownerId: me?.id,
      };

  const [values, setValues] = useFormDraft<OpportunityFormValues>(
    opportunityQuery.data?.id,
    opportunityQuery.data ? toFormValues(opportunityQuery.data) : initialValues,
  );
  const [error, setError] = useState<string | null>(null);

  // "Fecha desconocida" (ítem 18.C): afordancia de UI sobre el mismo campo
  // opcional, sin cambio de modelo — "desconocida" y vacío son lo mismo para
  // la API. Es estado propio y no se deriva de "el campo está vacío": si lo
  // fuera, destildarlo con el campo vacío sería imposible (seguiría vacío,
  // seguiría tildado y deshabilitado). Arranca destildado siempre, también en
  // edición con la fecha vacía: como no se persiste, no hay forma de
  // distinguir "desconocida" de "todavía no la cargaron".
  const [expectedCloseDateUnknown, setExpectedCloseDateUnknown] = useState(false);

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

  // La unidad con la que el formulario ARRANCÓ (la persistida en edición,
  // ninguna en creación). Contra esto se decide si un vehicleId es "nuevo".
  const initialVehicleId = opportunityQuery.data?.vehicleId ?? undefined;
  const hasNewVehicle = values.vehicleId !== undefined && values.vehicleId !== initialVehicleId;

  // EL PUNTO DELICADO del vínculo con stock: "al vincular una unidad, la
  // oportunidad toma su precio" (Fase 2c) — pero el backend aplica ese precio
  // SOLO cuando el body no manda amount ni currency (opportunity.service.ts,
  // priceFromVehicle: el body explícito gana). Como este formulario manda
  // siempre lo que tienen Monto/Moneda, vincular nunca tomaría el precio: se
  // pisaría con lo cargado ("USD" y vacío en creación, el valor persistido en
  // edición). Por eso, al vincular por primera vez o cambiar de unidad, se
  // VACÍAN Monto y Moneda en el mismo setValues: toCreateInput/toUpdateInput
  // ya convierten "" en undefined, y el backend completa los dos con el
  // precio de la unidad. Si después la persona tipea un monto, es un override
  // explícito y viaja tal cual — el comportamiento que el formulario ya tenía.
  //
  // No pasa nada al desvincular (null) ni al volver a la unidad con la que el
  // formulario arrancó: ahí no hay precio nuevo que tomar.
  function handleVehicleChange(vehicleId: string | null) {
    setValues((current) => {
      const next = { ...current, vehicleId: vehicleId ?? undefined };
      if (vehicleId !== null && vehicleId !== initialVehicleId) {
        return { ...next, amount: "", currency: "" };
      }
      return next;
    });
  }

  // Cierre desde el formulario (ítem 18.F de docs/frontend-cambios-pendientes.md).
  // REEMPLAZA a propósito la decisión de M5 (docs/project-overview.md,
  // "lostReason — corregido durante el diseño"), que dejaba Motivo de pérdida
  // y Fecha real de cierre siempre visibles y nunca tocados por status porque
  // no estaba definido qué pasa al reabrir. Ahora sí está definido:
  //
  // - Abierta → Ganada/Perdida: si Fecha real está vacía, se completa con HOY
  //   (reloj local, mismo todayIsoDate que usa el embudo al arrastrar). Es un
  //   valor inicial cómodo: el input sigue visible y editable, nunca
  //   disabled. Solo actúa en la transición vivida acá — con el select
  //   pasando por "OPEN" —, nunca por el valor con el que cargó el registro:
  //   una oportunidad que ya estaba cerrada, o con fecha cargada a mano, no
  //   se pisa.
  // - Ganada/Perdida → Abierta: se limpian Fecha real y Motivo en el mismo
  //   setValues (mismo criterio que handlePipelineChange con stageId). Si no,
  //   quedarían ocultos pero viajarían igual en el PATCH y reabrir arrastraría
  //   datos del cierre anterior; en edición viajan como null explícito, que es
  //   lo que el backend espera para limpiar.
  //
  // El backend sigue sin sincronizar nada de esto: es comportamiento del
  // formulario, y el embudo tiene el suyo (boardMove.ts).
  function handleStatusChange(status: OpportunityStatus) {
    setValues((current) => {
      if (status === "OPEN") {
        return { ...current, status, actualCloseDate: "", lostReason: "" };
      }
      if (current.status === "OPEN" && isClosed(status) && !current.actualCloseDate) {
        return { ...current, status, actualCloseDate: todayIsoDate() };
      }
      return { ...current, status };
    });
  }

  function handleExpectedCloseDateUnknownChange(unknown: boolean) {
    setExpectedCloseDateUnknown(unknown);
    if (unknown) {
      setValues((current) => ({ ...current, expectedCloseDate: "" }));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    // Pipeline y Etapa son obligatorios en el contrato (opportunity.service.ts
    // los valida) y sus <select> llevan `required` (asterisco + bloqueo nativo
    // del navegador). Pero ese bloqueo tiene huecos: el <select> solo existe
    // cuando su lista cargó, y el de Etapa está deshabilitado sin pipeline (un
    // control disabled no participa de la validación). Este chequeo cubre esos
    // casos con un mensaje propio en vez de un 400 "pipelineId inválido", y es
    // la garantía de que el asterisco no miente: sin los dos, no hay mutación.
    if (!values.pipelineId) {
      setError("Elegí un pipeline antes de guardar.");
      return;
    }
    if (!values.stageId) {
      setError("Elegí una etapa antes de guardar.");
      return;
    }
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

  // Una moneda persistida fuera de la lista (datos viejos, o cargados por
  // API: el backend acepta cualquier ISO 4217) se muestra como opción extra
  // mientras sea el valor vigente. Sin esto el <select> mostraría "USD"
  // (la primera opción) mientras el PATCH sigue mandando el valor real.
  const hasKnownCurrency = isKnownCurrency(values.currency);

  // Restyle según "Nueva oportunidad" de Claude Design con las piezas del
  // restyle de Empresas (.ds-form, .ds-field-grid, .ds-required): las mismas
  // tarjetas de antes, con los campos de a pares como en el export — Título a
  // lo ancho, Empresa + Contacto; Pipeline + Etapa, (Monto + Moneda) + Fecha
  // estimada, Propietario solo a media columna. El "*" va en Título (input
  // con `required`) y, desde el ítem 10 de docs/frontend-cambios-pendientes.md,
  // también en Pipeline y Etapa: sus <select> llevan `required` y handleSubmit
  // los chequea, así que el asterisco coincide con lo que pasa al dejarlos
  // vacíos. El diseño marca además Monto y Propietario, pero son opcionales en
  // el contrato (ver toCreateInput) y un asterisco ahí mentiría.
  //
  // Los dos textos de ayuda son del export y describen comportamiento real
  // (EMPTY_FORM.status es "OPEN"; ganada/perdida se asignan desde el
  // embudo), pero solo en creación: en edición la tarjeta "Estado y cierre"
  // sí permite cerrar desde acá, y ahí serían falsos.
  return (
    <form onSubmit={handleSubmit} className="ds-form">
      <h1>{isEditMode ? "Editar oportunidad" : "Nueva oportunidad"}</h1>
      {isEditMode ? null : (
        <p className="ds-hint">Se crea abierta en la etapa elegida del embudo.</p>
      )}
      <div className="ds-stack">
        <Card heading="Oportunidad">
          <div className="ds-field-grid">
            <div className="ds-field-grid--full">
              <FormField label={<span className="ds-required">Título</span>}>
                <input
                  type="text"
                  value={values.title}
                  onChange={(event) => setValues({ ...values, title: event.target.value })}
                  required
                />
              </FormField>
            </div>
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
          </div>
        </Card>

        <Card heading="Embudo y valor">
          <div className="ds-field-grid">
            <PipelineSelect
              id="opportunity-form-pipeline"
              label="Pipeline"
              value={values.pipelineId}
              onChange={handlePipelineChange}
              required
            />
            <StageSelect
              id="opportunity-form-stage"
              label="Etapa"
              pipelineId={values.pipelineId}
              value={values.stageId}
              onChange={(stageId) => setValues({ ...values, stageId })}
              required
            />
            {/* Monto + Moneda siguen en su .ds-field-row, que acá es una
                celda de la grilla: la fila queda (Monto | Moneda) | Fecha. */}
            <div>
              <div className="ds-field-row">
                {/* Formato uruguayo en vivo (ítem 18.A): el estado guarda el
                    valor canónico ("20000.5") y CurrencyInput muestra
                    "20.000,50". toCreateInput/toUpdateInput no cambian. */}
                <FormField label="Monto">
                  <CurrencyInput
                    value={values.amount}
                    onChange={(amount) => setValues({ ...values, amount })}
                  />
                </FormField>
                <FormField label="Moneda">
                  <select
                    value={values.currency}
                    onChange={(event) => setValues({ ...values, currency: event.target.value })}
                  >
                    {/* Vacía solo mientras handleVehicleChange la dejó así:
                        el backend va a tomar la moneda del precio de la
                        unidad. Desaparece apenas se elige USD o UYU. */}
                    {values.currency === "" ? <option value="">Según la unidad</option> : null}
                    {hasKnownCurrency || values.currency === "" ? null : (
                      <option value={values.currency}>{values.currency}</option>
                    )}
                    {CURRENCY_OPTIONS.map((currency) => (
                      <option key={currency} value={currency}>
                        {currency}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
              {/* Explica por qué los dos quedaron vacíos al vincular una
                  unidad (ver handleVehicleChange), para que no parezca un
                  bug. Desaparece apenas se tipea algo en cualquiera de los
                  dos: ahí ya es un monto explícito. */}
              {hasNewVehicle && !values.amount && !values.currency ? (
                <p className="ds-hint">
                  Se completa con el precio de la unidad al guardar, salvo que cargues un monto acá.
                </p>
              ) : null}
            </div>
            {/* Fecha estimada + "Fecha desconocida" (ítem 18.C) comparten la
                celda: el checkbox va debajo del input, como FormField propio
                (label > checkbox), que el CSS del sistema de diseño ya pone
                en fila. */}
            <div>
              <FormField label="Fecha estimada de cierre">
                <input
                  type="date"
                  value={values.expectedCloseDate}
                  disabled={expectedCloseDateUnknown}
                  onChange={(event) =>
                    setValues({ ...values, expectedCloseDate: event.target.value })
                  }
                />
              </FormField>
              <FormField label="Fecha desconocida">
                <input
                  type="checkbox"
                  checked={expectedCloseDateUnknown}
                  onChange={(event) => handleExpectedCloseDateUnknownChange(event.target.checked)}
                />
              </FormField>
            </div>
            {/* "Sin asignar" solo aparece si el registro no tiene dueño
                (Opportunity.ownerId no es nullable en la API, así que en la
                práctica solo con datos viejos): con clearable={false} y un
                valor real, UserSelect no renderiza opción vacía — el PATCH
                no puede limpiar ownerId (chequeo truthy en
                opportunity.service.ts). */}
            <UserSelect
              id="opportunity-form-owner"
              label="Propietario"
              value={values.ownerId}
              onChange={(ownerId) => setValues({ ...values, ownerId: ownerId || undefined })}
              emptyOptionLabel="Sin asignar"
              clearable={false}
            />
          </div>
        </Card>

        {/* Módulo de stock (Fase 3b). Card aparte y no dentro de "Embudo y
            valor": la unidad, la financiación y el origen del cliente son
            datos de ESTA venta, no del embudo. Los tres opcionales, sin
            required — una oportunidad sin unidad vinculada sigue siendo
            válida. El selector va a lo ancho: su resultado (unidad + precio +
            estado + "Quitar vínculo") no entra en media columna. */}
        <Card heading="Vehículo vinculado">
          <div className="ds-field-grid">
            <div className="ds-field-grid--full">
              <VehicleSelect
                id="opportunity-form-vehicle"
                label="Unidad de stock"
                value={values.vehicleId}
                onChange={handleVehicleChange}
              />
            </div>
            <FormField label="Financiación">
              <select
                value={values.financingType}
                onChange={(event) =>
                  setValues({
                    ...values,
                    financingType: event.target.value as OpportunityFinancingType | "",
                  })
                }
              >
                <option value="">Sin especificar</option>
                {FINANCING_TYPE_OPTIONS.map((financingType) => (
                  <option key={financingType} value={financingType}>
                    {FINANCING_TYPE_LABELS[financingType]}
                  </option>
                ))}
              </select>
            </FormField>
            {/* "Origen del cliente" es solo el texto visible (ítem 18.D):
                leadSource/OpportunityLeadSource/LEAD_SOURCE_* son nombres
                internos y siguen igual. */}
            <FormField label="Origen del cliente">
              <select
                value={values.leadSource}
                onChange={(event) =>
                  setValues({
                    ...values,
                    leadSource: event.target.value as OpportunityLeadSource | "",
                  })
                }
              >
                <option value="">Sin especificar</option>
                {LEAD_SOURCE_OPTIONS.map((leadSource) => (
                  <option key={leadSource} value={leadSource}>
                    {LEAD_SOURCE_LABELS[leadSource]}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
        </Card>

        {/* Sin mockup: el diseño cierra desde el embudo. Misma grilla por
            criterio propio — Estado + Motivo de pérdida como par, el hint a
            lo ancho debajo de los dos (suelto ocuparía una celda), Fecha real
            sola. Motivo y Fecha real solo con Ganada/Perdida — un solo
            criterio para los dos (ver handleStatusChange). */}
        {isEditMode ? (
          <Card heading="Estado y cierre">
            <div className="ds-field-grid">
              <FormField label="Estado">
                <select
                  value={values.status}
                  onChange={(event) => handleStatusChange(event.target.value as OpportunityStatus)}
                >
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABEL[status]}
                    </option>
                  ))}
                </select>
              </FormField>
              {isClosed(values.status) ? (
                <>
                  <FormField label="Motivo de pérdida">
                    <input
                      type="text"
                      value={values.lostReason}
                      onChange={(event) => setValues({ ...values, lostReason: event.target.value })}
                    />
                  </FormField>
                  <p className="ds-hint ds-field-grid--full">
                    Especialmente relevante cuando el estado es Perdida.
                  </p>
                  <FormField label="Fecha real de cierre">
                    <input
                      type="date"
                      value={values.actualCloseDate}
                      onChange={(event) =>
                        setValues({ ...values, actualCloseDate: event.target.value })
                      }
                    />
                  </FormField>
                </>
              ) : null}
            </div>
          </Card>
        ) : null}

        {error ? <ErrorState>{error}</ErrorState> : null}
        <div>
          {isEditMode ? null : (
            <p className="ds-hint">
              La oportunidad arranca abierta. Cerrarla como ganada o perdida se hace desde el
              embudo.
            </p>
          )}
          <RequiredFieldsHint />
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </form>
  );
}
