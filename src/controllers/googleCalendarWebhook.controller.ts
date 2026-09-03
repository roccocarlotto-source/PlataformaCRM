import type { Request, Response } from "express";
import { logger } from "../lib/logger";
import { procesarNotificacion } from "../services/googleCalendarSync.service";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";
import { STATUS_TOKEN_DE_CANAL_INVALIDO } from "../utils/webhookToken";

// ---------------------------------------------------------------------------
// POST /api/webhooks/google-calendar — el receptor de notificaciones push.
//
// SIN authenticate Y SIN AuthenticatedRequest, por el mismo motivo estructural
// que el callback OAuth: Google hace este POST desde su infraestructura y no
// reenvía ningún JWT. Lo único que autentica la notificación es el token firmado
// que viaja en X-Goog-Channel-Token, y lo verifica el service ANTES de tocar la
// base (ver googleCalendarSync.service.ts).
//
// ---------------------------------------------------------------------------
// EL CUERPO DEL POST VIENE VACÍO, Y NO ES UN DETALLE
// ---------------------------------------------------------------------------
//
// Textual en la guía de push de Google: "Notification messages posted by the
// Calendar API to your receiving URL don't include a message body. These
// messages don't contain specific information about updated resources; you must
// make another API call to see full change details."
//
// O sea: la notificación dice "algo cambió en este canal" y nada más. QUÉ cambió
// hay que ir a buscarlo con events.list. Por eso este handler no parsea ningún
// cuerpo y todo lo que necesita sale de los HEADERS.
//
// ---------------------------------------------------------------------------
// LOS CÓDIGOS DE RESPUESTA SON EL MECANISMO DE REINTENTO
// ---------------------------------------------------------------------------
//
// No hay cola propia ni reintentos propios acá, y es deliberado: Google YA
// reintenta la entrega con backoff cuando la respuesta es un error del
// servidor. Construir un outbox para esto sería duplicar un mecanismo que el
// proveedor ya provee, para un volumen (negocios chicos, pocos cambios por
// día) que no lo justifica.
//
// LA SEMÁNTICA EXACTA, corregida en V-1 (docs/auditoria-2026-08-29.md) contra
// la guía de push de Calendar — antes este bloque decía que Google reintentaba
// "cuando la respuesta no es 2xx", y no es así: reintenta con backoff SOLO ante
// 500, 502, 503 o 504; "every other return status code is considered to be a
// message failure". Un 4xx NO se reintenta.
//
//   200 -> procesado, o no hay nada que hacer. Google no reintenta. Incluye
//          DOS casos que no son "procesado" y que se responden 200 a propósito:
//          el canal desconocido y la conexión que no está activa (abajo).
//   403 -> el token no salió de acá. Google NO reintenta (es un 4xx) y la
//          notificación queda como fallida: no se acepta un canal espurio en
//          silencio, ni se le da a un emisor falso el reintento de un 5xx.
//   5xx -> algo se rompió de nuestro lado (Google caído, base caída). Google
//          reintenta, que es exactamente lo que queremos.
//
// EL CASO QUE MÁS IMPORTA ES EL 200 DEL "canal desconocido": un canal que ya no
// está en la base (se reemplazó, o la sucursal se desconectó) NO puede devolver
// 5xx — Google reintentaría con backoff una notificación que nunca vamos a poder
// procesar, y el canal seguiría vivo hasta vencer. Se responde 200 y se loguea.
//
// EL MISMO CRITERIO APLICA A LA CONEXIÓN QUE NO ESTÁ ACTIVA (M-4 de
// docs/auditoria-2026-08-29.md): findConnectionByChannelId no filtra por status,
// así que un canal cuya conexión está en ERROR se sigue encontrando, y
// obtenerAccessToken tira AppError(409) —"hay que reconectar"— en cada
// notificación. Ese 409 NO es transitorio: exige que un humano reconecte la
// sucursal desde la UI. Se responde 200 para cortar el reintento de Google; el
// canal sigue vivo del lado de Google hasta que alguien reconecte, a propósito.
// ---------------------------------------------------------------------------

// Los nombres de los headers, verificados contra la guía de push. Express los
// normaliza a minúsculas.
const HEADER_CHANNEL_ID = "x-goog-channel-id";
const HEADER_CHANNEL_TOKEN = "x-goog-channel-token";
const HEADER_RESOURCE_STATE = "x-goog-resource-state";
const HEADER_MESSAGE_NUMBER = "x-goog-message-number";

function leerHeader(req: Request, nombre: string): string | undefined {
  const valor = req.headers[nombre];
  return typeof valor === "string" ? valor : undefined;
}

export const googleCalendarWebhookHandler = asyncHandler<Request>(async (req, res: Response) => {
  const channelId = leerHeader(req, HEADER_CHANNEL_ID);
  const token = leerHeader(req, HEADER_CHANNEL_TOKEN);
  const resourceState = leerHeader(req, HEADER_RESOURCE_STATE);

  // Sin estos tres no hay nada que procesar y no puede ser Google. 400 sin
  // tocar nada: es la defensa más barata posible, antes incluso del HMAC.
  if (!channelId || !token || !resourceState) {
    res.status(400).json({ error: { message: "Faltan headers de notificación de Google" } });
    return;
  }

  try {
    const resultado = await procesarNotificacion({ channelId, resourceState, token });

    // Solo se loguea lo que produjo un efecto o lo que llama la atención. Una
    // notificación sin cambios es la mayoría del tráfico de este endpoint y
    // loguearla llenaría el log de ruido.
    if (resultado.bookingsCancelados > 0 || resultado.eventosMovidos > 0) {
      logger.info(
        {
          channelId,
          accion: resultado.accion,
          bookingsCancelados: resultado.bookingsCancelados,
          eventosMovidos: resultado.eventosMovidos,
          mensaje: leerHeader(req, HEADER_MESSAGE_NUMBER),
        },
        "Notificación de Google Calendar procesada",
      );
    }

    res.status(200).end();
  } catch (err) {
    // 403: el token no salió de acá. No es transitorio.
    //
    // SE DESPACHA POR EL VALOR NUMÉRICO DEL STATUS, y por eso el número viene
    // de la misma constante que webhookToken.ts usa para lanzarlo (V-1 de
    // docs/auditoria-2026-08-29.md): si aquel archivo cambiara su status y
    // este `if` siguiera comparando contra un literal, un token FALSIFICADO
    // dejaría de matchear acá en silencio y caería al 503 de abajo — y Google
    // reintentaría con backoff, durante días, una notificación que nunca va a
    // poder procesar. Los tests de integración de este controller afirman el
    // 403 por HTTP; la constante compartida es lo que hace que no haya dos
    // lugares que puedan divergir.
    if (err instanceof AppError && err.statusCode === STATUS_TOKEN_DE_CANAL_INVALIDO) {
      logger.warn({ channelId }, "Notificación con token de canal inválido: se rechaza");
      res.status(STATUS_TOKEN_DE_CANAL_INVALIDO).json({ error: { message: err.message } });
      return;
    }

    // 409: la conexión no está activa (ERROR, o un grant que Google acaba de
    // invalidar — ver obtenerAccessToken en googleCalendarConnection.service.ts).
    // A diferencia de un 409 transitorio, ESTE no se resuelve solo: exige que un
    // humano reconecte la sucursal desde la UI. Responder 503 haría que Google
    // reintentara con backoff durante días (hasta 7, según su documentación) una
    // notificación que nunca vamos a poder procesar, y llenaría el log de errores
    // por una condición ya conocida (M-4 de docs/auditoria-2026-08-29.md). Se
    // responde 200 para cortar el reintento — el canal de Google sigue vivo hasta
    // que alguien reconecte la sucursal, a propósito: cerrarlo contra Google
    // (channels.stop) queda fuera de este fix. warn y no error, por el mismo
    // criterio que el "canal desconocido" del service: condición conocida, no
    // incidente.
    if (err instanceof AppError && err.statusCode === 409) {
      logger.warn(
        { channelId, err },
        "Notificación para una conexión que no está activa: se ignora hasta que alguien reconecte la sucursal",
      );
      res.status(200).end();
      return;
    }

    // TODO LO DEMÁS ES 503 A PROPÓSITO, incluidos los AppError con otro
    // status (salvo el 403 y el 409 de arriba). Un 502 de Google caído o una
    // base caída son condiciones que pueden resolverse solas, y devolver el
    // status original haría que Google dejara de reintentar en los casos 4xx —
    // o sea que perderíamos la notificación por algo temporal.
    //
    // Se loguea con el error completo: es la única forma de enterarse de por
    // qué falló, porque la respuesta no lleva detalle hacia un endpoint
    // público.
    logger.error(
      { err, channelId, resourceState },
      "Falló el procesamiento de una notificación de Google Calendar; se responde 503 para que Google reintente",
    );

    res.status(503).json({ error: { message: "No se pudo procesar la notificación" } });
  }
});
