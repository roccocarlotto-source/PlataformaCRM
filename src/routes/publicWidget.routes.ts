import { Router } from "express";
import { sendWidgetMessageHandler } from "../controllers/publicWidget.controller";
import { authenticateEmbedToken } from "../middlewares/authenticateEmbedToken";
import { widgetRateLimiter } from "../middlewares/rateLimit";
import { requireWidgetJsonContentType, widgetJsonParser } from "../middlewares/widgetBody";
import { buildWidgetCorsMiddleware } from "../middlewares/widgetCors";

export const publicWidgetRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/public/agents/:agentId/web/messages — el endpoint público del
// canal Web (paso 5b de docs/ai-agent-architecture.md §9; decisiones en la
// nota fechada bajo §6). Lo llama el widget embebido en el sitio de un
// cliente, desde el navegador de un visitante anónimo.
//
// Se monta en app.ts bajo /api/public, ANTES del cors() global y del
// express.json() global — ver el comentario de app.ts.
//
// EL :agentId EN LA URL ES PÚBLICO Y SOLO SIRVE PARA CORS (punto 1 de la
// nota): el preflight OPTIONS no trae el token, así que sin un identificador
// en la URL no habría de dónde sacar allowedOrigins. La autorización real es
// el token del header, cuyo agentId tiene que coincidir con el de la URL.
//
// EL ORDEN DE LA CADENA NO ES INTERCAMBIABLE:
//
//   0. buildWidgetCorsMiddleware — con router.use(PATH, ...) y ANTES QUE NADA,
//      porque el preflight OPTIONS tiene que poder resolverse sin tocar ni el
//      parser de cuerpo ni la autenticación: un OPTIONS no trae cuerpo ni
//      trae el header del token, y si pasara por requireWidgetJsonContentType
//      moriría con 415 antes de que el navegador supiera si el origen está
//      permitido. Con .use() y el path con parámetro, Express popula
//      req.params.agentId también para este middleware.
//   1. requireWidgetJsonContentType — antes del parser, por lo mismo que en
//      ingest.routes.ts: es lo único que distingue "mandaste otro formato"
//      (415) de "mandaste un cuerpo vacío".
//   2. widgetJsonParser — antes de authenticateEmbedToken, por el mismo motivo
//      de costo que la ingesta: un cuerpo enorme tiene que morir contra el
//      límite (8 KB) ANTES de gastar un SELECT en resolver la credencial.
//   3. authenticateEmbedToken — el 401 genérico y la resolución del
//      WidgetAuthContext (token + agente + Origin).
//   4. widgetRateLimiter — DESPUÉS de authenticateEmbedToken por necesidad
//      estructural: cuenta por embedTokenId, que no existe hasta el paso 3.
//
// NO MONTA `authorize`: no hay usuario ni rol.
// ---------------------------------------------------------------------------
const WIDGET_MESSAGE_PATH = "/agents/:agentId/web/messages";

publicWidgetRouter.use(WIDGET_MESSAGE_PATH, buildWidgetCorsMiddleware());

publicWidgetRouter.post(
  WIDGET_MESSAGE_PATH,
  requireWidgetJsonContentType,
  widgetJsonParser,
  authenticateEmbedToken,
  widgetRateLimiter,
  sendWidgetMessageHandler,
);
