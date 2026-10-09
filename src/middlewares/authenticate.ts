import type { NextFunction, Request, Response } from "express";
import { verifySupabaseJwt } from "../lib/jwt";
import { resolveAuthContext } from "../services/auth.service";
import { AppError } from "../utils/AppError";
import { exigirModuloDeLaEdicion } from "./moduloDeLaEdicion";
import { asyncHandler } from "../utils/asyncHandler";

const BEARER_PREFIX = "Bearer ";

// Middleware reutilizable: verifica el JWT de Supabase, resuelve el usuario
// real contra Postgres, y adjunta el AuthContext a req.auth. No emite tokens
// propios, no autoriza por rol (ver authorize.ts) — solo prueba identidad.
// Y, ya con la identidad probada, aplica el gate de módulos por edición
// (moduloDeLaEdicion.ts): un no-op para COMPLETA.
export const authenticate = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;

    if (!header || !header.startsWith(BEARER_PREFIX)) {
      throw new AppError("Falta el token de autenticación", 401);
    }

    const token = header.slice(BEARER_PREFIX.length).trim();

    if (!token) {
      throw new AppError("Falta el token de autenticación", 401);
    }

    const payload = await verifySupabaseJwt(token);
    const auth = await resolveAuthContext(payload);
    req.auth = auth;

    exigirModuloDeLaEdicion(req, auth);

    next();
  },
);
