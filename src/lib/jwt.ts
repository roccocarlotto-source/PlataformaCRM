import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from "jose";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";
import type { JwtPayload } from "../types/auth";

// Supabase firma los JWT con claves asimétricas (ES256) publicadas en un
// JWKS — no con un secreto compartido. `createRemoteJWKSet` cachea las
// claves y las refresca sola cuando aparece un `kid` nuevo (rotación).
// Se crea una sola vez (lazy) para no golpear el JWKS en cada request.
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getJwks() {
  if (jwks) {
    return jwks;
  }

  if (!env.SUPABASE_URL) {
    throw new AppError("SUPABASE_URL no está configurado en el servidor", 500);
  }

  jwks = createRemoteJWKSet(
    new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
  );

  return jwks;
}

// Verifica firma y expiración del JWT emitido por Supabase Auth. No emite
// tokens propios, no toca Postgres — solo prueba identidad (principio rector
// de docs/authentication-architecture.md).
export async function verifySupabaseJwt(token: string): Promise<JwtPayload> {
  let payload: Record<string, unknown>;

  try {
    const result = await jwtVerify(token, getJwks(), {
      algorithms: ["ES256"],
    });
    payload = result.payload;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new AppError("El token expiró", 401);
    }
    throw new AppError("Token inválido", 401);
  }

  if (typeof payload.sub !== "string") {
    throw new AppError(
      "Token inválido: falta el identificador del usuario",
      401,
    );
  }

  return {
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    exp: typeof payload.exp === "number" ? payload.exp : 0,
    iat: typeof payload.iat === "number" ? payload.iat : undefined,
    aud: payload.aud as string | string[] | undefined,
  };
}
