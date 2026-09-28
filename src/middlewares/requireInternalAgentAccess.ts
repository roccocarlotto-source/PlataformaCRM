import type { NextFunction, Request, Response } from "express";
import { findUserById } from "../repositories/user.repository";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";

export const MENSAJE_SIN_ACCESO_AL_AGENTE_INTERNO =
  "No tenés acceso al agente interno. Pedíselo a un administrador de tu organización.";

// Quién puede usar el agente de IA interno (ítem 179): un ADMIN siempre; un
// USER solo si un ADMIN le marcó User.canUseInternalAgent. Va después de
// `authenticate`, igual que authorize().
//
// La columna se lee de la base en cada request y NO se sumó al AuthContext: es
// un dato que solo le importa a esta ruta, y agregarlo a req.auth lo haría
// viajar por todos los requests del sistema. Para un ADMIN no hay lectura.
export const requireInternalAgentAccess = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      // Error de programación nuestro, mismo criterio que authorize().
      throw new AppError(
        "requireInternalAgentAccess() debe usarse después del middleware authenticate",
        500,
        false,
      );
    }

    if (req.auth.role === "ADMIN") {
      next();
      return;
    }

    const user = await findUserById(req.auth.userId, req.auth.organizationId);
    if (!user?.canUseInternalAgent) {
      throw new AppError(MENSAJE_SIN_ACCESO_AL_AGENTE_INTERNO, 403);
    }

    next();
  },
);
