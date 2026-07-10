import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";
import type { JwtPayload } from "../types/auth";

// Verifica firma y expiración del JWT emitido por Supabase Auth. No emite
// tokens propios, no toca Postgres — solo prueba identidad (principio rector
// de docs/authentication-architecture.md).
export function verifySupabaseJwt(token: string): JwtPayload {
  if (!env.SUPABASE_JWT_SECRET) {
    throw new AppError(
      "SUPABASE_JWT_SECRET no está configurado en el servidor",
      500,
    );
  }

  let decoded: string | jwt.JwtPayload;

  try {
    decoded = jwt.verify(token, env.SUPABASE_JWT_SECRET, {
      algorithms: ["HS256"],
    });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError("El token expiró", 401);
    }
    throw new AppError("Token inválido", 401);
  }

  if (typeof decoded === "string" || typeof decoded.sub !== "string") {
    throw new AppError(
      "Token inválido: falta el identificador del usuario",
      401,
    );
  }

  return {
    sub: decoded.sub,
    email: typeof decoded.email === "string" ? decoded.email : undefined,
    exp: typeof decoded.exp === "number" ? decoded.exp : 0,
    iat: typeof decoded.iat === "number" ? decoded.iat : undefined,
    aud: decoded.aud,
  };
}
