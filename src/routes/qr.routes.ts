import { Router } from "express";
import {
  createDigitalQrHandler,
  deleteQrHandler,
  listQrHandler,
  nextQrDisplayNumberHandler,
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

// El N° sugerido para un QR nuevo de una sucursal (§54 de
// docs/frontend-cambios-pendientes.md). Va ANTES de cualquier ruta con
// parámetro para que un segmento literal nunca compita con uno dinámico;
// hoy no hay GET /qr/:id, y si algún día lo hay, este orden ya lo previó.
//
// authenticate y nada más, como el listado: es una LECTURA, y la regla del
// router es lectura para cualquier usuario de la organización. Aunque solo le
// sirva a un ADMIN (crear es ADMIN), no expone nada que GET /qr no exponga ya
// — los N° de los QRs vienen en el listado.
qrRouter.get("/qr/next-display-number", authenticate, nextQrDisplayNumberHandler);

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
