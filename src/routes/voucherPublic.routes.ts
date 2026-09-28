import { Router } from "express";
import { resolveVoucherHandler } from "../controllers/voucherPublic.controller";
import { requireInternalProxySecret } from "../middlewares/requireInternalProxySecret";

export const voucherPublicRouter = Router();

// ---------------------------------------------------------------------------
// Estado público de un cupón de descuento (ítem 176). SIN /api y SIN
// authenticate, con requireInternalProxySecret ANTES del handler — mismo molde
// exacto que qrPublic.routes.ts, y el mismo secreto (QR_RESOLVE_PROXY_SECRET):
// quien llega acá es el mismo Cloudflare Worker de nexoraqrs.com.
//
// PENDIENTE FUERA DE ESTE REPO: hoy ese Worker (repo Plataforma-QR) solo
// enruta /r/:qrId -> /qr/resolve/:qrId. Para que el link del cupón funcione de
// punta a punta hace falta sumarle /v/:id -> /vouchers/resolve/:id (el path
// que arma utils/voucherPublicUrl.ts), sin otro cambio de lógica: la respuesta
// es HTML y el Worker la reenvía tal cual. Bloquea que un link de cupón le
// llegue a un cliente real. Ver los ítems 176 y 178 de
// docs/frontend-cambios-pendientes.md.
// ---------------------------------------------------------------------------
voucherPublicRouter.get("/vouchers/resolve/:id", requireInternalProxySecret, resolveVoucherHandler);
