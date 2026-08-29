import { Router } from "express";
import {
  createResourceHandler,
  deleteResourceHandler,
  getResourceHandler,
  listResourcesHandler,
  updateResourceHandler,
} from "../controllers/resource.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const resourceRouter = Router();

// Mismo esquema de permisos que el resto de los CRUD de configuracion
// (pipelines, stages): lectura para cualquier usuario autenticado de la
// organizacion, escritura solo ADMIN. No se invento nada nuevo — Role sigue
// teniendo ADMIN/USER y nada mas.
resourceRouter.get("/resources", authenticate, listResourcesHandler);
resourceRouter.get("/resources/:id", authenticate, getResourceHandler);

// businessWriteRateLimiter (R1.9) va despues de authenticate —necesita
// req.auth.userId— y antes de authorize. Mismo orden que pipeline.routes.ts.
resourceRouter.post(
  "/resources",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  createResourceHandler,
);
resourceRouter.patch(
  "/resources/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  updateResourceHandler,
);
resourceRouter.delete(
  "/resources/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  deleteResourceHandler,
);
