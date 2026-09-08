// Reconstruido desde el contrato real del backend (src/controllers/vehicle.controller.ts
// — vehicleFields / listVehiclesQuerySchema —, src/services/vehicle.service.ts
// — VehicleWritableFields —, src/services/vehiclePhoto.service.ts y
// prisma/schema.prisma, modelos Vehicle / VehiclePhoto / VehicleChangeLog). No
// se agrega ningún campo que el backend no devuelva o no acepte.
//
// Tipos de lectura: los Decimal(14,2) de Prisma llegan como STRING (mismo
// caso verificado que Opportunity.amount, ver features/opportunity/types.ts);
// los @db.Date como ISO completo ("2026-01-01T00:00:00.000Z"); los Int como
// number. Para no adivinar campo por campo, la lista de cuáles son Decimal
// sale del schema: precios (4), consignmentAgreedPriceUsd,
// consignmentCommissionPercent, cylinderCapacityLiters,
// declaredConsumptionKmL y licensePlateDebtLocal. mileage/doors/powerHp/
// seats/year son Int.

export type VehicleCondition = "NEW" | "USED";
export type VehicleStatus = "AVAILABLE" | "RESERVED" | "IN_PREPARATION" | "IN_TRANSIT" | "SOLD";
export type VehicleBodyType =
  "SEDAN" | "HATCHBACK" | "SUV" | "PICKUP" | "COUPE" | "WAGON" | "VAN" | "UTILITY" | "MINIVAN";
export type VehicleOrigin =
  "DIRECT_PURCHASE" | "TRADE_IN" | "CONSIGNMENT" | "IMPORT" | "BRANCH_TRANSFER";
export type VehiclePublicationCurrency = "BOTH" | "USD_ONLY" | "LOCAL_ONLY";
export type VehicleTransmission = "MANUAL" | "AUTOMATIC" | "AUTOMATIC_SEQUENTIAL" | "CVT";
export type VehicleFuelType =
  "GASOLINE" | "DIESEL" | "HYBRID" | "ELECTRIC" | "CNG" | "GASOLINE_CNG";
export type VehicleColorFinish = "SOLID" | "METALLIC" | "PEARL" | "MATTE";
export type VehicleDrivetrain = "FRONT" | "REAR" | "FOUR_BY_FOUR" | "AWD";
export type VehicleWarranty = "NONE" | "FACTORY" | "DEALER_6M" | "DEALER_12M";

export interface Vehicle {
  id: string;
  organizationId: string;

  // Identificación
  internalCode: string;
  condition: VehicleCondition;
  licensePlate: string | null;
  vin: string | null;
  engineNumber: string | null;
  bodyType: VehicleBodyType | null;
  make: string;
  model: string;
  trim: string | null;
  year: number;

  // Comercial
  priceListUsd: string | null;
  priceListLocal: string | null;
  minAcceptablePriceUsd: string | null;
  acquisitionCostUsd: string | null;
  status: VehicleStatus;
  visibleInListing: boolean;
  origin: VehicleOrigin | null;
  stockEnteredAt: string | null;
  publicationCurrency: VehiclePublicationCurrency;
  acceptsTradeIn: boolean;
  financingAvailable: boolean;
  priceOnRequest: boolean;

  // Consignación (null salvo origin = CONSIGNMENT, lo garantiza el backend)
  consignorName: string | null;
  consignorDocument: string | null;
  consignorPhone: string | null;
  consignorEmail: string | null;
  consignmentAgreedPriceUsd: string | null;
  consignmentCommissionPercent: string | null;
  consignmentAgreementExpiresAt: string | null;
  consignmentContractNumber: string | null;

  // Características
  mileage: number | null;
  transmission: VehicleTransmission | null;
  fuelType: VehicleFuelType | null;
  exteriorColor: string | null;
  colorFinish: VehicleColorFinish | null;
  cylinderCapacityLiters: string | null;
  drivetrain: VehicleDrivetrain | null;
  doors: number | null;
  upholstery: string | null;
  powerHp: number | null;
  seats: number | null;
  declaredConsumptionKmL: string | null;
  equipment: string[];

  // Documentación / garantía
  warranty: VehicleWarranty | null;
  licensePlateDebtLocal: string | null;
  lastTechnicalInspectionAt: string | null;
  titleHolder: string | null;
  singleOwner: boolean;
  officialServiceUpToDate: boolean;
  hasManualAndSpareKey: boolean;
  titleReportRequested: boolean;

  // Operativo
  branchId: string;
  assignedSalespersonId: string | null;
  physicalLocation: string | null;
  availableSince: string | null;

  // Multimedia
  videoUrl: string | null;
  tour360Url: string | null;

  // Publicación
  publishOnWebsite: boolean;
  publishOnPortals: boolean;
  featuredOnHomepage: boolean;

  // Contenido
  publicDescription: string | null;
  internalNotes: string | null;

  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

// Una foto de la galería tal como la devuelve el backend (VehiclePhotoWithUrl):
// la fila más `url`, una URL firmada de lectura de corta duración generada en
// cada respuesta — nunca se guarda ni se cachea más allá de la query. `url`
// null es una foto cuyo objeto en Storage no pudo firmarse: se muestra igual
// para poder borrarla.
export interface VehiclePhoto {
  id: string;
  organizationId: string;
  vehicleId: string;
  storagePath: string;
  slot: string | null;
  position: number;
  isCover: boolean;
  createdAt: string;
  url: string | null;
}

// GET /vehicles/:id devuelve la ficha con su galería (getVehicleHandler:
// `{ ...vehicle, photos }`). El LISTADO no la trae: findManyVehicles es un
// findMany sin include, así que las filas del listado son `Vehicle` a secas.
export interface VehicleDetail extends Vehicle {
  photos: VehiclePhoto[];
}

export interface VehicleListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface VehicleListResponse {
  data: Vehicle[];
  pagination: VehicleListPagination;
}

export type VehicleSortBy = "createdAt" | "priceListUsd" | "stockEnteredAt";
export type SortOrder = "asc" | "desc";

// listVehiclesQuerySchema de vehicle.controller.ts. `status` es multi-selección
// y viaja como query repetida (?status=A&status=B), ver api.ts.
export interface VehicleListQuery {
  page?: number;
  pageSize?: number;
  branchId?: string;
  status?: VehicleStatus[];
  condition?: VehicleCondition;
  make?: string;
  model?: string;
  minPriceUsd?: number;
  maxPriceUsd?: number;
  consignmentOnly?: boolean;
  q?: string;
  sortBy?: VehicleSortBy;
  sortOrder?: SortOrder;
}

// Lo que el cliente ESCRIBE (vehicleFields del controller). Los Decimal van
// como number (z.number(), nunca string) y las fechas como "YYYY-MM-DD"
// (z.coerce.date). Un campo nullable se vacía mandando null.
export interface VehicleWritableFields {
  condition: VehicleCondition;
  licensePlate: string | null;
  vin: string | null;
  engineNumber: string | null;
  bodyType: VehicleBodyType | null;
  make: string;
  model: string;
  trim: string | null;
  year: number;

  priceListUsd: number | null;
  priceListLocal: number | null;
  minAcceptablePriceUsd: number | null;
  acquisitionCostUsd: number | null;
  status: VehicleStatus;
  visibleInListing: boolean;
  origin: VehicleOrigin | null;
  stockEnteredAt: string | null;
  publicationCurrency: VehiclePublicationCurrency;
  acceptsTradeIn: boolean;
  financingAvailable: boolean;
  priceOnRequest: boolean;

  consignorName: string | null;
  consignorDocument: string | null;
  consignorPhone: string | null;
  consignorEmail: string | null;
  consignmentAgreedPriceUsd: number | null;
  consignmentCommissionPercent: number | null;
  consignmentAgreementExpiresAt: string | null;
  consignmentContractNumber: string | null;

  mileage: number | null;
  transmission: VehicleTransmission | null;
  fuelType: VehicleFuelType | null;
  exteriorColor: string | null;
  colorFinish: VehicleColorFinish | null;
  cylinderCapacityLiters: number | null;
  drivetrain: VehicleDrivetrain | null;
  doors: number | null;
  upholstery: string | null;
  powerHp: number | null;
  seats: number | null;
  declaredConsumptionKmL: number | null;
  equipment: string[];

  warranty: VehicleWarranty | null;
  licensePlateDebtLocal: number | null;
  lastTechnicalInspectionAt: string | null;
  titleHolder: string | null;
  singleOwner: boolean;
  officialServiceUpToDate: boolean;
  hasManualAndSpareKey: boolean;
  titleReportRequested: boolean;

  branchId: string;
  assignedSalespersonId: string | null;
  physicalLocation: string | null;
  availableSince: string | null;

  videoUrl: string | null;
  tour360Url: string | null;

  publishOnWebsite: boolean;
  publishOnPortals: boolean;
  featuredOnHomepage: boolean;

  publicDescription: string | null;
  internalNotes: string | null;
}

type RequiredOnCreate = "condition" | "make" | "model" | "year" | "branchId";

// POST: los NOT NULL reales son obligatorios, el resto opcional (modo
// borrador). PATCH: todo parcial.
export type CreateVehicleInput = Pick<VehicleWritableFields, RequiredOnCreate> &
  Partial<Omit<VehicleWritableFields, RequiredOnCreate>>;

export type UpdateVehicleInput = Partial<VehicleWritableFields>;

// GET /vehicles/:id/change-log — una fila por campo que cambió, más reciente
// primero, con quién lo cambió (include changedBy { id, fullName }).
export interface VehicleChangeLogEntry {
  id: string;
  organizationId: string;
  vehicleId: string;
  changedById: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  changedAt: string;
  changedBy: { id: string; fullName: string };
}

export interface VehicleChangeLogResponse {
  data: VehicleChangeLogEntry[];
  pagination: VehicleListPagination;
}

export interface VehicleChangeLogQuery {
  page?: number;
  pageSize?: number;
}

// PATCH /vehicles/:id/photos/:photoId (updateVehiclePhotoSchema).
export interface UpdateVehiclePhotoInput {
  slot?: string | null;
  isCover?: boolean;
}

// POST /vehicles/:id/photos: los campos de texto del multipart.
export interface UploadVehiclePhotoOptions {
  slot?: string;
  isCover?: boolean;
}
