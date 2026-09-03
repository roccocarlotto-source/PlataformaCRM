import type { NextFunction, Request, Response } from "express";
import { findPlatformAdminByUserId } from "../repositories/qrBilling.repository";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";

// ---------------------------------------------------------------------------
// Gate de platform admin — módulo QR (docs/qr-integration.md, Fase 2).
//
// authorize() solo conoce ADMIN/USER, roles DENTRO de una Organization — no
// sirve acá: un PlatformAdmin es global (es Rocco, el operador de la
// plataforma), no necesariamente ADMIN de la Organization sobre la que está
// actuando, ni siquiera necesariamente parte de ella. Es el equivalente del
// `if not exists (select 1 from platform_admins where user_id = auth.uid())`
// que cada función SECURITY DEFINER del original repetía (D10): la identidad
// se re-verifica contra la tabla en CADA llamada, nunca se confía en un estado
// del cliente.
//
// Después de `authenticate`, siempre: necesita req.auth.userId. Async (consulta
// la base), así que va por asyncHandler igual que authenticate. Mismo mensaje
// genérico que authorize: un usuario común no tiene por qué enterarse de que
// existe esta allowlist.
//
// La allowlist no tiene write path de aplicación, a propósito (igual que el
// original): la única forma de agregar una fila es SQL directo — ver "Dar de
// alta el primer platform admin" en docs/qr-integration.md.
// ---------------------------------------------------------------------------
export const requirePlatformAdmin = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      // Error de programación nuestro, nunca del cliente — mismo criterio que
      // authorize(): isOperational false para que el mensaje quede en el log.
      throw new AppError(
        "requirePlatformAdmin debe usarse después del middleware authenticate",
        500,
        false,
      );
    }

    const platformAdmin = await findPlatformAdminByUserId(req.auth.userId);
    if (!platformAdmin) {
      throw new AppError("No tenés permisos para realizar esta acción", 403);
    }

    next();
  },
);
