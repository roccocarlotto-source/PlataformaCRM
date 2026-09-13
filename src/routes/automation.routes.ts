import { Router } from "express";
import {
  createAutomationHandler,
  deleteAutomationHandler,
  getAutomationHandler,
  listAutomationsHandler,
  updateAutomationHandler,
} from "../controllers/automation.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const automationRouter = Router();

// Mismo esquema de permisos que agent.routes.ts y el resto de los CRUD de
// configuración (branches, resources, service types): lectura para cualquier
// usuario autenticado de la organización, escritura solo ADMIN — es lo que
// docs/automations-architecture.md §8 pide para /api/automations.
automationRouter.get("/automations", authenticate, listAutomationsHandler);
automationRouter.get("/automations/:id", authenticate, getAutomationHandler);

// businessWriteRateLimiter (R1.9) va después de authenticate —necesita
// req.auth.userId— y antes de authorize. Mismo orden que agent.routes.ts.
automationRouter.post(
  "/automations",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  createAutomationHandler,
);
automationRouter.patch(
  "/automations/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  updateAutomationHandler,
);
automationRouter.delete(
  "/automations/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  deleteAutomationHandler,
);
