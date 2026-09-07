export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  // Detalle estructurado que acompaña al mensaje en la respuesta (por
  // ejemplo, la lista de campos que faltan para publicar una unidad:
  // `{ missingFields: [...] }`). Opcional y solo para errores operacionales:
  // errorHandler lo copia dentro de `error` junto al mensaje, sin cambiar la
  // forma `{ error: { message } }` que ya parsea el frontend.
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode = 500,
    isOperational = true,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;

    Object.setPrototypeOf(this, AppError.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}
