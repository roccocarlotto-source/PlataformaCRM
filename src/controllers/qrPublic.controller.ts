import type { Request, Response } from "express";
import { env } from "../config/env";
import type { QrPublicState } from "../repositories/qrCode.repository";
import { consumeSingleUseQr, getQrPublicState } from "../services/qrPublic.service";
import { asyncHandler } from "../utils/asyncHandler";
import {
  buildLandingHtml,
  buildSingleUseConfirmHtml,
  buildSingleUseUsedHtml,
} from "../utils/qrLanding";

// ---------------------------------------------------------------------------
// GET/POST /qr/resolve/:qrId — resolución pública de un QR (puerto de
// resolve/index.ts del original; docs/qr-integration.md, Fase 2).
//
// SIN authenticate, SIN AuthenticatedRequest y SIN /api: un teléfono abre esta
// URL directo desde la cámara, no hay sesión ni JSON de negocio — misma
// excepción que /health. El X-Internal-Proxy-Secret del original vive en
// middlewares/requireInternalProxySecret.ts (Fase 4), montado ANTES de estos
// handlers en qrPublic.routes.ts: acá se llega solo con el secreto válido.
//
// DEC-007 (anti-enumeración): un id que no existe, uno malformado, uno borrado
// y uno con la suscripción vencida renderizan la misma landing. La única
// excepción deliberada es "single-use ya usado" — ese motivo no es información
// sensible del negocio.
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

// Único lugar que convierte un estado público en una respuesta — compartido
// por el GET y por el fallback del POST (un POST que no consumió nada, por el
// motivo que sea, relee el estado real y lo muestra exactamente como un GET).
// Un REUSABLE renderiza idéntico llegue por GET o por POST: el POST no cambia
// nada de su semántica.
function renderPublicState(res: Response, state: QrPublicState | null, qrId: string): void {
  if (!state) {
    sendQrNotFoundLanding(res);
    return;
  }

  const claimAppUrl = env.QR_CLAIM_APP_URL;

  if (state.qrType === "REUSABLE") {
    if (state.canRedirect && state.destinationUrl) {
      res.redirect(302, state.destinationUrl);
      return;
    }
    // Suscripción vencida y sin exención: landing genérica, con link de claim.
    sendHtml(res, 200, buildLandingHtml({ qrId, claimAppUrl }));
    return;
  }

  // SINGLE_USE
  if (state.isUsed) {
    sendHtml(res, 200, buildSingleUseUsedHtml());
    return;
  }
  if (!state.canRedirect) {
    // Misma landing genérica que el reusable inactivo — NO "ya usado", así
    // que no es la excepción de DEC-007 (Cycle 27 §7 original).
    sendHtml(res, 200, buildLandingHtml({ qrId, claimAppUrl }));
    return;
  }
  // La página con el botón "Continuar", sin consumir nada todavía — el GET
  // nunca escribe.
  sendHtml(res, 200, buildSingleUseConfirmHtml());
}

// GET — de solo lectura por construcción (getQrPublicState nunca escribe).
export const resolveQrHandler = asyncHandler<Request>(async (req, res: Response) => {
  const qrId = req.params.qrId;
  const state = await getQrPublicState(qrId);
  renderPublicState(res, state, qrId);
});

// POST — consumo de un single-use. Solo el botón "Continuar" llega acá (un
// <form method="POST"> real, sin JavaScript). Body vacío, sin JSON.
//
// consumeSingleUseQr es un único UPDATE atómico: para un reusable, un
// single-use ya usado, una organización inactiva, o un id borrado/inexistente,
// matchea cero filas y devuelve null — nunca aplica parcialmente. Con null se
// relee el estado real por el mismo camino que el GET, así que la respuesta
// siempre es exacta: nunca se asume "ya usado" solo porque el UPDATE no pegó.
export const consumeQrHandler = asyncHandler<Request>(async (req, res: Response) => {
  const qrId = req.params.qrId;

  const consumedUrl = await consumeSingleUseQr(qrId);
  if (consumedUrl) {
    res.redirect(302, consumedUrl);
    return;
  }

  const state = await getQrPublicState(qrId);
  renderPublicState(res, state, qrId);
});
