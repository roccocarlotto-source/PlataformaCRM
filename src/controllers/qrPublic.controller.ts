import type { Request, Response } from "express";
import type { QrPublicState } from "../repositories/qrCode.repository";
import { getQrPublicState } from "../services/qrPublic.service";
import { asyncHandler } from "../utils/asyncHandler";
import { buildLandingHtml } from "../utils/qrLanding";

// ---------------------------------------------------------------------------
// GET /qr/resolve/:qrId — resolución pública de un QR (puerto de
// resolve/index.ts del original; docs/qr-integration.md, Fase 2).
//
// SIN authenticate, SIN AuthenticatedRequest y SIN /api: un link se abre
// directo, no hay sesión ni JSON de negocio — misma excepción que /health. El
// X-Internal-Proxy-Secret del original vive en
// middlewares/requireInternalProxySecret.ts (Fase 4), montado ANTES de este
// handler en qrPublic.routes.ts: acá se llega solo con el secreto válido.
//
// DEC-007 (anti-enumeración): un id que no existe, uno malformado, uno borrado
// y uno con la suscripción vencida renderizan la misma landing.
//
// HASTA 20260904120000_remove_qr_claim_and_single_use este archivo también
// tenía consumeQrHandler (el POST del botón "Continuar" de un QR de un solo
// uso) y el árbol de estados se ramificaba en qrType/isUsed. Se eliminaron
// junto con el resto del single-use y del claim físico — ver
// docs/qr-integration.md, sección "Qué se desvió".
// ---------------------------------------------------------------------------

function sendHtml(res: Response, status: number, html: string): void {
  res.status(status).type("html").send(html);
}

// El 404 de "no existe / malformado / borrado": la landing genérica sin link
// de claim — no tiene sentido ofrecer reclamar un id que no existe. Exportado
// porque requireInternalProxySecret responde EXACTAMENTE esto cuando el
// secreto falla: la misma función, no una copia, para que las dos respuestas
// sean byte a byte indistinguibles (DEC-007).
export function sendQrNotFoundLanding(res: Response): void {
  sendHtml(res, 404, buildLandingHtml());
}

// Único lugar que convierte un estado público en una respuesta.
function renderPublicState(res: Response, state: QrPublicState | null): void {
  if (!state) {
    sendQrNotFoundLanding(res);
    return;
  }

  if (state.canRedirect) {
    res.redirect(302, state.destinationUrl);
    return;
  }
  // Suscripción vencida y sin exención: landing genérica.
  sendHtml(res, 200, buildLandingHtml());
}

// GET — de solo lectura por construcción (getQrPublicState nunca escribe).
export const resolveQrHandler = asyncHandler<Request>(async (req, res: Response) => {
  const qrId = req.params.qrId;
  const state = await getQrPublicState(qrId);
  renderPublicState(res, state);
});
