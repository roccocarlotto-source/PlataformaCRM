import type { Prisma, QrType } from "@prisma/client";
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
// construcción — un teléfono que escanea el sticker no pertenece a ninguna
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
  // Solo para el claim de un QR físico: es el id que ya está impreso en el
  // sticker (decisión 4 de docs/qr-integration.md). Un QR digital no lo pasa y
  // toma el gen_random_uuid() del default.
  id?: string;
  organizationId: string;
  branchId: string;
  displayNumber: number;
  name: string;
  destinationUrl: string;
  message: string | null;
  qrType: QrType;
}

export function createQrCode(data: CreateQrCodeData, db: Db = prisma) {
  return db.qrCode.create({ data: { ...data, claimedAt: new Date() } });
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
// Devuelve null para "no existe" / "sin branch" / "borrado", indistinguibles
// entre sí (DEC-007). destinationUrl se devuelve solo para un REUSABLE: el GET
// público no tiene ningún motivo legítimo para tener ese valor antes del
// consentimiento de un single-use, así que esta función no lo entrega aunque
// el controller tuviera un bug en su branching (defensa en profundidad).
// ---------------------------------------------------------------------------

export interface QrPublicState {
  qrType: QrType;
  isUsed: boolean;
  canRedirect: boolean;
  destinationUrl: string | null;
}

export async function findQrCodePublicState(
  id: string,
  db: Db = prisma,
): Promise<QrPublicState | null> {
  const row = await db.qrCode.findUnique({
    where: { id },
    select: {
      branchId: true,
      deletedAt: true,
      qrType: true,
      usedAt: true,
      destinationUrl: true,
      organization: { select: { qrSubscriptionStatus: true, qrBillingExempt: true } },
    },
  });

  if (!row || row.branchId === null || row.deletedAt !== null) {
    return null;
  }

  return {
    qrType: row.qrType,
    isUsed: row.usedAt !== null,
    canRedirect:
      row.organization.qrSubscriptionStatus === "ACTIVE" || row.organization.qrBillingExempt,
    destinationUrl: row.qrType === "REUSABLE" ? row.destinationUrl : null,
  };
}

// ---------------------------------------------------------------------------
// Consumo atómico de un single-use — equivalente a consume_single_use_qr
// (0015 original). UN solo UPDATE, sin ventana SELECT-then-UPDATE: el chequeo
// de suscripción vive en el mismo WHERE que el de usedAt, así que "inactiva" y
// "ya usado" se resuelven en la misma operación atómica — un intento con la
// organización inactiva NO consume el QR (0 filas, igual que ya usado; el
// llamador no puede distinguir cuál falló desde acá, a propósito: relee el
// estado real con findQrCodePublicState).
//
// Dos POST concurrentes al mismo id: el row lock del UPDATE los serializa — el
// segundo, cuando puede seguir, reevalúa `used_at IS NULL` contra el resultado
// ya commiteado del primero y no matchea ninguna fila.
//
// Los literales del enum ('SINGLE_USE', 'ACTIVE') se castean solos al tipo de
// la columna — mismo criterio que los CHECK de 20260903120000.
// ---------------------------------------------------------------------------
export async function consumeSingleUseQrCode(id: string, db: Db = prisma): Promise<string | null> {
  const filas = await db.$queryRaw<{ destination_url: string | null }[]>`
    UPDATE qr_codes qc
    SET used_at = now()
    FROM organizations o
    WHERE qc.id = ${id}::uuid
      AND o.id = qc.organization_id
      AND qc.branch_id IS NOT NULL
      AND qc.qr_type = 'SINGLE_USE'
      AND qc.deleted_at IS NULL
      AND qc.used_at IS NULL
      AND (o.qr_subscription_status = 'ACTIVE' OR o.qr_billing_exempt)
    RETURNING qc.destination_url
  `;
  return filas.length > 0 ? filas[0].destination_url : null;
}
