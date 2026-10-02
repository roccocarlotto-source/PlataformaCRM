import { Router } from "express";
import { createAutomationHandlers } from "../controllers/automation.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";
import type { DepsDeReglaConMensaje } from "../services/automationWhatsapp.service";

// Mismo esquema de permisos que agent.routes.ts y el resto de los CRUD de
// configuración (branches, resources, service types): lectura para cualquier
// usuario autenticado de la organización, escritura solo ADMIN — es lo que
// docs/automations-architecture.md §8 pide para /api/automations.
//
// businessWriteRateLimiter (R1.9) va después de authenticate —necesita
// req.auth.userId— y antes de authorize. Mismo orden que agent.routes.ts.
//
// Factory para que los tests de integración le pasen un doble de Meta (las
// reglas que mandan WhatsApp sincronizan su plantilla al guardarse);
// producción monta automationRouter, con las dependencias reales.
export function createAutomationRouter(deps?: DepsDeReglaConMensaje) {
  const handlers = createAutomationHandlers(deps);
  const router = Router();

  router.get("/automations", authenticate, handlers.list);
  router.get("/automations/:id", authenticate, handlers.get);

  router.post(
    "/automations",
    authenticate,
    businessWriteRateLimiter,
    authorize("ADMIN"),
    handlers.create,
  );
  router.patch(
    "/automations/:id",
    authenticate,
    businessWriteRateLimiter,
    authorize("ADMIN"),
    handlers.update,
  );
  router.delete(
    "/automations/:id",
    authenticate,
    businessWriteRateLimiter,
    authorize("ADMIN"),
    handlers.remove,
  );
  // El estado de aprobación de WhatsApp, repreguntado a Meta. ADMIN, como
  // la escritura: dispara llamadas a Meta.
  router.post(
    "/automations/:id/whatsapp-approval/refresh",
    authenticate,
    businessWriteRateLimiter,
    authorize("ADMIN"),
    handlers.refreshWhatsappApproval,
  );

  return router;
}

export const automationRouter = createAutomationRouter();
