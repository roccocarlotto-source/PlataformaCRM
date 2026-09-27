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
//   - EL PAYLOAD ES { organizationId } SIN branchId: MetaPageConnection es una
//     fila por ORGANIZACIÓN (organization_id UNIQUE, ítem 169), a diferencia de
//     Google Calendar que es por sucursal. Reusar OAuthState obligaría a
//     inventar un branchId que acá no significa nada.
//   - AUDIENCIA PROPIA ("meta-oauth"). Es el claim que impide que un state
//     firmado para conectar Google sirva para completar el callback de Meta, y
//     viceversa.
//   - SUBCLAVE PROPIA (otro `info` en deriveKey). La audiencia ya separa los
//     flujos; la subclave distinta además evita que los dos compartan material
//     de firma, que es la misma disciplina que separar firma de cifrado.
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
  return new SignJWT({ organizationId: state.organizationId })
    .setProtectedHeader({ alg: ALGORITMO })
    .setIssuer(EMISOR)
    .setAudience(AUDIENCIA)
    .setIssuedAt()
    .setExpirationTime(`${META_STATE_TTL_SEGUNDOS}s`)
    .sign(clave ?? getClaveDeFirma());
}

// Verifica firma, vencimiento, emisor y audiencia. 400 en todos los caminos de
// fallo, por el mismo razonamiento que verificarState() (V-1 de
// docs/auditoria-2026-08-29.md): el state lo trae el navegador de una persona
// como parámetro del request; no es una credencial de API (401) ni hay una
// máquina a la que cerrarle la puerta (403). Y, como allá, "firma inválida" y
// "manipulado" comparten mensaje; solo el vencimiento —lo único que le pasa a
// un usuario legítimo— tiene uno propio y accionable.
export async function verificarMetaState(
  token: string,
  clave?: Uint8Array,
): Promise<MetaOAuthState> {
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

  if (typeof payload.organizationId !== "string") {
    throw new AppError("El parámetro state es inválido", 400);
  }

  return { organizationId: payload.organizationId };
}

// Solo para tests, mismo motivo que resetClaveDeFirmaParaTests() de oauthState.
export function resetClaveDeFirmaMetaParaTests(): void {
  claveDeFirma = undefined;
}
