import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { AppError } from "../utils/AppError";

// Middleware de error centralizado. Debe montarse último, después de todas
// las rutas y del middleware notFound. La firma de 4 parámetros es lo que
// Express usa para reconocerlo como manejador de errores.
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const message = isAppError ? err.message : "Error interno del servidor";

  logger.error(
    { err, path: req.originalUrl, method: req.method },
    isAppError ? err.message : "Unhandled error",
  );

  res.status(statusCode).json({
    error: {
      message,
      ...(env.isDevelopment && err instanceof Error && !isAppError
        ? { stack: err.stack }
        : {}),
    },
  });
}
