import { Router } from "express";
import {
  getConversationHandler,
  listConversationsHandler,
} from "../controllers/conversation.controller";
import { authenticate } from "../middlewares/authenticate";

export const conversationRouter = Router();

// SOLO `authenticate`, sin `authorize("ADMIN")` en ninguna de las dos, y sin
// businessWriteRateLimiter: no hay una sola escritura en este router.
//
// Es el mismo esquema que la LECTURA de /api/agents, /api/knowledge-base y
// /api/automations —abierta a cualquier usuario autenticado de la
// organización— y acá la lectura es todo lo que hay. La diferencia con esos
// tres módulos no es de permisos sino de naturaleza: ellos son pantallas de
// configuración (por eso sus rutas viven dentro de AdminRoute aunque el GET
// sea abierto), y esto es un dato del CRM que un vendedor necesita ver, como
// /api/contacts o /api/vehicles. Por eso la pantalla que lo consume TAMPOCO
// va dentro de AdminRoute (ver app/router.tsx).
//
// El aislamiento por organización no depende de esto: el organizationId sale
// del JWT y entra en el WHERE de las dos consultas (ver
// conversation.repository.ts), así que un id de otra organización es 404.
conversationRouter.get("/conversations", authenticate, listConversationsHandler);
conversationRouter.get("/conversations/:id", authenticate, getConversationHandler);
