import type { Prisma, VehicleCondition, VehicleStatus } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Vehicle — módulo de stock de vehículos (Fase 2a: CRUD, historial y
// completitud). Molde: qrCode.repository.ts, la otra entidad que cuelga de
// una Branch con el mismo esquema de permisos.
//
// Mismas reglas que el resto de los repositorios: organizationId obligatorio
// en toda lectura y escritura; deletedAt: null en las lecturas de negocio;
// updateMany en vez de update para que el WHERE efectivo exija organizationId
// además de id (M4) y `count === 0` se traduzca a 404 en el service.
//
// NO HAY lectura pública acá: la página sin login es Fase 3, y cuando llegue
// tendrá su propio `select` explícito que excluya los campos internos (ver la
// cabecera de Vehicle en prisma/schema.prisma). Todo lo que devuelve este
// archivo es para usuarios autenticados de la organización y va completo.
// ---------------------------------------------------------------------------

export interface VehicleFilters {
  branchId?: string;
  // Multi-selección en el mockup: un OR sobre la lista.
  status?: VehicleStatus[];
  condition?: VehicleCondition;
  make?: string;
  model?: string;
  minPriceUsd?: number;
  maxPriceUsd?: number;
  consignmentOnly?: boolean;
  // Búsqueda de texto libre contra los identificadores y el título.
  q?: string;
}

export type VehicleSortBy = "createdAt" | "priceListUsd" | "stockEnteredAt";
export type SortOrder = "asc" | "desc";

function buildWhere(organizationId: string, filters: VehicleFilters): Prisma.VehicleWhereInput {
  return {
    organizationId,
    deletedAt: null,
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.status && filters.status.length > 0 ? { status: { in: filters.status } } : {}),
    ...(filters.condition ? { condition: filters.condition } : {}),
    // make/model: igualdad exacta, no `contains`. Son filtros de selección
    // (se eligen entre los valores ya cargados), y la igualdad es lo que usa
    // el índice (organization_id, make) de la Fase 1. La búsqueda tolerante
    // es `q`.
    ...(filters.make ? { make: filters.make } : {}),
    ...(filters.model ? { model: filters.model } : {}),
    ...(filters.consignmentOnly ? { origin: "CONSIGNMENT" } : {}),
    ...(filters.minPriceUsd !== undefined || filters.maxPriceUsd !== undefined
      ? {
          priceListUsd: {
            ...(filters.minPriceUsd !== undefined ? { gte: filters.minPriceUsd } : {}),
            ...(filters.maxPriceUsd !== undefined ? { lte: filters.maxPriceUsd } : {}),
          },
        }
      : {}),
    // OR al mismo nivel que los filtros específicos: "q AND filtros" sale
    // gratis, mismo criterio que `search` en contact.repository.ts.
    ...(filters.q
      ? {
          OR: [
            { internalCode: { contains: filters.q, mode: "insensitive" } },
            { licensePlate: { contains: filters.q, mode: "insensitive" } },
            { vin: { contains: filters.q, mode: "insensitive" } },
            { make: { contains: filters.q, mode: "insensitive" } },
            { model: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

function buildOrderBy(
  sortBy: VehicleSortBy,
  sortOrder: SortOrder,
): Prisma.VehicleOrderByWithRelationInput {
  switch (sortBy) {
    case "priceListUsd":
      return { priceListUsd: sortOrder };
    case "stockEnteredAt":
      return { stockEnteredAt: sortOrder };
    case "createdAt":
    default:
      return { createdAt: sortOrder };
  }
}

export function findManyVehicles(
  organizationId: string,
  filters: VehicleFilters,
  pagination: { skip: number; take: number },
  sort: { sortBy: VehicleSortBy; sortOrder: SortOrder },
  db: Db = prisma,
) {
  return db.vehicle.findMany({
    where: buildWhere(organizationId, filters),
    orderBy: buildOrderBy(sort.sortBy, sort.sortOrder),
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countVehicles(organizationId: string, filters: VehicleFilters, db: Db = prisma) {
  return db.vehicle.count({ where: buildWhere(organizationId, filters) });
}

export function findVehicleById(id: string, organizationId: string, db: Db = prisma) {
  return db.vehicle.findFirst({ where: { id, organizationId, deletedAt: null } });
}

// Los campos que escribe el service, sin organizationId/id/internalCode (los
// pone el propio service) ni los timestamps. Es el tipo generado por Prisma
// para que un campo nuevo del schema no obligue a repetir la lista acá.
export type VehicleWritableData = Omit<
  Prisma.VehicleUncheckedCreateInput,
  "id" | "organizationId" | "internalCode" | "createdAt" | "updatedAt" | "deletedAt"
>;

export type VehicleUpdateData = Omit<
  Prisma.VehicleUncheckedUpdateManyInput,
  "id" | "organizationId" | "internalCode" | "createdAt" | "updatedAt" | "deletedAt"
>;

export function createVehicle(
  data: VehicleWritableData & { organizationId: string; internalCode: string },
  db: Db = prisma,
) {
  return db.vehicle.create({ data });
}

// deletedAt: null en el WHERE, no solo en el pre-check: una unidad dada de
// baja no se edita, y la escritura en sí es la garantía (qrCode.repository).
export function updateVehicle(
  id: string,
  organizationId: string,
  data: VehicleUpdateData,
  db: Db = prisma,
) {
  return db.vehicle.updateMany({ where: { id, organizationId, deletedAt: null }, data });
}

// Soft delete: solo deletedAt. La ficha entera se conserva — tuvo cambios,
// puede tener oportunidades, y su internalCode sigue ocupado (ver el
// comentario del campo en el schema).
export function softDeleteVehicle(id: string, organizationId: string, db: Db = prisma) {
  return db.vehicle.updateMany({
    where: { id, organizationId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}

// Contador durable del código interno — réplica exacta de
// assignNextQrDisplayNumber (qrBilling.repository.ts): update con increment
// dentro de la misma transacción con lock que el INSERT, y devuelve el número
// que le toca a ESTA unidad. No es una sequence de Postgres a propósito:
// nextval() no es transaccional y quemaría un número aunque la transacción
// haga rollback, y el código de una automotora tiene que ser correlativo (ver
// el comentario de nextVehicleStockNumber en prisma/schema.prisma). Sin
// default para `db`: fuera de la transacción con lock no tiene sentido.
export async function assignNextVehicleStockNumber(
  organizationId: string,
  db: Db,
): Promise<number> {
  const updated = await db.organization.update({
    where: { id: organizationId },
    data: { nextVehicleStockNumber: { increment: 1 } },
    select: { nextVehicleStockNumber: true },
  });
  return updated.nextVehicleStockNumber - 1;
}

// Unicidad de VIN / patente dentro de la organización, entre unidades NO
// dadas de baja. No es un UNIQUE de base por decisión de la Fase 1 (una
// unidad que vuelve al stock, con soft delete de por medio): es el service el
// que decide, y esta lectura le da las filas con las que choca. Se llama
// dentro de la transacción con el lock de la organización tomado, que es lo
// que la vuelve inmune a dos escrituras concurrentes con el mismo VIN.
export function findVehicleIdentifierConflicts(
  organizationId: string,
  identifiers: { vin?: string | null; licensePlate?: string | null },
  excludeVehicleId: string | undefined,
  db: Db,
) {
  const or: Prisma.VehicleWhereInput[] = [];
  if (identifiers.vin) {
    or.push({ vin: identifiers.vin });
  }
  if (identifiers.licensePlate) {
    or.push({ licensePlate: identifiers.licensePlate });
  }
  if (or.length === 0) {
    return Promise.resolve([]);
  }
  return db.vehicle.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...(excludeVehicleId ? { id: { not: excludeVehicleId } } : {}),
      OR: or,
    },
    select: { id: true, vin: true, licensePlate: true },
  });
}

// ---------------------------------------------------------------------------
// VehicleChangeLog — append-only, una fila por campo cambiado. Lo escribe el
// service en la misma transacción que el UPDATE de la ficha: un cambio sin su
// historial, o un historial de un cambio que no se guardó, serían los dos
// errores que la transacción evita.
// ---------------------------------------------------------------------------

export interface VehicleChangeLogEntry {
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
}

export function createVehicleChangeLogs(
  data: { organizationId: string; vehicleId: string; changedById: string },
  entries: VehicleChangeLogEntry[],
  db: Db,
) {
  return db.vehicleChangeLog.createMany({
    data: entries.map((entry) => ({ ...data, ...entry })),
  });
}

// "El historial de esta unidad, más reciente primero" — la única consulta
// prevista, sobre el índice (organization_id, vehicle_id, changed_at).
// Sin filtro por deletedAt: el log es append-only y no tiene.
export function findVehicleChangeLog(
  vehicleId: string,
  organizationId: string,
  pagination: { skip: number; take: number },
  db: Db = prisma,
) {
  return db.vehicleChangeLog.findMany({
    where: { organizationId, vehicleId },
    orderBy: { changedAt: "desc" },
    skip: pagination.skip,
    take: pagination.take,
    include: { changedBy: { select: { id: true, fullName: true } } },
  });
}

export function countVehicleChangeLog(vehicleId: string, organizationId: string, db: Db = prisma) {
  return db.vehicleChangeLog.count({ where: { organizationId, vehicleId } });
}
