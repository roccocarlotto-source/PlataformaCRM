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
import { Select } from "../../design-system/Select";
import { CompanySelect } from "../company/CompanySelect";
import { PipelineSelect } from "../pipeline/PipelineSelect";
import { DeliverySection } from "../delivery/DeliverySection";
import { PaymentSection } from "../payment/PaymentSection";
import { QuoteSection } from "../quote/QuoteSection";
import { StageSelect } from "../stage/StageSelect";
import { useStageOptions } from "../stage/queries";
import { UserSelect } from "../user/UserSelect";
import { TradeInSection } from "../vehicle/TradeInSection";
import { VehicleSelect } from "../vehicle/VehicleSelect";
import { todayIsoDate } from "./boardMove";
import { ContactSelect } from "./ContactSelect";
import { FINANCING_TYPE_LABELS, LEAD_SOURCE_LABELS, STATUS_LABEL, STATUSES } from "./labels";
import { useCreateOpportunity, useUpdateOpportunity } from "./mutations";
import { useOpportunity } from "./queries";
import { stageStatusChange } from "./stageStatus";
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
  // Detalle de financiación (§42). Los importes como string canónico de
  // CurrencyInput ("5000.5"), la cantidad de cuotas como el texto del input.
  financingLender: string;
  financingDownPayment: string;
  financingInstallmentCount: string;
  financingInstallmentAmount: string;
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
  financingLender: "",
  financingDownPayment: "",
  financingInstallmentCount: "",
  financingInstallmentAmount: "",
};

const FINANCING_TYPE_OPTIONS = Object.keys(FINANCING_TYPE_LABELS) as OpportunityFinancingType[];
const LEAD_SOURCE_OPTIONS = Object.keys(LEAD_SOURCE_LABELS) as OpportunityLeadSource[];

// Moneda: desplegable cerrado con las dos monedas de la operación real (ítem
// 18.B de docs/frontend-cambios-pendientes.md). Antes era texto libre
// normalizado a 3 letras porque el backend acepta cualquier código ISO 4217
// (^[A-Z]{3}$, opportunity.controller.ts) y una lista parecía inventar una
// restricción; en la práctica solo generaba tipeos ("usd", "U$S"). El backend
// NO cambia: la restricción es del lado del cliente. Sin opción "Otra". La
// lista vive en lib/currencies.ts desde el ítem 19, compartida con la
// configuración de moneda de la organización.

// "" → undefined; cualquier otro texto → Number. "0" es un valor real (una
// entrega inicial de cero), por eso no es un chequeo truthy sobre el número.
function optionalNumber(value: string): number | undefined {
  return value === "" ? undefined : Number(value);
}

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
    financingLender: values.financingLender || undefined,
    financingDownPayment: optionalNumber(values.financingDownPayment),
    financingInstallmentCount: optionalNumber(values.financingInstallmentCount),
    financingInstallmentAmount: optionalNumber(values.financingInstallmentAmount),
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
// backend, que compara contra el vínculo vigente). Los cuatro del detalle de
// financiación (§42) también: vacío es null explícito.
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
    financingLender: values.financingLender || null,
    financingDownPayment: optionalNumber(values.financingDownPayment) ?? null,
    financingInstallmentCount: optionalNumber(values.financingInstallmentCount) ?? null,
    financingInstallmentAmount: optionalNumber(values.financingInstallmentAmount) ?? null,
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
    financingLender: data.financingLender ?? "",
    // Mismo trato que amount: Number() para el canónico que CurrencyInput espera.
    financingDownPayment:
      data.financingDownPayment === null ? "" : String(Number(data.financingDownPayment)),
    financingInstallmentCount:
      data.financingInstallmentCount === null ? "" : String(data.financingInstallmentCount),
    financingInstallmentAmount:
      data.financingInstallmentAmount === null
        ? ""
        : String(Number(data.financingInstallmentAmount)),
  };
}

function isClosed(status: OpportunityStatus): boolean {
  return status === "WON" || status === "LOST";
}

// El detalle del plan (§42) se muestra solo con una financiación elegida —
// mismo patrón condicional que isClosed con Motivo/Fecha real. A diferencia
// de ese caso, volver a "Sin especificar"/"Sin financiación" NO vacía el
// detalle: los valores quedan ocultos y viajan igual al guardar, así un cambio
// de categoría por error no borra lo cargado. Es la misma regla del backend:
// el detalle no depende de financingType.
function hasFinancing(financingType: OpportunityFinancingType | ""): boolean {
  return financingType !== "" && financingType !== "NONE";
}

// Un único componente para create y edit, mismo patrón que
// CompanyFormPage/ContactFormPage/PipelineFormPage/StageFormPage.
//
// Campos agrupados en tarjetas como en "Nueva oportunidad": "Oportunidad"
// (título y a quién se asocia), "Embudo y valor" y, desde la Fase 3b del
// módulo de stock, "Vehículo vinculado" (unidad, financiación y origen del
// cliente — ver handleVehicleChange por la interacción con Monto/Moneda).
// Estado, Motivo de pérdida y Fecha real de cierre van en una tercera tarjeta,
// siempre en edición y en Alta solo si la Etapa elegida cerró la oportunidad
// (§50): el diseño no los tiene en creación porque toda oportunidad nueva
// arranca abierta (EMPTY_FORM.status es "OPEN") y el cierre se haría desde el
// Kanban; pero el Kanban todavía no existe, así que sacarlos también de la
// edición dejaría sin forma de cerrar una oportunidad. Dentro de esa tarjeta,
// Fecha real aparece al cerrar (Ganada o Perdida) y Motivo solo con Perdida
// (ver handleStatusChange).
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

  // Las etapas del pipeline elegido, para poder leer los flags isWon/isLost
  // de la que se elija (§50). Es EL MISMO hook que usa StageSelect adentro
  // (useStageOptions, stage/queries.ts), así que comparten queryKey y esto no
  // agrega ni una request: el selector ya trajo la lista y acá se lee del
  // caché. Sin pipeline la query está desactivada y `stages` queda undefined.
  const stagesQuery = useStageOptions(values.pipelineId);
  const stages = stagesQuery.data?.data;

  // Cambiar pipelineId limpia stageId — justificado por una regla real del
  // backend (opportunity.service.ts validateStageId: un stage de otro
  // pipeline es rechazado). A diferencia de Company/Contact (abajo), acá SÍ
  // hay reset.
  //
  // Si la oportunidad había quedado cerrada por una etapa (ver
  // handleStageChange), ese cierre pierde su causa al irse la etapa: se
  // REABRE con el mismo criterio que handleStatusChange al pasar a Abierta.
  // Si ya estaba abierta no cambia nada — en particular, un cierre puesto a
  // mano en el selector de Estado tampoco se pisa más allá de esto: quien
  // cambia de proceso de venta está empezando de nuevo.
  function handlePipelineChange(pipelineId: string) {
    setValues((current) => {
      const next = { ...current, pipelineId, stageId: undefined };
      if (current.status === "OPEN") return next;
      return { ...next, status: "OPEN" as const, actualCloseDate: "", lostReason: "" };
    });
  }

  // Elegir una Etapa sincroniza el Estado, exactamente con la misma regla que
  // el embudo aplica al arrastrar una tarjeta (stageStatus.ts, compartido con
  // boardMove.ts). Hasta §50 este selector solo cambiaba stageId: elegir una
  // etapa marcada "Perdida" dejaba la oportunidad abierta y sin Motivo de
  // pérdida a la vista, que es lo que confundía.
  //
  // Vale igual en Alta y en Edición. Lo que la regla no decide y sí decide
  // este handler:
  //   - lostReason se limpia en toda transición cuyo estado resultante no sea
  //     LOST, mismo criterio que handleStatusChange (§48) — si no, el motivo
  //     de una pérdida anterior viajaría fantasma en el PATCH.
  //   - "clear" es "" y no null: es el valor que espera un <input type="date">.
  //     toUpdateInput ya convierte ese "" en el null explícito que el backend
  //     necesita para limpiar.
  //
  // Si las etapas todavía no cargaron, o el id elegido no está en la lista,
  // no hay flags que mirar: se trata como etapa normal y solo cambia stageId.
  // Nunca se adivina por el nombre de la etapa.
  function handleStageChange(stageId: string) {
    const stage = stages?.find((candidate) => candidate.id === stageId);
    setValues((current) => {
      const change = stage
        ? stageStatusChange(
            { status: current.status, actualCloseDate: current.actualCloseDate || null },
            stage,
          )
        : null;
      if (!change) return { ...current, stageId };
      return {
        ...current,
        stageId,
        status: change.status,
        lostReason: change.status === "LOST" ? current.lostReason : "",
        actualCloseDate:
          change.actualCloseDate === "today"
            ? todayIsoDate()
            : change.actualCloseDate === "clear"
              ? ""
              : current.actualCloseDate,
      };
    });
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
  // - Ganada/Perdida → Abierta: se limpia Fecha real en el mismo setValues
  //   (mismo criterio que handlePipelineChange con stageId). Si no, quedaría
  //   oculta pero viajaría igual en el PATCH y reabrir arrastraría datos del
  //   cierre anterior; en edición viaja como null explícito, que es lo que el
  //   backend espera para limpiar.
  // - Cualquier estado que no sea Perdida: se limpia el Motivo, por el mismo
  //   motivo pero con su propio criterio — el campo solo se muestra con
  //   Perdida, así que tanto reabrir como pasar a Ganada tienen que dejarlo
  //   vacío para que el motivo de la pérdida anterior no viaje fantasma en el
  //   PATCH.
  //
  // El backend sigue sin sincronizar nada de esto: es comportamiento del
  // formulario, y el embudo tiene el suyo (boardMove.ts).
  function handleStatusChange(status: OpportunityStatus) {
    setValues((current) => {
      const base = status === "LOST" ? current : { ...current, lostReason: "" };
      if (status === "OPEN") {
        return { ...base, status, actualCloseDate: "" };
      }
      if (current.status === "OPEN" && isClosed(status) && !current.actualCloseDate) {
        return { ...base, status, actualCloseDate: todayIsoDate() };
      }
      return { ...base, status };
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
    // los valida) y sus selectores llevan `required` (asterisco + bloqueo nativo
    // del navegador). Pero ese bloqueo tiene huecos: el selector solo existe
    // cuando su lista cargó, y el de Etapa está deshabilitado sin pipeline (un
    // control disabled no participa de la validación). Este chequeo cubre esos
    // casos con un mensaje propio en vez de un 400 "pipelineId inválido", y es
    // la garantía de que el asterisco no miente: sin los dos, no hay mutación.
    if (!values.pipelineId) {
      setError("Elegí un proceso de venta antes de guardar.");
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
  // mientras sea el valor vigente. Sin esto el selector mostraría "USD"
  // (la primera opción) mientras el PATCH sigue mandando el valor real.
  const hasKnownCurrency = isKnownCurrency(values.currency);

  // Restyle según "Nueva oportunidad" de Claude Design con las piezas del
  // restyle de Empresas (.ds-form, .ds-field-grid, .ds-required): las mismas
  // tarjetas de antes, con los campos de a pares como en el export — Título a
  // lo ancho, Empresa + Contacto; Pipeline + Etapa, (Monto + Moneda) + Fecha
  // estimada, Asignado solo a media columna. El "*" va en Título (input
  // con `required`) y, desde el ítem 10 de docs/frontend-cambios-pendientes.md,
  // también en Pipeline y Etapa: sus selectores llevan `required` y handleSubmit
  // los chequea, así que el asterisco coincide con lo que pasa al dejarlos
  // vacíos. El diseño marca además Monto y Asignado, pero son opcionales en
  // el contrato (ver toCreateInput) y un asterisco ahí mentiría.
  //
  // Los dos textos de ayuda son del export y describen comportamiento real
  // (EMPTY_FORM.status es "OPEN"; ganada/perdida se asignan desde el
  // embudo), pero solo en creación y mientras la oportunidad siga abierta: en
  // edición la tarjeta "Estado y cierre" sí permite cerrar desde acá, y desde
  // §50 en Alta también, si la Etapa elegida forzó el cierre. En esos dos
  // casos serían falsos, así que no se muestran.
  // La sección de Cotización (§39) va DESPUÉS del <form> y no adentro: tiene
  // sus propios formularios y botones, y un <form> no se anida. Solo en
  // edición — una oportunidad que todavía no existe no tiene a qué colgarle
  // una cotización. La de Entrega (§40) va debajo, por el mismo motivo, y se
  // muestra sola solo si la oportunidad está ganada y tiene entrega (ver
  // DeliverySection). La de Permuta (§41) va después y sin ese gating: la
  // permuta se carga en cualquier momento de la negociación. La de Pagos (§43)
  // cierra la ficha, también sin gating: el cobro es el último paso del
  // proceso comercial, pero una seña se cobra con la oportunidad abierta.
  return (
    <>
      <form onSubmit={handleSubmit} className="ds-form">
        <h1>{isEditMode ? "Editar oportunidad" : "Nueva oportunidad"}</h1>
        {isEditMode || isClosed(values.status) ? null : (
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
                label="Proceso de venta"
                value={values.pipelineId}
                onChange={handlePipelineChange}
                required
              />
              <StageSelect
                id="opportunity-form-stage"
                label="Etapa"
                pipelineId={values.pipelineId}
                value={values.stageId}
                onChange={handleStageChange}
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
                  {/* Suelto, sin FormField: Select trae su propio <label
                    htmlFor> y FormField ES un <label>.

                    La fila vacía existe solo mientras handleVehicleChange la
                    dejó así: el backend va a tomar la moneda del precio de la
                    unidad. Desaparece apenas se elige USD o UYU. */}
                  <Select
                    label="Moneda"
                    value={values.currency}
                    options={[
                      ...(hasKnownCurrency || values.currency === ""
                        ? []
                        : [{ value: values.currency, label: values.currency }]),
                      ...CURRENCY_OPTIONS.map((currency) => ({
                        value: currency,
                        label: currency,
                      })),
                    ]}
                    emptyOption={values.currency === "" ? { label: "Según la unidad" } : undefined}
                    onChange={(currency) => setValues({ ...values, currency })}
                  />
                </div>
                {/* Explica por qué los dos quedaron vacíos al vincular una
                  unidad (ver handleVehicleChange), para que no parezca un
                  bug. Desaparece apenas se tipea algo en cualquiera de los
                  dos: ahí ya es un monto explícito. */}
                {hasNewVehicle && !values.amount && !values.currency ? (
                  <p className="ds-hint">
                    Se completa con el precio de la unidad al guardar, salvo que cargues un monto
                    acá.
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
                label="Asignado"
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
              <Select
                label="Financiación"
                value={values.financingType}
                options={FINANCING_TYPE_OPTIONS.map((financingType) => ({
                  value: financingType,
                  label: FINANCING_TYPE_LABELS[financingType],
                }))}
                emptyOption={{ label: "Sin especificar" }}
                onChange={(financingType) => setValues({ ...values, financingType })}
              />
              {/* "Origen del cliente" es solo el texto visible (ítem 18.D):
                leadSource/OpportunityLeadSource/LEAD_SOURCE_* son nombres
                internos y siguen igual. */}
              <Select
                label="Origen del cliente"
                value={values.leadSource}
                options={LEAD_SOURCE_OPTIONS.map((leadSource) => ({
                  value: leadSource,
                  label: LEAD_SOURCE_LABELS[leadSource],
                }))}
                emptyOption={{ label: "Sin especificar" }}
                onChange={(leadSource) => setValues({ ...values, leadSource })}
              />
              {/* Detalle del plan (§42), solo con una financiación elegida (ver
                hasFinancing). De a pares como el resto de la grilla: Entidad +
                Entrega, Cuotas + Monto de cuota. Sin cálculo automático entre
                ellos: se cargan los números que da el banco. */}
              {hasFinancing(values.financingType) ? (
                <>
                  <FormField label="Entidad financiera">
                    <input
                      type="text"
                      value={values.financingLender}
                      maxLength={255}
                      onChange={(event) =>
                        setValues({ ...values, financingLender: event.target.value })
                      }
                    />
                  </FormField>
                  <FormField label="Entrega inicial">
                    <CurrencyInput
                      value={values.financingDownPayment}
                      onChange={(financingDownPayment) =>
                        setValues({ ...values, financingDownPayment })
                      }
                    />
                  </FormField>
                  <FormField label="Cantidad de cuotas">
                    <input
                      type="number"
                      min={1}
                      max={120}
                      step={1}
                      value={values.financingInstallmentCount}
                      onChange={(event) =>
                        setValues({ ...values, financingInstallmentCount: event.target.value })
                      }
                    />
                  </FormField>
                  <FormField label="Monto de cuota">
                    <CurrencyInput
                      value={values.financingInstallmentAmount}
                      onChange={(financingInstallmentAmount) =>
                        setValues({ ...values, financingInstallmentAmount })
                      }
                    />
                  </FormField>
                  <p className="ds-hint ds-field-grid--full">
                    Entidad vacía para financiación propia. Los importes van en la moneda de la
                    oportunidad.
                  </p>
                </>
              ) : null}
            </div>
          </Card>

          {/* Sin mockup: el diseño cierra desde el embudo. Misma grilla por
            criterio propio — Estado + el campo que corresponda como par.
            Dos criterios distintos, uno por campo: Motivo de pérdida solo con
            Perdida (pedir un motivo de pérdida en una oportunidad ganada no
            tiene sentido), Fecha real de cierre con Ganada o Perdida
            (ver handleStatusChange).

            En edición se muestra siempre. En Alta aparece SOLO si la Etapa
            elegida forzó un cierre (§50): sin eso la oportunidad nace abierta
            y la tarjeta no tendría nada que ofrecer, pero con una etapa
            marcada "Perdida" el Motivo tiene que estar a la vista antes de
            guardar. Vuelve a desaparecer al elegir una etapa normal, porque
            ahí el estado vuelve a "OPEN". El Estado sigue siendo editable a
            mano también en Alta: la etapa propone, la persona decide. */}
          {isEditMode || isClosed(values.status) ? (
            <Card heading="Estado y cierre">
              <div className="ds-field-grid">
                {/* El combobox del design system (§46), suelto y sin FormField:
                    Select trae su propio <label htmlFor> y FormField ES un
                    <label>. */}
                <Select
                  label="Estado"
                  value={values.status}
                  options={STATUSES.map((status) => ({
                    value: status,
                    label: STATUS_LABEL[status],
                  }))}
                  onChange={(status) => {
                    if (status) handleStatusChange(status);
                  }}
                />
                {values.status === "LOST" ? (
                  <FormField label="Motivo de pérdida">
                    <input
                      type="text"
                      value={values.lostReason}
                      onChange={(event) => setValues({ ...values, lostReason: event.target.value })}
                    />
                  </FormField>
                ) : null}
                {isClosed(values.status) ? (
                  <FormField label="Fecha real de cierre">
                    <input
                      type="date"
                      value={values.actualCloseDate}
                      onChange={(event) =>
                        setValues({ ...values, actualCloseDate: event.target.value })
                      }
                    />
                  </FormField>
                ) : null}
              </div>
            </Card>
          ) : null}

          {error ? <ErrorState>{error}</ErrorState> : null}
          <div>
            {isEditMode || isClosed(values.status) ? null : (
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
      {isEditMode && opportunityQuery.data ? (
        <>
          <QuoteSection opportunity={opportunityQuery.data} />
          <DeliverySection opportunity={opportunityQuery.data} />
          <TradeInSection opportunity={opportunityQuery.data} />
          <PaymentSection opportunity={opportunityQuery.data} />
        </>
      ) : null}
    </>
  );
}
