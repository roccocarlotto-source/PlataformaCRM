import express, { type NextFunction, type Request, type Response, Router } from "express";
import {
  createVerifyWhatsappSignature,
  createWhatsappVerificationHandler,
  createWhatsappWebhookHandler,
  whatsappWebhookDepsReales,
  type WhatsappWebhookDeps,
  type WhatsappWebhookRequest,
} from "../controllers/whatsappWebhook.controller";
import { envolverParserConTraduccion } from "../middlewares/bodyParserError";
import { AppError } from "../utils/AppError";

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
// ---------------------------------------------------------------------------

// Un webhook de mensajes de texto es un JSON chico: metadata, un contacto y
// uno o pocos mensajes de hasta 4096 caracteres. 32 KB entra holgado, y como
// este parser corre ANTES de verificar la firma, el tope es lo que acota lo
// que cualquiera puede hacernos parsear sin estar autenticado.
export const WHATSAPP_MAX_BODY_BYTES = 32 * 1024;

function requireJsonBody(req: Request, _res: Response, next: NextFunction): void {
  if (!req.is("application/json")) {
    next(new AppError("El webhook solo acepta application/json", 400));
    return;
  }
  next();
}

const whatsappJsonParser = envolverParserConTraduccion(
  express.json({
    limit: WHATSAPP_MAX_BODY_BYTES,
    type: "application/json",
    verify: (req, _res, buf) => {
      (req as WhatsappWebhookRequest).rawBody = Buffer.from(buf);
    },
  }),
  {
    demasiado_grande: {
      message: `El cuerpo del request supera el máximo de ${WHATSAPP_MAX_BODY_BYTES} bytes`,
      statusCode: 413,
    },
    cuerpo_invalido: { message: "El cuerpo del request no es JSON válido", statusCode: 400 },
    codificacion_no_soportada: { message: "Codificación de cuerpo no soportada", statusCode: 415 },
  },
);

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
