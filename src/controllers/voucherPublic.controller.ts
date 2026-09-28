import type { Request, Response } from "express";
import { getDiscountVoucherPublicState } from "../services/discountVoucher.service";
import { asyncHandler } from "../utils/asyncHandler";
import { buildVoucherLandingHtml } from "../utils/voucherLanding";
import { buildVoucherPublicUrl } from "../utils/voucherPublicUrl";
import { sendQrNotFoundLanding } from "./qrPublic.controller";

// ---------------------------------------------------------------------------
// GET /vouchers/resolve/:id — lo que ve el cliente al abrir el link de su
// cupón de descuento (ítems 176 y 178 de docs/frontend-cambios-pendientes.md).
// Mismo molde que qrPublic.controller.ts: sin authenticate, sin /api, detrás
// de requireInternalProxySecret (montado en voucherPublic.routes.ts).
//
// HTML y no JSON: hasta el ítem 178 respondía JSON para que lo consumiera una
// página aparte, pero el Cloudflare Worker de nexoraqrs.com es un proxy puro
// que fuerza `Content-Type: text/html` en cualquier respuesta que no sea un
// redirect — el JSON le llegaba al navegador como texto crudo. Ahora el
// backend arma la página entera (utils/voucherLanding.ts), como la landing
// del QR, y el Worker la reenvía tal cual. Solo status y label — nada del
// contacto ni de la oportunidad.
//
// DEC-007 (anti-enumeración): un id que no existe o malformado responde
// EXACTAMENTE lo mismo que el gate cuando falta el secreto — la misma función
// (sendQrNotFoundLanding), no una copia. Quien prueba la URL cruda no puede
// distinguir "no hay cupón" de "no tenés el secreto".
// ---------------------------------------------------------------------------

// De solo lectura por construcción: abrir el link no consume el cupón.
export const resolveVoucherHandler = asyncHandler<Request>(async (req, res: Response) => {
  const id = req.params.id;
  const state = await getDiscountVoucherPublicState(id);
  if (!state) {
    sendQrNotFoundLanding(res);
    return;
  }
  const html = await buildVoucherLandingHtml(state, buildVoucherPublicUrl(id));
  res.status(200).type("html").send(html);
});
