import type { BadgeVariant } from "../../design-system/Badge";
import type {
  VehicleBodyType,
  VehicleColorFinish,
  VehicleCondition,
  VehicleDrivetrain,
  VehicleFuelType,
  VehicleOrigin,
  VehiclePublicationCurrency,
  VehicleStatus,
  VehicleTransmission,
  VehicleWarranty,
} from "./types";

// ---------------------------------------------------------------------------
// Rótulos en español de los enums de Vehicle. Los valores son los del schema
// (prisma/schema.prisma); acá solo el texto que ve la persona. Cada mapa es
// Record<Enum, string>: agregar un valor al enum sin rótulo no compila.
// ---------------------------------------------------------------------------

export const CONDITION_LABELS: Record<VehicleCondition, string> = {
  NEW: "Nuevo",
  USED: "Usado",
};

export const STATUS_LABELS: Record<VehicleStatus, string> = {
  AVAILABLE: "Disponible",
  RESERVED: "Reservado",
  IN_PREPARATION: "En preparación",
  IN_TRANSIT: "En tránsito",
  SOLD: "Vendido",
};

// El color del Badge lo decide este feature, no el componente (ver Badge.tsx):
// disponible es lo bueno, reservado es información, y vendido/en preparación/
// en tránsito son "no está a la venta ahora", neutrales los tres.
export const STATUS_BADGE_VARIANT: Record<VehicleStatus, BadgeVariant> = {
  AVAILABLE: "success",
  RESERVED: "info",
  IN_PREPARATION: "neutral",
  IN_TRANSIT: "neutral",
  SOLD: "neutral",
};

export const BODY_TYPE_LABELS: Record<VehicleBodyType, string> = {
  SEDAN: "Sedán",
  HATCHBACK: "Hatchback",
  SUV: "SUV",
  PICKUP: "Pickup",
  COUPE: "Coupé",
  WAGON: "Rural",
  VAN: "Van",
  UTILITY: "Utilitario",
  MINIVAN: "Minivan",
};

export const ORIGIN_LABELS: Record<VehicleOrigin, string> = {
  DIRECT_PURCHASE: "Compra directa",
  TRADE_IN: "Permuta",
  CONSIGNMENT: "Consignación",
  IMPORT: "Importación",
  BRANCH_TRANSFER: "Traslado entre sucursales",
};

export const PUBLICATION_CURRENCY_LABELS: Record<VehiclePublicationCurrency, string> = {
  BOTH: "USD y moneda local",
  USD_ONLY: "Solo USD",
  LOCAL_ONLY: "Solo moneda local",
};

export const TRANSMISSION_LABELS: Record<VehicleTransmission, string> = {
  MANUAL: "Manual",
  AUTOMATIC: "Automática",
  AUTOMATIC_SEQUENTIAL: "Automática secuencial",
  CVT: "CVT",
};

export const FUEL_TYPE_LABELS: Record<VehicleFuelType, string> = {
  GASOLINE: "Nafta",
  DIESEL: "Diésel",
  HYBRID: "Híbrido",
  ELECTRIC: "Eléctrico",
  CNG: "GNC",
  GASOLINE_CNG: "Nafta / GNC",
};

export const COLOR_FINISH_LABELS: Record<VehicleColorFinish, string> = {
  SOLID: "Sólido",
  METALLIC: "Metalizado",
  PEARL: "Perlado",
  MATTE: "Mate",
};

export const DRIVETRAIN_LABELS: Record<VehicleDrivetrain, string> = {
  FRONT: "Delantera",
  REAR: "Trasera",
  FOUR_BY_FOUR: "4x4",
  AWD: "Integral (AWD)",
};

export const WARRANTY_LABELS: Record<VehicleWarranty, string> = {
  NONE: "Sin garantía",
  FACTORY: "De fábrica",
  DEALER_6M: "Del concesionario, 6 meses",
  DEALER_12M: "Del concesionario, 12 meses",
  OTHER: "Otra",
};

// Rótulos de los campos de la ficha, para el checklist de completitud y el
// historial de cambios (que guarda fieldName tal cual). Un campo sin rótulo
// se muestra por su nombre técnico, no se oculta.
export const FIELD_LABELS: Record<string, string> = {
  condition: "Condición",
  licensePlate: "Patente",
  vin: "VIN",
  engineNumber: "Número de motor",
  bodyType: "Carrocería",
  make: "Marca",
  model: "Modelo",
  trim: "Versión",
  year: "Año",
  priceListUsd: "Precio de lista (USD)",
  priceListLocal: "Precio de lista (moneda local)",
  minAcceptablePriceUsd: "Precio mínimo aceptable (USD)",
  acquisitionCostUsd: "Costo de adquisición (USD)",
  status: "Estado",
  visibleInListing: "Visible en el listado",
  origin: "Origen",
  stockEnteredAt: "Ingreso al stock",
  publicationCurrency: "Moneda de publicación",
  acceptsTradeIn: "Acepta permuta",
  financingAvailable: "Financiación disponible",
  priceOnRequest: "Precio a consultar",
  consignorName: "Consignante",
  consignorDocument: "Documento del consignante",
  consignorPhone: "Teléfono del consignante",
  consignorEmail: "Email del consignante",
  consignmentAgreedPriceUsd: "Precio acordado (USD)",
  consignmentCommissionPercent: "Comisión (%)",
  consignmentAgreementExpiresAt: "Vencimiento del acuerdo",
  consignmentContractNumber: "Número de contrato",
  mileage: "Kilometraje",
  transmission: "Transmisión",
  fuelType: "Combustible",
  exteriorColor: "Color exterior",
  colorFinish: "Terminación del color",
  cylinderCapacityLiters: "Cilindrada (L)",
  drivetrain: "Tracción",
  doors: "Puertas",
  upholstery: "Tapizado",
  powerHp: "Potencia (HP)",
  seats: "Asientos",
  declaredConsumptionKmL: "Consumo declarado (km/L)",
  equipment: "Equipamiento",
  warranty: "Garantía",
  warrantyOther: "Detalle de la garantía",
  licensePlateDebtLocal: "Deuda de patente (moneda local)",
  lastTechnicalInspectionAt: "Última inspección técnica",
  titleHolder: "Titular registral",
  singleOwner: "Único dueño",
  officialServiceUpToDate: "Service oficial al día",
  hasManualAndSpareKey: "Manual y llave de repuesto",
  titleReportRequested: "Informe de dominio solicitado",
  branchId: "Sucursal",
  assignedSalespersonId: "Vendedor asignado",
  physicalLocation: "Ubicación física",
  availableSince: "Disponible desde",
  videoUrl: "Video (URL)",
  tour360Url: "Tour 360 (URL)",
  publishOnWebsite: "Publicar en el sitio web",
  publishOnPortals: "Publicar en portales",
  featuredOnHomepage: "Destacar en la portada",
  publicDescription: "Descripción pública",
  internalNotes: "Notas internas",
  photos: "Al menos una foto",
};

export function fieldLabel(fieldName: string): string {
  return FIELD_LABELS[fieldName] ?? fieldName;
}
