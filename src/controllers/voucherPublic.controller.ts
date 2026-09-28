import type { Request, Response } from "express";
import { getDiscountVoucherPublicState } from "../services/discountVoucher.service";
import { asyncHandler } from "../utils/asyncHandler";
import { sendQrNotFoundLanding } from "./qrPublic.controller";

// ---------------------------------------------------------------------------
// GET /vouchers/resolve/:id — lo que ve el cliente al abrir el link de su
// cupón de descuento (ítem 176 de docs/frontend-cambios-pendientes.md). Mismo
// molde que qrPublic.controller.ts: sin authenticate, sin /api, detrás de
// requireInternalProxySecret (montado en voucherPublic.routes.ts).
//
// JSON y no HTML ni redirect, a diferencia del QR: el que lo consume es la
// página del cupón (ítem 178), que muestra el QR y "Activo" / "Ya canjeado" /
// "Vencido". Solo status y label — nada del contacto ni de la oportunidad.
//
// DEC-007 (anti-enumeración): un id que no existe o malformado responde
// EXACTAMENTE lo mismo que el gate cuando falta el secreto — la misma función
// (sendQrNotFoundLanding), no una copia. Quien prueba la URL cruda no puede
// distinguir "no hay cupón" de "no tenés el secreto".
// ---------------------------------------------------------------------------

// De solo lectura por construcción: abrir el link no consume el cupón.
export const resolveVoucherHandler = asyncHandler<Request>(async (req, res: Response) => {
  const state = await getDiscountVoucherPublicState(req.params.id);
  if (!state) {
    sendQrNotFoundLanding(res);
    return;
  }
  res.status(200).json(state);
});
