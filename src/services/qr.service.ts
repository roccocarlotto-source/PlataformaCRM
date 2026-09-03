import { Prisma, type QrType } from "@prisma/client";
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
// QrCode — claim / digital / listar / editar / borrar (docs/qr-integration.md,
// Fase 2). Puerto de claim_qr_code, create_digital_qr_code, update_qr_code y
// delete_qr_code (0006/0008/0015 del original), con dos cambios de modelo
// decididos en la guía:
//
//   1. Un QR cuelga de una Branch de la Organization del caller, elegida
//      explícitamente (decisión 1), y `claim` pide name/destinationUrl igual
//      que `digital` (decisión 2) — no hay un default "Reseñas Google" copiado
//      desde ningún lado.
//   2. NO HAY STOCK PRE-INSERTADO (decisión 4). QrCode.organizationId es NOT
//      NULL, así que no existe la fila "sin dueño" que el original
//      pre-cargaba a mano antes de imprimir. El claim de un QR físico es un
//      INSERT con el id que ya viene impreso en el sticker: la fila nace en el
//      claim, ya con organizationId/branchId. Un id que ya tiene fila está
//      reclamado -> 409, mismo mensaje genérico que el original.
//
// EL LOCK DE ORGANIZACIÓN ES LA MITAD QUE EL INSERT SOLO NO CUBRE: el contador
// nextQrDisplayNumber se lee-incrementa-usa dentro de la transacción, y sin
// serializar dos claims concurrentes del mismo tenant podrían repartir el
// mismo número (el schema de Fase 1 no tiene el UNIQUE
// (organization_id, display_number) del original — ver "Desvíos" en la guía).
// Es el mismo `select ... for update` sobre la fila del business que el
// original hacía en 0006. Y una transacción que falla (id ya reclamado,
// sucursal ajena) revierte el incremento: un número nunca se quema sin usarse.
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

interface CreateQrCodeCommon {
  branchId: string;
  name: string;
  destinationUrl: string;
  message: string | null;
}

export interface ClaimQrCodeInput extends CreateQrCodeCommon {
  qrId: string;
}

export interface CreateDigitalQrCodeInput extends CreateQrCodeCommon {
  qrType: QrType;
}

// Mismo mensaje genérico que el 409 del original ("QR already claimed or does
// not exist"): no se distingue "ya reclamado" de "no es un id válido de stock"
// — aunque con el modelo de INSERT esa segunda categoría ya no existe.
const QR_YA_RECLAMADO = "QR ya reclamado o no existe";

async function crearConDisplayNumber(
  organizationId: string,
  data: CreateQrCodeCommon & { id?: string; qrType: QrType },
) {
  return prisma.$transaction(async (tx) => {
    await lockOrganizationForUpdate(organizationId, tx);
    await validateBranchId(organizationId, data.branchId, tx);
    const displayNumber = await assignNextQrDisplayNumber(organizationId, tx);

    return createQrCode(
      {
        id: data.id,
        organizationId,
        branchId: data.branchId,
        displayNumber,
        name: data.name,
        destinationUrl: data.destinationUrl,
        message: data.message,
        qrType: data.qrType,
      },
      tx,
    );
  });
}

// Claim de un QR físico. El id viene del sticker; el tipo es siempre REUSABLE
// por construcción, igual que en el original (0015: "every physical QR stays
// at the column default for its entire life") — el single-use físico sigue
// fuera de alcance, pendiente de su propia decisión.
export async function claimQrCode(organizationId: string, input: ClaimQrCodeInput) {
  try {
    return await crearConDisplayNumber(organizationId, {
      id: input.qrId,
      branchId: input.branchId,
      name: input.name,
      destinationUrl: input.destinationUrl,
      message: input.message,
      qrType: "REUSABLE",
    });
  } catch (err) {
    // El único UNIQUE que puede violar este INSERT es la primary key
    // (qr_codes_pkey): el id ya tiene fila, o sea ya está reclamado — por esta
    // organización o por otra, y no se dice cuál. La transacción entera ya se
    // revirtió, incluido el incremento del contador.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError(QR_YA_RECLAMADO, 409);
    }
    throw err;
  }
}

// QR digital: nace ya reclamado, con id generado (gen_random_uuid() del
// default de Prisma). Puede ser SINGLE_USE — es el único camino que lo permite
// (create_digital_qr_code con p_qr_type, 0015 original).
export function createDigitalQrCode(organizationId: string, input: CreateDigitalQrCodeInput) {
  return crearConDisplayNumber(organizationId, {
    branchId: input.branchId,
    name: input.name,
    destinationUrl: input.destinationUrl,
    message: input.message,
    qrType: input.qrType,
  });
}

export interface UpdateQrCodeInput {
  name?: string;
  destinationUrl?: string;
  message?: string | null;
}

// Nunca confía en un organizationId del body — no lo pide. qrType NO está en
// el input: es inmutable por construcción, igual que en el original (ningún
// camino de escritura lo incluye en un UPDATE).
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
