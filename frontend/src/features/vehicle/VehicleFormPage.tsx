import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { CurrencyInput } from "../../design-system/CurrencyInput";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { IntegerInput } from "../../design-system/IntegerInput";
import { LoadingState } from "../../design-system/LoadingState";
import { RequiredFieldsHint } from "../../design-system/RequiredFieldsHint";
import { useFormDraft } from "../../lib/useFormDraft";
import { BranchSelect } from "../branch/BranchSelect";
import { formatExchangeRate } from "../organization/format";
import { useOrganizationSettings } from "../organization/queries";
import { formatDate } from "../opportunity/format";
import { UserSelect } from "../user/UserSelect";
import { EquipmentField } from "./EquipmentField";
import {
  BODY_TYPE_LABELS,
  COLOR_FINISH_LABELS,
  CONDITION_LABELS,
  DRIVETRAIN_LABELS,
  FUEL_TYPE_LABELS,
  ORIGIN_LABELS,
  PUBLICATION_CURRENCY_LABELS,
  STATUS_LABELS,
  TRANSMISSION_LABELS,
  WARRANTY_LABELS,
  fieldLabel,
} from "./labels";
import { useCreateVehicle, useUpdateVehicle } from "./mutations";
import { computePublishChecklist, readServerMissingFields } from "./publishChecklist";
import { useVehicle } from "./queries";
import type {
  VehicleBodyType,
  VehicleColorFinish,
  VehicleCondition,
  VehicleDetail,
  VehicleDrivetrain,
  VehicleFuelType,
  VehicleOrigin,
  VehiclePublicationCurrency,
  VehicleStatus,
  VehicleTransmission,
  VehicleWarranty,
  VehicleWritableFields,
} from "./types";
import { VehicleChangeLogDialog } from "./VehicleChangeLogDialog";
import { VehiclePhotoGallery } from "./VehiclePhotoGallery";

// ---------------------------------------------------------------------------
// Valores del formulario: todo lo que se tipea es string (los number y las
// fechas también, es lo que el <input> maneja); los enums nullable admiten ""
// como "sin elegir"; los booleanos son booleanos. La conversión al contrato
// del backend (number/null, "YYYY-MM-DD"/null) vive en toInput.
// ---------------------------------------------------------------------------

interface VehicleFormValues {
  condition: VehicleCondition;
  licensePlate: string;
  vin: string;
  engineNumber: string;
  bodyType: VehicleBodyType | "";
  make: string;
  model: string;
  trim: string;
  year: string;

  priceListUsd: string;
  priceListLocal: string;
  minAcceptablePriceUsd: string;
  acquisitionCostUsd: string;
  status: VehicleStatus;
  visibleInListing: boolean;
  origin: VehicleOrigin | "";
  stockEnteredAt: string;
  publicationCurrency: VehiclePublicationCurrency;
  acceptsTradeIn: boolean;
  financingAvailable: boolean;
  priceOnRequest: boolean;
  internalNotes: string;

  consignorName: string;
  consignorDocument: string;
  consignorPhone: string;
  consignorEmail: string;
  consignmentAgreedPriceUsd: string;
  consignmentCommissionPercent: string;
  consignmentAgreementExpiresAt: string;
  consignmentContractNumber: string;

  mileage: string;
  transmission: VehicleTransmission | "";
  fuelType: VehicleFuelType | "";
  exteriorColor: string;
  colorFinish: VehicleColorFinish | "";
  cylinderCapacityLiters: string;
  drivetrain: VehicleDrivetrain | "";
  doors: string;
  upholstery: string;
  powerHp: string;
  seats: string;
  declaredConsumptionKmL: string;
  // Códigos ya normalizados ("ABS", "AIRBAG_LATERAL"), uno por chip: la lista
  // es válida por construcción (EquipmentField, §21). El catálogo cerrado no
  // está decidido.
  equipment: string[];

  warranty: VehicleWarranty | "";
  // Detalle en texto libre, solo con warranty = "OTHER" (§22). Se limpia al
  // elegir cualquier otra opción (handleWarrantyChange), no solo se oculta.
  warrantyOther: string;
  licensePlateDebtLocal: string;
  lastTechnicalInspectionAt: string;
  titleHolder: string;
  singleOwner: boolean;
  officialServiceUpToDate: boolean;
  hasManualAndSpareKey: boolean;
  titleReportRequested: boolean;

  branchId: string;
  assignedSalespersonId: string;
  physicalLocation: string;
  availableSince: string;

  videoUrl: string;
  tour360Url: string;

  publishOnWebsite: boolean;
  publishOnPortals: boolean;
  featuredOnHomepage: boolean;
  publicDescription: string;
}

// Los mismos ocho que CONSIGNMENT_FIELDS en vehicle.service.ts.
const CONSIGNMENT_FORM_FIELDS = [
  "consignorName",
  "consignorDocument",
  "consignorPhone",
  "consignorEmail",
  "consignmentAgreedPriceUsd",
  "consignmentCommissionPercent",
  "consignmentAgreementExpiresAt",
  "consignmentContractNumber",
] as const;

// Los defaults de la base para lo que no es nullable (status AVAILABLE,
// visibleInListing true, publicationCurrency BOTH, booleanos false).
const EMPTY_FORM: VehicleFormValues = {
  condition: "USED",
  licensePlate: "",
  vin: "",
  engineNumber: "",
  bodyType: "",
  make: "",
  model: "",
  trim: "",
  year: "",
  priceListUsd: "",
  priceListLocal: "",
  minAcceptablePriceUsd: "",
  acquisitionCostUsd: "",
  status: "AVAILABLE",
  visibleInListing: true,
  origin: "",
  stockEnteredAt: "",
  publicationCurrency: "BOTH",
  acceptsTradeIn: false,
  financingAvailable: false,
  priceOnRequest: false,
  internalNotes: "",
  consignorName: "",
  consignorDocument: "",
  consignorPhone: "",
  consignorEmail: "",
  consignmentAgreedPriceUsd: "",
  consignmentCommissionPercent: "",
  consignmentAgreementExpiresAt: "",
  consignmentContractNumber: "",
  mileage: "",
  transmission: "",
  fuelType: "",
  exteriorColor: "",
  colorFinish: "",
  cylinderCapacityLiters: "",
  drivetrain: "",
  doors: "",
  upholstery: "",
  powerHp: "",
  seats: "",
  declaredConsumptionKmL: "",
  equipment: [],
  warranty: "",
  warrantyOther: "",
  licensePlateDebtLocal: "",
  lastTechnicalInspectionAt: "",
  titleHolder: "",
  singleOwner: false,
  officialServiceUpToDate: false,
  hasManualAndSpareKey: false,
  titleReportRequested: false,
  branchId: "",
  assignedSalespersonId: "",
  physicalLocation: "",
  availableSince: "",
  videoUrl: "",
  tour360Url: "",
  publishOnWebsite: false,
  publishOnPortals: false,
  featuredOnHomepage: false,
  publicDescription: "",
};

// ISO completo de un @db.Date -> "YYYY-MM-DD" para el <input type="date">.
// Mismo slice(0,10) que OpportunityFormPage.
function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function toText(value: string | number | null): string {
  return value === null ? "" : String(value);
}

// Función pura, sin efecto: el estado local aparece recién cuando la persona
// edita algo (lib/useFormDraft.ts).
function toFormValues(vehicle: VehicleDetail): VehicleFormValues {
  return {
    condition: vehicle.condition,
    licensePlate: toText(vehicle.licensePlate),
    vin: toText(vehicle.vin),
    engineNumber: toText(vehicle.engineNumber),
    bodyType: vehicle.bodyType ?? "",
    make: vehicle.make,
    model: vehicle.model,
    trim: toText(vehicle.trim),
    year: String(vehicle.year),
    priceListUsd: toText(vehicle.priceListUsd),
    priceListLocal: toText(vehicle.priceListLocal),
    minAcceptablePriceUsd: toText(vehicle.minAcceptablePriceUsd),
    acquisitionCostUsd: toText(vehicle.acquisitionCostUsd),
    status: vehicle.status,
    visibleInListing: vehicle.visibleInListing,
    origin: vehicle.origin ?? "",
    stockEnteredAt: toDateInput(vehicle.stockEnteredAt),
    publicationCurrency: vehicle.publicationCurrency,
    acceptsTradeIn: vehicle.acceptsTradeIn,
    financingAvailable: vehicle.financingAvailable,
    priceOnRequest: vehicle.priceOnRequest,
    internalNotes: toText(vehicle.internalNotes),
    consignorName: toText(vehicle.consignorName),
    consignorDocument: toText(vehicle.consignorDocument),
    consignorPhone: toText(vehicle.consignorPhone),
    consignorEmail: toText(vehicle.consignorEmail),
    consignmentAgreedPriceUsd: toText(vehicle.consignmentAgreedPriceUsd),
    consignmentCommissionPercent: toText(vehicle.consignmentCommissionPercent),
    consignmentAgreementExpiresAt: toDateInput(vehicle.consignmentAgreementExpiresAt),
    consignmentContractNumber: toText(vehicle.consignmentContractNumber),
    mileage: toText(vehicle.mileage),
    transmission: vehicle.transmission ?? "",
    fuelType: vehicle.fuelType ?? "",
    exteriorColor: toText(vehicle.exteriorColor),
    colorFinish: vehicle.colorFinish ?? "",
    cylinderCapacityLiters: toText(vehicle.cylinderCapacityLiters),
    drivetrain: vehicle.drivetrain ?? "",
    doors: toText(vehicle.doors),
    upholstery: toText(vehicle.upholstery),
    powerHp: toText(vehicle.powerHp),
    seats: toText(vehicle.seats),
    declaredConsumptionKmL: toText(vehicle.declaredConsumptionKmL),
    equipment: vehicle.equipment,
    warranty: vehicle.warranty ?? "",
    warrantyOther: toText(vehicle.warrantyOther),
    licensePlateDebtLocal: toText(vehicle.licensePlateDebtLocal),
    lastTechnicalInspectionAt: toDateInput(vehicle.lastTechnicalInspectionAt),
    titleHolder: toText(vehicle.titleHolder),
    singleOwner: vehicle.singleOwner,
    officialServiceUpToDate: vehicle.officialServiceUpToDate,
    hasManualAndSpareKey: vehicle.hasManualAndSpareKey,
    titleReportRequested: vehicle.titleReportRequested,
    branchId: vehicle.branchId,
    assignedSalespersonId: toText(vehicle.assignedSalespersonId),
    physicalLocation: toText(vehicle.physicalLocation),
    availableSince: toDateInput(vehicle.availableSince),
    videoUrl: toText(vehicle.videoUrl),
    tour360Url: toText(vehicle.tour360Url),
    publishOnWebsite: vehicle.publishOnWebsite,
    publishOnPortals: vehicle.publishOnPortals,
    featuredOnHomepage: vehicle.featuredOnHomepage,
    publicDescription: toText(vehicle.publicDescription),
  };
}

// Vacío -> null (el backend además hace trim y "" -> null en los textos
// nullable; mandarle null directo es lo mismo y no depende de eso).
function textOrNull(value: string): string | null {
  return value.trim() === "" ? null : value;
}

function numberOrNull(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

// ---------------------------------------------------------------------------
// Cálculo automático USD ↔ moneda local del precio de lista (ítem 19.B de
// docs/frontend-cambios-pendientes.md). Solo el par priceListUsd/
// priceListLocal: minAcceptablePriceUsd, acquisitionCostUsd y priceOnRequest
// no participan.
// ---------------------------------------------------------------------------

type PriceListField = "priceListUsd" | "priceListLocal";

// Redondeo a 2 decimales (Decimal(14,2) del backend) y de vuelta al string
// canónico que maneja CurrencyInput ("1012500.5"). "" o algo no numérico → "".
function convertPriceList(value: string, from: PriceListField, rate: number): string {
  const amount = Number(value);
  if (value === "" || !Number.isFinite(amount) || !Number.isFinite(rate) || rate <= 0) {
    return "";
  }
  const converted = from === "priceListUsd" ? amount * rate : amount / rate;
  return String(Math.round(converted * 100) / 100);
}

function enumOrNull<T extends string>(value: T | ""): T | null {
  return value === "" ? null : value;
}

// El estado completo vigente, no un diff — mismo criterio que CompanyFormPage.
// El backend solo escribe (y registra en el historial) lo que efectivamente
// cambia, así que mandar todo no ensucia nada.
//
// Consignación: si el origen NO es consignación, los ocho campos van en null
// aunque haya algo tipeado. Es lo que applyConsignmentRule exige (un dato de
// consignante con otro origen es 400) y lo que la UI avisa antes de guardar.
function toInput(values: VehicleFormValues): VehicleWritableFields {
  const isConsignment = values.origin === "CONSIGNMENT";
  return {
    condition: values.condition,
    licensePlate: textOrNull(values.licensePlate),
    vin: textOrNull(values.vin),
    engineNumber: textOrNull(values.engineNumber),
    bodyType: enumOrNull(values.bodyType),
    make: values.make,
    model: values.model,
    trim: textOrNull(values.trim),
    year: Number(values.year),

    priceListUsd: numberOrNull(values.priceListUsd),
    priceListLocal: numberOrNull(values.priceListLocal),
    minAcceptablePriceUsd: numberOrNull(values.minAcceptablePriceUsd),
    acquisitionCostUsd: numberOrNull(values.acquisitionCostUsd),
    status: values.status,
    visibleInListing: values.visibleInListing,
    origin: enumOrNull(values.origin),
    stockEnteredAt: textOrNull(values.stockEnteredAt),
    publicationCurrency: values.publicationCurrency,
    acceptsTradeIn: values.acceptsTradeIn,
    financingAvailable: values.financingAvailable,
    priceOnRequest: values.priceOnRequest,

    consignorName: isConsignment ? textOrNull(values.consignorName) : null,
    consignorDocument: isConsignment ? textOrNull(values.consignorDocument) : null,
    consignorPhone: isConsignment ? textOrNull(values.consignorPhone) : null,
    consignorEmail: isConsignment ? textOrNull(values.consignorEmail) : null,
    consignmentAgreedPriceUsd: isConsignment
      ? numberOrNull(values.consignmentAgreedPriceUsd)
      : null,
    consignmentCommissionPercent: isConsignment
      ? numberOrNull(values.consignmentCommissionPercent)
      : null,
    consignmentAgreementExpiresAt: isConsignment
      ? textOrNull(values.consignmentAgreementExpiresAt)
      : null,
    consignmentContractNumber: isConsignment ? textOrNull(values.consignmentContractNumber) : null,

    mileage: numberOrNull(values.mileage),
    transmission: enumOrNull(values.transmission),
    fuelType: enumOrNull(values.fuelType),
    exteriorColor: textOrNull(values.exteriorColor),
    colorFinish: enumOrNull(values.colorFinish),
    cylinderCapacityLiters: numberOrNull(values.cylinderCapacityLiters),
    drivetrain: enumOrNull(values.drivetrain),
    doors: numberOrNull(values.doors),
    upholstery: textOrNull(values.upholstery),
    powerHp: numberOrNull(values.powerHp),
    seats: numberOrNull(values.seats),
    declaredConsumptionKmL: numberOrNull(values.declaredConsumptionKmL),
    equipment: values.equipment,

    warranty: enumOrNull(values.warranty),
    // Solo con "Otra"; null en cualquier otro caso, que es lo que
    // applyWarrantyRule exige del otro lado (un detalle con otra garantía es
    // 400). El estado ya se limpió al cambiar de opción; esto es la garantía
    // en el payload.
    warrantyOther: values.warranty === "OTHER" ? textOrNull(values.warrantyOther) : null,
    licensePlateDebtLocal: numberOrNull(values.licensePlateDebtLocal),
    lastTechnicalInspectionAt: textOrNull(values.lastTechnicalInspectionAt),
    titleHolder: textOrNull(values.titleHolder),
    singleOwner: values.singleOwner,
    officialServiceUpToDate: values.officialServiceUpToDate,
    hasManualAndSpareKey: values.hasManualAndSpareKey,
    titleReportRequested: values.titleReportRequested,

    branchId: values.branchId,
    assignedSalespersonId: textOrNull(values.assignedSalespersonId),
    physicalLocation: textOrNull(values.physicalLocation),
    availableSince: textOrNull(values.availableSince),

    videoUrl: textOrNull(values.videoUrl),
    tour360Url: textOrNull(values.tour360Url),

    publishOnWebsite: values.publishOnWebsite,
    publishOnPortals: values.publishOnPortals,
    featuredOnHomepage: values.featuredOnHomepage,

    publicDescription: textOrNull(values.publicDescription),
    internalNotes: textOrNull(values.internalNotes),
  };
}

// <select> de un enum del schema envuelto en FormField. Con `emptyLabel` el
// enum es nullable y la primera opción es "" (sin elegir); sin él, es un enum
// obligatorio (condition, status, publicationCurrency) y no hay opción vacía.
interface EnumFieldProps<T extends string> {
  label: ReactNode;
  value: T | "";
  labels: Record<T, string>;
  onChange: (value: T | "") => void;
  emptyLabel?: string;
}

function EnumField<T extends string>({
  label,
  value,
  labels,
  onChange,
  emptyLabel,
}: EnumFieldProps<T>) {
  return (
    <FormField label={label}>
      <select value={value} onChange={(event) => onChange(event.target.value as T | "")}>
        {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
        {(Object.keys(labels) as T[]).map((option) => (
          <option key={option} value={option}>
            {labels[option]}
          </option>
        ))}
      </select>
    </FormField>
  );
}

// ---------------------------------------------------------------------------
// Ficha de vehículo: un único componente para create y edit (modo por :id),
// plantilla CompanyFormPage pero con una Card por sección. Lo que no sale
// solo de leer el backend:
//
//   - Consignación se muestra SOLO con origin = CONSIGNMENT (es lo que
//     applyConsignmentRule aplica del otro lado); si se cambia el origen con
//     datos cargados, un aviso dice que se pierden al guardar.
//   - El checklist de completitud es LOCAL (publishChecklist.ts) y se
//     recalcula al tipear; el gate real es el backend: un 422 con
//     missingFields muestra ESA lista.
//   - "Publicar en el sitio web" arranca deshabilitado en creación: una unidad
//     nueva nunca tiene fotos y el backend rechaza publicarla siempre.
//   - La galería y el historial solo existen en edición (necesitan un id).
// ---------------------------------------------------------------------------
export function VehicleFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();

  const vehicleQuery = useVehicle(isEditMode ? id : undefined);
  const createVehicleMutation = useCreateVehicle();
  const updateVehicleMutation = useUpdateVehicle(id ?? "");

  const [values, setValues] = useFormDraft<VehicleFormValues>(
    vehicleQuery.data?.id,
    vehicleQuery.data ? toFormValues(vehicleQuery.data) : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);
  // La lista de faltantes que devolvió el SERVIDOR en el último 422, si hubo.
  const [serverMissingFields, setServerMissingFields] = useState<string[] | null>(null);
  const [isChangeLogOpen, setIsChangeLogOpen] = useState(false);

  const isSubmitting = createVehicleMutation.isPending || updateVehicleMutation.isPending;

  const photoCount = vehicleQuery.data?.photos.length ?? 0;
  const checklist = computePublishChecklist(values, photoCount);

  const isConsignment = values.origin === "CONSIGNMENT";
  const hasConsignmentData = CONSIGNMENT_FORM_FIELDS.some((field) => values[field] !== "");

  function update<K extends keyof VehicleFormValues>(field: K, value: VehicleFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  // Garantía (§22): al salir de "Otra" el detalle se LIMPIA en el mismo
  // setValues, no solo se oculta — mismo criterio que reabrir una oportunidad
  // (§18 Parte F). Si no, cambiar "Otra" por "De fábrica" y volver a "Otra"
  // mostraría el texto viejo, y un estado con texto y garantía fija es
  // exactamente lo que el backend rechaza.
  function handleWarrantyChange(value: VehicleWarranty | "") {
    setValues((current) => ({
      ...current,
      warranty: value,
      warrantyOther: value === "OTHER" ? current.warrantyOther : "",
    }));
  }

  // Cotización vigente para sugerir el precio en la otra moneda. Con el
  // universo USD/UYU (ítem 18.B), exchangeRates trae como máximo UNA fila —la
  // del par no-USD configurado, sea la moneda de preferencia o la
  // alternativa— y se usa directamente como USD↔moneda local, sin mapear cuál
  // de los dos campos de organización es cuál. Sin fila (organización sin
  // moneda distinta de USD, o el worker diario todavía no corrió) el cálculo
  // simplemente no aplica: los dos campos siguen editables a mano, sin
  // bloquear el formulario ni mostrar error. Un GET fallido tampoco bloquea.
  const organizationQuery = useOrganizationSettings();
  const exchangeRate = organizationQuery.data?.exchangeRates[0];
  const rate = exchangeRate ? Number(exchangeRate.rate) : null;

  // Cuál de los dos precios de lista tiene un valor CALCULADO (no tipeado).
  // "El otro campo está vacío" no alcanza como criterio para recalcular: al
  // tipear "25000" en USD, después del primer dígito la moneda local ya no
  // está vacía y se quedaría en 2 × cotización. Mientras el otro campo siga
  // siendo calculado, se recalcula con cada tecla; apenas la persona lo edita
  // a mano deja de serlo y no se toca más. En edición los dos valores
  // persistidos cuentan como tipeados (arranca en null).
  const [derivedPriceField, setDerivedPriceField] = useState<PriceListField | null>(null);

  function handlePriceListChange(field: PriceListField, value: string) {
    const other: PriceListField = field === "priceListUsd" ? "priceListLocal" : "priceListUsd";
    const canFillOther = rate !== null && (values[other] === "" || derivedPriceField === other);
    if (!canFillOther) {
      // El otro campo lo tipeó la persona (o no hay cotización): no se toca.
      // Y si ESTE era el calculado, ahora lo está editando a mano.
      update(field, value);
      if (derivedPriceField === field) setDerivedPriceField(null);
      return;
    }
    // Sugerido pero editable: se llena el otro campo, que sigue siendo un
    // input normal. Borrar el origen borra también el calculado (nunca fue
    // tipeado).
    const converted = convertPriceList(value, field, rate);
    setValues((current) => ({
      ...current,
      priceListUsd: field === "priceListUsd" ? value : converted,
      priceListLocal: field === "priceListLocal" ? value : converted,
    }));
    setDerivedPriceField(converted === "" ? null : other);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setServerMissingFields(null);
    // branchId es NOT NULL. BranchSelect lleva `required` (asterisco + bloqueo
    // nativo del navegador), pero su <select> solo existe cuando la lista de
    // sucursales cargó: este chequeo cubre ese hueco con un mensaje claro en
    // vez de un 400 "branchId inválido".
    if (!values.branchId) {
      setError("Elegí una sucursal antes de guardar.");
      return;
    }
    try {
      const input = toInput(values);
      if (isEditMode) {
        await updateVehicleMutation.mutateAsync(input);
      } else {
        await createVehicleMutation.mutateAsync(input);
      }
      navigate("/vehicles");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la unidad");
      setServerMissingFields(readServerMissingFields(err));
    }
  }

  if (isEditMode && vehicleQuery.isLoading) {
    return <LoadingState />;
  }

  if (isEditMode && vehicleQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar la unidad
        {vehicleQuery.error instanceof Error ? `: ${vehicleQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  const vehicle = vehicleQuery.data;

  return (
    <form onSubmit={handleSubmit} className="ds-form">
      <h1>{isEditMode ? "Editar unidad" : "Nueva unidad"}</h1>
      <div className="ds-stack">
        <Card heading="Identificación">
          <div className="ds-field-grid">
            <EnumField
              label={fieldLabel("condition")}
              value={values.condition}
              labels={CONDITION_LABELS}
              onChange={(value) => update("condition", value || "USED")}
            />
            <FormField label={<span className="ds-required">{fieldLabel("year")}</span>}>
              <input
                type="number"
                min={1900}
                max={2100}
                step={1}
                value={values.year}
                onChange={(event) => update("year", event.target.value)}
                required
              />
            </FormField>
            <FormField label={<span className="ds-required">{fieldLabel("make")}</span>}>
              <input
                type="text"
                value={values.make}
                onChange={(event) => update("make", event.target.value)}
                required
              />
            </FormField>
            <FormField label={<span className="ds-required">{fieldLabel("model")}</span>}>
              <input
                type="text"
                value={values.model}
                onChange={(event) => update("model", event.target.value)}
                required
              />
            </FormField>
            <FormField label={fieldLabel("trim")}>
              <input
                type="text"
                value={values.trim}
                onChange={(event) => update("trim", event.target.value)}
              />
            </FormField>
            <EnumField
              label={fieldLabel("bodyType")}
              value={values.bodyType}
              labels={BODY_TYPE_LABELS}
              onChange={(value) => update("bodyType", value)}
              emptyLabel="Sin especificar"
            />
            <FormField label={fieldLabel("licensePlate")}>
              <input
                type="text"
                value={values.licensePlate}
                onChange={(event) => update("licensePlate", event.target.value)}
              />
            </FormField>
            <FormField label={fieldLabel("vin")}>
              <input
                type="text"
                value={values.vin}
                onChange={(event) => update("vin", event.target.value)}
              />
            </FormField>
            <FormField label={fieldLabel("engineNumber")}>
              <input
                type="text"
                value={values.engineNumber}
                onChange={(event) => update("engineNumber", event.target.value)}
              />
            </FormField>
          </div>
        </Card>

        <Card heading="Comercial">
          <div className="ds-field-grid">
            <EnumField
              label={fieldLabel("status")}
              value={values.status}
              labels={STATUS_LABELS}
              onChange={(value) => update("status", value || "AVAILABLE")}
            />
            <EnumField
              label={fieldLabel("origin")}
              value={values.origin}
              labels={ORIGIN_LABELS}
              onChange={(value) => update("origin", value)}
              emptyLabel="Sin especificar"
            />
            {/* Importes con formato uruguayo en vivo (ítem 23): CurrencyInput
                recibe y devuelve el mismo string canónico que el estado ya
                guardaba ("25000.5"), así que handlePriceListChange y el
                auto-cálculo del ítem 19 no cambian. */}
            <FormField label={fieldLabel("priceListUsd")}>
              <CurrencyInput
                value={values.priceListUsd}
                onChange={(value) => handlePriceListChange("priceListUsd", value)}
              />
            </FormField>
            <FormField label={fieldLabel("priceListLocal")}>
              <CurrencyInput
                value={values.priceListLocal}
                onChange={(value) => handlePriceListChange("priceListLocal", value)}
              />
            </FormField>
            {/* Explica que el otro precio "se llena solo" y que se puede
                corregir, para que no parezca un error (mismo criterio que la
                nota de Oportunidad al vincular una unidad). Solo con
                cotización: sin ella no pasa nada que explicar. */}
            {exchangeRate ? (
              <p className="ds-hint ds-field-grid--full">
                Al completar uno de los dos precios de lista, el otro se calcula con la cotización
                vigente ({formatExchangeRate(exchangeRate)}, del {formatDate(exchangeRate.rateDate)}
                ) y se puede corregir a mano.
              </p>
            ) : null}
            <FormField label={fieldLabel("minAcceptablePriceUsd")}>
              <CurrencyInput
                value={values.minAcceptablePriceUsd}
                onChange={(value) => update("minAcceptablePriceUsd", value)}
              />
            </FormField>
            <FormField label={fieldLabel("acquisitionCostUsd")}>
              <CurrencyInput
                value={values.acquisitionCostUsd}
                onChange={(value) => update("acquisitionCostUsd", value)}
              />
            </FormField>
            <EnumField
              label={fieldLabel("publicationCurrency")}
              value={values.publicationCurrency}
              labels={PUBLICATION_CURRENCY_LABELS}
              onChange={(value) => update("publicationCurrency", value || "BOTH")}
            />
            <FormField label={fieldLabel("stockEnteredAt")}>
              <input
                type="date"
                value={values.stockEnteredAt}
                onChange={(event) => update("stockEnteredAt", event.target.value)}
              />
            </FormField>
            <FormField label={fieldLabel("priceOnRequest")}>
              <input
                type="checkbox"
                checked={values.priceOnRequest}
                onChange={(event) => update("priceOnRequest", event.target.checked)}
              />
            </FormField>
            <FormField label={fieldLabel("visibleInListing")}>
              <input
                type="checkbox"
                checked={values.visibleInListing}
                onChange={(event) => update("visibleInListing", event.target.checked)}
              />
            </FormField>
            <FormField label={fieldLabel("acceptsTradeIn")}>
              <input
                type="checkbox"
                checked={values.acceptsTradeIn}
                onChange={(event) => update("acceptsTradeIn", event.target.checked)}
              />
            </FormField>
            <FormField label={fieldLabel("financingAvailable")}>
              <input
                type="checkbox"
                checked={values.financingAvailable}
                onChange={(event) => update("financingAvailable", event.target.checked)}
              />
            </FormField>
            <div className="ds-field-grid--full">
              <FormField label={fieldLabel("internalNotes")}>
                <textarea
                  value={values.internalNotes}
                  onChange={(event) => update("internalNotes", event.target.value)}
                />
              </FormField>
            </div>
          </div>
        </Card>

        {/* Operativo: dónde está y quién la vende. BranchSelect/UserSelect se
            montan sueltos (traen su propio <label htmlFor>), como en el resto
            de los formularios. "Sin asignar" porque el backend no autoasigna
            assignedSalespersonId (a diferencia del owner de Company). */}
        <Card heading="Sucursal y asignación">
          <div className="ds-field-grid">
            <BranchSelect
              id="vehicle-form-branch"
              label={fieldLabel("branchId")}
              value={values.branchId || undefined}
              onChange={(branchId) => update("branchId", branchId)}
              required
            />
            <UserSelect
              id="vehicle-form-salesperson"
              label={fieldLabel("assignedSalespersonId")}
              value={values.assignedSalespersonId || undefined}
              onChange={(userId) => update("assignedSalespersonId", userId)}
              emptyOptionLabel="Sin asignar"
            />
            <FormField label={fieldLabel("physicalLocation")}>
              <input
                type="text"
                value={values.physicalLocation}
                onChange={(event) => update("physicalLocation", event.target.value)}
              />
            </FormField>
            <FormField label={fieldLabel("availableSince")}>
              <input
                type="date"
                value={values.availableSince}
                onChange={(event) => update("availableSince", event.target.value)}
              />
            </FormField>
          </div>
        </Card>

        {isConsignment ? (
          <Card heading="Consignación">
            <div className="ds-field-grid">
              <FormField label={fieldLabel("consignorName")}>
                <input
                  type="text"
                  value={values.consignorName}
                  onChange={(event) => update("consignorName", event.target.value)}
                />
              </FormField>
              <FormField label={fieldLabel("consignorDocument")}>
                <input
                  type="text"
                  value={values.consignorDocument}
                  onChange={(event) => update("consignorDocument", event.target.value)}
                />
              </FormField>
              <FormField label={fieldLabel("consignorPhone")}>
                <input
                  type="text"
                  value={values.consignorPhone}
                  onChange={(event) => update("consignorPhone", event.target.value)}
                />
              </FormField>
              <FormField label={fieldLabel("consignorEmail")}>
                <input
                  type="email"
                  value={values.consignorEmail}
                  onChange={(event) => update("consignorEmail", event.target.value)}
                />
              </FormField>
              <FormField label={fieldLabel("consignmentAgreedPriceUsd")}>
                <CurrencyInput
                  value={values.consignmentAgreedPriceUsd}
                  onChange={(value) => update("consignmentAgreedPriceUsd", value)}
                />
              </FormField>
              <FormField label={fieldLabel("consignmentCommissionPercent")}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={values.consignmentCommissionPercent}
                  onChange={(event) => update("consignmentCommissionPercent", event.target.value)}
                />
              </FormField>
              <FormField label={fieldLabel("consignmentAgreementExpiresAt")}>
                <input
                  type="date"
                  value={values.consignmentAgreementExpiresAt}
                  onChange={(event) => update("consignmentAgreementExpiresAt", event.target.value)}
                />
              </FormField>
              <FormField label={fieldLabel("consignmentContractNumber")}>
                <input
                  type="text"
                  value={values.consignmentContractNumber}
                  onChange={(event) => update("consignmentContractNumber", event.target.value)}
                />
              </FormField>
            </div>
          </Card>
        ) : null}
        {!isConsignment && hasConsignmentData ? (
          <p className="ds-hint" role="status">
            Los datos de consignación cargados se van a perder al guardar: el origen ya no es
            Consignación.
          </p>
        ) : null}

        <Card heading="Características">
          <div className="ds-field-grid">
            {/* Entero con puntos de miles, sin decimales (ítem 23): el estado
                sigue guardando "150000" y el backend recibe el int de siempre. */}
            <FormField label={fieldLabel("mileage")}>
              <IntegerInput value={values.mileage} onChange={(value) => update("mileage", value)} />
            </FormField>
            <EnumField
              label={fieldLabel("transmission")}
              value={values.transmission}
              labels={TRANSMISSION_LABELS}
              onChange={(value) => update("transmission", value)}
              emptyLabel="Sin especificar"
            />
            <EnumField
              label={fieldLabel("fuelType")}
              value={values.fuelType}
              labels={FUEL_TYPE_LABELS}
              onChange={(value) => update("fuelType", value)}
              emptyLabel="Sin especificar"
            />
            <FormField label={fieldLabel("exteriorColor")}>
              <input
                type="text"
                value={values.exteriorColor}
                onChange={(event) => update("exteriorColor", event.target.value)}
              />
            </FormField>
            <EnumField
              label={fieldLabel("colorFinish")}
              value={values.colorFinish}
              labels={COLOR_FINISH_LABELS}
              onChange={(value) => update("colorFinish", value)}
              emptyLabel="Sin especificar"
            />
            <FormField label={fieldLabel("cylinderCapacityLiters")}>
              <input
                type="number"
                min={0}
                step="0.01"
                value={values.cylinderCapacityLiters}
                onChange={(event) => update("cylinderCapacityLiters", event.target.value)}
              />
            </FormField>
            <EnumField
              label={fieldLabel("drivetrain")}
              value={values.drivetrain}
              labels={DRIVETRAIN_LABELS}
              onChange={(value) => update("drivetrain", value)}
              emptyLabel="Sin especificar"
            />
            <FormField label={fieldLabel("doors")}>
              <input
                type="number"
                min={1}
                step={1}
                value={values.doors}
                onChange={(event) => update("doors", event.target.value)}
              />
            </FormField>
            <FormField label={fieldLabel("seats")}>
              <input
                type="number"
                min={1}
                step={1}
                value={values.seats}
                onChange={(event) => update("seats", event.target.value)}
              />
            </FormField>
            <FormField label={fieldLabel("powerHp")}>
              <input
                type="number"
                min={1}
                step={1}
                value={values.powerHp}
                onChange={(event) => update("powerHp", event.target.value)}
              />
            </FormField>
            <FormField label={fieldLabel("declaredConsumptionKmL")}>
              <input
                type="number"
                min={0}
                step="0.01"
                value={values.declaredConsumptionKmL}
                onChange={(event) => update("declaredConsumptionKmL", event.target.value)}
              />
            </FormField>
            <FormField label={fieldLabel("upholstery")}>
              <input
                type="text"
                value={values.upholstery}
                onChange={(event) => update("upholstery", event.target.value)}
              />
            </FormField>
            <div className="ds-field-grid--full">
              <EquipmentField
                label={fieldLabel("equipment")}
                value={values.equipment}
                onChange={(codes) => update("equipment", codes)}
              />
            </div>
          </div>
        </Card>

        <Card heading="Documentación y garantía">
          <div className="ds-field-grid">
            <EnumField
              label={fieldLabel("warranty")}
              value={values.warranty}
              labels={WARRANTY_LABELS}
              onChange={handleWarrantyChange}
              emptyLabel="Sin especificar"
            />
            {values.warranty === "OTHER" ? (
              <FormField label={fieldLabel("warrantyOther")}>
                <input
                  type="text"
                  maxLength={255}
                  placeholder="Ej. Garantía del fabricante importador, 90 días"
                  value={values.warrantyOther}
                  onChange={(event) => update("warrantyOther", event.target.value)}
                />
              </FormField>
            ) : null}
            <FormField label={fieldLabel("titleHolder")}>
              <input
                type="text"
                value={values.titleHolder}
                onChange={(event) => update("titleHolder", event.target.value)}
              />
            </FormField>
            <FormField label={fieldLabel("licensePlateDebtLocal")}>
              <CurrencyInput
                value={values.licensePlateDebtLocal}
                onChange={(value) => update("licensePlateDebtLocal", value)}
              />
            </FormField>
            <FormField label={fieldLabel("lastTechnicalInspectionAt")}>
              <input
                type="date"
                value={values.lastTechnicalInspectionAt}
                onChange={(event) => update("lastTechnicalInspectionAt", event.target.value)}
              />
            </FormField>
            <FormField label={fieldLabel("singleOwner")}>
              <input
                type="checkbox"
                checked={values.singleOwner}
                onChange={(event) => update("singleOwner", event.target.checked)}
              />
            </FormField>
            <FormField label={fieldLabel("officialServiceUpToDate")}>
              <input
                type="checkbox"
                checked={values.officialServiceUpToDate}
                onChange={(event) => update("officialServiceUpToDate", event.target.checked)}
              />
            </FormField>
            <FormField label={fieldLabel("hasManualAndSpareKey")}>
              <input
                type="checkbox"
                checked={values.hasManualAndSpareKey}
                onChange={(event) => update("hasManualAndSpareKey", event.target.checked)}
              />
            </FormField>
            <FormField label={fieldLabel("titleReportRequested")}>
              <input
                type="checkbox"
                checked={values.titleReportRequested}
                onChange={(event) => update("titleReportRequested", event.target.checked)}
              />
            </FormField>
          </div>
        </Card>

        <Card heading="Multimedia">
          <div className="ds-stack">
            <div className="ds-field-grid">
              <FormField label={fieldLabel("videoUrl")}>
                <input
                  type="url"
                  value={values.videoUrl}
                  onChange={(event) => update("videoUrl", event.target.value)}
                />
              </FormField>
              <FormField label={fieldLabel("tour360Url")}>
                <input
                  type="url"
                  value={values.tour360Url}
                  onChange={(event) => update("tour360Url", event.target.value)}
                />
              </FormField>
            </div>
            {isEditMode && vehicle ? (
              <VehiclePhotoGallery vehicleId={vehicle.id} photos={vehicle.photos} />
            ) : (
              <p className="ds-hint">Las fotos se suben después de guardar la unidad.</p>
            )}
          </div>
        </Card>

        <Card heading="Publicación">
          <div className="ds-stack">
            <div className="ds-field-grid">
              <FormField label={fieldLabel("publishOnWebsite")}>
                <input
                  type="checkbox"
                  checked={values.publishOnWebsite}
                  onChange={(event) => update("publishOnWebsite", event.target.checked)}
                  disabled={!isEditMode}
                />
              </FormField>
              <FormField label={fieldLabel("publishOnPortals")}>
                <input
                  type="checkbox"
                  checked={values.publishOnPortals}
                  onChange={(event) => update("publishOnPortals", event.target.checked)}
                />
              </FormField>
              <FormField label={fieldLabel("featuredOnHomepage")}>
                <input
                  type="checkbox"
                  checked={values.featuredOnHomepage}
                  onChange={(event) => update("featuredOnHomepage", event.target.checked)}
                />
              </FormField>
              <div className="ds-field-grid--full">
                <FormField label={fieldLabel("publicDescription")}>
                  <textarea
                    value={values.publicDescription}
                    onChange={(event) => update("publicDescription", event.target.value)}
                  />
                </FormField>
              </div>
            </div>
            {!isEditMode ? (
              <p className="ds-hint">Vas a poder publicarla después de guardar y subirle fotos.</p>
            ) : null}
            {/* Completitud local: guía visual, se recalcula al tipear. */}
            <div className="ds-meter" aria-label="Completitud para publicar">
              <div className="ds-meter-row">
                <span>Completitud para publicar</span>
                <span className="ds-meter-value">{checklist.percent}%</span>
              </div>
              <div className="ds-meter-track">
                <div className="ds-meter-fill" style={{ width: `${checklist.percent}%` }} />
              </div>
            </div>
            {checklist.missing.length > 0 ? (
              <div>
                <p className="ds-hint">Falta completar:</p>
                <ul aria-label="Campos que faltan para publicar">
                  {checklist.missing.map((field) => (
                    <li key={field}>{fieldLabel(field)}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="ds-hint">La ficha tiene todo lo necesario para publicarse.</p>
            )}
            {/* La lista del SERVIDOR, cuando el guardado fue rechazado por
                completitud: es la que manda. */}
            {serverMissingFields ? (
              <div>
                <p className="ds-hint">El servidor rechazó la publicación. Falta completar:</p>
                <ul aria-label="Campos que faltan según el servidor">
                  {serverMissingFields.map((field) => (
                    <li key={field}>{fieldLabel(field)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Card>

        {isEditMode && vehicle ? (
          <Card heading="Registro">
            <div className="ds-stack">
              <dl className="ds-card-grid">
                <div>
                  <dt className="ds-kpi-label">Código interno</dt>
                  <dd>{vehicle.internalCode}</dd>
                </div>
                <div>
                  <dt className="ds-kpi-label">Alta</dt>
                  <dd>{new Date(vehicle.createdAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="ds-kpi-label">Última modificación</dt>
                  <dd>{new Date(vehicle.updatedAt).toLocaleString()}</dd>
                </div>
              </dl>
              <div className="ds-card-actions">
                <Button onClick={() => setIsChangeLogOpen(true)}>Ver historial de cambios</Button>
              </div>
            </div>
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

      {isChangeLogOpen && vehicle ? (
        <VehicleChangeLogDialog vehicleId={vehicle.id} onClose={() => setIsChangeLogOpen(false)} />
      ) : null}
    </form>
  );
}
