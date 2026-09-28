import type { Response } from "express";
import { z } from "zod";
import { canjearDiscountVoucher } from "../services/discountVoucher.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

const idParamSchema = z.string().uuid("id inválido");

// POST /api/vouchers/:id/redeem — el canje de un cupón de descuento (ítem
// 176): lo dispara un empleado escaneando el QR del cliente desde el CRM
// (pantalla del ítem 178). 200 con la fila ya CONSUMED; 409 si ya estaba
// canjeado o venció; 404 si no existe o es de otra organización.
export const redeemVoucherHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const cupon = await canjearDiscountVoucher(req.auth.organizationId, id, req.auth.userId);
    res.status(200).json(cupon);
  },
);
