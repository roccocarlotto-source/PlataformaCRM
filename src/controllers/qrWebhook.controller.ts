import type { NextFunction, Request, RequestHandler, Response } from "express";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import {
  fetchPreapprovalReal,
  processMercadopagoNotification,
  type FetchPreapproval,
} from "../services/qrWebhook.service";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";
import { verifyMercadoPagoSignature } from "../utils/mercadopagoSignature";

// ---------------------------------------------------------------------------
// POST /webhooks/mercadopago — puerto de mercadopago-webhook/index.ts
// (docs/qr-integration.md, Fase 2).
//
// SIN authenticate: MercadoPago no manda una sesión nuestra; su propia firma
// es el mecanismo de autenticación (D3 original). Y montado en app.ts ANTES
// del express.json() global, por el mismo motivo exacto que ingestRouter: la
// cadena de este endpoint verifica la firma sobre headers + query ANTES de
// leer el cuerpo, y trae su propio parser con su propio límite (ver
// routes/qrWebhook.routes.ts).
//
// EL ORDEN ES EL DEL ORIGINAL Y NO SE REORDENA — cada paso corta antes del
// siguiente:
//   1. headers x-signature / x-request-id y data.id (query)   -> este archivo
//   2. firma HMAC + frescura del ts, SIN leer el body todavía  -> este archivo
//   3. parsear el body JSON                                     -> el router
//   4..8. tipo de evento, id de notificación, re-fetch, mapeo, organización,
//         transacción idempotente                              -> el service
//
// Las dependencias (secreto, access token, fetch a MercadoPago, reloj) se
// inyectan por factory: la instancia de producción las toma del entorno y de
// la red; los tests de integración le pasan un secreto conocido y un doble de
// MercadoPago, y ejercitan la MISMA cadena por HTTP real.
// ---------------------------------------------------------------------------

export interface QrWebhookDeps {
  webhookSecret: () => string | undefined;
  accessToken: () => string | undefined;
  fetchPreapproval: FetchPreapproval;
  nowMs: () => number;
}

const depsReales: QrWebhookDeps = {
  webhookSecret: () => env.MERCADOPAGO_WEBHOOK_SECRET,
  accessToken: () => env.MERCADOPAGO_ACCESS_TOKEN,
  fetchPreapproval: fetchPreapprovalReal,
  nowMs: () => Date.now(),
};

function leerHeader(req: Request, nombre: string): string | undefined {
  const valor = req.headers[nombre];
  return typeof valor === "string" ? valor : undefined;
}

function leerQuery(req: Request, nombre: string): string | undefined {
  const valor = req.query[nombre];
  return typeof valor === "string" && valor.length > 0 ? valor : undefined;
}

// Pasos 1 y 2. Un middleware separado del handler para que el parser del body
// (paso 3, en el router) quede ENTRE la verificación de firma y el handler:
// una firma inválida responde 401 con el stream sin consumir, sin haber gastado
// nada en parsear.
//
// Sin las env vars el servidor arranca igual (son opcionales en config/env.ts,
// mismo criterio que SECRET_ENCRYPTION_KEY) y recién acá, ante un webhook real,
// falla con un 500 que dice exactamente qué falta — en el log, no en la
// respuesta (isOperational false).
export function createVerifyMercadopagoSignature(deps: QrWebhookDeps): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const webhookSecret = deps.webhookSecret();
    const accessToken = deps.accessToken();
    if (!webhookSecret || !accessToken) {
      next(
        new AppError(
          "Falta MERCADOPAGO_WEBHOOK_SECRET o MERCADOPAGO_ACCESS_TOKEN en el entorno",
          500,
          false,
        ),
      );
      return;
    }

    const dataId = leerQuery(req, "data.id") ?? leerQuery(req, "id");
    if (!dataId) {
      next(new AppError("Falta data.id", 400));
      return;
    }

    const validSignature = verifyMercadoPagoSignature({
      signatureHeader: leerHeader(req, "x-signature"),
      requestId: leerHeader(req, "x-request-id"),
      dataId,
      secret: webhookSecret,
      nowMs: deps.nowMs(),
    });

    if (!validSignature) {
      logger.warn({ dataId }, "Webhook de MercadoPago rechazado: firma inválida o vencida");
      next(new AppError("Firma inválida", 401));
      return;
    }

    next();
  };
}

// Pasos 4 a 8, ya con firma verificada y body parseado.
//
// LOS 200 "ignored"/"duplicate" NO SON ERRORES: esto lo llama MercadoPago, no
// un cliente nuestro, y reintenta ante cualquier cosa que no sea 2xx. Un evento
// que no importa, un preapproval sin organización asociada y una entrega
// repetida se contestan 200 para que deje de insistir. Los 502/500 sí son
// errores reales (MercadoPago caído, base caída) y ahí el reintento es lo que
// queremos.
export function createQrWebhookHandler(deps: QrWebhookDeps): RequestHandler {
  return asyncHandler<Request>(async (req, res: Response) => {
    const accessToken = deps.accessToken();
    if (!accessToken) {
      throw new AppError("Falta MERCADOPAGO_ACCESS_TOKEN en el entorno", 500, false);
    }
    // Ya validado por createVerifyMercadopagoSignature; el fallback es solo
    // para el tipo.
    const dataId = leerQuery(req, "data.id") ?? leerQuery(req, "id") ?? "";

    const body = (req.body ?? {}) as { id?: unknown; type?: unknown };

    let resultado;
    try {
      resultado = await processMercadopagoNotification({
        dataId,
        body,
        accessToken,
        fetchPreapproval: deps.fetchPreapproval,
      });
    } catch (err) {
      // Distinguir "MercadoPago no respondió" (502) de "nuestra base falló"
      // (500) exige saber de dónde vino el error, y el service no lo marca.
      // Se loguea completo y se responde 502 solo cuando el fallo ocurrió en
      // el re-fetch, que es lo único que sale a la red.
      if (err instanceof Error && err.message.startsWith("MercadoPago API returned")) {
        logger.error({ err, dataId }, "No se pudo verificar el evento contra MercadoPago");
        res
          .status(502)
          .json({ error: { message: "No se pudo verificar el evento con MercadoPago" } });
        return;
      }
      throw err;
    }

    switch (resultado.outcome) {
      case "ignored":
        res.status(200).json({
          ok: true,
          ignored: true,
          ...(resultado.status !== undefined ? { status: resultado.status } : {}),
        });
        return;
      case "missing_notification_id":
        logger.warn({ dataId }, "Webhook de MercadoPago sin id de notificación en el payload");
        res.status(400).json({ error: { message: "Falta el id de la notificación" } });
        return;
      case "duplicate":
        res.status(200).json({ ok: true, duplicate: true });
        return;
      case "ok":
        if (resultado.statusChanged) {
          logger.info(
            { dataId },
            "Estado de suscripción QR actualizado por webhook de MercadoPago",
          );
        }
        res.status(200).json({ ok: true });
        return;
    }
  });
}

export const verifyMercadopagoSignature = createVerifyMercadopagoSignature(depsReales);
export const qrWebhookHandler = createQrWebhookHandler(depsReales);
