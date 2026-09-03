import { Router } from "express";
import {
  claimQrHandler,
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
// /qr/claim y /qr/digital son POST y /qr/:id es PATCH/DELETE, así que no
// compiten entre sí aunque "claim" y "digital" parezcan un :id.
// ---------------------------------------------------------------------------
qrRouter.get("/qr", authenticate, listQrHandler);

qrRouter.post(
  "/qr/claim",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  claimQrHandler,
);
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
