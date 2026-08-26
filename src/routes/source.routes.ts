import { Router } from "express";
import {
  createSourceHandler,
  deleteSourceHandler,
  getSourceHandler,
  listSourcesHandler,
  updateSourceHandler,
} from "../controllers/source.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const sourceRouter = Router();

// ADMIN-only en las cinco, lectura incluida — mismo criterio que
// user.routes.ts e invitation.routes.ts y distinto del de Company/Contact: una
// Source es configuración de integración, no un módulo de negocio de lectura
// abierta. Deja toda la superficie de ingesta detrás de un solo rol en vez de
// dos criterios distintos.
sourceRouter.get("/sources", authenticate, authorize("ADMIN"), listSourcesHandler);
sourceRouter.get("/sources/:id", authenticate, authorize("ADMIN"), getSourceHandler);

// businessWriteRateLimiter (R1.9) va después de authenticate (necesita
// req.auth.userId) y antes de authorize — ver rateLimit.ts. Solo en las
// escrituras, mismo criterio que el resto de los routers.
sourceRouter.post(
  "/sources",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  createSourceHandler,
);
sourceRouter.patch(
  "/sources/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  updateSourceHandler,
);
sourceRouter.delete(
  "/sources/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  deleteSourceHandler,
);
