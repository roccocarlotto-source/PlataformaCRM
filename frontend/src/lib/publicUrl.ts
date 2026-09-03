import { env } from "../config/env";

// ---------------------------------------------------------------------------
// URL pública de resolución de un QR — la que se codifica en la imagen y la
// que se comparte por WhatsApp/email. Reescrito al portar (docs/qr-integration.md,
// Fase 3, decisión 6): el original armaba `${domain}/r/${qrId}` con un dominio
// propio del admin porque el Edge Function vivía en otro host. Acá
// qrPublicRouter está montado en el mismo Express que el resto de la API, así
// que la base es env.apiUrl y no hace falta ninguna env var nueva.
//
// SIN /api, a propósito: /qr/resolve/:qrId es una ruta pública (misma
// excepción que /health — un teléfono la abre desde la cámara, no es JSON de
// negocio), montada fuera del prefijo /api. Por eso esta función arma la URL
// directo sobre env.apiUrl y no pasa por request()/buildUrl() de lib/api.ts,
// que prefijan /api siempre.
// ---------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildPublicResolutionUrl(qrId: string): string {
  // Mismo chequeo que el original: un id que no es uuid nunca llega a formar
  // parte de un link que alguien pueda imprimir o mandar.
  if (!UUID_RE.test(qrId)) {
    throw new Error(`qrId tiene que ser un UUID válido, se recibió: ${qrId}`);
  }
  return `${env.apiUrl}/qr/resolve/${qrId}`;
}
