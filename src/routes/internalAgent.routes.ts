import { Router } from "express";
import {
  getInternalAgentHandler,
  listInternalAgentMessagesHandler,
  postInternalAgentMessageHandler,
  putInternalAgentHandler,
} from "../controllers/internalAgent.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";
import { requireInternalAgentAccess } from "../middlewares/requireInternalAgentAccess";

export const internalAgentRouter = Router();

// El chat (ítem 179). POST es una escritura —guarda mensajes y, por las tools,
// puede crear tareas— y además paga una llamada a un LLM: lleva el
// businessWriteRateLimiter como POST /agents/:id/test-message. Va después de
// authenticate (necesita req.auth.userId) y antes del chequeo de acceso, mismo
// orden que con authorize.
internalAgentRouter.get(
  "/internal-agent/messages",
  authenticate,
  requireInternalAgentAccess,
  listInternalAgentMessagesHandler,
);
internalAgentRouter.post(
  "/internal-agent/messages",
  authenticate,
  businessWriteRateLimiter,
  requireInternalAgentAccess,
  postInternalAgentMessageHandler,
);

// La configuración: solo ADMIN, incluida la lectura (las instructions son el
// prompt del agente; un USER habilitado lo usa, no lo configura).
internalAgentRouter.get(
  "/internal-agent",
  authenticate,
  authorize("ADMIN"),
  getInternalAgentHandler,
);
internalAgentRouter.put(
  "/internal-agent",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  putInternalAgentHandler,
);
