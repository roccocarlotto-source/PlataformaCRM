import { env } from "../config/env";

// ---------------------------------------------------------------------------
// URL pública de resolución de un QR — la que se codifica en la imagen y la
// que se comparte por WhatsApp/email.
//
// CORREGIDO 2026-09-04 (docs/qr-integration.md, gap de Fase 4 encontrado el
// mismo día): entre el 2026-09-03 y esta fecha, esta función armaba
// `${env.apiUrl}/qr/resolve/${qrId}` — directo contra el backend Express,
// esquivando por completo el Cloudflare Worker (`nexoraqrs.com/r/*`) que hace
// el rate limiting y agrega el header `x-internal-proxy-secret` que
// `requireInternalProxySecret` exige desde Fase 4. Con eso, todo link que
// generaba el CRM devolvía el 404 genérico al abrirse — como si el QR no
// existiera, aunque estuviera activo. El Worker ya estaba deployado y
// apuntando al backend real (`BACKEND_PUBLIC_BASE_URL`); lo único que faltaba
// era que el frontend armara el link CONTRA EL WORKER, no contra la API
// directa. Por eso ahora la base es `env.qrPublicBaseUrl`
// (`VITE_QR_PUBLIC_BASE_URL`, el dominio del Worker) y el path vuelve a ser
// `/r/${qrId}` — el mismo formato que el original de `Plataforma-QR` (ver la
// nota vieja de la decisión 6 en docs/qr-integration.md, que quedó obsoleta
// por este cambio).
//
// El backend sigue exponiendo /qr/resolve/:qrId sin /api (es una ruta
// pública, misma excepción que /health), pero esta función ya no le pega
// directo: el Worker es el único camino público válido — pegarle al backend
// sin el header es exactamente lo que /qr/resolve/:qrId rechaza a propósito.
// ---------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildPublicResolutionUrl(qrId: string): string {
  // Mismo chequeo que el original: un id que no es uuid nunca llega a formar
  // parte de un link que alguien pueda imprimir o mandar.
  if (!UUID_RE.test(qrId)) {
    throw new Error(`qrId tiene que ser un UUID válido, se recibió: ${qrId}`);
  }
  return `${env.qrPublicBaseUrl}/r/${qrId}`;
}
