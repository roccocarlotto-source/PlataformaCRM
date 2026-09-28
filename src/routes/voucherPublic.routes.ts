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
// punta a punta hace falta sumarle la ruta del cupón. No bloquea este ítem
// (todavía no se le manda ningún link a un cliente); sí bloquea el 177/178.
// Ver el ítem 176 de docs/frontend-cambios-pendientes.md.
// ---------------------------------------------------------------------------
voucherPublicRouter.get("/vouchers/resolve/:id", requireInternalProxySecret, resolveVoucherHandler);
