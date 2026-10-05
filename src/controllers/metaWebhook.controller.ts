import type { NextFunction, Request, RequestHandler, Response } from "express";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { firmaDeMetaValida } from "../middlewares/metaWebhookBody";
import { secretsMatch } from "../middlewares/requireInternalProxySecret";
import {
  hayQueReintentarElLote,
  metaWebhookPayloadSchema,
  procesarWebhookDeMeta,
  type MetaWebhookPayload,
  type ResumenDelLote,
} from "../services/metaWebhook.service";
import { AppError } from "../utils/AppError";
import { STATUS_PARA_QUE_META_REINTENTE } from "../utils/falloDeEntrante";
import { asyncHandler } from "../utils/asyncHandler";

// ---------------------------------------------------------------------------
// GET y POST /webhooks/meta — la entrada de Messenger e Instagram (ítem 171,
// paso 3 de 5 de los canales de Meta). El calco de
// whatsappWebhook.controller.ts; ver ahí el porqué de cada decisión (sin
// authenticate, orden de la cadena, secretos por factory).
//
// UN SOLO ENDPOINT PARA LOS DOS CANALES: Meta manda object "page" (Messenger)
// u object "instagram" a la URL que se cargue en cada producto, y el fork es
// por `payload.object` adentro del service.
//
// LA DIFERENCIA CON WHATSAPP: sin accessToken en las deps. En WhatsApp el
// token de envío es uno solo, del entorno, y la firma exige que esté para no
// encolar turnos que el worker no podría contestar. Acá el token es el de la
// página de CADA organización (MetaPageConnection, ítem 170) y lo usa el envío
// del ítem 172; el webhook no tiene nada que chequear de antemano.
// ---------------------------------------------------------------------------

export interface MetaWebhookDeps {
  verifyToken: () => string | undefined;
  appSecret: () => string | undefined;
  // Solo para tests: el procesamiento del lote, para simular que la base no
  // respondió al guardar un mensaje. Producción usa procesarWebhookDeMeta.
  procesar?: (payload: MetaWebhookPayload) => Promise<ResumenDelLote>;
}

// META_APP_SECRET y no una variable propia: es el mismo App Secret con el que
// el OAuth del ítem 170 habla con Meta. Solo el verify token es de este
// webhook (ver env.ts).
export const metaWebhookDepsReales: MetaWebhookDeps = {
  verifyToken: () => env.META_WEBHOOK_VERIFY_TOKEN,
  appSecret: () => env.META_APP_SECRET,
};

function leerQuery(req: Request, nombre: string): string | undefined {
  const valor = req.query[nombre];
  return typeof valor === "string" ? valor : undefined;
}

// GET — el handshake, idéntico al de WhatsApp: challenge CRUDO en text/plain,
// secretsMatch para el verify token (largo variable), y 500 operacional si el
// token no está configurado.
export function createMetaVerificationHandler(deps: MetaWebhookDeps): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const verifyToken = deps.verifyToken();
    if (!verifyToken) {
      next(new AppError("Falta META_WEBHOOK_VERIFY_TOKEN en el entorno", 500, false));
      return;
    }

    const mode = leerQuery(req, "hub.mode");
    const token = leerQuery(req, "hub.verify_token");
    const challenge = leerQuery(req, "hub.challenge");

    if (mode !== "subscribe" || token === undefined || !secretsMatch(token, verifyToken)) {
      logger.warn("Handshake del webhook de Meta rechazado: modo o verify token incorrecto");
      res.status(403).type("text/plain").send("Forbidden");
      return;
    }

    res
      .status(200)
      .type("text/plain")
      .send(challenge ?? "");
  };
}

// POST, paso 2 de la cadena: la firma con META_APP_SECRET. Sin el secreto,
// 500 que lo nombra (y Meta reintenta mientras la configuración esté rota);
// firma ausente o que no coincide, 401.
export function createVerifyMetaSignature(deps: MetaWebhookDeps): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const appSecret = deps.appSecret();
    if (!appSecret) {
      next(new AppError("Falta META_APP_SECRET en el entorno", 500, false));
      return;
    }

    if (!firmaDeMetaValida(req, appSecret)) {
      logger.warn("Webhook de Meta rechazado: firma ausente o inválida");
      next(new AppError("Firma inválida", 401));
      return;
    }

    next();
  };
}

// POST, paso 3: 200 cuando todo lo del lote quedó guardado; 503 si un mensaje
// no se pudo guardar, para que Meta lo reentregue — mismo criterio que
// WhatsApp (ver createWhatsappWebhookHandler y utils/falloDeEntrante.ts).
export function createMetaWebhookHandler(
  deps: Pick<MetaWebhookDeps, "procesar"> = {},
): RequestHandler {
  const procesar = deps.procesar ?? procesarWebhookDeMeta;
  return asyncHandler<Request>(async (req, res: Response) => {
    const parsed = metaWebhookPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn("Webhook de Meta con un cuerpo que no tiene la forma esperada");
      res.status(400).json({ error: { message: "Payload de webhook inválido" } });
      return;
    }

    const resumen = await procesar(parsed.data);
    if (hayQueReintentarElLote(resumen)) {
      logger.error(
        { object: parsed.data.object, resumen },
        "Webhook de Meta con mensajes sin guardar: se le pide a Meta que reintente",
      );
      res
        .status(STATUS_PARA_QUE_META_REINTENTE)
        .json({ error: { message: "No se pudo guardar el lote completo" } });
      return;
    }
    logger.info({ object: parsed.data.object, resumen }, "Webhook de Meta procesado");

    res.status(200).json({ ok: true });
  });
}
