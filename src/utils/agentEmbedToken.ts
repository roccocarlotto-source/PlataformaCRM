import { createHash, randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Generación y hasheo del token de embed del widget del canal Web (módulo de
// Agentes de IA, paso 5a — nota del canal Web en §10 de
// docs/ai-agent-architecture.md).
//
// CALCADO DE utils/apiKey.ts, A PROPÓSITO, Y CON EL MISMO RAZONAMIENTO: el
// hash es SHA-256 determinístico y sin sal porque el camino de autenticación
// hashea lo que llega y busca por igualdad (una sal por fila lo haría O(n)),
// y eso es seguro porque el token lo genera el servidor con 256 bits de un
// CSPRNG — no lo elige ni lo memoriza nadie, así que no es una contraseña y
// bcrypt/argon2 serían el primitivo equivocado. El bloque largo de apiKey.ts
// explica cada una de esas frases; no se repite acá para que haya UNA sola
// versión de ese argumento.
//
// LO QUE ES DISTINTO, y por qué existe este archivo en vez de reusar
// generateApiKey():
//
//   - El PREFIJO. "embed_" y no "crm_": los dos tipos de credencial tienen
//     que distinguirse a simple vista en un log, en un ticket o en la UI, y
//     el borde del 5b tiene que poder rechazar temprano una API key de
//     ingesta presentada como token de widget (y viceversa).
//   - El PRIVILEGIO. Una API key ingesta datos al CRM; un token de embed solo
//     puede escribir mensajes al loop de orquestación. Es un token PÚBLICO de
//     baja privilegio —va en el HTML del sitio del cliente—, no un secreto de
//     sesión: la entropía sigue importando (que nadie pueda adivinar uno
//     ajeno), pero lo que de verdad lo protege es rate limit por token +
//     Agent.allowedOrigins.
//
// Las dos restricciones de apiKey.ts para el camino de autenticación aplican
// igual acá: hashear LOS BYTES EXACTOS que llegan (sin trim ni normalización)
// y NUNCA aceptar el token por querystring — va en un header, que el logger
// redacta.
// ---------------------------------------------------------------------------

export const EMBED_TOKEN_PREFIX = "embed_";

// 32 bytes = 256 bits, el mismo requisito que API_KEY_SECRET_BYTES.
export const EMBED_TOKEN_SECRET_BYTES = 32;

// Cuántos caracteres del token se guardan en claro en tokenPrefix para poder
// identificarlo en la UI. 14 = EMBED_TOKEN_PREFIX (6) + 8 caracteres del
// secreto, y entra en el VarChar(16) de la columna. Esos 8 caracteres
// base64url exponen 48 bits y dejan 208 ocultos — la misma cuenta que
// API_KEY_PREFIX_LENGTH.
export const EMBED_TOKEN_PREFIX_LENGTH = 14;

export interface GeneratedEmbedToken {
  // El token en claro. Se devuelve UNA sola vez, en la respuesta de creación,
  // y no se persiste en ningún lado. No adjuntarlo a `req`, no meterlo en un
  // AppError, no loguearlo ni en debug.
  token: string;
  tokenPrefix: string;
  tokenHash: string;
}

export function generateEmbedToken(): GeneratedEmbedToken {
  const token = EMBED_TOKEN_PREFIX + randomBytes(EMBED_TOKEN_SECRET_BYTES).toString("base64url");

  return {
    token,
    tokenPrefix: token.slice(0, EMBED_TOKEN_PREFIX_LENGTH),
    tokenHash: hashEmbedToken(token),
  };
}

// Se hashea la cadena COMPLETA, prefijo incluido, igual que hashApiKey.
export function hashEmbedToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
