import type { NextFunction, Request, Response } from "express";
import { verifySupabaseJwt } from "../lib/jwt";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";
import { extractBearerToken } from "../utils/bearerToken";

// Middleware reutilizable y acotado (M1, punto A del ciclo de rate
// limiting): verifica el JWT de Supabase UNA sola vez y deja
// { userId, email } en req.invitationAcceptIdentity para que tanto
// acceptInvitationRateLimiter (keying por identidad, ver rateLimit.ts)
// como el controller/service lo consuman sin volver a verificar el token.
// No reemplaza a authenticate.ts — ese exige una fila en public.users que
// todavía no existe para quien está aceptando (mismo motivo ya
// documentado en bearerToken.ts). No cambia qué se verifica ni cómo:
// reutiliza extractBearerToken y verifySupabaseJwt tal cual están
// verificados en producción, sin tocarlos.
export const verifyInvitationAcceptIdentity = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const token = extractBearerToken(req);
    const payload = await verifySupabaseJwt(token);

    if (!payload.email) {
      throw new AppError("El token no contiene un email válido", 401);
    }

    req.invitationAcceptIdentity = {
      userId: payload.sub,
      email: payload.email.trim().toLowerCase(),
    };

    next();
  },
);
