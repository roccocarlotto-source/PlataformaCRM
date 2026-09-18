import { Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { findBranchById, lockBranchForUpdate } from "../repositories/branch.repository";
import {
  countQrCodes,
  createQrCode,
  findManyQrCodes,
  findNextDisplayNumberByBranch,
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
// EL N° (displayNumber) ES UNA SERIE POR SUCURSAL QUE REUSA LOS NÚMEROS
// LIBERADOS, desde 20260921120000_qr_display_number_por_sucursal
// (docs/frontend-cambios-pendientes.md §54). Hasta esa migración lo repartía
// Organization.nextQrDisplayNumber, un contador durable por organización que
// solo subía: con 10 QRs creados y 9 borrados, el siguiente nacía con el 11
// aunque el único vivo fuera el 1. Hoy sale de max + 1 sobre los QRs ACTIVOS
// de la sucursal (findNextDisplayNumberByBranch), y quien crea o edita puede
// escribirlo a mano.
//
// EL LOCK PASÓ DE ORGANIZACIÓN A SUCURSAL, y es exactamente el mismo
// razonamiento con el ALCANCE corregido. El número se lee-decide-usa dentro de
// la transacción; sin serializar, dos altas concurrentes leerían el mismo max
// y se repartirían el mismo número. Lo que cambió es QUIÉN compite con quién:
// la serie ya no es del tenant sino de la sucursal, así que un lock de
// organización serializaría de más — dos altas en sucursales distintas no
// pueden chocar entre sí y no tienen por qué esperarse. lockBranchForUpdate es
// el mismo `select ... for update` de una fila, ya usado por el RESTRICT de
// deleteBranch (y ya probado en lockForUpdate.integration-test.ts).
//
// Y EL LOCK NO ES LA GARANTÍA, es la que evita chocar contra ella: la
// unicidad real la sostiene el índice único parcial
// qr_codes_branch_display_number_unique, que también cubre el número escrito a
// mano —donde no hay nada que serializar, porque lo eligió una persona— y la
// ventana del GET de sugerencia, que es de solo lectura y no reserva nada.
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
// se confirma la existencia de una sucursal ajena. `db` explícito porque en el
// alta se revalida DENTRO de la transacción, con el lock de la sucursal
// sostenido.
//
// SIGUE HACIENDO FALTA aunque lockBranchForUpdate también mire organizationId,
// por dos razones: el lock lanza un Error crudo (500) y no este 400 de
// anti-enumeración, y su WHERE no filtra deletedAt — una sucursal borrada se
// puede bloquear igual. Es findBranchById, no el lock, lo que decide si la
// sucursal es usable.
async function validateBranchId(organizationId: string, branchId: string, db: Db) {
  const branch = await findBranchById(branchId, organizationId, db);
  if (!branch) {
    throw new AppError("La sucursal indicada no existe o no pertenece a tu organización", 400);
  }
  return branch;
}

// ---------------------------------------------------------------------------
// N° del QR (§54)
// ---------------------------------------------------------------------------

const NUMERO_YA_USADO = "Ya existe un QR activo con ese número en esta sucursal";

// Traduce la violación de qr_codes_branch_display_number_unique al 409 legible
// en vez de dejar subir el P2002 crudo como 500 (P2002 se traduce por
// servicio, ver utils/prismaErrors.ts). 409 y no 400: es el mismo tipo de
// respuesta que ya dan todas las demás colisiones de unicidad del proyecto
// —contacto con ese email, pipeline con ese nombre, invitación pendiente— y
// significa lo mismo, "el request está bien formado pero choca con el estado
// actual".
//
// DEPENDE DEL NOMBRE DEL ÍNDICE, igual que rethrowAsConflict en
// contact.service.ts y por el mismo motivo: el índice es parcial, una forma
// que el DSL de Prisma no expresa, así que Prisma no puede mapearlo a nombres
// de campo y reporta el nombre crudo en err.meta.target. Mientras contenga
// "display_number" la traducción funciona con cualquiera de las dos formas que
// Prisma pueda devolver (array de columnas o nombre del índice). Cualquier
// otro P2002 de esta tabla —hoy solo podría ser la PK, o sea una colisión de
// gen_random_uuid()— se relanza sin tocar: no es este error y no merece este
// mensaje. Hay un test de integración que captura la violación real de
// Postgres y la pasa por acá, porque los unitarios le pasan el target a mano y
// no verían un renombre del índice.
//
// Exportada para poder testear la traducción sin base (qr.service.test.ts).
export function rethrowNumeroRepetido(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = Array.isArray(err.meta?.target)
      ? err.meta.target.join(",")
      : String(err.meta?.target ?? "");

    if (target.includes("display_number")) {
      throw new AppError(NUMERO_YA_USADO, 409);
    }
  }

  throw err;
}

// GET /api/qr/next-display-number — lo que el formulario de alta usa para
// PRELLENAR el campo "N°" antes de crear nada.
//
// ES UNA SUGERENCIA, NO UNA RESERVA, y por eso no toma el lock de sucursal:
// bloquear una fila para contestar una lectura dejaría el lock tomado sin
// ninguna escritura que lo justifique, y aun así dos formularios abiertos a la
// vez verían el mismo número (el lock se libera al contestar). Quién se queda
// con el número se decide recién al crear, donde el lock sí corre y donde el
// índice único puede rechazar al segundo con NUMERO_YA_USADO.
export async function getNextQrDisplayNumber(organizationId: string, branchId: string) {
  await validateBranchId(organizationId, branchId, prisma);
  const suggestedDisplayNumber = await findNextDisplayNumberByBranch(branchId, organizationId);
  return { branchId, suggestedDisplayNumber };
}

export interface CreateDigitalQrCodeInput {
  branchId: string;
  name: string;
  destinationUrl: string;
  message: string | null;
  // Ausente = el sugerido por la sucursal. Presente = lo escribió una persona
  // y se usa tal cual (el índice único decide si se puede).
  displayNumber?: number;
}

async function crearConDisplayNumber(organizationId: string, data: CreateDigitalQrCodeInput) {
  // 400 rápido, sin abrir transacción — mismo criterio que deleteBranch en
  // branch.service.ts. NO es la defensa: se revalida adentro, con el lock
  // sostenido.
  //
  // Y ADEMÁS ES LO QUE PROTEGE EL 400 ANTI-ENUMERACIÓN. lockBranchForUpdate,
  // ante una sucursal ajena o inexistente, lanza un Error CRUDO —500, y con el
  // branchId y el organizationId en el mensaje—, no este 400. Si el lock fuera
  // lo primero, una sucursal de otra organización dejaría de ser
  // indistinguible de una inexistente. Con el pre-check adelante ese camino no
  // se alcanza: una Branch nunca se borra físicamente (soft delete), así que
  // entre este chequeo y el lock la fila no puede desaparecer.
  await validateBranchId(organizationId, data.branchId, prisma);

  try {
    return await prisma.$transaction(async (tx) => {
      await lockBranchForUpdate(data.branchId, organizationId, tx);
      await validateBranchId(organizationId, data.branchId, tx);
      const displayNumber =
        data.displayNumber ??
        (await findNextDisplayNumberByBranch(data.branchId, organizationId, tx));

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
  } catch (err) {
    rethrowNumeroRepetido(err);
  }
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
  displayNumber?: number;
}

// Nunca confía en un organizationId del body — no lo pide.
//
// SIN LOCK Y SIN SUGERENCIA, a diferencia del alta: acá el número siempre lo
// escribió una persona (no hay nada que calcular, así que no hay lectura que
// serializar) y la sucursal no cambia (updateQrCode no acepta branchId), así
// que la unicidad se evalúa contra la misma sucursal de siempre. El índice
// único parcial es toda la defensa que hace falta.
async function aplicarPatch(organizationId: string, id: string, input: UpdateQrCodeInput) {
  try {
    return await updateQrCodeRepo(id, organizationId, input);
  } catch (err) {
    rethrowNumeroRepetido(err);
  }
}

export async function updateQrCode(organizationId: string, id: string, input: UpdateQrCodeInput) {
  const result = await aplicarPatch(organizationId, id, input);
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
