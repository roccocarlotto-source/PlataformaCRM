import { createHmac, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Verificación de firma de los webhooks de MercadoPago — puerto 1:1 de
// Plataforma-QR/supabase/functions/_shared/mercadopago.ts (DEC-013 / D3 del
// original), con `crypto.createHmac` de Node en vez de `crypto.subtle`.
// Mismo algoritmo, mismas constantes, misma semántica; por eso es síncrono
// donde el original era async.
//
// MercadoPago manda dos headers en cada request:
//   x-signature:  "ts=<unix-seconds>,v1=<hex-hmac>"
//   x-request-id: "<request id>"
// y el id del recurso notificado como query param (`data.id` o `id`).
//
// La firma esperada es HMAC-SHA256, con el secreto del webhook de la
// integración, sobre el manifiesto:
//   "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
//
// LA FIRMA NO CUBRE EL BODY — es una propiedad del esquema de MercadoPago, no
// una decisión de acá. Por eso el controller verifica la firma ANTES de leer
// el cuerpo, y por eso el `status` que viene en el payload nunca se usa: el
// recurso se vuelve a pedir a la API de MercadoPago (ver qrWebhook.service.ts).
// ---------------------------------------------------------------------------

export interface ParsedSignature {
  ts: string;
  v1: string;
}

export function parseSignatureHeader(header: string | null | undefined): ParsedSignature | null {
  if (!header) return null;
  const parts = header.split(",").map((p) => p.trim());
  const map: Record<string, string> = {};
  for (const part of parts) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (key) map[key] = value;
  }
  if (!map.ts || !map.v1) return null;
  return { ts: map.ts, v1: map.v1 };
}

export function buildManifest(dataId: string, requestId: string, ts: string): string {
  return `id:${dataId};request-id:${requestId};ts:${ts};`;
}

export function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

// Comparación en tiempo constante sobre strings. Node solo ofrece
// crypto.timingSafeEqual sobre buffers del MISMO largo (tira si difieren), así
// que el largo se compara antes — igual que el original, donde un largo
// distinto era un `false` directo. Que el largo se filtre no es un problema:
// el largo de un HMAC hex es público (64).
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return nodeTimingSafeEqual(bufA, bufB);
}

// AUD-04 del original: el HMAC prueba que MercadoPago firmó `ts` en algún
// momento — no prueba CUÁNDO. Sin un chequeo de frescura, un request capturado
// y bien firmado sigue siendo válido para siempre, que es exactamente lo que
// hace posible un replay. `ts` es Unix seconds y forma parte del manifiesto
// firmado, así que acotar su antigüedad es el control anti-replay mínimo y
// correcto (mismo patrón que otros esquemas HMAC+timestamp de webhooks).
export const MAX_TIMESTAMP_AGE_SECONDS = 300; // 5 minutos — la ventana anti-replay en sí.
// Deliberadamente mucho más chica que la ventana de arriba: solo absorbe el
// desfasaje de reloj entre MercadoPago y este servidor, no es una segunda
// ventana de replay. Una tolerancia grande hacia el futuro dejaría pre-firmar
// un timestamp lejano y extender la ventana hacia adelante.
export const MAX_TIMESTAMP_FUTURE_SKEW_SECONDS = 60;

// Pura y determinística — recibe `nowMs` en vez de leer Date.now() para que se
// pueda testear sin depender del reloj.
export function isTimestampFresh(
  ts: string,
  nowMs: number,
  opts: { maxAgeSeconds?: number; maxFutureSkewSeconds?: number } = {},
): boolean {
  const maxAgeSeconds = opts.maxAgeSeconds ?? MAX_TIMESTAMP_AGE_SECONDS;
  const maxFutureSkewSeconds = opts.maxFutureSkewSeconds ?? MAX_TIMESTAMP_FUTURE_SKEW_SECONDS;

  const numericTs = Number(ts);
  // Number.isFinite es false para NaN, Infinity y -Infinity — cubre strings no
  // numéricos y los valores "ambiguos" en un solo chequeo, antes de hacer
  // cualquier aritmética con el valor.
  if (!Number.isFinite(numericTs)) return false;

  const ageSeconds = (nowMs - numericTs * 1000) / 1000;
  if (ageSeconds > maxAgeSeconds) return false; // demasiado viejo — fuera de la ventana
  if (ageSeconds < -maxFutureSkewSeconds) return false; // demasiado en el futuro
  return true;
}

export function verifyMercadoPagoSignature(opts: {
  signatureHeader: string | null | undefined;
  requestId: string | null | undefined;
  dataId: string;
  secret: string;
  nowMs?: number;
}): boolean {
  const parsed = parseSignatureHeader(opts.signatureHeader);
  if (!parsed || !opts.requestId || !opts.dataId) return false;

  // Los dos chequeos corren siempre, incondicionalmente — un request viejo pero
  // bien firmado y uno fresco pero mal firmado terminan en `false` por el mismo
  // camino, así que el llamador no puede distinguir (ni lo intenta) cuál falló
  // a partir del resultado.
  const timestampFresh = isTimestampFresh(parsed.ts, opts.nowMs ?? Date.now());
  const manifest = buildManifest(opts.dataId, opts.requestId, parsed.ts);
  const expected = hmacSha256Hex(opts.secret, manifest);
  const signatureMatches = timingSafeEqual(expected, parsed.v1);

  return timestampFresh && signatureMatches;
}
