import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/AppError";
import type { RoleName } from "../types/auth";

// Factory de middleware de autorización por rol. Debe montarse siempre
// después de `authenticate` en la misma ruta. Los roles son ADMIN, USER (una
// automotora) y RECEPCION (una clínica, docs/rubros.md §11); las capacidades
// más finas que un rol están en src/services/permisos.ts.
//
// El middleware lleva los roles que deja pasar en una propiedad
// (rolesDeAuthorize): src/services/permisos.test.ts recorre el router real y
// fija qué rutas abre cada rol, sin una lista a mano que se desactualice.
const ROLES_PERMITIDOS = Symbol("rolesPermitidos");

type MiddlewareDeAuthorize = ((req: Request, res: Response, next: NextFunction) => void) & {
  [ROLES_PERMITIDOS]: readonly RoleName[];
};

export function authorize(...allowedRoles: RoleName[]): MiddlewareDeAuthorize {
  const middleware = (req: Request, _res: Response, next: NextFunction): void => {
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
  return Object.assign(middleware, { [ROLES_PERMITIDOS]: allowedRoles });
}

/** Los roles que deja pasar un middleware de authorize(), o null si `handle`
 *  no es uno. */
export function rolesDeAuthorize(handle: unknown): readonly RoleName[] | null {
  return typeof handle === "function" && ROLES_PERMITIDOS in handle
    ? (handle as MiddlewareDeAuthorize)[ROLES_PERMITIDOS]
    : null;
}
