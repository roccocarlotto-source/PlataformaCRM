import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { AppError } from "../utils/AppError";
import { traducirErrorDePrisma } from "../utils/prismaErrors";

// ---------------------------------------------------------------------------
// Middleware de error centralizado. Debe montarse último, después de todas las
// rutas y del middleware notFound. La firma de 4 parámetros es lo que Express
// usa para reconocerlo como manejador de errores.
//
// LO QUE DECIDE (M-11 de docs/auditoria-2026-08-29.md):
//
//   - QUÉ STATUS. El de un AppError; el de la traducción de Prisma para los
//     códigos genéricos (P2034/P2028 -> 409, P2003 -> 400, ver
//     utils/prismaErrors.ts — P2002 se sigue traduciendo por servicio, y ahí
//     está explicado por qué); 500 para todo lo demás.
//
//   - QUÉ MENSAJE VE EL CLIENTE. Solo el de un AppError `isOperational`. Un
//     AppError con isOperational: false narra algo interno —config faltante,
//     uso incorrecto de una API nuestra, un invariante de datos roto— y su
//     mensaje existe para el log, no para el cliente: sale como "Error interno
//     del servidor", igual que un error que no es AppError.
//
//   - CON QUÉ LOGGER Y A QUÉ NIVEL. req.log, no el logger raíz: es el hijo que
//     pinoHttp le cuelga a cada request con su req.id, y sin eso la línea del
//     error no se puede correlacionar con las demás líneas del mismo request.
//     Con fallback al logger raíz SOLO si req.log no existe: app.ts monta
//     pinoHttp antes que todo, pero varias apps de test montan errorHandler
//     sin pinoHttp, y un TypeError acá dentro haría que Express respondiera
//     por su cuenta con un 500 sin cuerpo nuestro — un error handler que se
//     rompe al loguear es peor que uno sin correlación.
//     `error` solo para statusCode >= 500 —bugs e infraestructura rota, lo que
//     alguien tiene que mirar—; los 4xx son parte del funcionamiento esperado
//     de la API y van a `warn`, mismo criterio que el webhook de Google
//     Calendar para sus 403/409.
//
//   - EL STACK, solo en desarrollo, y solo cuando el cliente tampoco ve el
//     mensaje real (no AppError, o AppError no operacional): es exactamente el
//     caso en que un desarrollador local depurando quiere verlo. Un AppError
//     operacional ya dice todo lo que tiene que decir en su mensaje.
//
//   - SI LOS HEADERS YA SALIERON, NO ESCRIBE (B-24 de
//     docs/auditoria-2026-08-29.md). Un handler que ya mandó headers —o empezó
//     a escribir el cuerpo— y recién ahí falla no puede recibir un segundo
//     res.status().json(): Node tira ERR_HTTP_HEADERS_SENT desde adentro del
//     propio error handler, el último eslabón, y ese crash secundario tapa al
//     error original. La convención de Express es delegar en next(err): el
//     finalhandler por defecto sabe cerrar la conexión sin reescribir. Se
//     loguea IGUAL antes de delegar — que los headers hayan salido no vuelve
//     menos importante saber qué falló. Hoy ningún endpoint escribe antes de
//     poder fallar (todos responden con un único res.status().json() al
//     final), así que es defensa en profundidad para el día que exista una
//     ruta que streamee, no un bug alcanzable.
// ---------------------------------------------------------------------------
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  const prismaError = err instanceof AppError ? undefined : traducirErrorDePrisma(err);
  const appError = err instanceof AppError ? err : prismaError;
  const isAppError = appError !== undefined;
  const statusCode = appError ? appError.statusCode : 500;
  const message =
    isAppError && appError.isOperational ? appError.message : "Error interno del servidor";

  const log = req.log ?? logger;
  const logPayload = { err, path: req.originalUrl, method: req.method };
  const logMessage = isAppError ? appError.message : "Unhandled error";
  if (statusCode >= 500) {
    log.error(logPayload, logMessage);
  } else {
    log.warn(logPayload, logMessage);
  }

  if (res.headersSent) {
    next(err);
    return;
  }

  res.status(statusCode).json({
    error: {
      message,
      ...(env.isDevelopment && err instanceof Error && (!isAppError || !appError.isOperational)
        ? { stack: err.stack }
        : {}),
    },
  });
}
