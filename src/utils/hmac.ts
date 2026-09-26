import { createHmac, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Primitivas de firma HMAC-SHA256 en hex, hoy usadas por el webhook de
// WhatsApp (controllers/whatsappWebhook.controller.ts, sobre el cuerpo crudo).
// Nacieron en mercadopagoSignature.ts —el webhook de la suscripción aparte del
// módulo QR— y se mudaron acá en el ítem 81, cuando apareció WhatsApp como
// segundo consumidor; el de MercadoPago se retiró en el ítem 135.
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
