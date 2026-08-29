import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";
import type { JwtPayload } from "../types/auth";
import { logger } from "./logger";

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

  jwks = createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));

  return jwks;
}

// ---------------------------------------------------------------------------
// A-3 (docs/auditoria-2026-08-29.md; el ALTO-4 del 21/08 que seguía abierto):
// "este token es inválido" y "no pudimos verificar nada" NO SON EL MISMO 401.
//
// Antes, el catch alrededor de jwtVerify distinguía JWTExpired de "todo lo
// demás", y "todo lo demás" incluía un timeout contra el endpoint JWKS de
// Supabase, un `kid` que el JWKS todavía no publica, o la red caída. El
// resultado era que si /.well-known/jwks.json dejaba de responder, TODOS los
// requests autenticados del sistema devolvían 401 —el frontend lo interpreta
// como sesión inválida y desloguea a todo el mundo— y el error real no
// quedaba en ningún log.
//
// LA DISTINCIÓN, VERIFICADA CONTRA jose@6.2.3 (dist/webapi/jwks/remote.js y
// util/errors.js), no asumida:
//
//   EL TOKEN ES INVÁLIDO (culpa de quien llama → 401, sin log):
//     - JWTExpired                    vencido (mensaje propio, como antes)
//     - JWTClaimValidationFailed      un claim no cumple (nbf, iat futuro…)
//     - JWTInvalid / JWSInvalid       no es un JWT/JWS bien formado
//     - JWSSignatureVerificationFailed la firma no verifica con la clave
//     - JOSEAlgNotAllowed             alg fuera de ["ES256"] (la anon key
//                                     legacy HS256, por ejemplo)
//     - JOSENotSupported              alg/curva que el runtime no conoce
//
//   NO SE PUDO VERIFICAR (culpa nuestra o de Supabase → 503 + logger.error):
//     - JWKSTimeout                   fetch del JWKS abortado por timeout
//                                     (jose lo lanza SOLO ante err.name ===
//                                     "TimeoutError")
//     - TypeError "fetch failed" y cualquier otro error de red: jose lo
//       RELANZA CRUDO, no lo envuelve — por eso la regla de abajo no puede ser
//       "instanceof JOSEError".
//     - JOSEError genérico (ERR_JOSE_GENERIC): el JWKS respondió algo que no
//       es 200, o un cuerpo que no es JSON. No tiene subclase propia.
//     - JWKSInvalid / JWKInvalid / JWKSMultipleMatchingKeys: el JWKS que
//       publica Supabase está roto o es ambiguo. No es el token.
//     - JWKSNoMatchingKey — VER LA NOTA DE ABAJO.
//     - Y cualquier clase que jose agregue en el futuro: por defecto cae acá,
//       con log. Un 401 silencioso es el modo de fallo que este archivo
//       existe para eliminar; un 503 logueado de más se ve y se corrige.
//
// NOTA SOBRE JWKSNoMatchingKey — ES EL ÚNICO CASO AMBIGUO, y se decide a
// favor del usuario legítimo. jose ya recarga el JWKS por su cuenta cuando ve
// un `kid` que no conoce (remote.js: getKey → reload, salvo dentro del
// cooldown de 30 s posterior a la última recarga). Así que cuando este error
// llega acá pasó una de dos cosas: (a) Supabase rotó la clave y el JWKS no la
// publicó todavía, o la recarga cayó dentro del cooldown — transitorio, el
// cliente tiene que reintentar, no desloguearse; o (b) el token está firmado
// con una clave que este proyecto no tiene: forjado, o de otro proyecto de
// Supabase — inválido. Un 401 en (a) es exactamente el deslogueo masivo de
// A-3; un 503 en (b) le da a un atacante una respuesta distinta y una línea
// de log por request. Se prefiere pagar (b) —que solo cuesta ruido en el log
// y no le abre nada a nadie— antes que (a). Si el ruido aparece, el cambio es
// mover la clase a la lista de arriba.
//
// 503 Y NO 500: es el código que el proyecto ya usa para "fallo transitorio,
// no es culpa de quien llama, conviene reintentar" — el webhook de Google
// Calendar responde 503 para que Google reintente, y /health responde 503 con
// la base caída. Un 500 diría "bug"; acá no lo hay.
// ---------------------------------------------------------------------------

// Las clases que significan "ESTE token no sirve". Lista explícita y cerrada
// a propósito: todo lo que no esté acá es un fallo nuestro hasta que se
// demuestre lo contrario.
const ERRORES_DEL_TOKEN = [
  joseErrors.JWTClaimValidationFailed,
  joseErrors.JWTInvalid,
  joseErrors.JWSInvalid,
  joseErrors.JWSSignatureVerificationFailed,
  joseErrors.JOSEAlgNotAllowed,
  joseErrors.JOSENotSupported,
] as const;

// Exportada para poder fijar la clasificación con tests unitarios sin red:
// la tabla de arriba es una decisión, y una decisión sin test se pudre.
export function esErrorDelToken(err: unknown): boolean {
  return ERRORES_DEL_TOKEN.some((clase) => err instanceof clase);
}

// La verificación propiamente dicha, con el resolutor de claves inyectado.
// Producción le pasa el JWKS remoto de Supabase (verifySupabaseJwt, abajo); el
// test unitario le pasa una clave local o una función que falla como fallaría
// el JWKS. Es lo que permite probar "el JWKS no responde" sin tumbar ningún
// JWKS de verdad — mismo criterio que el `fetch` inyectable del cliente de
// Google Calendar.
export async function verifySupabaseJwtWith(
  token: string,
  getKey: JWTVerifyGetKey,
): Promise<JwtPayload> {
  let payload: Record<string, unknown>;

  try {
    const result = await jwtVerify(token, getKey, {
      algorithms: ["ES256"],
    });
    payload = result.payload;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new AppError("El token expiró", 401);
    }

    if (esErrorDelToken(err)) {
      throw new AppError("Token inválido", 401);
    }

    // Todo lo demás es infraestructura: el error original va al log ENTERO,
    // porque antes se perdía y era imposible distinguir "Supabase caído" de
    // "alguien mandó basura" mirando la salida del servidor.
    logger.error(
      { err },
      "No se pudo verificar el JWT: falló la obtención o el uso del JWKS, no el token. Se responde 503",
    );
    throw new AppError(
      "No se pudo verificar la sesión en este momento. Probá de nuevo en unos segundos.",
      503,
    );
  }

  if (typeof payload.sub !== "string") {
    throw new AppError("Token inválido: falta el identificador del usuario", 401);
  }

  return {
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    exp: typeof payload.exp === "number" ? payload.exp : 0,
    iat: typeof payload.iat === "number" ? payload.iat : undefined,
    aud: payload.aud as string | string[] | undefined,
  };
}

// Verifica firma y expiración del JWT emitido por Supabase Auth. No emite
// tokens propios, no toca Postgres — solo prueba identidad (principio rector
// de docs/authentication-architecture.md).
//
// getJwks() queda FUERA del try de arriba: su AppError(500) por SUPABASE_URL
// ausente es un error de configuración y tiene que salir como tal, no
// disfrazado de 401 (que era lo que pasaba antes, con la llamada adentro del
// try).
export async function verifySupabaseJwt(token: string): Promise<JwtPayload> {
  return verifySupabaseJwtWith(token, getJwks());
}
