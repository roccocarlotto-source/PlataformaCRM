import { env } from "../../config/env";

// ---------------------------------------------------------------------------
// Qué es lo que se escaneó o se pegó en "Canjear cupón". El QR de la página
// del cupón codifica su link público (`https://nexoraqrs.com/v/:id`, ver
// src/utils/voucherPublicUrl.ts del backend) — o el id pelado, si el backend
// no tiene QR_PUBLIC_BASE_URL. Solo esas dos formas van al canje.
//
// Hasta acá se tomaba cualquier UUID al final del texto, y el QR de reseñas
// (`…/r/:id`, ver lib/publicUrl.ts) también termina en UUID: se mandaba al
// canje y el backend contestaba "El cupón no existe", que no le dice al
// empleado qué hizo mal. Ahora se distingue sin llamar al backend:
// - `cupon`: `/v/<uuid>` en el dominio de los QR, o un UUID pelado;
// - `qr-resenas`: `/r/<uuid>` en ese dominio — el otro QR que el cliente
//   puede tener a mano;
// - `no-es-cupon`: cualquier otra cosa (otro dominio, sin UUID, otra ruta).
//
// Se toleran una barra final, un query o un hash que agregue quien lo
// comparte, el link sin `https://` (tipeado a mano) y el `www.` de más o de
// menos. `base` es parámetro para probarlo sin tocar env.
// ---------------------------------------------------------------------------

export type CodigoEscaneado =
  { tipo: "cupon"; id: string } | { tipo: "qr-resenas" } | { tipo: "no-es-cupon" };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_PELADO = new RegExp(`^${UUID}$`, "i");
const RUTA_DEL_QR = new RegExp(`^/(v|r)/(${UUID})/?$`, "i");

function hostSinWww(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function comoUrl(texto: string): URL | null {
  const conEsquema = /^[a-z][a-z0-9+.-]*:\/\//i.test(texto) ? texto : `https://${texto}`;
  try {
    return new URL(conEsquema);
  } catch {
    return null;
  }
}

export function leerCodigoEscaneado(
  texto: string,
  base: string = env.qrPublicBaseUrl,
): CodigoEscaneado {
  const limpio = texto.trim();
  if (UUID_PELADO.test(limpio)) return { tipo: "cupon", id: limpio.toLowerCase() };

  const url = comoUrl(limpio);
  const baseUrl = comoUrl(base);
  if (url === null || baseUrl === null || hostSinWww(url) !== hostSinWww(baseUrl)) {
    return { tipo: "no-es-cupon" };
  }
  const match = RUTA_DEL_QR.exec(url.pathname);
  if (match === null) return { tipo: "no-es-cupon" };
  return match[1].toLowerCase() === "v"
    ? { tipo: "cupon", id: match[2].toLowerCase() }
    : { tipo: "qr-resenas" };
}
