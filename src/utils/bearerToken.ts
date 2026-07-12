import type { Request } from "express";
import { AppError } from "./AppError";

const BEARER_PREFIX = "Bearer ";

// Extrae el token del header Authorization. Usado por el flujo de aceptación
// de invitaciones, que no puede pasar por middlewares/authenticate.ts: ese
// middleware exige que ya exista una fila en public.users (resolveAuthContext),
// exactamente lo que todavía no existe para alguien aceptando una invitación.
// No se reutiliza este helper dentro de authenticate.ts para no tocar código
// de auth ya verificado en producción — la duplicación de estas pocas líneas
// es un costo menor a cambio de no modificarlo.
export function extractBearerToken(req: Request): string {
  const header = req.headers.authorization;

  if (!header || !header.startsWith(BEARER_PREFIX)) {
    throw new AppError("Falta el token de autenticación", 401);
  }

  const token = header.slice(BEARER_PREFIX.length).trim();

  if (!token) {
    throw new AppError("Falta el token de autenticación", 401);
  }

  return token;
}
