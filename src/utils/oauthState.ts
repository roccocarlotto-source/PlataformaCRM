import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { env } from "../config/env";
import { AppError } from "./AppError";
import { deriveKey, parseMasterKey } from "./encryption";

// ---------------------------------------------------------------------------
// El parámetro `state` del flujo OAuth 2.0 con Google.
//
// ---------------------------------------------------------------------------
// POR QUÉ ES OBLIGATORIO Y NO UN EXTRA
// ---------------------------------------------------------------------------
//
// El callback de Google (GET /api/integrations/google-calendar/callback) es el
// único endpoint de escritura de este módulo QUE NO PUEDE ESTAR AUTENTICADO. No
// es una decisión: Google redirige el navegador del usuario a esa URL y no
// reenvía el header Authorization del CRM. No hay JWT que leer, no hay
// req.auth.organizationId, no hay authorize("ADMIN") posible.
//
// Sin `state`, entonces, cualquiera en internet podría hacer un GET a esa URL
// con un `code` propio y un branchId ajeno, y el sistema conectaría LA CUENTA DE
// GOOGLE DEL ATACANTE a la sucursal de otra organización — o, al revés, la
// cuenta de Google de la víctima a una sucursal del atacante. Es CSRF de manual,
// y en este flujo el daño no es "una acción no querida" sino un cruce de
// tenants.
//
// EL `state` ES LO ÚNICO QUE SOSTIENE ESA FRONTERA. Quien complete el callback
// tiene que ser criptográficamente la misma sucursal que inició la conexión, y
// eso se prueba con la firma, no con lo que venga en la query string.
//
// ---------------------------------------------------------------------------
// POR QUÉ UN JWT FIRMADO Y NO UN NONCE GUARDADO EN LA BASE
// ---------------------------------------------------------------------------
//
// La alternativa clásica es generar un nonce aleatorio, guardarlo en una tabla
// con su organizationId/branchId y su vencimiento, y buscarlo en el callback. Es
// correcta, y se descartó por costo: agrega una tabla, su migración, su
// escritura por cada intento de conexión y su purga de filas vencidas — todo
// para transportar dos UUIDs y un vencimiento entre dos requests.
//
// Un token firmado hace lo mismo sin estado: los datos VIAJAN en el token y la
// firma prueba que salieron de acá. Es autocontenido y no deja nada que limpiar.
//
// LO QUE SE PIERDE, y queda escrito para que nadie lo descubra tarde: un `state`
// firmado NO ES DE UN SOLO USO. Dentro de su ventana de validez se puede
// reproducir. No es un agujero en este flujo —reproducirlo exige además un
// `code` de Google válido y sin usar, y Google los invalida al canjearlos— pero
// es la propiedad que sí daría la tabla, y la que habría que agregar si algún
// día el callback hiciera algo más que canjear un código.
//
// ---------------------------------------------------------------------------
// POR QUÉ jose Y NO UN HMAC A MANO
// ---------------------------------------------------------------------------
//
// Se buscó primero qué había en el repo. lib/jwt.ts NO SIRVE para esto: solo
// VERIFICA los JWT que emite Supabase (ES256, contra un JWKS remoto), no firma
// nada, y su clave privada es de Supabase — este backend no la tiene ni debería.
//
// Lo que sí se reusa es la librería que aquel ya usa: `jose`, que es dependencia
// del proyecto desde el arranque. Trae la firma HS256, la validación de `exp`,
// `iss` y `aud`, y la comparación en tiempo constante del tag. Escribir el HMAC
// a mano habría significado escribir también el formato, el vencimiento y una
// comparación que no filtre por timing — tres oportunidades de equivocarse en
// silencio, ninguna de ellas parte del problema que hay que resolver.
//
// LA CLAVE SE DERIVA de la misma SECRET_ENCRYPTION_KEY, con un `info` distinto
// (ver utils/encryption.ts): firmar y cifrar con el mismo material crudo es
// reutilización que ninguna de las dos primitivas promete resistir, y una
// segunda variable de entorno era una cosa más que configurar mal.
// ---------------------------------------------------------------------------

const ALGORITMO = "HS256";

// `iss` y `aud` no son decoración. La subclave de firma es una sola, así que sin
// ellos un token emitido para OTRO propósito futuro que use la misma subclave
// sería aceptado acá con solo tener los claims correctos. Fijarlos ata este
// token a este flujo.
const EMISOR = "plataforma-crm";
const AUDIENCIA = "google-calendar-oauth";

const INFO_FIRMA = "plataforma-crm:oauth-state:v1";

// 10 minutos. Es el tiempo que le lleva a una persona ver la pantalla de
// consentimiento de Google, elegir una cuenta y aceptar — con margen para dudar.
//
// CORTO A PROPÓSITO: la ventana de validez es exactamente la ventana en la que
// un `state` filtrado (del historial del navegador, de un Referer, de un log de
// un proxy) sigue siendo reproducible. Alargarlo no mejora ningún caso de uso
// real y agranda esa ventana linealmente.
export const STATE_TTL_SEGUNDOS = 10 * 60;

export interface OAuthState {
  organizationId: string;
  branchId: string;
}

// Perezoso y memoizado, mismo criterio que getCifrador(): SECRET_ENCRYPTION_KEY
// es opcional en config/env.ts para que el servidor arranque sin ella.
let claveDeFirma: Uint8Array | undefined;

function getClaveDeFirma(): Uint8Array {
  if (claveDeFirma) {
    return claveDeFirma;
  }

  if (!env.SECRET_ENCRYPTION_KEY) {
    throw new AppError(
      "SECRET_ENCRYPTION_KEY no está configurada en el servidor: sin ella no se puede firmar el state del flujo OAuth",
      500,
    );
  }

  claveDeFirma = deriveKey(parseMasterKey(env.SECRET_ENCRYPTION_KEY), INFO_FIRMA);

  return claveDeFirma;
}

// Firma el estado que viaja hasta Google y vuelve. La clave se pasa por
// parámetro opcional SOLO para los tests unitarios, que así no dependen del
// entorno — mismo motivo por el que crearCifrador() es una factory.
export async function firmarState(state: OAuthState, clave?: Uint8Array): Promise<string> {
  return new SignJWT({ organizationId: state.organizationId, branchId: state.branchId })
    .setProtectedHeader({ alg: ALGORITMO })
    .setIssuer(EMISOR)
    .setAudience(AUDIENCIA)
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_SEGUNDOS}s`)
    .sign(clave ?? getClaveDeFirma());
}

// Verifica firma, vencimiento, emisor y audiencia, y devuelve el estado. Lanza
// AppError 400 —no 500— en todos los caminos de fallo: un state inválido o
// vencido es un problema del request, no del servidor.
//
// EL 400 NO DISTINGUE entre "firma inválida" y "manipulado": los dos son "este
// state no salió de acá" y darle a cada uno su mensaje solo le diría a quien
// prueba en qué se equivocó. El vencimiento SÍ es un mensaje aparte, porque es
// el único fallo que le puede pasar a un usuario legítimo (dejó la pestaña
// abierta) y su respuesta es accionable: volver a empezar.
export async function verificarState(token: string, clave?: Uint8Array): Promise<OAuthState> {
  let payload: Record<string, unknown>;

  try {
    const resultado = await jwtVerify(token, clave ?? getClaveDeFirma(), {
      // Lista explícita: sin ella, `jose` aceptaría cualquier algoritmo que el
      // header del token declare. Es la defensa contra el ataque clásico de
      // confusión de algoritmo, donde el atacante elige el alg.
      algorithms: [ALGORITMO],
      issuer: EMISOR,
      audience: AUDIENCIA,
    });
    payload = resultado.payload;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new AppError(
        "La conexión con Google expiró antes de completarse. Volvé a iniciarla desde el CRM.",
        400,
      );
    }
    throw new AppError("El parámetro state es inválido", 400);
  }

  // La firma prueba que el token salió de acá, no que su contenido tenga la
  // forma esperada. Un token firmado con claims corruptos (por un bug de una
  // versión anterior, por ejemplo) tiene que morir acá y no tres líneas después
  // con un organizationId `undefined` llegando a una consulta.
  if (typeof payload.organizationId !== "string" || typeof payload.branchId !== "string") {
    throw new AppError("El parámetro state es inválido", 400);
  }

  return { organizationId: payload.organizationId, branchId: payload.branchId };
}

// Solo para tests, mismo motivo que resetCifradorParaTests().
export function resetClaveDeFirmaParaTests(): void {
  claveDeFirma = undefined;
}
