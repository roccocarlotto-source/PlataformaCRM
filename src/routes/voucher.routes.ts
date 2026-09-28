import { Router } from "express";
import { redeemVoucherHandler } from "../controllers/voucher.controller";
import { authenticate } from "../middlewares/authenticate";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const voucherRouter = Router();

// Canje de un cupón de descuento (ítem 176). SIN authorize, a propósito:
// cualquier usuario de la organización puede canjear — el que está en el
// mostrador del taller no tiene por qué ser ADMIN (decisión de producto). El
// businessWriteRateLimiter va igual, en el mismo lugar que en el resto de las
// escrituras: es un límite por volumen de escritura, no por rol.
voucherRouter.post(
  "/vouchers/:id/redeem",
  authenticate,
  businessWriteRateLimiter,
  redeemVoucherHandler,
);
