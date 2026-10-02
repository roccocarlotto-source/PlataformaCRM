import QRCode from "qrcode";
import { env } from "../config/env";
import { buildVoucherPublicUrl } from "./voucherPublicUrl";

// ---------------------------------------------------------------------------
// La imagen del QR que va de encabezado en el WhatsApp de seguimiento (formato
// "solo imagen" o "link e imagen" de las reglas del QR y del cupón).
//
// Meta no recibe los bytes: recibe un link (`header.parameters[0].image.link`)
// y baja la imagen él mismo al mandar el mensaje. Así que hace falta una URL
// pública que devuelva el PNG: GET /qr-images/:tipo/:id.png de este backend
// (routes/qrImage.routes.ts).
//
// NO EXPONE NADA QUE EL LINK NO EXPONGA YA. El PNG es una función pura del
// UUID de la URL: codifica el mismo link público que el cliente recibe en el
// texto (`/r/:id` del QR de la sucursal, `/v/:id` del cupón). No toca la base
// — no dice si el QR o el cupón existen, ni de quién son —, así que tampoco
// sirve para enumerar ids: un UUID cualquiera devuelve un QR igual de válido
// que uno real. Por eso no va detrás del secreto del Worker como
// /qr/resolve: no hay nada que proteger.
//
// Por qué en el backend y no en el Worker de nexoraqrs.com: el Worker hoy solo
// reenvía /r/* y /v/* (y es otro repo con su propio deploy). Esto sale con el
// backend, y el día que se quiera servir desde nexoraqrs.com alcanza con que
// el Worker reenvíe /qr-images/* tal cual — el endpoint ya no depende de nada.
// ---------------------------------------------------------------------------

export const TIPOS_DE_QR = ["r", "v"] as const;
export type TipoDeQr = (typeof TIPOS_DE_QR)[number];

export function esTipoDeQr(valor: string): valor is TipoDeQr {
  return (TIPOS_DE_QR as readonly string[]).includes(valor);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Lo que codifica el QR: el link público del QR de la sucursal o del cupón, el
// mismo que va en el texto del mensaje. Null si no hay forma de armarlo: un QR
// de sucursal sin QR_PUBLIC_BASE_URL no tiene link (el del cupón cae al id
// pelado, que la pantalla de canje acepta igual — buildVoucherPublicUrl).
export function contenidoDelQr(
  tipo: TipoDeQr,
  id: string,
  qrPublicBaseUrl: string | undefined = env.QR_PUBLIC_BASE_URL,
): string | null {
  if (!UUID_RE.test(id)) return null;
  const idNormalizado = id.toLowerCase();
  if (tipo === "v") return buildVoucherPublicUrl(idNormalizado, qrPublicBaseUrl);
  return qrPublicBaseUrl ? `${qrPublicBaseUrl}/r/${idNormalizado}` : null;
}

// 640 px: Meta muestra el encabezado al ancho del globo y lo comprime; más
// chico se ve borroso y deja de escanearse desde otra pantalla.
export function qrPng(contenido: string): Promise<Buffer> {
  return QRCode.toBuffer(contenido, { type: "png", width: 640, margin: 2 });
}

// El origen público de este backend: PUBLIC_API_BASE_URL, o la URL que Render
// define sola. Undefined si no hay ninguna.
export function baseDeLaApiPublica(
  fuente: { PUBLIC_API_BASE_URL?: string; RENDER_EXTERNAL_URL?: string } = env,
): string | undefined {
  return fuente.PUBLIC_API_BASE_URL ?? fuente.RENDER_EXTERNAL_URL;
}

// La URL que se le pasa a Meta como imagen del encabezado. Null si el backend
// no conoce su propia URL pública: con eso no hay imagen posible.
export function buildQrImageUrl(
  tipo: TipoDeQr,
  id: string,
  base: string | undefined = baseDeLaApiPublica(),
): string | null {
  return base && UUID_RE.test(id) ? `${base}/qr-images/${tipo}/${id.toLowerCase()}.png` : null;
}
