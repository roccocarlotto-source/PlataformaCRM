import { Router } from "express";
import { consumeQrHandler, resolveQrHandler } from "../controllers/qrPublic.controller";
import { requireInternalProxySecret } from "../middlewares/requireInternalProxySecret";

export const qrPublicRouter = Router();

// ---------------------------------------------------------------------------
// Resolución pública de un QR (docs/qr-integration.md, Fase 2). SIN /api y SIN
// authenticate, a propósito — misma excepción que /health: no es JSON de
// negocio, un teléfono la abre directo desde la cámara. Es la URL que va
// impresa en el sticker, así que tiene que quedarse estable para siempre.
//
// PERO CON requireInternalProxySecret (Fase 4), en las dos rutas y ANTES del
// handler — el secreto se chequea antes de mirar siquiera el qrId, mismo orden
// que el original. Un teléfono no llega acá directo: llega a través del
// Cloudflare Worker, que es quien agrega el header. Sin el secreto (o sin
// ninguno configurado), la respuesta es el mismo 404 que un QR inexistente.
// Este gate es específico de este endpoint: /health y el resto de las rutas
// públicas no lo llevan.
//
// GET: de solo lectura por construcción. POST: el consumo de un single-use,
// que llega desde un <form method="POST"> real de la propia página del GET
// (sin JavaScript, sin token especial) — y ese POST también atraviesa el
// Worker, que le agrega el mismo header. Ver el controller.
// ---------------------------------------------------------------------------
qrPublicRouter.get("/qr/resolve/:qrId", requireInternalProxySecret, resolveQrHandler);
qrPublicRouter.post("/qr/resolve/:qrId", requireInternalProxySecret, consumeQrHandler);
