import type { Response } from "express";
import { z } from "zod";
import type { DepsDeRespuestaHumana } from "../services/conversationReply.service";
import { canjearDiscountVoucher } from "../services/discountVoucher.service";
import {
  crearCuponManual,
  crearCuponManualSchema,
  enviarCuponPorWhatsapp,
  estadoDelEnvioDelCupon,
  listarCuponesDelContacto,
} from "../services/discountVoucherManual.service";
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

// ---------------------------------------------------------------------------
// "Crear cupón" a mano (discountVoucherManual.service.ts). Factory por el
// envío por WhatsApp: los tests de integración inyectan un doble de Meta,
// mismo patrón que createConversationReplyHandlers.
// ---------------------------------------------------------------------------
export function createManualVoucherHandlers(deps?: DepsDeRespuestaHumana) {
  const actorDe = (req: AuthenticatedRequest) => ({
    userId: req.auth.userId,
    role: req.auth.role,
  });
  return {
    // POST /api/vouchers — 201 con el cupón, su estado y su link.
    create: asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
      const input = parseOrThrow(crearCuponManualSchema, req.body);
      const cupon = await crearCuponManual(actorDe(req), req.auth.organizationId, input);
      res.status(201).json(cupon);
    }),
    // GET /api/contacts/:id/vouchers — los cupones del contacto.
    listByContact: asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
      const contactId = parseOrThrow(idParamSchema, req.params.id);
      const data = await listarCuponesDelContacto(req.auth.organizationId, contactId);
      res.status(200).json({ data });
    }),
    // GET /api/vouchers/:id/whatsapp — si se puede mandar ahora, o por qué no.
    whatsappStatus: asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
      const id = parseOrThrow(idParamSchema, req.params.id);
      res.status(200).json(await estadoDelEnvioDelCupon(req.auth.organizationId, id));
    }),
    // POST /api/vouchers/:id/whatsapp — lo manda (texto libre con el link).
    sendWhatsapp: asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
      const id = parseOrThrow(idParamSchema, req.params.id);
      const resultado = await enviarCuponPorWhatsapp(
        actorDe(req),
        req.auth.organizationId,
        id,
        deps,
      );
      res.status(200).json(resultado);
    }),
  };
}
