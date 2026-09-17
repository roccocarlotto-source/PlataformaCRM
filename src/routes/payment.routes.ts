import { Router } from "express";
import {
  createPaymentHandler,
  deletePaymentHandler,
  getPaymentHandler,
  listPaymentsHandler,
  updatePaymentHandler,
} from "../controllers/payment.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

// Pagos del cliente (§43 de docs/frontend-cambios-pendientes.md). Misma forma
// que quote.routes.ts, porque un pago también es parte de la oportunidad:
// lectura para cualquier autenticado de la organización, escritura ADMIN.
//
// CON DELETE, a diferencia de quotes y deliveries: un pago es un dato cargado
// a mano que se corrige o se borra si está mal, no el registro de una oferta
// o de un evento. El borrado es físico.
export const paymentRouter = Router();

// GET /payments?opportunityId= — el historial de una oportunidad.
// opportunityId es obligatorio (payment.controller.ts).
paymentRouter.get("/payments", authenticate, listPaymentsHandler);
paymentRouter.get("/payments/:id", authenticate, getPaymentHandler);

// businessWriteRateLimiter (R1.9) va después de authenticate (necesita
// req.auth.userId) y antes de authorize — ver rateLimit.ts.
paymentRouter.post(
  "/payments",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  createPaymentHandler,
);
paymentRouter.patch(
  "/payments/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  updatePaymentHandler,
);
paymentRouter.delete(
  "/payments/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  deletePaymentHandler,
);
