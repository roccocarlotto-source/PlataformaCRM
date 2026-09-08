import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { AppError } from "../utils/AppError";
import {
  VEHICLE_PHOTO_MAX_BYTES,
  detectImageType,
  isVehiclePhotoMimeType,
  type DetectedImage,
} from "../utils/vehiclePhoto";

// ---------------------------------------------------------------------------
// Recepción de una foto de vehículo (Fase 2b). Molde: importUpload.ts, con
// las mismas tres decisiones —multer, memoryStorage, límite real acá porque
// express.json() no toca un multipart— y dos diferencias propias de una foto:
//
//   1. fileFilter por tipo. Solo JPEG y PNG. multer NO dispara LIMIT_FILE_SIZE
//      ni ningún MulterError cuando el fileFilter rechaza: entrega al callback
//      el error que el propio filtro le pasó. Por eso el filtro construye
//      directamente el AppError (415) y la traducción de abajo lo deja pasar
//      tal cual; sin ese caso aparte un PDF respondería 500.
//
//   2. El tipo REAL se decide por los primeros bytes, no por el mimetype que
//      declaró el cliente. El fileFilter corre antes de que exista el buffer,
//      así que solo puede mirar la declaración; la firma se comprueba después,
//      con el archivo en memoria (utils/vehiclePhoto.ts). Lo que se guarda en
//      Storage (content-type) y la extensión de la ruta salen de la firma,
//      nunca del nombre original del archivo.
// ---------------------------------------------------------------------------

const CAMPO_ARCHIVO = "photo";

const TIPO_NO_ADMITIDO = "Solo se admiten fotos JPEG o PNG";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: VEHICLE_PHOTO_MAX_BYTES,
    // UNA sola foto por request; sin esto el límite por archivo no acotaría
    // el total (mismo criterio que importUpload.ts).
    files: 1,
    // Los campos de texto del multipart: slot e isCover.
    fields: 5,
  },
  fileFilter: (_req, file, cb) => {
    if (isVehiclePhotoMimeType(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new AppError(TIPO_NO_ADMITIDO, 415));
  },
}).single(CAMPO_ARCHIVO);

// Lo que el handler recibe además de req.file: el tipo detectado por firma,
// para no volver a mirarlo.
export interface VehiclePhotoUploadRequest extends Request {
  detectedImage?: DetectedImage;
}

export function vehiclePhotoUpload(req: Request, res: Response, next: NextFunction): void {
  upload(req, res, (err: unknown) => {
    if (!err) {
      if (!req.file) {
        next(
          new AppError(
            `Falta la foto: se espera un multipart/form-data con un campo "${CAMPO_ARCHIVO}"`,
            400,
          ),
        );
        return;
      }
      const detected = detectImageType(req.file.buffer);
      if (!detected) {
        // El cliente declaró image/jpeg o image/png y los bytes dicen otra
        // cosa: mismo 415 que el fileFilter, es el mismo problema.
        next(new AppError(TIPO_NO_ADMITIDO, 415));
        return;
      }
      (req as VehiclePhotoUploadRequest).detectedImage = detected;
      next();
      return;
    }

    // El rechazo del fileFilter llega acá como el AppError que el filtro
    // construyó, no como MulterError.
    if (err instanceof AppError) {
      next(err);
      return;
    }

    if (err instanceof multer.MulterError) {
      switch (err.code) {
        case "LIMIT_FILE_SIZE":
          next(
            new AppError(
              `La foto supera el máximo de ${VEHICLE_PHOTO_MAX_BYTES / (1024 * 1024)} MB`,
              413,
            ),
          );
          return;
        case "LIMIT_FILE_COUNT":
        case "LIMIT_UNEXPECTED_FILE":
          next(new AppError(`Se espera exactamente una foto, en el campo "${CAMPO_ARCHIVO}"`, 400));
          return;
        default:
          next(new AppError(`Subida inválida: ${err.code}`, 400));
          return;
      }
    }

    // Ni AppError ni MulterError: sin traducir, que errorHandler lo registre
    // con su stack (mismo criterio que importUpload.ts).
    next(err);
  });
}
