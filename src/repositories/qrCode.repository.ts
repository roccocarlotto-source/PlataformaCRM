import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// QrCode — módulo QR (docs/qr-integration.md, Fase 2).
//
// Mismas reglas que el resto de los repositorios: organizationId siempre
// obligatorio en toda lectura y escritura scoped; deletedAt: null en las
// lecturas de negocio; updateMany en vez de update para que el WHERE efectivo
// exija organizationId además de id (M4) y `count === 0` se traduzca a 404 en
// el service.
//
// Lo único que NO está scoped por organización es la lectura PÚBLICA de
// resolución (findQrCodePublicState): ahí el id del QR es la única clave, por
// construcción — un link que se abre desde afuera no pertenece a ninguna
// organización. Esa función devuelve solo lo que el endpoint público necesita
// para decidir, nunca la fila entera.
// ---------------------------------------------------------------------------

export interface QrCodeFilters {
  branchId?: string;
}

export type QrCodeSortBy = "createdAt" | "displayNumber";
export type SortOrder = "asc" | "desc";

function buildWhere(organizationId: string, filters: QrCodeFilters): Prisma.QrCodeWhereInput {
  return {
    organizationId,
    deletedAt: null,
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
  };
}

function buildOrderBy(
  sortBy: QrCodeSortBy,
  sortOrder: SortOrder,
): Prisma.QrCodeOrderByWithRelationInput {
  switch (sortBy) {
    case "displayNumber":
      return { displayNumber: sortOrder };
    case "createdAt":
    default:
      return { createdAt: sortOrder };
  }
}

export function findManyQrCodes(
  organizationId: string,
  filters: QrCodeFilters,
  pagination: { skip: number; take: number },
  sort: { sortBy: QrCodeSortBy; sortOrder: SortOrder },
  db: Db = prisma,
) {
  return db.qrCode.findMany({
    where: buildWhere(organizationId, filters),
    orderBy: buildOrderBy(sort.sortBy, sort.sortOrder),
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countQrCodes(organizationId: string, filters: QrCodeFilters, db: Db = prisma) {
  return db.qrCode.count({ where: buildWhere(organizationId, filters) });
}

export function findQrCodeById(id: string, organizationId: string, db: Db = prisma) {
  return db.qrCode.findFirst({ where: { id, organizationId, deletedAt: null } });
}

// QRs activos de una sucursal — el conteo sobre el que decide el RESTRICT de
// deleteBranch contra QRs huérfanos. Mismo criterio que
// countActiveResourcesByBranch: organizationId además de branchId porque esto
// decide si una escritura procede, así que el aislamiento va en el propio
// WHERE y no en el del caller.
export function countActiveQrCodesByBranch(
  branchId: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.qrCode.count({ where: { branchId, organizationId, deletedAt: null } });
}

// El próximo display_number libre de una sucursal (§54 de
// docs/frontend-cambios-pendientes.md): max + 1 sobre los QRs ACTIVOS de esa
// sucursal, 1 si no hay ninguno.
//
// MIRA deletedAt: null, y ahí está todo el cambio: un QR borrado libera su
// número. Antes lo repartía Organization.nextQrDisplayNumber, un contador por
// organización que solo subía —con 10 QRs creados y 9 borrados el siguiente
// nacía con el 11, no con el 2—. Ese contador ya no existe.
//
// organizationId además de branchId aunque el branchId ya determine la
// organización (la FK compuesta lo fuerza): mismo criterio que
// countActiveQrCodesByBranch — lo que decide una escritura lleva el
// aislamiento en su propio WHERE, no en el del caller.
//
// ES UNA SUGERENCIA, NO UNA RESERVA. Entre este max y el INSERT hay una
// ventana; lo que impide de verdad dos QRs activos con el mismo número en la
// misma sucursal es el índice único parcial
// qr_codes_branch_display_number_unique. En la creación esta lectura además va
// dentro de la transacción que ya tomó lockBranchForUpdate, así que dos altas
// concurrentes de la misma sucursal se serializan y ninguna de las dos llega a
// chocar con el índice.
export async function findNextDisplayNumberByBranch(
  branchId: string,
  organizationId: string,
  db: Db = prisma,
): Promise<number> {
  const resultado = await db.qrCode.aggregate({
    where: { branchId, organizationId, deletedAt: null },
    _max: { displayNumber: true },
  });
  return (resultado._max.displayNumber ?? 0) + 1;
}

export interface CreateQrCodeData {
  organizationId: string;
  branchId: string;
  displayNumber: number;
  name: string;
  destinationUrl: string;
  message: string | null;
}

export function createQrCode(data: CreateQrCodeData, db: Db = prisma) {
  return db.qrCode.create({ data });
}

// displayNumber es editable desde §54: el N° se puede corregir a mano también
// después de crear el QR. branchId sigue sin estar (mover un QR de sucursal no
// es una operación del contrato), y eso es lo que hace que la unicidad del
// PATCH se evalúe contra la MISMA sucursal que la del alta, sin que el service
// tenga que averiguar cuál es.
export interface UpdateQrCodeData {
  name?: string;
  destinationUrl?: string;
  message?: string | null;
  displayNumber?: number;
}

// deletedAt: null en el WHERE, no solo en el pre-check: un QR borrado no se
// edita, y la escritura en sí es la garantía (equivalente al
// `and deleted_at is null` de update_qr_code en 0008 del original).
export function updateQrCode(
  id: string,
  organizationId: string,
  data: UpdateQrCodeData,
  db: Db = prisma,
) {
  return db.qrCode.updateMany({ where: { id, organizationId, deletedAt: null }, data });
}

// Soft delete: solo deletedAt. name/destinationUrl/message/displayNumber se
// conservan — nunca se limpian (0008 original, delete_qr_code). Desde §54 la
// fila conserva su displayNumber pero deja de OCUPARLO: el índice único es
// parcial (WHERE deleted_at IS NULL) y findNextDisplayNumberByBranch ignora
// los borrados, así que ese número vuelve a estar disponible para la sucursal.
export function softDeleteQrCode(id: string, organizationId: string, db: Db = prisma) {
  return db.qrCode.updateMany({
    where: { id, organizationId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Lectura pública — equivalente a get_qr_public_state (0015 original).
//
// Devuelve null para "no existe" / "borrado", indistinguibles entre sí
// (DEC-007). Todo QR encontrado redirige: desde
// 20260904120000_remove_qr_claim_and_single_use ya no hay single-use ni
// "Stock", y desde el ítem 135 tampoco hay suscripción que chequear — el módulo
// QR viene incluido con la cuenta (docs/qr-integration.md, "Changelog"). Hasta
// ese ítem este estado llevaba un `canRedirect` que dependía de
// qrSubscriptionStatus/qrBillingExempt de la organización.
// ---------------------------------------------------------------------------

export interface QrPublicState {
  destinationUrl: string;
}

export async function findQrCodePublicState(
  id: string,
  db: Db = prisma,
): Promise<QrPublicState | null> {
  const row = await db.qrCode.findUnique({
    where: { id },
    select: { deletedAt: true, destinationUrl: true },
  });

  if (!row || row.deletedAt !== null) {
    return null;
  }

  return { destinationUrl: row.destinationUrl };
}
