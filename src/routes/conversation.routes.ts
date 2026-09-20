import { Router } from "express";
import {
  generateConversationBriefHandler,
  getConversationHandler,
  listConversationsHandler,
  updateConversationBriefHandler,
} from "../controllers/conversation.controller";
import { authenticate } from "../middlewares/authenticate";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const conversationRouter = Router();

// SOLO `authenticate`, sin `authorize("ADMIN")` en NINGUNA de las cuatro — ni
// siquiera en las dos que escriben, que es donde el resto del módulo de
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
//
// El aislamiento por organización no depende de nada de esto: el
// organizationId sale del JWT y entra en el WHERE de todas las consultas (ver
// conversation.repository.ts), así que un id de otra organización es 404
// también en el PATCH y en el POST.
conversationRouter.get("/conversations", authenticate, listConversationsHandler);
conversationRouter.get("/conversations/:id", authenticate, getConversationHandler);

// ---------------------------------------------------------------------------
// El brief (ítem 73). Las dos primeras escrituras de este router, y siguen sin
// tocar `messages`: el brief es una anotación interna sobre la conversación,
// no un mensaje que se entregue por ningún canal. La barrera del ítem 66 —no
// se responde desde acá— queda intacta.
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
