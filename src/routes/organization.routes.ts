import { Router } from "express";
import {
  getOrganizationSettingsHandler,
  updateOrganizationCurrencyHandler,
} from "../controllers/organization.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const organizationRouter = Router();

// Configuración de moneda de la organización (Fase 2c del módulo de stock de
// vehículos). Sin :id: la organización es SIEMPRE la del token — no existe
// "leer la configuración de otra". Mismo esquema de permisos que
// branchRouter: cualquier usuario autenticado de la organización lee (el
// frontend necesita la moneda y la cotización para mostrar precios),
// escritura solo ADMIN.
organizationRouter.get("/organization", authenticate, getOrganizationSettingsHandler);

// businessWriteRateLimiter va después de authenticate —necesita
// req.auth.userId— y antes de authorize. Mismo orden que branch.routes.ts.
organizationRouter.patch(
  "/organization",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  updateOrganizationCurrencyHandler,
);
