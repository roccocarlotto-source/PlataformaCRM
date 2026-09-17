import { Router } from "express";
import {
  getDeliveryHandler,
  listDeliveriesHandler,
  updateDeliveryHandler,
} from "../controllers/delivery.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

// Entregas (§40 de docs/frontend-cambios-pendientes.md). Misma forma que
// quote.routes.ts, porque una entrega también es parte de la oportunidad:
// lectura para cualquier autenticado de la organización, escritura ADMIN.
//
// SIN POST: la entrega nace sola cuando la oportunidad gana con unidad
// vinculada (opportunity.service.ts). SIN DELETE: es el registro de un evento
// real, no se borra.
export const deliveryRouter = Router();

// GET /deliveries?opportunityId= — la entrega de una oportunidad, 0 o 1.
// opportunityId es obligatorio (delivery.controller.ts).
deliveryRouter.get("/deliveries", authenticate, listDeliveriesHandler);
deliveryRouter.get("/deliveries/:id", authenticate, getDeliveryHandler);

// PATCH: "Confirmar entrega" o la edición del checklist/fecha, nunca las dos
// en el mismo body (ver updateDeliveryHandler). businessWriteRateLimiter
// (R1.9) va después de authenticate y antes de authorize — ver rateLimit.ts.
deliveryRouter.patch(
  "/deliveries/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  updateDeliveryHandler,
);
