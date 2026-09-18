import { Router } from "express";
import {
  createAgentHandler,
  deleteAgentHandler,
  getAgentHandler,
  listAgentsHandler,
  testMessageHandler,
  translateGuardrailsHandler,
  updateAgentHandler,
} from "../controllers/agent.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const agentRouter = Router();

// Mismo esquema de permisos que el resto de los CRUD de configuración
// (branches, resources, service types): lectura para cualquier usuario
// autenticado de la organización, escritura solo ADMIN — es lo que
// docs/ai-agent-architecture.md §5 pide para /api/agents. No se inventó nada
// nuevo: Role sigue teniendo ADMIN/USER y nada más.
agentRouter.get("/agents", authenticate, listAgentsHandler);

// Traductor de guardrails en lenguaje natural (ítem 56). No guarda nada, pero
// dispara una llamada real y paga a un LLM: mismo rate limiter y mismo ADMIN
// que las escrituras. Va ANTES de "/agents/:id" por la regla de orden que ya
// sigue este archivo —rutas fijas antes que rutas con parámetro—, aunque acá
// los métodos HTTP difieran y no haya colisión posible.
agentRouter.post(
  "/agents/guardrails/translate",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  translateGuardrailsHandler,
);

agentRouter.get("/agents/:id", authenticate, getAgentHandler);

// businessWriteRateLimiter (R1.9) va después de authenticate —necesita
// req.auth.userId— y antes de authorize. Mismo orden que resource.routes.ts.
agentRouter.post(
  "/agents",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  createAgentHandler,
);
agentRouter.patch(
  "/agents/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  updateAgentHandler,
);
agentRouter.delete(
  "/agents/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  deleteAgentHandler,
);

// Endpoint interno de prueba del loop de orquestación (paso 2b). Es una
// escritura administrativa —crea conversación y mensajes, y puede crear
// oportunidades o reservas a través de las tools— así que lleva exactamente
// la misma cadena que POST /agents.
agentRouter.post(
  "/agents/:id/test-message",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  testMessageHandler,
);
