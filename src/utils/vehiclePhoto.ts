// ---------------------------------------------------------------------------
// Fotos de vehículos (Fase 2b) — lo puro y compartido entre el middleware de
// subida, el service y los tests: los límites de la subida y la detección del
// tipo real de imagen por sus primeros bytes. Mismo lugar que
// IMPORT_MAX_FILE_BYTES en utils/spreadsheet.ts para la importación.
// ---------------------------------------------------------------------------

export const VEHICLE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

// WebP desde el 06/10/2026 (decisión 14 de docs/importacion-de-datos.md): lo
// sirven muchos sitios de los que se importan fotos de stock, y se suma a
// TODOS los caminos de subida a la vez para que una foto importada nunca sea
// de un tipo que no se pueda subir a mano.
export const VEHICLE_PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type VehiclePhotoMimeType = (typeof VEHICLE_PHOTO_MIME_TYPES)[number];

export function isVehiclePhotoMimeType(value: string): value is VehiclePhotoMimeType {
  return (VEHICLE_PHOTO_MIME_TYPES as readonly string[]).includes(value);
}

export interface DetectedImage {
  mimeType: VehiclePhotoMimeType;
  extension: "jpg" | "png" | "webp";
}

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// WebP es un contenedor RIFF: "RIFF", cuatro bytes de largo, "WEBP". Las dos
// marcas, no solo "RIFF": un WAV o un AVI también empiezan así.
const RIFF_MARK = Buffer.from("RIFF", "ascii");
const WEBP_MARK = Buffer.from("WEBP", "ascii");

// El tipo REAL del archivo, por firma, no por lo que declaró el cliente. La
// extensión de la ruta en Storage y el content-type con el que se guarda
// salen de acá. undefined = no es JPEG, PNG ni WebP.
export function detectImageType(buffer: Buffer): DetectedImage | undefined {
  if (
    buffer.length >= PNG_SIGNATURE.length &&
    buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (
    buffer.length >= JPEG_SIGNATURE.length &&
    buffer.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)
  ) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).equals(RIFF_MARK) &&
    buffer.subarray(8, 12).equals(WEBP_MARK)
  ) {
    return { mimeType: "image/webp", extension: "webp" };
  }
  return undefined;
}
