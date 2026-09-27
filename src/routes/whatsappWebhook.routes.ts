import { Router } from "express";
import {
  createVerifyWhatsappSignature,
  createWhatsappVerificationHandler,
  createWhatsappWebhookHandler,
  whatsappWebhookDepsReales,
  type WhatsappWebhookDeps,
} from "../controllers/whatsappWebhook.controller";
import { crearParserConRawBody, requireJsonBody } from "../middlewares/metaWebhookBody";

// ---------------------------------------------------------------------------
// GET y POST /webhooks/whatsapp (ítem 81). Se monta en app.ts ANTES del
// express.json() global, por el mismo motivo exacto que ingestRouter:
// body-parser marca el request al parsearlo y cualquier
// instancia posterior se saltea a sí misma, así que montado después el parser
// propio no correría — y sin él no hay bytes crudos, y sin bytes crudos no hay
// firma que verificar.
//
// EL ORDEN DEL POST NO ES INTERCAMBIABLE:
//   1. requireJsonBody — 400 explícito si el Content-Type no es JSON. Sin
//      esto body-parser se saltea el request en silencio, no hay rawBody y la
//      firma daría un 401 que describe mal el problema.
//   2. whatsappJsonParser — parser propio con tope propio, que además guarda
//      los bytes crudos en req.rawBody (el `verify` corre ANTES de
//      JSON.parse, sobre exactamente lo que llegó). Errores traducidos a
//      413/400/415 con la misma tabla que el parser global.
//   3. verifyWhatsappSignature — HMAC-SHA256 de los bytes crudos con el App
//      Secret contra X-Hub-Signature-256. 401 si no coincide.
//   4. whatsappWebhookHandler — recorre el lote.
//
// La firma va DESPUÉS del parser: Meta firma el
// cuerpo, así que hay que leerlo para poder verificarla (ver el comentario de
// whatsappWebhook.controller.ts).
//
// requireJsonBody y el parser con rawBody viven en
// middlewares/metaWebhookBody.ts desde el ítem 171: los comparte el webhook de
// Messenger e Instagram (routes/metaWebhook.routes.ts).
// ---------------------------------------------------------------------------

// Un webhook de mensajes de texto es un JSON chico: metadata, un contacto y
// uno o pocos mensajes de hasta 4096 caracteres. 32 KB entra holgado, y como
// este parser corre ANTES de verificar la firma, el tope es lo que acota lo
// que cualquiera puede hacernos parsear sin estar autenticado.
export const WHATSAPP_MAX_BODY_BYTES = 32 * 1024;

const whatsappJsonParser = crearParserConRawBody(WHATSAPP_MAX_BODY_BYTES);

// Factory y no un router armado a mano en el test: el test de integración construye ESTA MISMA cadena con
// secretos conocidos, así que una diferencia entre lo que se prueba y lo que
// corre en producción no puede existir.
export function createWhatsappWebhookRouter(deps: WhatsappWebhookDeps): Router {
  const router = Router();

  router.get("/webhooks/whatsapp", createWhatsappVerificationHandler(deps));

  router.post(
    "/webhooks/whatsapp",
    requireJsonBody,
    whatsappJsonParser,
    createVerifyWhatsappSignature(deps),
    createWhatsappWebhookHandler(),
  );

  return router;
}

export const whatsappWebhookRouter = createWhatsappWebhookRouter(whatsappWebhookDepsReales);
