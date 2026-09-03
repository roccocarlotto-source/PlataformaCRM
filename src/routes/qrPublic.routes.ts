import { Router } from "express";
import { consumeQrHandler, resolveQrHandler } from "../controllers/qrPublic.controller";

export const qrPublicRouter = Router();

// ---------------------------------------------------------------------------
// Resolución pública de un QR (docs/qr-integration.md, Fase 2). SIN /api y SIN
// authenticate, a propósito — misma excepción que /health: no es JSON de
// negocio, un teléfono la abre directo desde la cámara. Es la URL que va
// impresa en el sticker, así que tiene que quedarse estable para siempre.
//
// GET: de solo lectura por construcción. POST: el consumo de un single-use,
// que llega desde un <form method="POST"> real de la propia página del GET
// (sin JavaScript, sin token especial). Ver el controller.
// ---------------------------------------------------------------------------
qrPublicRouter.get("/qr/resolve/:qrId", resolveQrHandler);
qrPublicRouter.post("/qr/resolve/:qrId", consumeQrHandler);
