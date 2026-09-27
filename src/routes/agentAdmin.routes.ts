import { Router } from "express";
import {
  asignarNumeroDeWhatsappHandler,
  asignarPaginaDeFacebookHandler,
} from "../controllers/agentAdmin.controller";
import { authenticate } from "../middlewares/authenticate";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";
import { requirePlatformAdmin } from "../middlewares/requirePlatformAdmin";

export const agentAdminRouter = Router();

// ---------------------------------------------------------------------------
// Asignación del número de WhatsApp de un agente por un platform admin (ítem
// 127). Es el único camino que escribe agents.whatsapp_phone_number_id: el
// CRUD del tenant ya no lo cambia (ver agent.service.ts).
//
// Misma cadena exacta que organizationAdmin.routes.ts:
// authenticate + businessWriteRateLimiter + requirePlatformAdmin, y NO
// authorize("ADMIN") — un PlatformAdmin es global, no un rol dentro de la
// organización del agente.
// ---------------------------------------------------------------------------
agentAdminRouter.put(
  "/admin/agents/:agentId/whatsapp-phone-number",
  authenticate,
  businessWriteRateLimiter,
  requirePlatformAdmin,
  asignarNumeroDeWhatsappHandler,
);

// La página de Facebook del agente (ítem 169), con la misma cadena exacta: es
// el único camino que escribe agents.facebook_page_id.
agentAdminRouter.put(
  "/admin/agents/:agentId/facebook-page",
  authenticate,
  businessWriteRateLimiter,
  requirePlatformAdmin,
  asignarPaginaDeFacebookHandler,
);
