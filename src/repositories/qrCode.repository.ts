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

export interface UpdateQrCodeData {
  name?: string;
  destinationUrl?: string;
  message?: string | null;
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
// conservan — nunca se limpian (0008 original, delete_qr_code).
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
// (DEC-007). Desde 20260904120000_remove_qr_claim_and_single_use ya no hay
// single-use ni "Stock" (branchId es NOT NULL): todo QR encontrado es
// reusable, así que el único estado que queda es "puede redirigir" o no.
// ---------------------------------------------------------------------------

export interface QrPublicState {
  canRedirect: boolean;
  destinationUrl: string;
}

export async function findQrCodePublicState(
  id: string,
  db: Db = prisma,
): Promise<QrPublicState | null> {
  const row = await db.qrCode.findUnique({
    where: { id },
    select: {
      deletedAt: true,
      destinationUrl: true,
      organization: { select: { qrSubscriptionStatus: true, qrBillingExempt: true } },
    },
  });

  if (!row || row.deletedAt !== null) {
    return null;
  }

  return {
    canRedirect:
      row.organization.qrSubscriptionStatus === "ACTIVE" || row.organization.qrBillingExempt,
    destinationUrl: row.destinationUrl,
  };
}
