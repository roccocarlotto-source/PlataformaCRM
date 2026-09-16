import { Router } from "express";
import {
  createQuoteHandler,
  getQuoteHandler,
  listQuotesHandler,
  updateQuoteHandler,
} from "../controllers/quote.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

// Cotizaciones (§39 de docs/frontend-cambios-pendientes.md). Misma forma que
// opportunity.routes.ts, porque una cotización es parte de la oportunidad:
// lectura para cualquier autenticado de la organización, escritura ADMIN.
//
// SIN DELETE, a propósito: una cotización no se borra, se supera — el
// historial de lo que se le ofreció al cliente es el punto de la entidad.
export const quoteRouter = Router();

// GET /quotes?opportunityId= — el historial de una oportunidad y cuál es la
// activa. opportunityId es obligatorio (quote.controller.ts).
quoteRouter.get("/quotes", authenticate, listQuotesHandler);
quoteRouter.get("/quotes/:id", authenticate, getQuoteHandler);

// businessWriteRateLimiter (R1.9) va después de authenticate (necesita
// req.auth.userId) y antes de authorize — ver rateLimit.ts.
quoteRouter.post(
  "/quotes",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  createQuoteHandler,
);
// PATCH: una transición de estado o la edición de un borrador, nunca las dos
// en el mismo body (ver updateQuoteHandler).
quoteRouter.patch(
  "/quotes/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  updateQuoteHandler,
);
