import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { env } from "../config/env";
import { AppError } from "./AppError";
import { deriveKey, parseMasterKey } from "./encryption";

// ---------------------------------------------------------------------------
// El token del canal de notificaciones de Google (`X-Goog-Channel-Token`).
//
// HERMANO DE utils/oauthState.ts, no una reimplementación: misma primitiva
// (deriveKey + jose), misma forma, mismo criterio de errores. Lo único que
// cambia es el `info` de la subclave, la audiencia y el TTL. Se hizo así en vez
// de generalizar aquel archivo porque ya está mergeado y revisado, y
// parametrizarlo habría tocado el camino del callback OAuth para agregar un caso
// que no le corresponde.
//
// ---------------------------------------------------------------------------
// POR QUÉ FIRMADO Y NO UNA BÚSQUEDA EN BASE
// ---------------------------------------------------------------------------
//
// La alternativa obvia es guardar un secreto aleatorio por canal y compararlo
// contra el que llega. Funciona, y se descartó por lo mismo que en el `state` de
// OAuth: obliga a tocar Postgres ANTES de saber si el request es legítimo.
//
// Este endpoint es público y no autenticado (Google no reenvía ningún JWT), así
// que su superficie de abuso es cualquiera en internet. Con un token firmado, un
// request inválido muere en un HMAC sobre unos cientos de bytes: sin consulta,
// sin conexión del pool, sin llamada a Google. Con búsqueda en base, cada
// request basura cuesta una consulta.
//
// ---------------------------------------------------------------------------
// QUÉ CODIFICA, Y POR QUÉ LOS TRES
// ---------------------------------------------------------------------------
//
// organizationId + branchId + channelId.
//
// EL channelId ES EL QUE NO ES OBVIO y es el que cierra un agujero real: sin él,
// un token válido de la sucursal A podría reproducirse junto al header
// X-Goog-Channel-ID de la sucursal B. El handler verifica que el channelId del
// token FIRMADO coincida con el del header, así que el token queda atado a UN
// canal concreto y no solo a una sucursal.
//
// El organizationId y el branchId viajan igual aunque después se busque la
// conexión por channelId: son la afirmación firmada de a quién pertenece este
// canal, y permiten detectar que una fila cambió de dueño (no debería poder
// pasar, y si pasara sería un bug que hay que ver, no un caso a tolerar).
// ---------------------------------------------------------------------------

const ALGORITMO = "HS256";

const EMISOR = "plataforma-crm";
// Audiencia PROPIA, distinta de la del state de OAuth. Es lo que impide que un
// token de aquel flujo sirva acá y viceversa, aunque las dos subclaves salieran
// de la misma clave maestra.
const AUDIENCIA = "google-calendar-webhook";

const INFO_FIRMA = "plataforma-crm:google-webhook-token:v1";

// 8 días. TIENE QUE SOBREVIVIR AL CANAL: un canal de Google dura 604800 segundos
// = 7 días exactos (verificado contra la referencia de events.watch), y el token
// viaja en CADA notificación de ese canal, incluida la última.
//
// Con un TTL igual o menor al del canal, las notificaciones del último tramo
// llegarían con un token vencido y se rechazarían — justo las de un canal que
// nadie renovó todavía. El día de margen cubre eso sin volverlo eterno.
export const WEBHOOK_TOKEN_TTL_SEGUNDOS = 8 * 24 * 60 * 60;

export interface WebhookToken {
  organizationId: string;
  branchId: string;
  channelId: string;
}

// Perezoso y memoizado, mismo criterio que getCifrador() y la clave del state:
// SECRET_ENCRYPTION_KEY es opcional en config/env.ts para que el servidor
// arranque sin ella.
let claveDeFirma: Uint8Array | undefined;

function getClaveDeFirma(): Uint8Array {
  if (claveDeFirma) {
    return claveDeFirma;
  }

  if (!env.SECRET_ENCRYPTION_KEY) {
    throw new AppError(
      "SECRET_ENCRYPTION_KEY no está configurada en el servidor: sin ella no se puede firmar el token del canal de notificaciones",
      500,
    );
  }

  claveDeFirma = deriveKey(parseMasterKey(env.SECRET_ENCRYPTION_KEY), INFO_FIRMA);

  return claveDeFirma;
}

// La clave se pasa por parámetro opcional SOLO para los tests unitarios, igual
// que en oauthState.ts.
export async function firmarWebhookToken(datos: WebhookToken, clave?: Uint8Array): Promise<string> {
  return new SignJWT({
    organizationId: datos.organizationId,
    branchId: datos.branchId,
    channelId: datos.channelId,
  })
    .setProtectedHeader({ alg: ALGORITMO })
    .setIssuer(EMISOR)
    .setAudience(AUDIENCIA)
    .setIssuedAt()
    .setExpirationTime(`${WEBHOOK_TOKEN_TTL_SEGUNDOS}s`)
    .sign(clave ?? getClaveDeFirma());
}

// Verifica firma, vencimiento, emisor y audiencia. Lanza AppError 403 —no 401 y
// no 500— en todo camino de fallo: del otro lado no hay una identidad que pueda
// reautenticarse, hay un emisor que no probó ser Google hablando de un canal
// nuestro. 403 es "no vas a pasar", que es exactamente el caso.
//
// NO distingue entre firma inválida, manipulado y vencido en el mensaje: los
// tres son "este token no salió de acá" desde el punto de vista de quien llama,
// y detallarlo solo le diría a quien prueba en qué se equivocó. A diferencia del
// state de OAuth, acá NO hay un usuario legítimo del otro lado a quien darle un
// mensaje accionable — es una máquina.
export async function verificarWebhookToken(
  token: string,
  clave?: Uint8Array,
): Promise<WebhookToken> {
  let payload: Record<string, unknown>;

  try {
    const resultado = await jwtVerify(token, clave ?? getClaveDeFirma(), {
      // Lista explícita: sin ella `jose` aceptaría el algoritmo que declare el
      // header del token. Es la defensa contra la confusión de algoritmo.
      algorithms: [ALGORITMO],
      issuer: EMISOR,
      audience: AUDIENCIA,
    });
    payload = resultado.payload;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new AppError("El token del canal de notificaciones expiró", 403);
    }
    throw new AppError("Token del canal de notificaciones inválido", 403);
  }

  // La firma prueba que salió de acá, no que el contenido tenga la forma
  // esperada. Un token firmado con claims corruptos tiene que morir acá y no
  // tres líneas después con un channelId `undefined` llegando a una consulta.
  if (
    typeof payload.organizationId !== "string" ||
    typeof payload.branchId !== "string" ||
    typeof payload.channelId !== "string"
  ) {
    throw new AppError("Token del canal de notificaciones inválido", 403);
  }

  return {
    organizationId: payload.organizationId,
    branchId: payload.branchId,
    channelId: payload.channelId,
  };
}

// Solo para tests, mismo motivo que resetCifradorParaTests().
export function resetClaveDeWebhookParaTests(): void {
  claveDeFirma = undefined;
}
