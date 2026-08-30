import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/AppError";
import type { RoleName } from "../types/auth";

// Factory de middleware de autorización por rol. Debe montarse siempre
// después de `authenticate` en la misma ruta. Solo hay ADMIN/USER hoy —
// nada de permisos granulares todavía (ver Role en prisma/schema.prisma).
export function authorize(...allowedRoles: RoleName[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      // Error de programación nuestro, nunca del cliente: isOperational false
      // para que el mensaje quede en el log y no en la respuesta (M-11 b).
      next(new AppError("authorize() debe usarse después del middleware authenticate", 500, false));
      return;
    }

    if (!allowedRoles.includes(req.auth.role)) {
      next(new AppError("No tenés permisos para realizar esta acción", 403));
      return;
    }

    next();
  };
}
