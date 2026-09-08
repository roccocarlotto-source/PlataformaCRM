import {
  Prisma,
  type VehicleBodyType,
  type VehicleColorFinish,
  type VehicleCondition,
  type VehicleDrivetrain,
  type VehicleFuelType,
  type VehicleOrigin,
  type VehiclePublicationCurrency,
  type VehicleStatus,
  type VehicleTransmission,
  type VehicleWarranty,
} from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { findBranchById } from "../repositories/branch.repository";
import { lockOrganizationForUpdate } from "../repositories/organization.repository";
import { findUserByIdInOrganization } from "../repositories/user.repository";
import { countPhotosByVehicle } from "../repositories/vehiclePhoto.repository";
import {
  assignNextVehicleStockNumber,
  countVehicleChangeLog,
  countVehicles,
  createVehicle as createVehicleRepo,
  createVehicleChangeLogs,
  findManyVehicles,
  findVehicleById,
  findVehicleChangeLog,
  findVehicleIdentifierConflicts,
  softDeleteVehicle,
  updateVehicle as updateVehicleRepo,
  type VehicleChangeLogEntry,
  type VehicleSortBy,
  type VehicleUpdateData,
  type SortOrder,
} from "../repositories/vehicle.repository";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Vehicle — CRUD, historial de cambios y completitud para publicar (módulo de
// stock de vehículos, Fase 2a). Molde: qr.service.ts — una unidad cuelga de
// una Branch de la Organization del caller, elegida explícitamente.
//
// Las fotos y Storage son de vehiclePhoto.service.ts (2b); de ellas acá solo
// entra la cuenta, para la regla "al menos una foto para publicar". El vínculo
// con Opportunity (2c) vive en opportunity.service.ts; de él acá entra solo
// setVehicleStatusForOpportunityLink, al final del archivo. Tipo de cambio y
// moneda de la organización (2c) son de exchangeRate.service.ts y
// organization.service.ts. FUERA DE ESTA FASE: la página pública sin login
// (Fase 3).
//
// TODA ESCRITURA VA EN UNA TRANSACCIÓN CON lockOrganizationForUpdate, no solo
// la creación. En QR el lock protegía únicamente el contador; acá protege
// además la unicidad de VIN/patente, que NO es un UNIQUE de base (decisión de
// la Fase 1): sin serializar dos escrituras del mismo tenant, dos requests
// concurrentes con el mismo VIN pasarían las dos su chequeo. Es el mismo
// criterio que countActiveAdmins en user.service.ts —una decisión tomada
// sobre una lectura agregada se serializa sobre la fila de la organización—
// y el costo es aceptable: las escrituras de stock son de una persona en un
// mostrador, no de un webhook.
// ---------------------------------------------------------------------------

export interface ListVehiclesParams {
  page: number;
  pageSize: number;
  branchId?: string;
  status?: VehicleStatus[];
  condition?: VehicleCondition;
  make?: string;
  model?: string;
  minPriceUsd?: number;
  maxPriceUsd?: number;
  consignmentOnly?: boolean;
  q?: string;
  sortBy: VehicleSortBy;
  sortOrder: SortOrder;
}

export async function listVehicles(organizationId: string, params: ListVehiclesParams) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyVehicles(organizationId, filters, { skip, take: pageSize }, { sortBy, sortOrder }),
    countVehicles(organizationId, filters),
  ]);

  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

// "No existe" / "no es tuyo" / "está dado de baja" -> el mismo 404 genérico
// (anti-enumeración, igual que QR).
const VEHICULO_NO_ENCONTRADO = "Vehículo no encontrado";

export async function getVehicleById(organizationId: string, id: string, db: Db = prisma) {
  const vehicle = await findVehicleById(id, organizationId, db);
  if (!vehicle) {
    throw new AppError(VEHICULO_NO_ENCONTRADO, 404);
  }
  return vehicle;
}

export async function getVehicleChangeLog(
  organizationId: string,
  id: string,
  params: { page: number; pageSize: number },
) {
  // 404 antes de listar: el historial de una unidad ajena o inexistente no
  // se distingue de uno vacío.
  await getVehicleById(organizationId, id);
  const skip = (params.page - 1) * params.pageSize;

  const [data, total] = await Promise.all([
    findVehicleChangeLog(id, organizationId, { skip, take: params.pageSize }),
    countVehicleChangeLog(id, organizationId),
  ]);

  return {
    data,
    pagination: {
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / params.pageSize),
    },
  };
}

// ---------------------------------------------------------------------------
// Código interno: "STK-000001". Correlativo por organización a partir de
// Organization.nextVehicleStockNumber. Seis dígitos con relleno de ceros para
// que ordene bien como texto; a partir del millón sigue creciendo sin
// truncarse (padStart no recorta).
// ---------------------------------------------------------------------------

export function formatInternalCode(stockNumber: number): string {
  return `STK-${String(stockNumber).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Los campos que escribe el cliente. Es la contraparte del schema de Zod del
// controller; las Decimal llegan como number y las @db.Date como Date, y así
// las acepta Prisma. Sin id/organizationId/internalCode (los pone el service)
// ni timestamps.
// ---------------------------------------------------------------------------

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
  stockEnteredAt: Date | null;
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
  consignmentAgreementExpiresAt: Date | null;
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
  lastTechnicalInspectionAt: Date | null;
  titleHolder: string | null;
  singleOwner: boolean;
  officialServiceUpToDate: boolean;
  hasManualAndSpareKey: boolean;
  titleReportRequested: boolean;

  branchId: string;
  assignedSalespersonId: string | null;
  physicalLocation: string | null;
  availableSince: Date | null;

  videoUrl: string | null;
  tour360Url: string | null;

  publishOnWebsite: boolean;
  publishOnPortals: boolean;
  featuredOnHomepage: boolean;

  publicDescription: string | null;
  internalNotes: string | null;
}

type RequiredOnCreate = "condition" | "make" | "model" | "year" | "branchId";

// POST: los NOT NULL reales del schema son obligatorios; todo lo demás es
// opcional (modo borrador). Lo que no viene toma el default de la base.
export type CreateVehicleInput = Pick<VehicleWritableFields, RequiredOnCreate> &
  Partial<Omit<VehicleWritableFields, RequiredOnCreate>>;

// PATCH: parcial. Un campo nullable se vacía mandando null.
export type UpdateVehicleInput = Partial<VehicleWritableFields>;

// ---------------------------------------------------------------------------
// Consignación: los ocho campos que el CHECK
// vehicles_consignment_fields_require_origin_check obliga a que sean NULL
// salvo con origin = CONSIGNMENT.
// ---------------------------------------------------------------------------

export const CONSIGNMENT_FIELDS = [
  "consignorName",
  "consignorDocument",
  "consignorPhone",
  "consignorEmail",
  "consignmentAgreedPriceUsd",
  "consignmentCommissionPercent",
  "consignmentAgreementExpiresAt",
  "consignmentContractNumber",
] as const;

export type ConsignmentField = (typeof CONSIGNMENT_FIELDS)[number];

const CONSIGNMENT_FIELDS_CLEARED: Record<ConsignmentField, null> = {
  consignorName: null,
  consignorDocument: null,
  consignorPhone: null,
  consignorEmail: null,
  consignmentAgreedPriceUsd: null,
  consignmentCommissionPercent: null,
  consignmentAgreementExpiresAt: null,
  consignmentContractNumber: null,
};

// Decide qué hacer con la sección de consignación dada la escritura que se
// está por hacer. `effectiveOrigin` es el origen con el que la fila QUEDA
// (el del body, o el actual si el body no lo trae).
//
//   - Si queda en CONSIGNMENT: nada que hacer, lo que vino se escribe.
//   - Si NO queda en CONSIGNMENT y el body trae algún dato de consignante:
//     400. Vaciarlos en silencio descartaría lo que el cliente pidió
//     guardar, y escribirlos violaría el CHECK — ninguna de las dos es una
//     respuesta; es un body contradictorio.
//   - Si NO queda en CONSIGNMENT y el body no trae nada de eso: los ocho van a
//     NULL en la misma escritura. Es lo que el CHECK exige, y es lo que
//     corresponde: los datos personales de un consignante no sobreviven a
//     que la unidad deje de estar en consignación.
//
// Exportada para probarla sin base.
export function applyConsignmentRule<T extends Partial<VehicleWritableFields>>(
  effectiveOrigin: VehicleOrigin | null | undefined,
  data: T,
): T {
  if (effectiveOrigin === "CONSIGNMENT") {
    return data;
  }
  const enviados = CONSIGNMENT_FIELDS.filter(
    (field) => data[field] !== undefined && data[field] !== null,
  );
  if (enviados.length > 0) {
    throw new AppError(
      `Los datos de consignación solo se pueden cargar con origin = CONSIGNMENT (recibidos: ${enviados.join(", ")})`,
      400,
    );
  }
  return { ...data, ...CONSIGNMENT_FIELDS_CLEARED };
}

// ---------------------------------------------------------------------------
// Completitud para publicar. publishOnWebsite solo puede quedar en true si la
// ficha tiene estos campos; un usado exige además patente, kilometraje y
// titular registral; y desde la Fase 2b, al menos una foto. La lista de
// faltantes viaja en el 422 (error.details.missingFields) para que el
// frontend pinte el checklist "Falta completar"; la foto aparece ahí como
// "photos", al final.
//
// La cuenta de fotos la trae el caller (`gallery.photoCount`), no la lee esta
// función: es pura, y quien la llama sabe si está creando (cero fotos, una
// unidad nueva no puede tenerlas), editando (se cuentan bajo el lock) o
// borrando una foto (las que quedarían).
// ---------------------------------------------------------------------------

export const PUBLISH_REQUIRED_FIELDS = [
  "bodyType",
  "make",
  "model",
  "year",
  "priceListUsd",
  "priceListLocal",
  "transmission",
  "fuelType",
  "exteriorColor",
  "vin",
] as const;

export const PUBLISH_REQUIRED_FIELDS_USED = ["licensePlate", "mileage", "titleHolder"] as const;

export const PUBLISH_REQUIRED_PHOTOS = "photos";

export type PublishRequiredField =
  | (typeof PUBLISH_REQUIRED_FIELDS)[number]
  | (typeof PUBLISH_REQUIRED_FIELDS_USED)[number]
  | typeof PUBLISH_REQUIRED_PHOTOS;

type PublishRequiredVehicleField = Exclude<PublishRequiredField, typeof PUBLISH_REQUIRED_PHOTOS>;

export interface PublishGallery {
  photoCount: number;
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return true;
}

// Recibe la ficha CON LA QUE LA FILA QUEDA (la actual con el body aplicado),
// no el body solo, y la cantidad de fotos con la que queda la galería.
// Exportada para probarla sin base.
export function computeMissingFieldsForPublish(
  vehicle: Partial<Record<PublishRequiredVehicleField, unknown>> & {
    condition: VehicleCondition;
  },
  gallery: PublishGallery,
): PublishRequiredField[] {
  const required: PublishRequiredVehicleField[] = [...PUBLISH_REQUIRED_FIELDS];
  if (vehicle.condition === "USED") {
    required.push(...PUBLISH_REQUIRED_FIELDS_USED);
  }
  const missing: PublishRequiredField[] = required.filter((field) => !isPresent(vehicle[field]));
  if (gallery.photoCount < 1) {
    missing.push(PUBLISH_REQUIRED_PHOTOS);
  }
  return missing;
}

export const VEHICULO_INCOMPLETO_PARA_PUBLICAR = "La unidad no está completa para publicar";

// Exportada porque también la aplica vehiclePhoto.service al borrar la última
// foto de una unidad publicada.
export function assertCompleteForPublish(
  vehicle: Partial<Record<PublishRequiredVehicleField, unknown>> & {
    condition: VehicleCondition;
    publishOnWebsite?: boolean;
  },
  gallery: PublishGallery,
) {
  if (vehicle.publishOnWebsite !== true) {
    return;
  }
  const missingFields = computeMissingFieldsForPublish(vehicle, gallery);
  if (missingFields.length > 0) {
    throw new AppError(
      `${VEHICULO_INCOMPLETO_PARA_PUBLICAR}: faltan ${missingFields.join(", ")}`,
      422,
      true,
      { missingFields },
    );
  }
}

// ---------------------------------------------------------------------------
// Unicidad de VIN / patente entre unidades no dadas de baja de la
// organización. Recibe las filas con las que choca (ya leídas con el lock
// tomado) y decide el mensaje. Exportada para probarla sin base.
// ---------------------------------------------------------------------------

export function assertIdentifiersAvailable(
  conflicts: { vin: string | null; licensePlate: string | null }[],
  identifiers: { vin?: string | null; licensePlate?: string | null },
): void {
  if (identifiers.vin && conflicts.some((row) => row.vin === identifiers.vin)) {
    throw new AppError("Ya existe otra unidad con ese VIN en esta organización", 409);
  }
  if (
    identifiers.licensePlate &&
    conflicts.some((row) => row.licensePlate === identifiers.licensePlate)
  ) {
    throw new AppError("Ya existe otra unidad con esa patente en esta organización", 409);
  }
}

async function validateIdentifiersUnique(
  organizationId: string,
  identifiers: { vin?: string | null; licensePlate?: string | null },
  excludeVehicleId: string | undefined,
  db: Db,
) {
  if (!identifiers.vin && !identifiers.licensePlate) {
    return;
  }
  const conflicts = await findVehicleIdentifierConflicts(
    organizationId,
    identifiers,
    excludeVehicleId,
    db,
  );
  assertIdentifiersAvailable(conflicts, identifiers);
}

// ---------------------------------------------------------------------------
// Historial de cambios: una fila por campo que efectivamente cambia de valor.
// Se compara la forma serializada, que es la que se guarda: así un Decimal
// leído de la base y el number que llegó en el body comparan igual cuando
// representan el mismo valor, y un campo que viene con lo que ya tenía no
// genera fila.
// ---------------------------------------------------------------------------

// A texto, o null por "no había valor" / "se vació". Las fechas de Vehicle
// son todas @db.Date, así que se serializan como día del calendario (UTC),
// que es lo que la columna guarda.
export function serializeChangeLogValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (value instanceof Prisma.Decimal) {
    return value.toString();
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value);
}

// Solo mira las claves de `after`: lo que el body no trae no cambió.
export function computeChangeLogEntries(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): VehicleChangeLogEntry[] {
  const entries: VehicleChangeLogEntry[] = [];
  for (const fieldName of Object.keys(after)) {
    if (after[fieldName] === undefined) {
      continue;
    }
    const oldValue = serializeChangeLogValue(before[fieldName]);
    const newValue = serializeChangeLogValue(after[fieldName]);
    if (oldValue !== newValue) {
      entries.push({ fieldName, oldValue, newValue });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Validaciones cruzadas: la sucursal y el vendedor tienen que ser de la
// organización del caller. Mismo mensaje y mismo 400 que validateBranchId en
// qr.service / resource.service (nunca se confirma la existencia de una
// sucursal ajena), y el de resolveOwnerId para el vendedor. `db` explícito
// porque corren DENTRO de la transacción, con el lock tomado.
// ---------------------------------------------------------------------------

async function validateBranchId(organizationId: string, branchId: string, db: Db) {
  const branch = await findBranchById(branchId, organizationId, db);
  if (!branch) {
    throw new AppError("La sucursal indicada no existe o no pertenece a tu organización", 400);
  }
}

async function validateAssignedSalespersonId(organizationId: string, userId: string, db: Db) {
  const user = await findUserByIdInOrganization(userId, organizationId, db);
  if (!user) {
    throw new AppError(
      "El usuario indicado en assignedSalespersonId no existe, no pertenece a tu organización, o está desactivado",
      400,
    );
  }
}

// ---------------------------------------------------------------------------
// Crear: siempre en modo borrador salvo que el body pida publicar (y entonces
// la ficha tiene que estar completa). Desde la Fase 2b eso incluye una foto,
// y una unidad recién creada no puede tener ninguna: publishOnWebsite: true
// en el POST es siempre 422 con "photos" entre los faltantes. Se crea, se
// suben las fotos y se publica con un PATCH.
//
// El lock de organización serializa el contador y la unicidad; una
// transacción que falla revierte el incremento, así que un código nunca se
// quema sin usarse (igual que displayNumber).
// ---------------------------------------------------------------------------

export function createVehicle(organizationId: string, input: CreateVehicleInput) {
  // Reglas puras primero: un body contradictorio o incompleto se rechaza
  // antes de abrir una transacción.
  const data = applyConsignmentRule(input.origin ?? null, input);
  assertCompleteForPublish(data, { photoCount: 0 });

  return prisma.$transaction(async (tx) => {
    await lockOrganizationForUpdate(organizationId, tx);
    await validateBranchId(organizationId, data.branchId, tx);
    if (data.assignedSalespersonId) {
      await validateAssignedSalespersonId(organizationId, data.assignedSalespersonId, tx);
    }
    await validateIdentifiersUnique(
      organizationId,
      { vin: data.vin, licensePlate: data.licensePlate },
      undefined,
      tx,
    );
    const stockNumber = await assignNextVehicleStockNumber(organizationId, tx);

    return createVehicleRepo(
      { ...data, organizationId, internalCode: formatInternalCode(stockNumber) },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// Editar: parcial. Las dos reglas de negocio de esta fase viven acá —el
// historial por campo y el vaciado de consignación— más la completitud
// cuando la fila QUEDA publicada (no solo cuando pasa a serlo: un PATCH que
// vacía el VIN de una unidad ya publicada, o la pasa de 0 km a usado sin
// patente, la dejaría publicada e incompleta, que es exactamente el estado
// que la regla existe para impedir).
//
// UPDATE y filas de historial en la misma transacción. Nunca confía en un
// organizationId del body — no lo pide.
// ---------------------------------------------------------------------------

export async function updateVehicle(
  organizationId: string,
  actorUserId: string,
  id: string,
  input: UpdateVehicleInput,
) {
  return prisma.$transaction(async (tx) => {
    await lockOrganizationForUpdate(organizationId, tx);
    // 404 si no existe, no es de esta organización, o está dada de baja.
    const current = await getVehicleById(organizationId, id, tx);

    const effectiveOrigin = input.origin !== undefined ? input.origin : current.origin;
    const data: UpdateVehicleInput = applyConsignmentRule(effectiveOrigin, input);

    // La ficha con la que la fila queda, para las reglas que miran el todo.
    // Las fotos se cuentan solo si hace falta (la fila queda publicada), y
    // bajo el lock: un DELETE de foto concurrente espera a este PATCH.
    const effective = { ...current, ...data };
    const photoCount = effective.publishOnWebsite
      ? await countPhotosByVehicle(id, organizationId, tx)
      : 0;
    assertCompleteForPublish(effective, { photoCount });

    if (data.branchId !== undefined) {
      await validateBranchId(organizationId, data.branchId, tx);
    }
    if (data.assignedSalespersonId) {
      await validateAssignedSalespersonId(organizationId, data.assignedSalespersonId, tx);
    }
    await validateIdentifiersUnique(
      organizationId,
      { vin: data.vin, licensePlate: data.licensePlate },
      id,
      tx,
    );

    const entries = computeChangeLogEntries(
      current as unknown as Record<string, unknown>,
      data as Record<string, unknown>,
    );
    if (entries.length === 0) {
      // Todo lo que vino ya estaba así: sin escritura y sin historial.
      return current;
    }

    // Solo los campos que cambian: un UPDATE que reescribe con el mismo valor
    // no aporta nada y movería updatedAt sin motivo.
    const changed = Object.fromEntries(
      entries.map((entry) => [entry.fieldName, data[entry.fieldName as keyof UpdateVehicleInput]]),
    ) as VehicleUpdateData;

    const result = await updateVehicleRepo(id, organizationId, changed, tx);
    if (result.count === 0) {
      throw new AppError(VEHICULO_NO_ENCONTRADO, 404);
    }
    await createVehicleChangeLogs(
      { organizationId, vehicleId: id, changedById: actorUserId },
      entries,
      tx,
    );

    return getVehicleById(organizationId, id, tx);
  });
}

// "Dar de baja la unidad": soft delete, la ficha y su historial se conservan.
export async function deleteVehicle(organizationId: string, id: string) {
  const result = await softDeleteVehicle(id, organizationId);
  if (result.count === 0) {
    throw new AppError(VEHICULO_NO_ENCONTRADO, 404);
  }
}

// ---------------------------------------------------------------------------
// Vínculo con Opportunity (Fase 2c). "Al vincular una unidad del stock, la
// oportunidad toma su precio y su estado": el ESTADO de la unidad es quien
// manda, y esta función es la única puerta por la que opportunity.service.ts
// lo mueve —a RESERVED al vincular, a SOLD al ganar, a AVAILABLE al liberar—.
// Cambia SOLO status, DENTRO de la transacción del caller (nunca abre la
// suya, a diferencia de updateVehicle), con el lock de organización ya
// tomado por ese caller.
//
// Escribe el historial igual que un PATCH directo a /vehicles/:id: la ficha
// muestra "RESERVED → SOLD" venga de donde venga. Deliberadamente NO pasa por
// applyConsignmentRule ni por assertCompleteForPublish: tocar solo status
// nunca deja una ficha publicada incompleta (publishOnWebsite no se toca) ni
// afecta la regla de consignación (origin no se toca).
// ---------------------------------------------------------------------------

export async function setVehicleStatusForOpportunityLink(
  organizationId: string,
  actorUserId: string,
  vehicleId: string,
  newStatus: VehicleStatus,
  tx: Db,
): Promise<void> {
  // 404 defensivo: el caller ya validó existencia bajo el mismo lock.
  const current = await getVehicleById(organizationId, vehicleId, tx);
  if (current.status === newStatus) {
    return;
  }

  const entries = computeChangeLogEntries(current as unknown as Record<string, unknown>, {
    status: newStatus,
  });
  const result = await updateVehicleRepo(vehicleId, organizationId, { status: newStatus }, tx);
  if (result.count === 0) {
    // Se leyó la fila un instante antes, bajo el mismo lock: cero filas acá
    // es un bug del caller, no un 404 — mismo criterio que
    // lockStageForUpdate con cero filas.
    throw new Error(
      `setVehicleStatusForOpportunityLink: el UPDATE de ${vehicleId} no afectó ninguna fila`,
    );
  }
  if (entries.length > 0) {
    await createVehicleChangeLogs(
      { organizationId, vehicleId, changedById: actorUserId },
      entries,
      tx,
    );
  }
}
