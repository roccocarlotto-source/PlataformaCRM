import { Router } from "express";
import {
  createMetaVerificationHandler,
  createMetaWebhookHandler,
  createVerifyMetaSignature,
  metaWebhookDepsReales,
  type MetaWebhookDeps,
} from "../controllers/metaWebhook.controller";
import { crearParserConRawBody, requireJsonBody } from "../middlewares/metaWebhookBody";

// ---------------------------------------------------------------------------
// GET y POST /webhooks/meta (ítem 171): Messenger e Instagram. Se monta en
// app.ts ANTES del express.json() global, al lado de whatsappWebhookRouter y
// por el mismo motivo: sin el parser propio no hay bytes crudos, y sin bytes
// crudos no hay firma que verificar.
//
// La cadena del POST es la de WhatsApp, en el mismo orden y por los mismos
// motivos (ver routes/whatsappWebhook.routes.ts):
//   1. requireJsonBody        — 400 si no es application/json.
//   2. parser con rawBody     — tope propio, errores traducidos.
//   3. firma                  — HMAC con META_APP_SECRET, 401 si no coincide.
//   4. handler                — recorre el lote.
// ---------------------------------------------------------------------------

// Mismo tope que WhatsApp: un lote de mensajes de texto de Messenger o
// Instagram (hasta 2000 caracteres cada uno) entra holgado en 32 KB.
export const META_MAX_BODY_BYTES = 32 * 1024;

// Factory, igual que WhatsApp: el test de integración arma ESTA cadena con
// secretos conocidos.
export function createMetaWebhookRouter(deps: MetaWebhookDeps): Router {
  const router = Router();

  router.get("/webhooks/meta", createMetaVerificationHandler(deps));

  router.post(
    "/webhooks/meta",
    requireJsonBody,
    crearParserConRawBody(META_MAX_BODY_BYTES),
    createVerifyMetaSignature(deps),
    createMetaWebhookHandler(),
  );

  return router;
}

export const metaWebhookRouter = createMetaWebhookRouter(metaWebhookDepsReales);
