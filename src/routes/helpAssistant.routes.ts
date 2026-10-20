import { Router } from "express";
import { feedbackHandler, preguntarHandler } from "../controllers/helpAssistant.controller";
import { authenticate } from "../middlewares/authenticate";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const helpAssistantRouter = Router();

// El asistente "¿Cómo se hace?": para todos los roles, sin módulo propio. Una
// pregunta paga una llamada al modelo: lleva el businessWriteRateLimiter, como
// el Agente interno, además del tope diario del service.
helpAssistantRouter.post(
  "/help-assistant/questions",
  authenticate,
  businessWriteRateLimiter,
  preguntarHandler,
);

// El 👍/👎 de una respuesta, de quien la preguntó.
helpAssistantRouter.patch(
  "/help-assistant/questions/:id/feedback",
  authenticate,
  businessWriteRateLimiter,
  feedbackHandler,
);
