import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { AppError } from "../utils/AppError";
import { IMPORT_MAX_FILE_BYTES } from "../utils/spreadsheet";

// ---------------------------------------------------------------------------
// Recepción del archivo de importación (ítem 5).
//
// POR QUÉ multer: es el middleware de multipart de la organización de Express,
// con tipos publicados (@types/multer) y mantenido. Alternativas consideradas:
// busboy —que es sobre lo que multer está construido— habría significado
// escribir a mano el manejo de límites y el ensamblado del buffer; formidable
// está pensado alrededor de escribir a disco.
//
// memoryStorage y NO diskStorage. Escribir a disco agregaría un archivo
// temporal por subida, con su ciclo de vida propio: hay que borrarlo si el
// parseo falla, si el request se aborta, si el proceso muere. Con el tope de
// IMPORT_MAX_FILE_BYTES el archivo entra holgado en memoria y desaparece solo
// cuando el request termina — un problema menos que no hace falta resolver.
//
// EL LÍMITE ES REAL ACÁ, a diferencia del webhook. La ruta de ingesta necesitó
// montarse antes del express.json() global porque body-parser marca el request
// y toda instancia posterior se saltea a sí misma (ver app.ts). Con multipart
// eso no pasa: express.json() solo mira application/json y express.urlencoded
// solo application/x-www-form-urlencoded, así que ninguno toca un
// multipart/form-data y multer es el primero y único que lee este cuerpo.
// ---------------------------------------------------------------------------

const CAMPO_ARCHIVO = "file";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: IMPORT_MAX_FILE_BYTES,
    // UN solo archivo por request. Sin esto, alguien podría mandar 100 archivos
    // de 10 MB y el límite por archivo no acotaría nada del total.
    files: 1,
    // Los campos de texto del multipart: acá solo viaja sourceId.
    fields: 5,
  },
}).single(CAMPO_ARCHIVO);

// Traduce los errores de multer a AppError, por la misma razón que
// ingestBody.ts lo hace con los de body-parser: errorHandler manda a 500 todo
// lo que no sea AppError, así que sin esto un archivo demasiado grande
// respondería 500 — un error del servidor por algo que hizo el cliente.
export function importUpload(req: Request, res: Response, next: NextFunction): void {
  upload(req, res, (err: unknown) => {
    if (!err) {
      if (!req.file) {
        next(
          new AppError(
            `Falta el archivo: se espera un multipart/form-data con un campo "${CAMPO_ARCHIVO}"`,
            400,
          ),
        );
        return;
      }
      next();
      return;
    }

    if (err instanceof multer.MulterError) {
      switch (err.code) {
        case "LIMIT_FILE_SIZE":
          next(new AppError(`El archivo supera el máximo de ${IMPORT_MAX_FILE_BYTES} bytes`, 413));
          return;
        case "LIMIT_FILE_COUNT":
        case "LIMIT_UNEXPECTED_FILE":
          next(
            new AppError(`Se espera exactamente un archivo, en el campo "${CAMPO_ARCHIVO}"`, 400),
          );
          return;
        default:
          next(new AppError(`Subida inválida: ${err.code}`, 400));
          return;
      }
    }

    // No es un error de multer y no sabemos qué es: se deja pasar sin traducir
    // para que errorHandler lo registre con su stack. Inventarle un 4xx a un
    // error que no entendemos sería decirle al cliente que la culpa es suya sin
    // saberlo — mismo criterio que ingestBody.ts.
    next(err);
  });
}
