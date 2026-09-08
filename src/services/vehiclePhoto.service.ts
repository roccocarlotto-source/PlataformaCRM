import { randomUUID } from "node:crypto";
import type { VehiclePhoto } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import {
  createSignedReadUrls,
  ensureBucket,
  removeObject,
  uploadObject,
  type BucketSpec,
} from "../lib/supabaseStorage";
import { logger } from "../lib/logger";
import { lockOrganizationForUpdate } from "../repositories/organization.repository";
import {
  clearCover,
  createPhoto,
  deletePhoto as deletePhotoRepo,
  findPhotoById,
  findPhotosByVehicle,
  updatePhoto,
} from "../repositories/vehiclePhoto.repository";
import { AppError } from "../utils/AppError";
import {
  VEHICLE_PHOTO_MAX_BYTES,
  VEHICLE_PHOTO_MIME_TYPES,
  type DetectedImage,
} from "../utils/vehiclePhoto";
import { assertCompleteForPublish, getVehicleById } from "./vehicle.service";

// ---------------------------------------------------------------------------
// VehiclePhoto — la galería de una unidad y su respaldo en Supabase Storage
// (Fase 2b). Las reglas de negocio de la galería viven acá y son puras
// (exportadas, probadas sin base):
//
//   - La primera foto de una unidad es la portada aunque no se pida.
//   - A lo sumo una portada: marcar una desmarca la anterior en la misma
//     transacción, ANTES, porque el índice único parcial de la Fase 1 no
//     admite dos en true ni por un instante.
//   - Una unidad con fotos nunca queda sin portada: si se borra la portada,
//     la de posición más baja pasa a serlo.
//   - Reordenar reemplaza el orden entero (criterio WorkingHours), no hay
//     PATCH de position por foto.
//   - Una unidad publicada no puede quedarse sin fotos (la regla "al menos una
//     foto para publicar" de vehicle.service, mirada desde el borrado).
//
// STORAGE Y BASE NO SON UNA TRANSACCIÓN, y el orden de las dos escrituras
// elige qué inconsistencia es la tolerable:
//   - Subir: primero el objeto, después la fila. Si la fila falla se intenta
//     borrar el objeto; si eso también falla queda un objeto huérfano.
//   - Borrar: primero el objeto, después la fila. Si el objeto no se pudo
//     borrar no se toca la fila; si la fila falla después, huérfano otra vez.
// Un objeto huérfano en Storage es espacio que nadie referencia. Una fila que
// apunta a un objeto que no existe es una foto rota en la ficha. Siempre se
// prefiere el primero.
//
// TODA ESCRITURA EN LA BASE VA EN TRANSACCIÓN CON lockOrganizationForUpdate,
// como en vehicle.service: la decisión "¿ya hay portada?" se toma sobre una
// lectura, y dos subidas concurrentes de la primera foto pasarían las dos su
// chequeo sin serializar. La subida a Storage queda FUERA del lock: es una
// llamada de red que no tiene por qué frenar al resto de la organización.
// ---------------------------------------------------------------------------

// Constante en código y no variable de entorno: el nombre del bucket no varía
// por ambiente. Cada proyecto de Supabase (local de CI, el del .env,
// producción) tiene el suyo con este mismo nombre, creado por ensureBucket la
// primera vez que se usa.
export const VEHICLE_PHOTO_BUCKET: BucketSpec = {
  name: "vehicle-photos",
  fileSizeLimit: VEHICLE_PHOTO_MAX_BYTES,
  allowedMimeTypes: [...VEHICLE_PHOTO_MIME_TYPES],
};

// Las URLs de lectura se firman al responder y duran una hora: lo que dura
// una sesión de trabajo sobre la ficha, y corto para que una URL copiada no
// sea un enlace permanente a un bucket privado. Nunca se guardan.
export const VEHICLE_PHOTO_URL_TTL_SECONDS = 60 * 60;

export const VEHICLE_PHOTO_SLOT_MAX = 30;

// La ruta del objeto: coincide con lo que la Fase 1 fijó para storagePath
// ("<organization_id>/<vehicle_id>/<uuid>.<ext>"). El uuid lo genera el
// service, no viene del cliente, así el nombre original del archivo nunca
// llega a Storage.
export function buildStoragePath(
  organizationId: string,
  vehicleId: string,
  extension: DetectedImage["extension"],
): string {
  return `${organizationId}/${vehicleId}/${randomUUID()}.${extension}`;
}

// ---------------------------------------------------------------------------
// Reglas puras.
// ---------------------------------------------------------------------------

export interface GalleryEntry {
  id: string;
  position: number;
  isCover: boolean;
}

// Dónde entra una foto nueva: al final de la galería, y como portada si el
// cliente lo pidió o si todavía no hay ninguna (la primera foto es la
// portada, como lo muestra el mockup).
export function decideNewPhotoPlacement(
  existing: Pick<GalleryEntry, "position" | "isCover">[],
  requestedIsCover: boolean | undefined,
): { position: number; isCover: boolean } {
  const position =
    existing.length === 0 ? 0 : Math.max(...existing.map((photo) => photo.position)) + 1;
  const hasCover = existing.some((photo) => photo.isCover);
  return { position, isCover: requestedIsCover === true || !hasCover };
}

// La portada que queda cuando se borra la actual: la de posición más baja
// entre las restantes, o ninguna si no queda ninguna. `remaining` viene
// ordenada por position desde el repositorio, pero no se confía en eso.
export function pickNextCover(
  remaining: Pick<GalleryEntry, "id" | "position">[],
): string | undefined {
  if (remaining.length === 0) {
    return undefined;
  }
  return remaining.reduce((lowest, photo) => (photo.position < lowest.position ? photo : lowest))
    .id;
}

// El nuevo orden tiene que nombrar EXACTAMENTE las fotos de la unidad: ni una
// menos (dejaría fotos sin posición coherente), ni una de más (sería de otra
// unidad o inexistente), ni repetidas. Devuelve position = índice en la lista.
export function computeReorderedPositions(
  existingIds: string[],
  orderedIds: string[],
): { id: string; position: number }[] {
  const repetidos = orderedIds.filter((id, index) => orderedIds.indexOf(id) !== index);
  if (repetidos.length > 0) {
    throw new AppError("photoIds tiene ids repetidos", 400);
  }
  const existentes = new Set(existingIds);
  const desconocidos = orderedIds.filter((id) => !existentes.has(id));
  if (desconocidos.length > 0) {
    throw new AppError("photoIds incluye fotos que no son de esta unidad", 400);
  }
  if (orderedIds.length !== existingIds.length) {
    throw new AppError(
      `photoIds tiene que incluir todas las fotos de la unidad (${existingIds.length}), se recibieron ${orderedIds.length}`,
      400,
    );
  }
  return orderedIds.map((id, position) => ({ id, position }));
}

// ---------------------------------------------------------------------------
// Lectura: la galería en orden, cada foto con su URL firmada de lectura. Es
// lo que devuelve cada escritura también, para que el cliente repinte la
// galería con lo que quedó sin un segundo request.
// ---------------------------------------------------------------------------

export type VehiclePhotoWithUrl = VehiclePhoto & { url: string | null };

async function attachSignedUrls(photos: VehiclePhoto[]): Promise<VehiclePhotoWithUrl[]> {
  const urls = await createSignedReadUrls(
    VEHICLE_PHOTO_BUCKET.name,
    photos.map((photo) => photo.storagePath),
    VEHICLE_PHOTO_URL_TTL_SECONDS,
  );
  // url: null es una foto cuyo objeto Storage no pudo firmar (no existe): la
  // fila se muestra igual para que se pueda borrar desde la ficha.
  return photos.map((photo) => ({ ...photo, url: urls.get(photo.storagePath) ?? null }));
}

// Sin 404 propio: el caller ya resolvió la unidad (getVehicleById) y las
// fotos de una unidad ajena o inexistente son, por el WHERE, una lista vacía.
export async function getVehiclePhotos(
  organizationId: string,
  vehicleId: string,
  db: Db = prisma,
): Promise<VehiclePhotoWithUrl[]> {
  const photos = await findPhotosByVehicle(vehicleId, organizationId, db);
  return attachSignedUrls(photos);
}

const FOTO_NO_ENCONTRADA = "Foto no encontrada";

// ---------------------------------------------------------------------------
// Subir.
// ---------------------------------------------------------------------------

export interface UploadVehiclePhotoInput {
  buffer: Buffer;
  image: DetectedImage;
  slot?: string | null;
  isCover?: boolean;
}

export async function uploadVehiclePhoto(
  organizationId: string,
  vehicleId: string,
  input: UploadVehiclePhotoInput,
): Promise<VehiclePhotoWithUrl[]> {
  // 404 antes de tocar Storage: no se sube nada para una unidad que no es
  // del caller.
  await getVehicleById(organizationId, vehicleId);

  await ensureBucket(VEHICLE_PHOTO_BUCKET);
  const storagePath = buildStoragePath(organizationId, vehicleId, input.image.extension);
  await uploadObject(VEHICLE_PHOTO_BUCKET.name, storagePath, input.buffer, input.image.mimeType);

  try {
    return await prisma.$transaction(async (tx) => {
      await lockOrganizationForUpdate(organizationId, tx);
      // Otra vez bajo el lock: pudo darse de baja entre la lectura y acá.
      await getVehicleById(organizationId, vehicleId, tx);
      const existing = await findPhotosByVehicle(vehicleId, organizationId, tx);
      const placement = decideNewPhotoPlacement(existing, input.isCover);
      if (placement.isCover) {
        await clearCover(vehicleId, organizationId, tx);
      }
      await createPhoto(
        {
          organizationId,
          vehicleId,
          storagePath,
          slot: input.slot ?? null,
          position: placement.position,
          isCover: placement.isCover,
        },
        tx,
      );
      return getVehiclePhotos(organizationId, vehicleId, tx);
    });
  } catch (err) {
    // La fila no se escribió: el objeto recién subido no tiene dueño. Se
    // intenta borrarlo y, si tampoco se puede, queda huérfano — el error que
    // se propaga es el original, que es el que explica qué pasó.
    await removeObject(VEHICLE_PHOTO_BUCKET.name, storagePath).catch((cleanupErr: unknown) => {
      logger.error(
        { err: cleanupErr, storagePath },
        "No se pudo borrar de Storage la foto cuya fila no se guardó; queda huérfana",
      );
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Editar slot / portada.
// ---------------------------------------------------------------------------

export interface UpdateVehiclePhotoInput {
  slot?: string | null;
  isCover?: boolean;
}

export async function updateVehiclePhoto(
  organizationId: string,
  vehicleId: string,
  photoId: string,
  input: UpdateVehiclePhotoInput,
): Promise<VehiclePhotoWithUrl[]> {
  return prisma.$transaction(async (tx) => {
    await lockOrganizationForUpdate(organizationId, tx);
    await getVehicleById(organizationId, vehicleId, tx);
    const photo = await findPhotoById(photoId, vehicleId, organizationId, tx);
    if (!photo) {
      throw new AppError(FOTO_NO_ENCONTRADA, 404);
    }

    if (input.isCover === false && photo.isCover) {
      // Desmarcar la portada sin elegir otra dejaría la unidad con fotos y
      // sin portada, que es el estado que estas reglas impiden. La portada se
      // cambia marcando otra foto.
      throw new AppError(
        "La portada no se desmarca: para cambiarla, marcá otra foto como portada",
        400,
      );
    }

    const data: { slot?: string | null; isCover?: boolean } = {};
    if (input.slot !== undefined && input.slot !== photo.slot) {
      data.slot = input.slot;
    }
    if (input.isCover === true && !photo.isCover) {
      // Primero la anterior a false, después esta a true — el índice único
      // parcial no admite el orden inverso.
      await clearCover(vehicleId, organizationId, tx);
      data.isCover = true;
    }
    if (Object.keys(data).length > 0) {
      const result = await updatePhoto(photoId, vehicleId, organizationId, data, tx);
      if (result.count === 0) {
        throw new AppError(FOTO_NO_ENCONTRADA, 404);
      }
    }
    return getVehiclePhotos(organizationId, vehicleId, tx);
  });
}

// ---------------------------------------------------------------------------
// Borrar.
// ---------------------------------------------------------------------------

export async function deleteVehiclePhoto(
  organizationId: string,
  vehicleId: string,
  photoId: string,
): Promise<VehiclePhotoWithUrl[]> {
  const vehicle = await getVehicleById(organizationId, vehicleId);
  const photo = await findPhotoById(photoId, vehicleId, organizationId);
  if (!photo) {
    throw new AppError(FOTO_NO_ENCONTRADA, 404);
  }

  // Una unidad publicada no se queda sin fotos por borrar la última: 422 con
  // missingFields, igual que un PATCH que la dejaría incompleta. Para borrarla
  // primero se despublica. Se decide antes de tocar Storage.
  const existing = await findPhotosByVehicle(vehicleId, organizationId);
  assertCompleteForPublish(vehicle, { photoCount: existing.length - 1 });

  // Storage primero. Si falla, la fila queda y el error sale tal cual.
  await removeObject(VEHICLE_PHOTO_BUCKET.name, photo.storagePath);

  return prisma.$transaction(async (tx) => {
    await lockOrganizationForUpdate(organizationId, tx);
    const result = await deletePhotoRepo(photoId, vehicleId, organizationId, tx);
    if (result.count === 0) {
      // Alguien la borró entre la lectura y el lock: el objeto ya no existe y
      // la fila tampoco, que es el estado final que se buscaba.
      return getVehiclePhotos(organizationId, vehicleId, tx);
    }
    if (photo.isCover) {
      const remaining = await findPhotosByVehicle(vehicleId, organizationId, tx);
      const nextCoverId = pickNextCover(remaining);
      if (nextCoverId) {
        await updatePhoto(nextCoverId, vehicleId, organizationId, { isCover: true }, tx);
      }
    }
    return getVehiclePhotos(organizationId, vehicleId, tx);
  });
}

// ---------------------------------------------------------------------------
// Reordenar: se reescribe position para todas, en una transacción.
// ---------------------------------------------------------------------------

export async function reorderVehiclePhotos(
  organizationId: string,
  vehicleId: string,
  orderedIds: string[],
): Promise<VehiclePhotoWithUrl[]> {
  return prisma.$transaction(async (tx) => {
    await lockOrganizationForUpdate(organizationId, tx);
    await getVehicleById(organizationId, vehicleId, tx);
    const existing = await findPhotosByVehicle(vehicleId, organizationId, tx);
    const positions = computeReorderedPositions(
      existing.map((photo) => photo.id),
      orderedIds,
    );
    for (const { id, position } of positions) {
      await updatePhoto(id, vehicleId, organizationId, { position }, tx);
    }
    return getVehiclePhotos(organizationId, vehicleId, tx);
  });
}
