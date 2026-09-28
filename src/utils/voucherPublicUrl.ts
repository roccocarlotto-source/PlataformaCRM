import { env } from "../config/env";

// ---------------------------------------------------------------------------
// El link público de un cupón de descuento: `${QR_PUBLIC_BASE_URL}/v/:id`, el
// path que el Cloudflare Worker de nexoraqrs.com reenvía a
// GET /vouchers/resolve/:id (ítem 178; ver docs/qr-integration.md, "Cloudflare
// Worker — repunte"). Un solo lugar que lo arma: lo codifica el QR de la
// página del cupón, y es el mismo link que le tiene que llegar al cliente.
//
// Sin QR_PUBLIC_BASE_URL devuelve el id pelado: no hay dominio que inventar, y
// la pantalla de escaneo del CRM canjea igual (toma el UUID del final del
// texto). `base` es parámetro para probarlo sin tocar env.
// ---------------------------------------------------------------------------

export function buildVoucherPublicUrl(
  id: string,
  base: string | undefined = env.QR_PUBLIC_BASE_URL,
): string {
  return base ? `${base}/v/${id}` : id;
}
