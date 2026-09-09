import { prisma } from "../lib/prisma";
import {
  countBranches,
  createBranch as createBranchRepo,
  findBranchById,
  findManyBranches,
  lockBranchForUpdate,
  softDeleteBranch,
  updateBranch as updateBranchRepo,
  type BranchSortBy,
  type SortOrder,
} from "../repositories/branch.repository";
import { countConnectionsWithSecretByBranch } from "../repositories/googleCalendarConnection.repository";
import { countActiveQrCodesByBranch } from "../repositories/qrCode.repository";
import { countActiveResourcesByBranch } from "../repositories/resource.repository";
import { countActiveServiceTypesByBranch } from "../repositories/serviceType.repository";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Branch (sucursal) — P2.1.
//
// SIN INVARIANTE DE "AL MENOS UNA SUCURSAL ACTIVA", a diferencia de Pipeline.
// Una organización que no usa Booking tiene cero Branch y ese es un estado
// válido: nada del CRM depende de que exista una. Por eso deleteBranch no
// necesita el lock de organización que H-1 le impuso a deletePipeline — el
// único invariante acá es sobre los hijos de ESTA sucursal, y se protege con el
// lock de su propia fila.
// ---------------------------------------------------------------------------

export interface ListBranchesParams {
  page: number;
  pageSize: number;
  search?: string;
  sortBy: BranchSortBy;
  sortOrder: SortOrder;
}

export async function listBranches(organizationId: string, params: ListBranchesParams) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyBranches(organizationId, filters, { skip, take: pageSize }, { sortBy, sortOrder }),
    countBranches(organizationId, filters),
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

export async function getBranchById(organizationId: string, id: string) {
  const branch = await findBranchById(id, organizationId);
  if (!branch) {
    throw new AppError("Sucursal no encontrada", 404);
  }
  return branch;
}

export interface CreateBranchInput {
  name: string;
  timezone: string;
}

export function createBranch(organizationId: string, input: CreateBranchInput) {
  // Sin unicidad de nombre: dos sucursales pueden llamarse igual ("Centro" en
  // dos ciudades). No hay ninguna constraint que traducir a 409, así que no hay
  // rethrowAsConflict que escribir — a diferencia de Pipeline, que sí tiene un
  // único (organizationId, name).
  return createBranchRepo({ organizationId, name: input.name, timezone: input.timezone });
}

export interface UpdateBranchInput {
  name?: string;
  timezone?: string;
}

export async function updateBranch(organizationId: string, id: string, input: UpdateBranchInput) {
  await getBranchById(organizationId, id);

  const result = await updateBranchRepo(id, organizationId, input);
  if (result.count === 0) {
    throw new AppError("Sucursal no encontrada", 404);
  }

  return getBranchById(organizationId, id);
}

// RESTRICT lógico, el criterio ya establecido en ALTO-8: no se borra una
// sucursal que tiene recursos, servicios o QRs activos colgando, ni Google
// Calendar todavía conectado. Mismo formato de error que "el último pipeline"
// y que los dos RESTRICT de ALTO-8: AppError con 400.
//
// Y CON EL LOCK, que es la mitad que el chequeo solo no cubre. Un RESTRICT es
// una decisión sobre un conteo: sin serializar contra createResource /
// createServiceType, esos conteos se quedan viejos entre que se leen y que se
// escribe, y el bloqueo sería evitable con solo llegar primero. Es la misma
// clase de bug que H-1.
export async function deleteBranch(organizationId: string, id: string) {
  // 404 rápido, sin abrir transacción — mismo criterio que deletePipeline. No
  // es la defensa: se revalida adentro, con el lock sostenido.
  await getBranchById(organizationId, id);

  await prisma.$transaction(async (tx) => {
    await lockBranchForUpdate(id, organizationId, tx);

    const branch = await findBranchById(id, organizationId, tx);
    if (!branch) {
      throw new AppError("Sucursal no encontrada", 404);
    }

    // Los recursos primero: un ServiceType siempre cuelga de un Resource de la
    // misma sucursal, así que una sucursal con servicios activos tiene también
    // recursos activos. Preguntar por los recursos primero da el mensaje más
    // accionable — es el nivel por el que hay que empezar a limpiar.
    const recursosActivos = await countActiveResourcesByBranch(id, organizationId, tx);
    if (recursosActivos > 0) {
      throw new AppError(
        "No se puede eliminar una sucursal que tiene recursos activos. Eliminá primero sus recursos.",
        400,
      );
    }

    // Redundante mientras el invariante de arriba se sostenga —sin recursos no
    // puede haber servicios— y está igual: es la clase de redundancia que
    // sobrevive a que alguien afloje la relación entre ServiceType y Resource.
    const serviciosActivos = await countActiveServiceTypesByBranch(id, organizationId, tx);
    if (serviciosActivos > 0) {
      throw new AppError(
        "No se puede eliminar una sucursal que tiene servicios activos. Eliminá primero sus servicios.",
        400,
      );
    }

    // TERCER RESTRICT: no se borra una sucursal que todavía tiene QRs activos
    // colgando. Un QrCode NO cambia de sucursal — UpdateQrCodeInput
    // (qr.service.ts) no acepta branchId, es inmutable como Resource— así que
    // sin este chequeo el soft delete de la sucursal deja el QR apuntando a un
    // branchId que ya no resuelve para el resto de la API (findBranchById
    // filtra deletedAt: null): un QR "huérfano", listado y editable, pero cuya
    // sucursal ya no existe desde ningún otro endpoint. El link público en sí
    // seguiría redirigiendo igual —findQrCodePublicState no depende de la
    // sucursal, solo del propio QR y de la organización— así que esto no es un
    // 404 en producción; es el mismo tipo de inconsistencia de datos que
    // recursos/servicios huérfanos, y se cierra con el mismo criterio.
    //
    // Para destrabar, el ADMIN tiene que borrar cada QR de la sucursal (DELETE
    // /api/qr/:id) — no hay forma de reasignarlo a otra sucursal. Por eso va
    // junto a recursos y servicios (datos que hay que limpiar a mano) y antes
    // de Google Calendar, que se destraba con un solo click.
    const qrsActivos = await countActiveQrCodesByBranch(id, organizationId, tx);
    if (qrsActivos > 0) {
      throw new AppError(
        "No se puede eliminar una sucursal que tiene QRs activos. Eliminá primero sus QRs.",
        400,
      );
    }

    // CUARTO RESTRICT (P2.1, paso 2): no se borra una sucursal que todavía tiene
    // Google Calendar conectado. La conexión guarda una credencial viva sobre la
    // cuenta de Google del negocio, y borrar la sucursal la dejaría huérfana:
    // sin fila que consultar, nadie podría revocarla nunca más desde el CRM.
    //
    // LO QUE BLOQUEA ES EL SECRETO, NO EL STATUS — B-9 de
    // docs/auditoria-2026-08-29.md. Una conexión REVOKED ya no tiene token (se
    // pone en NULL al desconectar) y no bloquea: no hay nada que se pueda
    // perder. Una en ERROR es un grant que Google rechazó, pero
    // markConnectionError CONSERVA el refresh token a propósito —puede ser algo
    // que se resuelva del lado de Google—, así que sigue habiendo un secreto
    // cifrado en la fila y SÍ bloquea. Antes se contaba por status = ACTIVE y
    // una sucursal en ERROR se podía borrar con su credencial adentro, sin
    // ninguna fila desde la que revocarla. El camino para el ADMIN ya existe:
    // desconectar() acepta una conexión en ERROR (solo rechaza REVOKED) y pone
    // el token en NULL; después de eso, el borrado procede.
    //
    // VA ÚLTIMO, después de recursos, servicios y QRs, y no es indiferente: los
    // cuatro mensajes son excluyentes —se devuelve el primero que dispara— así
    // que el orden decide cuál ve el ADMIN. Recursos, servicios y QRs son datos
    // que hay que migrar o borrar a mano; desconectar Google es un click.
    // Empezar por lo caro deja el trámite corto para el final, en vez de
    // hacerle desconectar Google para descubrir recién ahí que igual no puede
    // borrar la sucursal.
    const conexionesConSecreto = await countConnectionsWithSecretByBranch(id, organizationId, tx);
    if (conexionesConSecreto > 0) {
      throw new AppError(
        "No se puede eliminar una sucursal que todavía tiene Google Calendar conectado, aunque la conexión esté en error. Desconectalo primero.",
        400,
      );
    }

    const result = await softDeleteBranch(id, organizationId, tx);
    if (result.count === 0) {
      throw new AppError("Sucursal no encontrada", 404);
    }
  });
}
