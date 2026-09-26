import { Router } from "express";
import { createWhatsappTemplateHandlers } from "../controllers/whatsappTemplate.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";
import type { DepsDePlantillas } from "../services/whatsappTemplate.service";

// ---------------------------------------------------------------------------
// /api/whatsapp-templates (ítem 160). ADMIN-only INCLUIDA LA LECTURA, mismo
// criterio que apiKeyRouter: la pantalla es toda configuración, ningún USER la
// necesita, y el texto de la plantilla es cómo el negocio le escribe a sus
// clientes.
//
// businessWriteRateLimiter en las escrituras, en el mismo lugar que
// automation.routes.ts: después de authenticate (necesita req.auth.userId) y
// antes de authorize. Acá además frena que alguien le martille a Meta el alta
// o el refresh desde el CRM.
//
// Factory con las llamadas a Meta inyectables, para el test de integración;
// producción monta whatsappTemplateRouter, con las reales.
// ---------------------------------------------------------------------------

export function createWhatsappTemplateRouter(deps?: DepsDePlantillas) {
  const handlers = createWhatsappTemplateHandlers(deps);
  const router = Router();

  router.get("/whatsapp-templates", authenticate, authorize("ADMIN"), handlers.getCurrent);
  router.post(
    "/whatsapp-templates",
    authenticate,
    businessWriteRateLimiter,
    authorize("ADMIN"),
    handlers.create,
  );
  router.delete(
    "/whatsapp-templates/:id",
    authenticate,
    businessWriteRateLimiter,
    authorize("ADMIN"),
    handlers.remove,
  );
  router.post(
    "/whatsapp-templates/:id/refresh",
    authenticate,
    businessWriteRateLimiter,
    authorize("ADMIN"),
    handlers.refresh,
  );

  return router;
}

export const whatsappTemplateRouter = createWhatsappTemplateRouter();
