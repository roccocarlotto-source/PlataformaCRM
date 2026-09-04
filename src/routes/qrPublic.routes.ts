import { Router } from "express";
import { resolveQrHandler } from "../controllers/qrPublic.controller";
import { requireInternalProxySecret } from "../middlewares/requireInternalProxySecret";

export const qrPublicRouter = Router();

// ---------------------------------------------------------------------------
// Resolución pública de un QR (docs/qr-integration.md, Fase 2). SIN /api y SIN
// authenticate, a propósito — misma excepción que /health: no es JSON de
// negocio, se abre directo desde un link. Es la URL que va detrás del QR/link
// que se comparte, así que tiene que quedarse estable para siempre.
//
// PERO CON requireInternalProxySecret (Fase 4), ANTES del handler — el
// secreto se chequea antes de mirar siquiera el qrId, mismo orden que el
// original. No se llega acá directo: se llega a través del Cloudflare Worker,
// que es quien agrega el header. Sin el secreto (o sin ninguno configurado),
// la respuesta es el mismo 404 que un QR inexistente. Este gate es específico
// de este endpoint: /health y el resto de las rutas públicas no lo llevan.
//
// De solo lectura por construcción (getQrPublicState nunca escribe). Hasta
// 20260904120000_remove_qr_claim_and_single_use esta ruta también tenía un
// POST para el consumo de un single-use — se eliminó junto con esa
// funcionalidad.
// ---------------------------------------------------------------------------
qrPublicRouter.get("/qr/resolve/:qrId", requireInternalProxySecret, resolveQrHandler);
