import type { NextFunction, Request, Response } from "express";
import { verifySupabaseJwt } from "../lib/jwt";
import { resolveAuthContext } from "../services/auth.service";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";

const BEARER_PREFIX = "Bearer ";

// Middleware reutilizable: verifica el JWT de Supabase, resuelve el usuario
// real contra Postgres, y adjunta el AuthContext a req.auth. No emite tokens
// propios, no autoriza por rol (ver authorize.ts) — solo prueba identidad.
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

    const payload = verifySupabaseJwt(token);
    req.auth = await resolveAuthContext(payload);

    next();
  },
);
