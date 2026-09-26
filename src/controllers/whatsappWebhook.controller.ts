import type { NextFunction, Request, RequestHandler, Response } from "express";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { secretsMatch } from "../middlewares/requireInternalProxySecret";
import {
  procesarWebhookDeWhatsapp,
  whatsappWebhookPayloadSchema,
} from "../services/whatsappWebhook.service";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";
import { hmacSha256Hex, timingSafeEqual } from "../utils/hmac";

// ---------------------------------------------------------------------------
// GET y POST /webhooks/whatsapp — el canal WhatsApp del módulo de Agentes de
// IA (ítem 81; paso 6 de §9 de docs/ai-agent-architecture.md).
//
// SIN authenticate: lo llama Meta, no un cliente nuestro. El GET se autentica
// con el verify token (un string que elegimos nosotros y cargamos en el panel
// de Meta); el POST con la firma HMAC de Meta sobre el cuerpo crudo.
//
// EL ORDEN DE LA CADENA: Meta firma el CUERPO CRUDO COMPLETO, así que hay que
// leerlo primero —con un parser que guarde los bytes tal cual llegaron (ver
// routes/whatsappWebhook.routes.ts)— y recién después verificar. El parser
// tiene un tope chico justamente porque corre antes de saber quién manda.
//
// Los secretos se inyectan por factory: producción los toma del entorno; los
// tests le pasan secretos conocidos y ejercitan la MISMA cadena por HTTP real. El cliente de
// la Graph API ya no está acá: desde el ítem 125 la respuesta la manda el
// worker de la cola (src/workers/agentInboundWorker.ts), no el webhook.
// ---------------------------------------------------------------------------

export interface WhatsappWebhookDeps {
  verifyToken: () => string | undefined;
  appSecret: () => string | undefined;
  accessToken: () => string | undefined;
}

export const whatsappWebhookDepsReales: WhatsappWebhookDeps = {
  verifyToken: () => env.WHATSAPP_VERIFY_TOKEN,
  appSecret: () => env.WHATSAPP_APP_SECRET,
  accessToken: () => env.WHATSAPP_ACCESS_TOKEN,
};

// El request con los bytes crudos que dejó el `verify` del parser propio.
export interface WhatsappWebhookRequest extends Request {
  rawBody?: Buffer;
}

export const WHATSAPP_SIGNATURE_HEADER = "x-hub-signature-256";
const PREFIJO_DE_FIRMA = "sha256=";

function leerQuery(req: Request, nombre: string): string | undefined {
  const valor = req.query[nombre];
  return typeof valor === "string" ? valor : undefined;
}

// GET — el handshake que hace Meta UNA vez, al guardar la URL del webhook en
// el panel. Responde el challenge CRUDO como text/plain: Meta compara el
// cuerpo byte a byte, y un JSON ("\"123\"") haría fallar la verificación.
//
// secretsMatch y no timingSafeEqual: el verify token es un secreto de largo
// variable, y timingSafeEqual cortaría antes por largo (ver utils/hmac.ts).
//
// Sin WHATSAPP_VERIFY_TOKEN configurado no hay nada contra qué comparar: 500
// operacional (en el log), nunca un handshake que acepte cualquier token.
export function createWhatsappVerificationHandler(deps: WhatsappWebhookDeps): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const verifyToken = deps.verifyToken();
    if (!verifyToken) {
      next(new AppError("Falta WHATSAPP_VERIFY_TOKEN en el entorno", 500, false));
      return;
    }

    const mode = leerQuery(req, "hub.mode");
    const token = leerQuery(req, "hub.verify_token");
    const challenge = leerQuery(req, "hub.challenge");

    if (mode !== "subscribe" || token === undefined || !secretsMatch(token, verifyToken)) {
      logger.warn("Handshake del webhook de WhatsApp rechazado: modo o verify token incorrecto");
      res.status(403).type("text/plain").send("Forbidden");
      return;
    }

    res
      .status(200)
      .type("text/plain")
      .send(challenge ?? "");
  };
}

// POST, paso 2 de la cadena (el 1 es el parser del router): la firma.
// Firma ausente, mal formada o que no coincide -> 401 sin llegar al handler.
//
// Sin WHATSAPP_APP_SECRET o WHATSAPP_ACCESS_TOKEN: 500 que dice qué falta (en
// el log, isOperational false). Nunca un
// webhook que "funciona" sin verificar nada, ni uno que encola turnos cuyas
// respuestas el worker después no va a poder mandar. Un 5xx además hace que
// Meta reintente, que es lo que se quiere mientras la configuración esté rota.
export function createVerifyWhatsappSignature(deps: WhatsappWebhookDeps): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const appSecret = deps.appSecret();
    const accessToken = deps.accessToken();
    if (!appSecret || !accessToken) {
      next(
        new AppError("Falta WHATSAPP_APP_SECRET o WHATSAPP_ACCESS_TOKEN en el entorno", 500, false),
      );
      return;
    }

    const rawBody = (req as WhatsappWebhookRequest).rawBody;
    const header = req.headers[WHATSAPP_SIGNATURE_HEADER];
    const firma =
      typeof header === "string" && header.startsWith(PREFIJO_DE_FIRMA)
        ? header.slice(PREFIJO_DE_FIRMA.length)
        : undefined;

    // Sin rawBody no hay qué verificar (cuerpo vacío): es tan inválido como
    // una firma que no coincide, y cae en el mismo 401.
    if (!rawBody || !firma || !timingSafeEqual(hmacSha256Hex(appSecret, rawBody), firma)) {
      logger.warn("Webhook de WhatsApp rechazado: firma ausente o inválida");
      next(new AppError("Firma inválida", 401));
      return;
    }

    next();
  };
}

// POST, paso 3: firma verificada y cuerpo parseado. Cada change del lote se
// despacha por su `field`: `messages` (los entrantes, ítem 81) y
// `message_template_status_update` (Meta aprobó o rechazó la plantilla de
// seguimiento de un negocio, ítem 160); los dos viven en
// whatsappWebhook.service.ts. Para recibir el segundo, el campo tiene que
// estar suscripto en el webhook de la app de Meta.
//
// 200 SIEMPRE QUE LA FORMA SEA VÁLIDA, aunque un mensaje puntual falle
// adentro (se loguea en el service): cualquier cosa que no sea 2xx hace que
// Meta reintente el lote entero. El único 400 es un cuerpo que ni siquiera
// tiene la forma de un webhook de Meta — firmado por Meta, así que no debería
// pasar nunca.
export function createWhatsappWebhookHandler(): RequestHandler {
  return asyncHandler<Request>(async (req, res: Response) => {
    const parsed = whatsappWebhookPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn("Webhook de WhatsApp con un cuerpo que no tiene la forma esperada");
      res.status(400).json({ error: { message: "Payload de webhook inválido" } });
      return;
    }

    const resumen = await procesarWebhookDeWhatsapp(parsed.data);
    logger.info({ resumen }, "Webhook de WhatsApp procesado");

    res.status(200).json({ ok: true });
  });
}
