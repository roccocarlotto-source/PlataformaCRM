import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import {
  KNOWLEDGE_BASE_EXTRACT_MAX_FILE_BYTES,
  MENSAJE_FORMATO_NO_SOPORTADO,
  MIMETYPES_SOPORTADOS,
} from "../services/knowledgeBaseExtraction.service";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Recepción del archivo del que se extrae el contenido de una entrada de la
// base de conocimiento (ítem 60 de docs/frontend-cambios-pendientes.md).
//
// CALCADO DE importUpload.ts, con tres diferencias y ninguna accidental:
//
//   1. El tope es 5 MB y no 10: acá viene un documento de texto, no una
//      planilla de miles de filas. Ver KNOWLEDGE_BASE_EXTRACT_MAX_FILE_BYTES.
//   2. Hay fileFilter. La importación acepta cualquier mimetype y decide por la
//      EXTENSIÓN adentro del parser, porque para un .csv el navegador manda
//      cualquier cosa (application/vnd.ms-excel es habitual). Acá los tres
//      formatos tienen mimetypes estables y bien definidos, así que el rechazo
//      puede pasar ANTES de leer un solo byte del archivo.
//   3. No viaja ningún campo de texto: el archivo es todo el cuerpo.
//
// memoryStorage y NO diskStorage, por la misma razón que importUpload: un
// archivo temporal en disco agrega un ciclo de vida propio —hay que borrarlo si
// el parseo falla, si el request se aborta, si el proceso muere— y con este
// tope entra holgado en memoria y desaparece solo cuando el request termina.
// El archivo NO se persiste en ningún lado: lo único que sobrevive al request
// es el texto que el servicio devuelve.
// ---------------------------------------------------------------------------

const CAMPO_ARCHIVO = "file";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: KNOWLEDGE_BASE_EXTRACT_MAX_FILE_BYTES,
    // UN solo archivo por request, igual que importUpload: sin esto el límite
    // por archivo no acotaría el total.
    files: 1,
    // Ningún campo de texto. A diferencia de la importación —que recibe
    // sourceId— acá no hay nada más que el archivo, así que cualquier campo
    // extra es ruido que no se procesa.
    fields: 0,
  },
  // EL RECHAZO POR FORMATO OCURRE ACÁ, antes de parsear nada, que es lo que
  // hace que este endpoint no le regale trabajo a nadie: multer descarta el
  // stream sin materializarlo y el servicio de extracción ni se entera.
  //
  // El mimetype lo declara el cliente y es tan manipulable como una extensión:
  // esto NO es un control de seguridad, es un filtro barato. Lo que realmente
  // decide es el parser de cada formato, que falla con un 400 si el contenido
  // no es lo que dice ser.
  fileFilter: (_req, file, cb) => {
    if (!MIMETYPES_SOPORTADOS.includes(file.mimetype)) {
      cb(new AppError(MENSAJE_FORMATO_NO_SOPORTADO, 400));
      return;
    }
    cb(null, true);
  },
}).single(CAMPO_ARCHIVO);

// Traduce los errores de multer a AppError, por la misma razón que lo hace
// importUpload.ts: errorHandler manda a 500 todo lo que no sea AppError, así
// que sin esto un archivo demasiado grande respondería 500 — un error del
// servidor por algo que hizo el cliente.
export function knowledgeBaseUpload(req: Request, res: Response, next: NextFunction): void {
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

    // El AppError del fileFilter vuelve por acá: multer lo propaga tal cual,
    // así que ya tiene su 400 y su mensaje y no hay nada que traducir.
    if (err instanceof AppError) {
      next(err);
      return;
    }

    if (err instanceof multer.MulterError) {
      switch (err.code) {
        case "LIMIT_FILE_SIZE": {
          // 413, el mismo código que usa importUpload para este caso. En MB
          // porque el número en bytes no le dice nada a nadie.
          const maxMb = Math.round(KNOWLEDGE_BASE_EXTRACT_MAX_FILE_BYTES / (1024 * 1024));
          next(new AppError(`El archivo supera el máximo de ${maxMb} MB`, 413));
          return;
        }
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
    // para que errorHandler lo registre con su stack. Mismo criterio que
    // importUpload.ts e ingestBody.ts.
    next(err);
  });
}
