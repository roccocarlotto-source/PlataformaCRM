import { prisma, type Db } from "../lib/prisma";
import { findBranchById } from "../repositories/branch.repository";
import { lockOrganizationForUpdate } from "../repositories/organization.repository";
import { assignNextQrDisplayNumber } from "../repositories/qrBilling.repository";
import {
  countQrCodes,
  createQrCode,
  findManyQrCodes,
  findQrCodeById,
  softDeleteQrCode,
  updateQrCode as updateQrCodeRepo,
  type QrCodeSortBy,
  type SortOrder,
} from "../repositories/qrCode.repository";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// QrCode — digital / listar / editar / borrar (docs/qr-integration.md,
// Fase 2). Puerto de create_digital_qr_code, update_qr_code y delete_qr_code
// (0008/0015 del original). Un QR cuelga de una Branch de la Organization del
// caller, elegida explícitamente (decisión 1).
//
// HASTA 20260904120000_remove_qr_claim_and_single_use este archivo también
// tenía claimQrCode (el claim de un QR físico, INSERT con el id impreso en el
// sticker) y el parámetro qrType de createDigitalQrCode (SINGLE_USE). Los dos
// se eliminaron junto con las columnas del modelo — ver
// docs/qr-integration.md, sección "Qué se desvió", para el porqué. Todo QR
// nace hoy digital, con id generado y siempre reusable.
//
// EL LOCK DE ORGANIZACIÓN ES LA MITAD QUE EL INSERT SOLO NO CUBRE: el contador
// nextQrDisplayNumber se lee-incrementa-usa dentro de la transacción, y sin
// serializar dos creaciones concurrentes del mismo tenant podrían repartir el
// mismo número (el schema de Fase 1 no tiene el UNIQUE
// (organization_id, display_number) del original — ver "Desvíos" en la guía).
// Es el mismo `select ... for update` sobre la fila del business que el
// original hacía en 0006. Y una transacción que falla (sucursal ajena)
// revierte el incremento: un número nunca se quema sin usarse.
// ---------------------------------------------------------------------------

export interface ListQrCodesParams {
  page: number;
  pageSize: number;
  branchId?: string;
  sortBy: QrCodeSortBy;
  sortOrder: SortOrder;
}

export async function listQrCodes(organizationId: string, params: ListQrCodesParams) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyQrCodes(organizationId, filters, { skip, take: pageSize }, { sortBy, sortOrder }),
    countQrCodes(organizationId, filters),
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

// "No existe" / "no es tuyo" / "está borrado" -> el mismo 404 genérico
// (anti-enumeración, igual que el `qr not found` único de update_qr_code /
// delete_qr_code en el original).
const QR_NO_ENCONTRADO = "QR no encontrado";

export async function getQrCodeById(organizationId: string, id: string) {
  const qrCode = await findQrCodeById(id, organizationId);
  if (!qrCode) {
    throw new AppError(QR_NO_ENCONTRADO, 404);
  }
  return qrCode;
}

// Mismo mensaje y mismo 400 que validateBranchId en resource.service.ts: nunca
// se confirma la existencia de una sucursal ajena. `db` explícito porque se
// revalida DENTRO de la transacción, con el lock de la organización sostenido.
async function validateBranchId(organizationId: string, branchId: string, db: Db) {
  const branch = await findBranchById(branchId, organizationId, db);
  if (!branch) {
    throw new AppError("La sucursal indicada no existe o no pertenece a tu organización", 400);
  }
  return branch;
}

export interface CreateDigitalQrCodeInput {
  branchId: string;
  name: string;
  destinationUrl: string;
  message: string | null;
}

async function crearConDisplayNumber(organizationId: string, data: CreateDigitalQrCodeInput) {
  return prisma.$transaction(async (tx) => {
    await lockOrganizationForUpdate(organizationId, tx);
    await validateBranchId(organizationId, data.branchId, tx);
    const displayNumber = await assignNextQrDisplayNumber(organizationId, tx);

    return createQrCode(
      {
        organizationId,
        branchId: data.branchId,
        displayNumber,
        name: data.name,
        destinationUrl: data.destinationUrl,
        message: data.message,
      },
      tx,
    );
  });
}

// QR digital: id generado (gen_random_uuid() del default de Prisma), siempre
// reusable.
export function createDigitalQrCode(organizationId: string, input: CreateDigitalQrCodeInput) {
  return crearConDisplayNumber(organizationId, input);
}

export interface UpdateQrCodeInput {
  name?: string;
  destinationUrl?: string;
  message?: string | null;
}

// Nunca confía en un organizationId del body — no lo pide.
export async function updateQrCode(organizationId: string, id: string, input: UpdateQrCodeInput) {
  const result = await updateQrCodeRepo(id, organizationId, input);
  if (result.count === 0) {
    throw new AppError(QR_NO_ENCONTRADO, 404);
  }
  return getQrCodeById(organizationId, id);
}

export async function deleteQrCode(organizationId: string, id: string) {
  const result = await softDeleteQrCode(id, organizationId);
  if (result.count === 0) {
    throw new AppError(QR_NO_ENCONTRADO, 404);
  }
}
