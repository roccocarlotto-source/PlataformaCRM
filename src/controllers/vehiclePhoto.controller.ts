import type { Response } from "express";
import { z } from "zod";
import type { VehiclePhotoUploadRequest } from "../middlewares/vehiclePhotoUpload";
import {
  VEHICLE_PHOTO_SLOT_MAX,
  deleteVehiclePhoto,
  reorderVehiclePhotos,
  updateVehiclePhoto,
  uploadVehiclePhoto,
} from "../services/vehiclePhoto.service";
import type { AuthenticatedRequest } from "../types/auth";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

// ---------------------------------------------------------------------------
// Frontera de validación de la galería de una unidad (Fase 2b). Los permisos
// (lectura autenticada, escritura ADMIN) los fija vehicle.routes.ts.
//
// El POST es multipart: el archivo lo recibe vehiclePhotoUpload y los campos
// de texto (slot, isCover) llegan por req.body como STRINGS, porque multer
// no tipa. Por eso isCover acá es "true"/"false" y no z.boolean() — mismo
// criterio que los booleanos de query string del listado. El PATCH y el
// reorder son JSON normales.
// ---------------------------------------------------------------------------

const idParamSchema = z.string().uuid("id inválido");
const photoIdParamSchema = z.string().uuid("photoId inválido");

// slot: el ángulo que la ficha pide ("frente", "perfil"...). VarChar(30) en
// el schema; la lista cerrada la decide la UI. Vacío -> null, como el resto
// de los textos nullable del módulo.
const slotSchema = z
  .string()
  .trim()
  .max(VEHICLE_PHOTO_SLOT_MAX, `slot no puede superar los ${VEHICLE_PHOTO_SLOT_MAX} caracteres`)
  .nullable()
  .transform((valor) => (valor === null || valor.length === 0 ? null : valor));

const multipartBooleanSchema = z
  .enum(["true", "false"], { message: 'isCover tiene que ser "true" o "false"' })
  .transform((value) => value === "true");

export const uploadVehiclePhotoBodySchema = z.object({
  slot: slotSchema.optional(),
  isCover: multipartBooleanSchema.optional(),
});

export const updateVehiclePhotoSchema = z
  .object({
    slot: slotSchema.optional(),
    isCover: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

export const reorderVehiclePhotosSchema = z.object({
  photoIds: z
    .array(z.string().uuid("cada photoId tiene que ser un uuid"))
    .min(1, "photoIds no puede estar vacío"),
});

export const uploadVehiclePhotoHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const body = parseOrThrow(uploadVehiclePhotoBodySchema, req.body ?? {});
    const { file, detectedImage } = req as AuthenticatedRequest & VehiclePhotoUploadRequest;
    if (!file || !detectedImage) {
      // vehiclePhotoUpload garantiza los dos; llegar acá sin ellos es un
      // middleware mal encadenado, no un error del cliente.
      throw new AppError("uploadVehiclePhotoHandler sin vehiclePhotoUpload delante", 500, false);
    }
    const photos = await uploadVehiclePhoto(req.auth.organizationId, id, {
      buffer: file.buffer,
      image: detectedImage,
      slot: body.slot,
      isCover: body.isCover,
    });
    res.status(201).json(photos);
  },
);

export const updateVehiclePhotoHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const photoId = parseOrThrow(photoIdParamSchema, req.params.photoId);
    const input = parseOrThrow(updateVehiclePhotoSchema, req.body);
    const photos = await updateVehiclePhoto(req.auth.organizationId, id, photoId, input);
    res.status(200).json(photos);
  },
);

export const deleteVehiclePhotoHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const photoId = parseOrThrow(photoIdParamSchema, req.params.photoId);
    const photos = await deleteVehiclePhoto(req.auth.organizationId, id, photoId);
    // 200 con la galería que quedó, no 204: el cliente necesita saber cuál es
    // la portada nueva si borró la anterior.
    res.status(200).json(photos);
  },
);

export const reorderVehiclePhotosHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const input = parseOrThrow(reorderVehiclePhotosSchema, req.body);
    const photos = await reorderVehiclePhotos(req.auth.organizationId, id, input.photoIds);
    res.status(200).json(photos);
  },
);
