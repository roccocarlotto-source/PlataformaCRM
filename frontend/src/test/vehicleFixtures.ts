import type {
  Vehicle,
  VehicleChangeLogEntry,
  VehicleDetail,
  VehicleListItem,
  VehiclePhoto,
} from "../features/vehicle/types";

// Fixtures compartidas entre los tests de features/vehicle/. Un usado con lo
// mínimo cargado: cualquier test que necesite una ficha "completa para
// publicar" lo dice con overrides explícitos.
export function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: "v1",
    organizationId: "org-1",
    internalCode: "STK-000001",
    condition: "USED",
    licensePlate: null,
    vin: null,
    engineNumber: null,
    bodyType: null,
    make: "Toyota",
    model: "Corolla",
    trim: null,
    year: 2020,
    priceListUsd: null,
    priceListLocal: null,
    minAcceptablePriceUsd: null,
    acquisitionCostUsd: null,
    status: "AVAILABLE",
    visibleInListing: true,
    origin: null,
    stockEnteredAt: null,
    publicationCurrency: "BOTH",
    acceptsTradeIn: false,
    financingAvailable: false,
    priceOnRequest: false,
    consignorName: null,
    consignorDocument: null,
    consignorPhone: null,
    consignorEmail: null,
    consignmentAgreedPriceUsd: null,
    consignmentCommissionPercent: null,
    consignmentAgreementExpiresAt: null,
    consignmentContractNumber: null,
    mileage: null,
    transmission: null,
    fuelType: null,
    exteriorColor: null,
    colorFinish: null,
    cylinderCapacityLiters: null,
    drivetrain: null,
    doors: null,
    upholstery: null,
    powerHp: null,
    seats: null,
    declaredConsumptionKmL: null,
    equipment: [],
    warranty: null,
    warrantyOther: null,
    licensePlateDebtLocal: null,
    lastTechnicalInspectionAt: null,
    titleHolder: null,
    singleOwner: false,
    officialServiceUpToDate: false,
    hasManualAndSpareKey: false,
    titleReportRequested: false,
    branchId: "b1",
    assignedSalespersonId: null,
    physicalLocation: null,
    availableSince: null,
    videoUrl: null,
    tour360Url: null,
    publishOnWebsite: false,
    publishOnPortals: false,
    featuredOnHomepage: false,
    publicDescription: null,
    internalNotes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

// Una fila del listado: la unidad más coverPhotoUrl (null por default, como
// una unidad recién dada de alta sin fotos).
export function makeVehicleListItem(overrides: Partial<VehicleListItem> = {}): VehicleListItem {
  return { coverPhotoUrl: null, ...makeVehicle(overrides), ...overrides };
}

export function makeVehiclePhoto(overrides: Partial<VehiclePhoto> = {}): VehiclePhoto {
  return {
    id: "p1",
    organizationId: "org-1",
    vehicleId: "v1",
    storagePath: "org-1/v1/p1.jpg",
    slot: null,
    position: 0,
    isCover: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    url: "https://storage.test.local/signed/p1.jpg",
    ...overrides,
  };
}

export function makeVehicleDetail(
  overrides: Partial<VehicleDetail> = {},
  photos: VehiclePhoto[] = [],
): VehicleDetail {
  return { ...makeVehicle(overrides), photos, ...overrides };
}

export function makeChangeLogEntry(
  overrides: Partial<VehicleChangeLogEntry> = {},
): VehicleChangeLogEntry {
  return {
    id: "cl1",
    organizationId: "org-1",
    vehicleId: "v1",
    changedById: "u1",
    fieldName: "status",
    oldValue: "AVAILABLE",
    newValue: "RESERVED",
    changedAt: "2026-02-01T12:00:00.000Z",
    changedBy: { id: "u1", fullName: "Ana Pérez" },
    ...overrides,
  };
}
