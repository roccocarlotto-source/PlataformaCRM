import type {
  Prisma,
  VehicleBodyType,
  VehicleCondition,
  VehicleFuelType,
  VehicleStatus,
  VehicleTransmission,
} from "@prisma/client";
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
  // Ítem 85: los agrega search_vehicles (agentTools.service.ts), el único
  // consumidor hoy. Igualdad exacta, mismo criterio que make/model.
  year?: number;
  bodyType?: VehicleBodyType;
  // Ítem 86, mismo consumidor. transmission/fuelType por igualdad (son
  // enums); exteriorColor es texto libre de la ficha, así que `contains`
  // insensible ("blanco" encuentra "Blanco perla").
  transmission?: VehicleTransmission;
  fuelType?: VehicleFuelType;
  exteriorColor?: string;
  mileageMax?: number;
  financingAvailable?: boolean;
  acceptsTradeIn?: boolean;
  // Ítem 86: texto libre SOLO sobre lo que se publica. Distinto de `q`, que es
  // la búsqueda del listado del panel y mira identificadores internos
  // (patente, VIN): desde un canal público eso permitiría averiguar si una
  // patente está en stock. Ver buildTextoPublico.
  textoPublico?: string;
  minPriceUsd?: number;
  maxPriceUsd?: number;
  consignmentOnly?: boolean;
  // Permuta (§41): "las unidades recibidas en esta venta", igualdad exacta
  // sobre el índice (organization_id, trade_in_opportunity_id).
  tradeInOpportunityId?: string;
  // §70: la bandera de publicación hacia afuera. El único consumidor hoy es la
  // sincronización de stock con la base de conocimiento, que la combina con
  // status para quedarse con lo publicable Y disponible — son dos condiciones
  // independientes (ver buscarVehiculosQueCalifican). Filtro opcional del
  // mismo tipo que branchId y status, y no una consulta suelta en el service:
  // el WHERE multi-tenant de esta entidad se arma en un solo lugar.
  publishOnWebsite?: boolean;
  // Ítem 158: solo las visibles en el listado interno (visibleInListing).
  onlyVisible?: boolean;
  // Búsqueda de texto libre contra los identificadores y el título.
  q?: string;
  // Ítem 123: desde un canal público, el rango de precio NO se le puede
  // aplicar a una unidad con `priceOnRequest`. Su precio de lista existe en la
  // fila pero el negocio decidió no publicarlo, y un filtro que lo usa se
  // convierte en un oráculo: el cliente pregunta por menos de 24.000, no
  // aparece; por menos de 26.000, aparece; ya sabe que sale 25.000. Con esta
  // bandera esas unidades entran SIEMPRE, sin mirar el rango, así que su
  // presencia no dice nada sobre su precio.
  //
  // Es opcional y apagada por defecto a propósito: en el panel, filtrar por el
  // precio real de una unidad "a consultar" es exactamente lo que el vendedor
  // necesita hacer. El que no puede es el canal público.
  precioAConsultarIgnoraElRango?: boolean;
}

export type VehicleSortBy = "createdAt" | "priceListUsd" | "priceListUsdPublico" | "stockEnteredAt";
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
    ...(filters.year !== undefined ? { year: filters.year } : {}),
    ...(filters.bodyType ? { bodyType: filters.bodyType } : {}),
    ...(filters.transmission ? { transmission: filters.transmission } : {}),
    ...(filters.fuelType ? { fuelType: filters.fuelType } : {}),
    ...(filters.exteriorColor
      ? { exteriorColor: { contains: filters.exteriorColor, mode: "insensitive" } }
      : {}),
    ...(filters.mileageMax !== undefined ? { mileage: { lte: filters.mileageMax } } : {}),
    // Booleanos explícitos contra undefined, mismo cuidado que publishOnWebsite.
    ...(filters.financingAvailable !== undefined
      ? { financingAvailable: filters.financingAvailable }
      : {}),
    ...(filters.acceptsTradeIn !== undefined ? { acceptsTradeIn: filters.acceptsTradeIn } : {}),
    ...(filters.consignmentOnly ? { origin: "CONSIGNMENT" } : {}),
    ...(filters.onlyVisible ? { visibleInListing: true } : {}),
    // Booleano explícito contra undefined: un `filters.publishOnWebsite ?` se
    // comería el filtro "las no publicadas".
    ...(filters.publishOnWebsite !== undefined
      ? { publishOnWebsite: filters.publishOnWebsite }
      : {}),
    ...(filters.tradeInOpportunityId ? { tradeInOpportunityId: filters.tradeInOpportunityId } : {}),
    // Un AND explícito y no un segundo `OR` suelto: si vinieran q y
    // textoPublico juntos, el segundo spread pisaría al primero. Por la misma
    // razón el AND se arma UNA sola vez con todo lo que va adentro: dos
    // spreads de `AND` tampoco se suman, el segundo gana.
    ...buildAnd(filters),
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

// Todo lo que necesita ir dentro de un AND, en una sola lista.
function buildAnd(filters: VehicleFilters): Prisma.VehicleWhereInput {
  const condiciones: Prisma.VehicleWhereInput[] = [];

  if (filters.minPriceUsd !== undefined || filters.maxPriceUsd !== undefined) {
    const enRango: Prisma.VehicleWhereInput = {
      priceListUsd: {
        ...(filters.minPriceUsd !== undefined ? { gte: filters.minPriceUsd } : {}),
        ...(filters.maxPriceUsd !== undefined ? { lte: filters.maxPriceUsd } : {}),
      },
    };
    // Ítem 123: con el resguardo del canal público, el rango se envuelve en un
    // OR que deja pasar entera a toda unidad "a consultar". Su presencia en
    // los resultados deja de depender del precio, que es lo que la convertía
    // en un oráculo.
    condiciones.push(
      filters.precioAConsultarIgnoraElRango ? { OR: [{ priceOnRequest: true }, enRango] } : enRango,
    );
  }

  if (filters.textoPublico) {
    condiciones.push(buildTextoPublico(filters.textoPublico));
  }

  return condiciones.length > 0 ? { AND: condiciones } : {};
}

// Texto libre sobre los campos que se publican: marca, modelo, versión, color,
// descripción pública (contains, sin mayúsculas) y equipamiento. El
// equipamiento se guarda como códigos (TECHO_SOLAR, ver equipmentSchema en
// vehicle.controller.ts), así que ahí el texto se lleva a ese formato y se
// busca el código EXACTO con `has`: "techo solar" encuentra TECHO_SOLAR,
// "techo" solo no. Prisma no tiene un contains sobre los elementos de un array.
function buildTextoPublico(texto: string): Prisma.VehicleWhereInput {
  const insensible = { contains: texto, mode: "insensitive" as const };
  const codigo = aCodigoDeEquipamiento(texto);
  return {
    OR: [
      { make: insensible },
      { model: insensible },
      { trim: insensible },
      { exteriorColor: insensible },
      { publicDescription: insensible },
      ...(codigo ? [{ equipment: { has: codigo } }] : []),
    ],
  };
}

// Misma normalización que normalizeEquipmentCode + finalizeEquipmentCode del
// frontend (features/vehicle/equipment.ts): sin acentos, mayúsculas, espacios
// y guiones a "_", nada fuera de [A-Z0-9_].
export function aCodigoDeEquipamiento(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^A-Z0-9_]/g, "")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

function buildOrderBy(
  sortBy: VehicleSortBy,
  sortOrder: SortOrder,
): Prisma.VehicleOrderByWithRelationInput | Prisma.VehicleOrderByWithRelationInput[] {
  switch (sortBy) {
    case "priceListUsd":
      return { priceListUsd: sortOrder };
    // Ítem 123: el mismo orden por precio, pero con las unidades "a consultar"
    // TODAS al final —false ordena antes que true— en vez de intercaladas por
    // un precio que no se publica. Si quedan en el medio, su posición en la
    // lista delata cuánto salen, que es el mismo oráculo que el del rango
    // (y además la descripción de search_vehicles ya promete que van al final).
    //
    // Entre ellas siguen ordenadas por su precio real: eso solo las compara
    // entre sí y no revela ningún número.
    case "priceListUsdPublico":
      return [{ priceOnRequest: "asc" }, { priceListUsd: sortOrder }];
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
