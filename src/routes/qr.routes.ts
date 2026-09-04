import { Router } from "express";
import {
  createDigitalQrHandler,
  deleteQrHandler,
  listQrHandler,
  updateQrHandler,
} from "../controllers/qr.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const qrRouter = Router();

// ---------------------------------------------------------------------------
// Gestión de QRs de la organización (docs/qr-integration.md, Fase 2). Mismo
// esquema de permisos que branchRouter/resourceRouter: lectura para cualquier
// usuario autenticado de la organización, escritura solo ADMIN.
//
// businessWriteRateLimiter va después de authenticate —necesita
// req.auth.userId— y antes de authorize. Mismo orden que branch.routes.ts.
//
// /qr/claim existió acá hasta 20260904120000_remove_qr_claim_and_single_use:
// el QR físico se eliminó, así que /qr/digital es hoy el único POST de
// creación (y /qr/:id sigue siendo PATCH/DELETE, sin competir con "digital").
// ---------------------------------------------------------------------------
qrRouter.get("/qr", authenticate, listQrHandler);

qrRouter.post(
  "/qr/digital",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  createDigitalQrHandler,
);
qrRouter.patch(
  "/qr/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  updateQrHandler,
);
qrRouter.delete(
  "/qr/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  deleteQrHandler,
);
