import { Router } from "express";
import {
  createServiceTypeHandler,
  deleteServiceTypeHandler,
  getServiceTypeHandler,
  listServiceTypesHandler,
  updateServiceTypeHandler,
} from "../controllers/serviceType.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const serviceTypeRouter = Router();

// Mismo esquema de permisos que el resto de los CRUD de configuracion
// (pipelines, stages): lectura para cualquier usuario autenticado de la
// organizacion, escritura solo ADMIN. No se invento nada nuevo — Role sigue
// teniendo ADMIN/USER y nada mas.
serviceTypeRouter.get("/service-types", authenticate, listServiceTypesHandler);
serviceTypeRouter.get("/service-types/:id", authenticate, getServiceTypeHandler);

// businessWriteRateLimiter (R1.9) va despues de authenticate —necesita
// req.auth.userId— y antes de authorize. Mismo orden que pipeline.routes.ts.
serviceTypeRouter.post(
  "/service-types",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  createServiceTypeHandler,
);
serviceTypeRouter.patch(
  "/service-types/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  updateServiceTypeHandler,
);
serviceTypeRouter.delete(
  "/service-types/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  deleteServiceTypeHandler,
);
