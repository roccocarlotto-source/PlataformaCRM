import { createHmac, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Primitivas de firma HMAC compartidas por los webhooks que verifican una
// firma HMAC-SHA256 en hex: MercadoPago (utils/mercadopagoSignature.ts, sobre
// un manifiesto de headers + query) y WhatsApp (middlewares/whatsappSignature.ts,
// sobre el cuerpo crudo). Vivían en mercadopagoSignature.ts hasta el ítem 81;
// se mudaron acá cuando apareció el segundo consumidor, sin cambiar nada.
// ---------------------------------------------------------------------------

// `message` acepta Buffer además de string: WhatsApp firma los BYTES crudos
// del cuerpo, y convertirlos a string antes de hashear podría alterar algo que
// no sea UTF-8 válido. Para un string el resultado es idéntico al de siempre.
export function hmacSha256Hex(secret: string, message: string | Buffer): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

// Comparación en tiempo constante sobre strings. Node solo ofrece
// crypto.timingSafeEqual sobre buffers del MISMO largo (tira si difieren), así
// que el largo se compara antes — igual que el original, donde un largo
// distinto era un `false` directo. Que el largo se filtre no es un problema:
// el largo de un HMAC hex es público (64). NO sirve para comparar secretos de
// largo variable: para eso está secretsMatch en requireInternalProxySecret.ts.
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return nodeTimingSafeEqual(bufA, bufB);
}
