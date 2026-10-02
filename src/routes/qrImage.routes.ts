import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { contenidoDelQr, esTipoDeQr, qrPng } from "../utils/qrImage";

export const qrImageRouter = Router();

// ---------------------------------------------------------------------------
// GET /qr-images/:tipo/:archivo — el PNG del QR de una sucursal (`r`) o de un
// cupón (`v`), para el encabezado del WhatsApp de seguimiento. Meta lo baja
// al mandar el mensaje. SIN /api, sin authenticate y SIN el secreto del
// Worker, a diferencia de /qr/resolve: es una función pura del UUID que no
// toca la base ni dice nada que el link no diga (ver utils/qrImage.ts).
//
// `archivo` es `<uuid>.png`: la extensión en la URL es para quien la mire (y
// para clientes que deciden el tipo por ella). Cualquier otra cosa es un 404
// sin cuerpo, el mismo para un tipo desconocido, un id malformado o un QR de
// sucursal sin QR_PUBLIC_BASE_URL.
//
// Cacheable para siempre: la misma URL devuelve siempre los mismos bytes.
// ---------------------------------------------------------------------------
const ARCHIVO_RE = /^([0-9a-f-]{36})\.png$/i;

qrImageRouter.get(
  "/qr-images/:tipo/:archivo",
  asyncHandler<Request>(async (req, res: Response) => {
    const { tipo, archivo } = req.params;
    const id = ARCHIVO_RE.exec(archivo)?.[1];
    const contenido = esTipoDeQr(tipo) && id ? contenidoDelQr(tipo, id) : null;
    if (!contenido) {
      res.status(404).end();
      return;
    }
    const png = await qrPng(contenido);
    res
      .status(200)
      .type("png")
      .set("Cache-Control", "public, max-age=31536000, immutable")
      // Helmet la deja en same-origin; esto es un recurso público a propósito.
      .set("Cross-Origin-Resource-Policy", "cross-origin")
      .send(png);
  }),
);
