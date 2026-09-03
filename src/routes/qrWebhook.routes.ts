import express, { type NextFunction, type Request, type Response, Router } from "express";
import { qrWebhookHandler, verifyMercadopagoSignature } from "../controllers/qrWebhook.controller";
import { envolverParserConTraduccion } from "../middlewares/bodyParserError";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// POST /webhooks/mercadopago (docs/qr-integration.md, Fase 2). Se monta en
// app.ts ANTES del express.json() global, por el mismo motivo exacto que
// ingestRouter (ver el comentario de app.ts): body-parser marca el request al
// parsearlo y cualquier instancia posterior se saltea a sí misma, así que
// montado después ni el límite propio ni el orden "firma antes que body" de
// esta cadena valdrían nada.
//
// EL ORDEN DE LOS CUATRO MIDDLEWARES NO ES INTERCAMBIABLE:
//   1. verifyMercadopagoSignature — sobre headers + query, con el stream del
//      body sin tocar. Una firma inválida o vencida muere acá con 401 sin
//      haber parseado nada (mismo orden que el original: la firma no cubre el
//      body, así que no hay motivo para leerlo antes).
//   2. requireJsonBody — 400 explícito si el Content-Type no es JSON. Sin
//      esto, body-parser se saltea el request en silencio y el handler vería
//      un body vacío -> "type" ausente -> 200 ignored, que es mentirle a
//      MercadoPago sobre un request malformado.
//   3. mercadopagoJsonParser — parser propio con límite propio, errores
//      traducidos a 413/400/415 (misma tabla que el parser global, vía
//      envolverParserConTraduccion) en vez del 500 de errorHandler.
//   4. qrWebhookHandler — pasos 4 a 8.
// ---------------------------------------------------------------------------

// Una notificación de MercadoPago es un JSON chico (id, type, action, data.id,
// fechas). 64 KB entra holgado, mismo tope que la ingesta — el otro endpoint
// del sistema sin usuario detrás.
export const MERCADOPAGO_MAX_BODY_BYTES = 64 * 1024;

function requireJsonBody(req: Request, _res: Response, next: NextFunction): void {
  if (!req.is("application/json")) {
    next(new AppError("El webhook solo acepta application/json", 400));
    return;
  }
  next();
}

const mercadopagoJsonParser = envolverParserConTraduccion(
  express.json({ limit: MERCADOPAGO_MAX_BODY_BYTES, type: "application/json" }),
  {
    demasiado_grande: {
      message: `El cuerpo del request supera el máximo de ${MERCADOPAGO_MAX_BODY_BYTES} bytes`,
      statusCode: 413,
    },
    cuerpo_invalido: { message: "El cuerpo del request no es JSON válido", statusCode: 400 },
    codificacion_no_soportada: { message: "Codificación de cuerpo no soportada", statusCode: 415 },
  },
);

export const qrWebhookRouter = Router();

qrWebhookRouter.post(
  "/webhooks/mercadopago",
  verifyMercadopagoSignature,
  requireJsonBody,
  mercadopagoJsonParser,
  qrWebhookHandler,
);
