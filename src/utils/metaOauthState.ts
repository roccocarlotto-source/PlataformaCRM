import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { env } from "../config/env";
import { AppError } from "./AppError";
import { deriveKey, parseMasterKey } from "./encryption";

// ---------------------------------------------------------------------------
// El parámetro `state` del flujo OAuth con Meta (ítem 170: la página de
// Facebook de una organización, para Instagram y Messenger).
//
// ES UN MÓDULO HERMANO DE utils/oauthState.ts, NO UNA GENERALIZACIÓN DE ÉL. Los
// motivos por los que el state es obligatorio, por qué es un JWT firmado y no
// un nonce en la base, y por qué `jose` y no un HMAC a mano están escritos
// allá y valen idénticos acá — el callback de Meta tampoco recibe el JWT de
// Supabase (Meta redirige el navegador), así que este token es LO ÚNICO que
// prueba qué organización inició la conexión.
//
// Lo que cambia, y es la razón de que sea otro archivo:
//
//   - EL PAYLOAD ES { organizationId, userId } + jti, SIN branchId: MetaPageConnection es una
//     fila por ORGANIZACIÓN (organization_id UNIQUE, ítem 169), a diferencia de
//     Google Calendar que es por sucursal. Reusar OAuthState obligaría a
//     inventar un branchId que acá no significa nada.
//   - AUDIENCIA PROPIA ("meta-oauth"). Es el claim que impide que un state
//     firmado para conectar Google sirva para completar el callback de Meta, y
//     viceversa.
//   - SUBCLAVE PROPIA (otro `info` en deriveKey). La audiencia ya separa los
//     flujos; la subclave distinta además evita que los dos compartan material
//     de firma, que es la misma disciplina que separar firma de cifrado.
//
// userId Y jti — A-07 de docs-privados/auditoria-2026-09-30-corta.md (local,
// no está en GitHub). Con solo { organizationId }, el ADMIN de B podía mandarle
// su URL de autorización legítima al dueño de la página de A: si la aceptaba,
// la página quedaba conectada a B. Desde A-07 el callback ya no canjea nada:
// rebota al CRM, y el canje lo hace un endpoint AUTENTICADO que exige que quien
// termina el flujo sea el mismo usuario (userId) de la misma organización que
// lo empezó. El jti hace que cada state sirva para un solo intento (ver
// consumirMetaState).
// ---------------------------------------------------------------------------

const ALGORITMO = "HS256";

const EMISOR = "plataforma-crm";
const AUDIENCIA = "meta-oauth";

const INFO_FIRMA = "plataforma-crm:oauth-state:meta:v1";

// 10 minutos, mismo criterio que STATE_TTL_SEGUNDOS de oauthState.ts: lo que
// tarda una persona en elegir su página y aceptar los permisos en la pantalla
// de Meta, y no más — la ventana de validez es la ventana en la que un state
// filtrado sigue siendo reproducible.
export const META_STATE_TTL_SEGUNDOS = 10 * 60;

export interface MetaOAuthState {
  organizationId: string;
  // El usuario que tocó "Conectar": el único que puede terminar el flujo.
  userId: string;
}

// Lo que devuelve la verificación: además del payload, el jti y cuándo vence,
// que es lo que necesita consumirMetaState.
export interface MetaOAuthStateVerificado extends MetaOAuthState {
  jti: string;
  expiraEnMs: number;
}

// Perezoso y memoizado, mismo criterio que getCifrador(): SECRET_ENCRYPTION_KEY
// es opcional en config/env.ts para que el servidor arranque sin ella.
let claveDeFirma: Uint8Array | undefined;

function getClaveDeFirma(): Uint8Array {
  if (claveDeFirma) {
    return claveDeFirma;
  }

  if (!env.SECRET_ENCRYPTION_KEY) {
    // isOperational: false — nombra una variable de entorno (M-11 b).
    throw new AppError(
      "SECRET_ENCRYPTION_KEY no está configurada en el servidor: sin ella no se puede firmar el state del flujo OAuth de Meta",
      500,
      false,
    );
  }

  claveDeFirma = deriveKey(parseMasterKey(env.SECRET_ENCRYPTION_KEY), INFO_FIRMA);

  return claveDeFirma;
}

// La clave por parámetro opcional existe SOLO para los tests unitarios, mismo
// motivo que en firmarState().
export async function firmarMetaState(state: MetaOAuthState, clave?: Uint8Array): Promise<string> {
  return new SignJWT({ organizationId: state.organizationId, userId: state.userId })
    .setProtectedHeader({ alg: ALGORITMO })
    .setJti(randomUUID())
    .setIssuer(EMISOR)
    .setAudience(AUDIENCIA)
    .setIssuedAt()
    .setExpirationTime(`${META_STATE_TTL_SEGUNDOS}s`)
    .sign(clave ?? getClaveDeFirma());
}

// Verifica firma, vencimiento, emisor y audiencia. 400 en todos los caminos de
// fallo, por el mismo razonamiento que verificarState() (V-1 de
// docs-privados/auditoria-2026-08-29.md (local, no está en GitHub)): el state lo trae el navegador de una persona
// como parámetro del request; no es una credencial de API (401) ni hay una
// máquina a la que cerrarle la puerta (403). Y, como allá, "firma inválida" y
// "manipulado" comparten mensaje; solo el vencimiento —lo único que le pasa a
// un usuario legítimo— tiene uno propio y accionable.
export async function verificarMetaState(
  token: string,
  clave?: Uint8Array,
): Promise<MetaOAuthStateVerificado> {
  let payload: Record<string, unknown>;

  try {
    const resultado = await jwtVerify(token, clave ?? getClaveDeFirma(), {
      // Lista explícita contra la confusión de algoritmo; ver oauthState.ts.
      algorithms: [ALGORITMO],
      issuer: EMISOR,
      audience: AUDIENCIA,
    });
    payload = resultado.payload;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new AppError(
        "La conexión con Facebook expiró antes de completarse. Volvé a iniciarla desde el CRM.",
        400,
      );
    }
    throw new AppError("El parámetro state es inválido", 400);
  }

  // Un state firmado antes de A-07 no trae userId ni jti: se rechaza como
  // cualquier otro inválido (vivía 10 minutos, no hay nada que migrar).
  if (
    typeof payload.organizationId !== "string" ||
    typeof payload.userId !== "string" ||
    typeof payload.jti !== "string" ||
    typeof payload.exp !== "number"
  ) {
    throw new AppError("El parámetro state es inválido", 400);
  }

  return {
    organizationId: payload.organizationId,
    userId: payload.userId,
    jti: payload.jti,
    expiraEnMs: payload.exp * 1000,
  };
}

// ---------------------------------------------------------------------------
// UN SOLO USO POR STATE (A-07). Sin esto, un mismo state disparaba canjes
// ilimitados contra Meta durante sus 10 minutos.
//
// EN MEMORIA Y NO EN LA BASE, a propósito: el backend es un solo proceso (G-04
// del 24/09), y lo que se protege dura 10 minutos. Si el proceso reinicia en
// esa ventana, el registro se pierde y un state ya usado vuelve a pasar este
// chequeo — pero sigue atado a su usuario, y el `code` que viaja con él Meta
// lo acepta una sola vez. Persistirlo exigiría una tabla (migración) para
// cubrir ese hueco.
//
// Se consume ANTES de canjear: un intento que falla a mitad de camino gasta el
// state, y reintentar es volver a tocar "Conectar", que firma uno nuevo.
// ---------------------------------------------------------------------------
const statesUsados = new Map<string, number>();

// true si el jti no se había usado (y queda marcado); false si ya se usó.
// Síncrona de punta a punta: entre el has() y el set() no hay un await, así
// que dos requests con el mismo state no pueden pasar los dos.
export function consumirMetaState(
  state: Pick<MetaOAuthStateVerificado, "jti" | "expiraEnMs">,
  ahoraMs: number = Date.now(),
): boolean {
  for (const [jti, expira] of statesUsados) {
    if (expira <= ahoraMs) statesUsados.delete(jti);
  }
  if (statesUsados.has(state.jti)) return false;
  statesUsados.set(state.jti, state.expiraEnMs);
  return true;
}

// Solo para tests.
export function resetStatesUsadosParaTests(): void {
  statesUsados.clear();
}

// Solo para tests, mismo motivo que resetClaveDeFirmaParaTests() de oauthState.
export function resetClaveDeFirmaMetaParaTests(): void {
  claveDeFirma = undefined;
}
