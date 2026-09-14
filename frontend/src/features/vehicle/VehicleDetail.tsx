import { DetailList, type DetailSection } from "../../design-system/DetailList";
import { Badge } from "../../design-system/Badge";
import { formatAmount } from "../../design-system/currencyFormat";
import { formatDateTime, yesNo } from "../../design-system/detailFormat";
import { formatInteger } from "../../design-system/integerFormat";
import { BRANCHES_PARA_SELECT, useBranches } from "../branch/queries";
import { formatDate } from "../opportunity/format";
import {
  BODY_TYPE_LABELS,
  COLOR_FINISH_LABELS,
  CONDITION_LABELS,
  DRIVETRAIN_LABELS,
  FUEL_TYPE_LABELS,
  ORIGIN_LABELS,
  PUBLICATION_CURRENCY_LABELS,
  STATUS_BADGE_VARIANT,
  STATUS_LABELS,
  TRANSMISSION_LABELS,
  WARRANTY_LABELS,
  fieldLabel,
} from "./labels";
import type { VehicleListItem } from "./types";

// ---------------------------------------------------------------------------
// Contenido del pop up "Ver detalle" de una unidad de stock
// (docs/frontend-cambios-pendientes.md §28). En archivo aparte, y no en línea
// en VehicleListPage como en los demás listados, porque la ficha tiene ~40
// campos: las mismas tarjetas de VehicleFormPage, en el mismo orden y con los
// mismos rótulos (fieldLabel, la fuente única de nombres de campo), pasan a
// ser secciones de DetailList. Lo que el formulario muestra como ayuda de
// edición y no como dato —"Completitud para publicar", los campos que faltan,
// el historial de cambios— no está acá.
//
// FORMATO, el que ya usa cada dato en pantalla: importes con el mismo
// formatAmount de CurrencyInput ("25.000,00", ítem 23), kilometraje con el
// de IntegerInput, fechas de solo día (@db.Date) con el formatDate de
// Oportunidades, fechas con hora como en la tarjeta "Registro" del
// formulario, enums con sus mapas de labels.ts y el estado con el mismo
// Badge de la columna. Los enteros chicos (año, puertas, asientos, HP) y los
// decimales técnicos (cilindrada, consumo, comisión) van tal cual, como el
// formulario los muestra en su input. Nada de esto es un formato nuevo.
//
// SUCURSAL por nombre, nunca el id: la resuelve la misma query que el filtro
// "Sucursal" del listado ya tiene abierta (BranchSelect usa exactamente
// BRANCHES_PARA_SELECT), así que TanStack Query la dedupe y el detalle no
// dispara ninguna request propia. El vendedor llega ya resuelto desde el
// listado (mismo mapa que la columna Vendedor).
// ---------------------------------------------------------------------------

export interface VehicleDetailProps {
  vehicle: VehicleListItem;
  salespersonName: string | null;
}

// Decimal(14,2) de la API ("25000.00") → "25.000,00"; null → vacío.
function importe(value: string | null): string {
  return value === null ? "" : formatAmount(value);
}

// @db.Date de la API ("2026-01-01T00:00:00.000Z") → solo el día, en UTC.
function fecha(value: string | null): string {
  return value === null ? "" : formatDate(value);
}

// Enum nullable → su rótulo; null → vacío (el formulario lo muestra como
// "Sin especificar", el detalle como dato vacío).
function rotulo<T extends string>(labels: Record<T, string>, value: T | null): string {
  return value === null ? "" : labels[value];
}

export function VehicleDetail({ vehicle, salespersonName }: VehicleDetailProps) {
  const branchesQuery = useBranches(BRANCHES_PARA_SELECT);
  const branchName =
    branchesQuery.data?.data.find((branch) => branch.id === vehicle.branchId)?.name ?? "—";

  const sections: DetailSection[] = [
    {
      heading: "Identificación",
      items: [
        { label: fieldLabel("condition"), value: CONDITION_LABELS[vehicle.condition] },
        { label: fieldLabel("year"), value: String(vehicle.year) },
        { label: fieldLabel("make"), value: vehicle.make },
        { label: fieldLabel("model"), value: vehicle.model },
        { label: fieldLabel("trim"), value: vehicle.trim },
        { label: fieldLabel("bodyType"), value: rotulo(BODY_TYPE_LABELS, vehicle.bodyType) },
        { label: fieldLabel("licensePlate"), value: vehicle.licensePlate },
        { label: fieldLabel("vin"), value: vehicle.vin },
        { label: fieldLabel("engineNumber"), value: vehicle.engineNumber },
      ],
    },
    {
      heading: "Comercial",
      items: [
        {
          label: fieldLabel("status"),
          value: (
            <Badge variant={STATUS_BADGE_VARIANT[vehicle.status]}>
              {STATUS_LABELS[vehicle.status]}
            </Badge>
          ),
        },
        { label: fieldLabel("origin"), value: rotulo(ORIGIN_LABELS, vehicle.origin) },
        { label: fieldLabel("priceListUsd"), value: importe(vehicle.priceListUsd) },
        { label: fieldLabel("priceListLocal"), value: importe(vehicle.priceListLocal) },
        {
          label: fieldLabel("minAcceptablePriceUsd"),
          value: importe(vehicle.minAcceptablePriceUsd),
        },
        { label: fieldLabel("acquisitionCostUsd"), value: importe(vehicle.acquisitionCostUsd) },
        {
          label: fieldLabel("publicationCurrency"),
          value: PUBLICATION_CURRENCY_LABELS[vehicle.publicationCurrency],
        },
        { label: fieldLabel("stockEnteredAt"), value: fecha(vehicle.stockEnteredAt) },
        { label: fieldLabel("priceOnRequest"), value: yesNo(vehicle.priceOnRequest) },
        { label: fieldLabel("visibleInListing"), value: yesNo(vehicle.visibleInListing) },
        { label: fieldLabel("acceptsTradeIn"), value: yesNo(vehicle.acceptsTradeIn) },
        { label: fieldLabel("financingAvailable"), value: yesNo(vehicle.financingAvailable) },
        { label: fieldLabel("internalNotes"), value: vehicle.internalNotes },
      ],
    },
    {
      heading: "Sucursal y asignación",
      items: [
        { label: fieldLabel("branchId"), value: branchName },
        { label: fieldLabel("assignedSalespersonId"), value: salespersonName },
        { label: fieldLabel("physicalLocation"), value: vehicle.physicalLocation },
        { label: fieldLabel("availableSince"), value: fecha(vehicle.availableSince) },
      ],
    },
    // Solo con origen Consignación, como la tarjeta del formulario: en
    // cualquier otro origen el backend garantiza estos campos en null.
    ...(vehicle.origin === "CONSIGNMENT"
      ? [
          {
            heading: "Consignación",
            items: [
              { label: fieldLabel("consignorName"), value: vehicle.consignorName },
              { label: fieldLabel("consignorDocument"), value: vehicle.consignorDocument },
              { label: fieldLabel("consignorPhone"), value: vehicle.consignorPhone },
              { label: fieldLabel("consignorEmail"), value: vehicle.consignorEmail },
              {
                label: fieldLabel("consignmentAgreedPriceUsd"),
                value: importe(vehicle.consignmentAgreedPriceUsd),
              },
              {
                label: fieldLabel("consignmentCommissionPercent"),
                value: vehicle.consignmentCommissionPercent,
              },
              {
                label: fieldLabel("consignmentAgreementExpiresAt"),
                value: fecha(vehicle.consignmentAgreementExpiresAt),
              },
              {
                label: fieldLabel("consignmentContractNumber"),
                value: vehicle.consignmentContractNumber,
              },
            ],
          },
        ]
      : []),
    {
      heading: "Características",
      items: [
        {
          label: fieldLabel("mileage"),
          value: vehicle.mileage === null ? "" : formatInteger(String(vehicle.mileage)),
        },
        {
          label: fieldLabel("transmission"),
          value: rotulo(TRANSMISSION_LABELS, vehicle.transmission),
        },
        { label: fieldLabel("fuelType"), value: rotulo(FUEL_TYPE_LABELS, vehicle.fuelType) },
        { label: fieldLabel("exteriorColor"), value: vehicle.exteriorColor },
        {
          label: fieldLabel("colorFinish"),
          value: rotulo(COLOR_FINISH_LABELS, vehicle.colorFinish),
        },
        { label: fieldLabel("cylinderCapacityLiters"), value: vehicle.cylinderCapacityLiters },
        { label: fieldLabel("drivetrain"), value: rotulo(DRIVETRAIN_LABELS, vehicle.drivetrain) },
        { label: fieldLabel("doors"), value: vehicle.doors },
        { label: fieldLabel("seats"), value: vehicle.seats },
        { label: fieldLabel("powerHp"), value: vehicle.powerHp },
        { label: fieldLabel("declaredConsumptionKmL"), value: vehicle.declaredConsumptionKmL },
        { label: fieldLabel("upholstery"), value: vehicle.upholstery },
        // Los chips de EquipmentField, como texto separado por comas.
        { label: fieldLabel("equipment"), value: vehicle.equipment.join(", ") },
      ],
    },
    {
      heading: "Documentación y garantía",
      items: [
        { label: fieldLabel("warranty"), value: rotulo(WARRANTY_LABELS, vehicle.warranty) },
        // El detalle en texto libre solo con "Otra", como en el formulario (§22).
        ...(vehicle.warranty === "OTHER"
          ? [{ label: fieldLabel("warrantyOther"), value: vehicle.warrantyOther }]
          : []),
        { label: fieldLabel("titleHolder"), value: vehicle.titleHolder },
        {
          label: fieldLabel("licensePlateDebtLocal"),
          value: importe(vehicle.licensePlateDebtLocal),
        },
        {
          label: fieldLabel("lastTechnicalInspectionAt"),
          value: fecha(vehicle.lastTechnicalInspectionAt),
        },
        { label: fieldLabel("singleOwner"), value: yesNo(vehicle.singleOwner) },
        {
          label: fieldLabel("officialServiceUpToDate"),
          value: yesNo(vehicle.officialServiceUpToDate),
        },
        { label: fieldLabel("hasManualAndSpareKey"), value: yesNo(vehicle.hasManualAndSpareKey) },
        { label: fieldLabel("titleReportRequested"), value: yesNo(vehicle.titleReportRequested) },
      ],
    },
    {
      heading: "Multimedia",
      items: [
        { label: fieldLabel("videoUrl"), value: vehicle.videoUrl },
        { label: fieldLabel("tour360Url"), value: vehicle.tour360Url },
        // La galería no viaja en el listado; sí la portada (coverPhotoUrl,
        // la misma miniatura de la columna Foto). Es una referencia, no la
        // galería: §28 lo deja fuera del foco de este ítem.
        {
          label: "Portada",
          value: vehicle.coverPhotoUrl ? (
            <img src={vehicle.coverPhotoUrl} alt="" className="ds-thumb" />
          ) : null,
        },
      ],
    },
    {
      heading: "Publicación",
      items: [
        { label: fieldLabel("publishOnWebsite"), value: yesNo(vehicle.publishOnWebsite) },
        { label: fieldLabel("publishOnPortals"), value: yesNo(vehicle.publishOnPortals) },
        { label: fieldLabel("featuredOnHomepage"), value: yesNo(vehicle.featuredOnHomepage) },
        { label: fieldLabel("publicDescription"), value: vehicle.publicDescription },
      ],
    },
    {
      heading: "Registro",
      items: [
        { label: "Código interno", value: vehicle.internalCode },
        { label: "Alta", value: formatDateTime(vehicle.createdAt) },
        { label: "Última modificación", value: formatDateTime(vehicle.updatedAt) },
      ],
    },
  ];

  return <DetailList sections={sections} />;
}
