import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { sendQrNotFoundLanding } from "../controllers/qrPublic.controller";

// ---------------------------------------------------------------------------
// Gate de secreto compartido para /qr/resolve/:qrId — docs/qr-integration.md,
// Fase 4 (backend). Puerto de hasValidInternalProxySecret + el comentario
// AUD-09 de Plataforma-QR/supabase/functions/resolve/index.ts.
//
// POR QUÉ EXISTE: el endpoint público de resolución es alcanzable directo en
// la URL del backend, salteando por completo al Cloudflare Worker que hace el
// rate limiting (10/min por IP, 500/min global). Un rate limit que vive solo
// en el Worker es, por lo tanto, evitable — así que el backend exige un secreto
// que solo el Worker conoce, agregado en su fetch server-to-server.
//
// FALLA CERRADO, A PROPÓSITO: sin QR_RESOLVE_PROXY_SECRET (ni _PREVIOUS)
// configurado, ningún valor del header satisface el chequeo y el endpoint
// queda bloqueado para todo el mundo hasta que se configure un valor real. Es
// el mismo diseño que el original, no un bug — y por eso el orden de deploy
// importa: el secreto se configura en el entorno real ANTES o JUNTO con este
// cambio, nunca después.
//
// EN FALLA, LA RESPUESTA ES LA MISMA QUE PARA UN QR INEXISTENTE, byte a byte:
// el 404 con la landing genérica que arma el propio controller
// (sendQrNotFoundLanding). Nunca un 401/403/AppError distinto — eso solo le
// revelaría a quien prueba la URL cruda que este gate existe (DEC-007 aplica
// también acá). Como no pasa por errorHandler ni tira, tampoco deja rastro
// distinguible en el log de errores.
//
// ROTACIÓN: se acepta el secreto actual o el anterior
// (QR_RESOLVE_PROXY_SECRET_PREVIOUS), así se puede actualizar primero
// cualquiera de los dos lados —Worker o backend— sin ventana de caída.
//
// Se lee `env` en cada request, no al cargar el módulo: los tests cambian el
// valor entre casos, y en producción no cambia nada porque env es inmutable
// una vez parseado.
// ---------------------------------------------------------------------------

export const INTERNAL_PROXY_SECRET_HEADER = "x-internal-proxy-secret";

// Comparación en tiempo constante SIN filtrar el largo del secreto. No se reusa
// timingSafeEqual de utils/mercadopagoSignature.ts a propósito: ese helper
// devuelve `false` de inmediato cuando los largos difieren, lo cual está bien
// para un HMAC hex (el largo es público, siempre 64) pero acá el largo del
// secreto ES parte del secreto. Hashear los dos lados con SHA-256 deja dos
// buffers de 32 bytes siempre, así crypto.timingSafeEqual nunca tira ni corta
// antes por longitud, y el tiempo de comparación no depende de cuánto se
// parezca el valor recibido al configurado.
export function secretsMatch(candidate: string, expected: string): boolean {
  const a = createHash("sha256").update(candidate, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

// Pura y exportada para testearla sin Express — misma firma y misma semántica
// que la función original: acepta el actual o el anterior; sin ninguno
// configurado (o con el header ausente/vacío), nada la satisface.
export function hasValidInternalProxySecret(
  headerValue: string | null | undefined,
  current: string | null | undefined,
  previous: string | null | undefined,
): boolean {
  if (!headerValue) return false;
  if (current && secretsMatch(headerValue, current)) return true;
  if (previous && secretsMatch(headerValue, previous)) return true;
  return false;
}

// Síncrono: no consulta nada, así que no hace falta asyncHandler. Express ya
// normaliza los nombres de header a minúsculas, por eso req.get() es
// case-insensitive.
export function requireInternalProxySecret(req: Request, res: Response, next: NextFunction): void {
  const headerValue = req.get(INTERNAL_PROXY_SECRET_HEADER);
  const valid = hasValidInternalProxySecret(
    headerValue,
    env.QR_RESOLVE_PROXY_SECRET,
    env.QR_RESOLVE_PROXY_SECRET_PREVIOUS,
  );
  if (!valid) {
    sendQrNotFoundLanding(res);
    return;
  }
  next();
}
