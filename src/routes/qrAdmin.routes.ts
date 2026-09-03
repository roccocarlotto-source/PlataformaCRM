import { Router } from "express";
import {
  setQrBillingExemptionHandler,
  setQrSubscriptionStatusHandler,
} from "../controllers/qrAdmin.controller";
import { authenticate } from "../middlewares/authenticate";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";
import { requirePlatformAdmin } from "../middlewares/requirePlatformAdmin";

export const qrAdminRouter = Router();

// ---------------------------------------------------------------------------
// Activación manual del módulo QR por un platform admin (docs/qr-integration.md,
// Fase 2): el camino para pagos en efectivo/transferencia y para exenciones
// comerciales, al margen del webhook de MercadoPago.
//
// authenticate + requirePlatformAdmin, y NO authorize("ADMIN") — deliberado:
// un PlatformAdmin es global, no un rol dentro de la Organization sobre la que
// actúa (ver middlewares/requirePlatformAdmin.ts). businessWriteRateLimiter en
// el mismo lugar que en el resto de las escrituras autenticadas.
// ---------------------------------------------------------------------------
qrAdminRouter.post(
  "/admin/organizations/:organizationId/qr-subscription-status",
  authenticate,
  businessWriteRateLimiter,
  requirePlatformAdmin,
  setQrSubscriptionStatusHandler,
);

qrAdminRouter.post(
  "/admin/organizations/:organizationId/qr-billing-exemption",
  authenticate,
  businessWriteRateLimiter,
  requirePlatformAdmin,
  setQrBillingExemptionHandler,
);
