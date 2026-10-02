import { Router } from "express";
import {
  closeConversationHandler,
  createConversationReplyHandlers,
  generateConversationBriefHandler,
  getConversationHandler,
  listConversationsHandler,
  updateConversationBriefHandler,
} from "../controllers/conversation.controller";
import { authenticate } from "../middlewares/authenticate";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";
import type { DepsDeRespuestaHumana } from "../services/conversationReply.service";

// Factory desde I-03: las respuestas desde el CRM salen por la Graph API, y el
// test de integración monta el router con un doble del envío (mismo patrón que
// createAutomationRouter). Producción monta conversationRouter.
export function createConversationRouter(deps?: DepsDeRespuestaHumana) {
  const conversationRouter = Router();
  const replyHandlers = createConversationReplyHandlers(deps);

  // SOLO `authenticate`, sin `authorize("ADMIN")` en NINGUNA — ni siquiera
  // en las que escriben, que es donde el resto del módulo de
  // agentes sí pone el gate.
  //
  // Es el mismo esquema que la LECTURA de /api/agents, /api/knowledge-base y
  // /api/automations —abierta a cualquier usuario autenticado de la
  // organización—. La diferencia con esos tres módulos no es de permisos sino de
  // naturaleza: ellos son pantallas de configuración (por eso sus rutas viven
  // dentro de AdminRoute aunque el GET sea abierto), y esto es un dato del CRM
  // que un vendedor necesita ver, como /api/contacts o /api/vehicles. Por eso la
  // pantalla que lo consume TAMPOCO va dentro de AdminRoute (ver app/router.tsx).
  //
  // Y POR ESO LAS ESCRITURAS DEL BRIEF TAMPOCO SON ADMIN-ONLY (ítem 73):
  // corregir el resumen de una conversación es trabajo del vendedor que la
  // atiende, no una decisión de configuración. Un ADMIN-only acá dejaría la
  // pantalla con un botón que la mayoría de quienes la usan no podría apretar.
  // Lo mismo vale para el cierre manual (ítem 168): cerrar una conversación es
  // parte de atenderla, no configuración.
  //
  // El aislamiento por organización no depende de nada de esto: el
  // organizationId sale del JWT y entra en el WHERE de todas las consultas (ver
  // conversation.repository.ts), así que un id de otra organización es 404
  // también en el PATCH y en los POST.
  conversationRouter.get("/conversations", authenticate, listConversationsHandler);
  conversationRouter.get("/conversations/:id", authenticate, getConversationHandler);

  // ---------------------------------------------------------------------------
  // El brief (ítem 73). Las dos primeras escrituras de este router, y siguen sin
  // tocar `messages`: el brief es una anotación interna sobre la conversación,
  // no un mensaje que se entregue por ningún canal. Responder llegó recién con
  // I-03, abajo.
  //
  // businessWriteRateLimiter (R1.9) va después de authenticate, que es de donde
  // saca req.auth.userId. Mismo orden que el resto de los routers.
  //
  // EL MISMO LIMITER PARA LAS DOS, incluida la que llama al proveedor de LLM: es
  // el precedente exacto de POST /api/agents/:id/test-message, que también gasta
  // una llamada al modelo por request y usa este limiter y no uno propio. Los
  // que tienen limiter propio (import/preview, knowledge-base/extract-text) son
  // los que NO escriben nada y por eso no tienen ningún costo que los frene
  // naturalmente; acá cada generación deja una fila escrita.
  // ---------------------------------------------------------------------------
  conversationRouter.patch(
    "/conversations/:id",
    authenticate,
    businessWriteRateLimiter,
    updateConversationBriefHandler,
  );
  conversationRouter.post(
    "/conversations/:id/generate-brief",
    authenticate,
    businessWriteRateLimiter,
    generateConversationBriefHandler,
  );

  // ---------------------------------------------------------------------------
  // El cierre manual (ítem 168). Mismo gate y mismo limiter que las escrituras
  // del brief, por el mismo motivo (ver arriba). Tampoco toca `messages`: es un
  // cambio de status, al contacto no se le entrega nada.
  // ---------------------------------------------------------------------------
  conversationRouter.post(
    "/conversations/:id/close",
    authenticate,
    businessWriteRateLimiter,
    closeConversationHandler,
  );

  // ---------------------------------------------------------------------------
  // Responder desde el CRM (I-03 de
  // docs-privados/auditoria-2026-09-24-punta-a-punta.md, local): la primera
  // escritura de este router que SÍ crea un Message, y lo entrega por WhatsApp.
  // Tampoco van con authorize("ADMIN"): el permiso es por conversación (el
  // vendedor asignado o un ADMIN) y lo decide el service, que es el que tiene la
  // fila. Mismo limiter que el resto de las escrituras.
  // ---------------------------------------------------------------------------
  conversationRouter.post(
    "/conversations/:id/messages",
    authenticate,
    businessWriteRateLimiter,
    replyHandlers.reply,
  );
  conversationRouter.post(
    "/conversations/:id/messages/:messageId/retry",
    authenticate,
    businessWriteRateLimiter,
    replyHandlers.retry,
  );
  conversationRouter.post(
    "/conversations/:id/return-to-agent",
    authenticate,
    businessWriteRateLimiter,
    replyHandlers.returnToAgent,
  );

  return conversationRouter;
}

export const conversationRouter = createConversationRouter();
