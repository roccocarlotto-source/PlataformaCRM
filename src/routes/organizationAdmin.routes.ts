import { Router } from "express";
import { createOrganizationHandler } from "../controllers/organizationAdmin.controller";
import { authenticate } from "../middlewares/authenticate";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";
import { requirePlatformAdmin } from "../middlewares/requirePlatformAdmin";

export const organizationAdminRouter = Router();

// ---------------------------------------------------------------------------
// Alta de una organización nueva con su primer ADMIN por un platform admin
// (Fase 4a del módulo SaaS). Herramienta interna del operador de la
// plataforma, no un signup público: reemplaza en la práctica a
// POST /api/onboarding, que queda montado pero sin uso.
//
// Misma cadena exacta que qrAdmin.routes.ts: authenticate +
// businessWriteRateLimiter + requirePlatformAdmin, y NO authorize("ADMIN") —
// un PlatformAdmin es global, no un rol dentro de la Organization que está
// creando (ver middlewares/requirePlatformAdmin.ts). Vive en su propio router
// porque qrAdmin.routes.ts es específico del módulo QR.
// ---------------------------------------------------------------------------
organizationAdminRouter.post(
  "/admin/organizations",
  authenticate,
  businessWriteRateLimiter,
  requirePlatformAdmin,
  createOrganizationHandler,
);
