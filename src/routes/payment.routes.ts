import { Router } from "express";
import {
  createPaymentHandler,
  deletePaymentHandler,
  getPaymentHandler,
  listPaymentChangesHandler,
  listPaymentsHandler,
  updatePaymentHandler,
} from "../controllers/payment.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

// Pagos del cliente (§43 de docs/frontend-cambios-pendientes.md). Misma forma
// que quote.routes.ts, porque un pago también es parte de la oportunidad:
// lectura para cualquier autenticado de la organización. Registrar y
// corregir un pago: ADMIN, y desde PR-17 también el vendedor (USER) en las
// oportunidades que tiene asignadas (chequeo de dueño en el controller).
// Borrar: solo ADMIN. Cada alta, corrección y borrado queda en el historial
// (GET /payments/changes, PR-17b).
//
// CON DELETE, a diferencia de quotes y deliveries: un pago es un dato cargado
// a mano que se corrige o se borra si está mal, no el registro de una oferta
// o de un evento. El borrado es físico.
export const paymentRouter = Router();

// GET /payments?opportunityId= — el historial de una oportunidad.
// opportunityId es obligatorio (payment.controller.ts).
paymentRouter.get("/payments", authenticate, listPaymentsHandler);
// Antes de /payments/:id: si no, "changes" se leería como un id.
paymentRouter.get("/payments/changes", authenticate, listPaymentChangesHandler);
paymentRouter.get("/payments/:id", authenticate, getPaymentHandler);

// businessWriteRateLimiter (R1.9) va después de authenticate (necesita
// req.auth.userId) y antes de authorize — ver rateLimit.ts.
paymentRouter.post(
  "/payments",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN", "USER"),
  createPaymentHandler,
);
paymentRouter.patch(
  "/payments/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN", "USER"),
  updatePaymentHandler,
);
paymentRouter.delete(
  "/payments/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  deletePaymentHandler,
);
