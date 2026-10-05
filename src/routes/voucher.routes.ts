import { Router } from "express";
import {
  createManualVoucherHandlers,
  redeemVoucherHandler,
} from "../controllers/voucher.controller";
import { authenticate } from "../middlewares/authenticate";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";
import type { DepsDeRespuestaHumana } from "../services/conversationReply.service";

// Factory: los tests de integración del alta manual inyectan el doble de Meta
// (mismo patrón que createConversationRouter).
export function createVoucherRouter(deps?: DepsDeRespuestaHumana) {
  const router = Router();
  const manual = createManualVoucherHandlers(deps);

  // Canje de un cupón de descuento (ítem 176). SIN authorize, a propósito:
  // cualquier usuario de la organización puede canjear — el que está en el
  // mostrador del taller no tiene por qué ser ADMIN (decisión de producto). El
  // businessWriteRateLimiter va igual, en el mismo lugar que en el resto de las
  // escrituras: es un límite por volumen de escritura, no por rol.
  router.post("/vouchers/:id/redeem", authenticate, businessWriteRateLimiter, redeemVoucherHandler);

  // "Crear cupón" a mano (discountVoucherManual.service.ts). SIN authorize:
  // ADMIN y USER; el service acota al USER a sus contactos y oportunidades
  // asignados (403). Listar es abierto, como leer el contacto.
  router.post("/vouchers", authenticate, businessWriteRateLimiter, manual.create);
  router.get("/contacts/:id/vouchers", authenticate, manual.listByContact);
  router.get("/vouchers/:id/whatsapp", authenticate, manual.whatsappStatus);
  router.post(
    "/vouchers/:id/whatsapp",
    authenticate,
    businessWriteRateLimiter,
    manual.sendWhatsapp,
  );
  return router;
}

export const voucherRouter = createVoucherRouter();
