import { http, HttpResponse, delay } from "msw";
import { env } from "../../config/env";
import type { MeResponse } from "../../auth/AuthContext";

const meUrl = `${env.apiUrl}/api/me`;

function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

// Helpers de /api/me para los 14 escenarios de M1 (docs/project-overview.md).
// Cada test compone exactamente el handler que necesita vía server.use(...)
// — no hay handlers globales por default para este endpoint porque cada
// escenario depende de una respuesta distinta.

export function meSuccessHandler(profile: MeResponse, expectedToken?: string) {
  return http.get(meUrl, ({ request }) => {
    if (expectedToken && bearerToken(request) !== expectedToken) {
      return HttpResponse.json(
        { error: { message: "token inesperado en este handler de test" } },
        { status: 401 },
      );
    }
    return HttpResponse.json(profile);
  });
}

export function meErrorHandler(status: number, message: string) {
  return http.get(meUrl, () => HttpResponse.json({ error: { message } }, { status }));
}

export function meNetworkErrorHandler() {
  return http.get(meUrl, () => HttpResponse.error());
}

// Usado por el escenario crítico A→B: la respuesta de un token específico
// se demora ms milisegundos antes de resolver, para poder disparar el
// cambio de identidad ANTES de que esta promesa se resuelva.
export function meDelayedHandler(profile: MeResponse, ms: number, expectedToken?: string) {
  return http.get(meUrl, async ({ request }) => {
    if (expectedToken && bearerToken(request) !== expectedToken) {
      return HttpResponse.json(
        { error: { message: "token inesperado en este handler de test" } },
        { status: 401 },
      );
    }
    await delay(ms);
    return HttpResponse.json(profile);
  });
}

// Combina dos tokens distintos en un único handler — necesario para A→B:
// un solo GET /api/me registrado a la vez en MSW, pero debe responder
// distinto según qué identidad esté pidiendo en ese momento.
export function meByTokenHandler(
  responses: Record<string, { profile?: MeResponse; delayMs?: number }>,
) {
  return http.get(meUrl, async ({ request }) => {
    const token = bearerToken(request);
    const entry = token ? responses[token] : undefined;
    if (!entry) {
      return HttpResponse.json({ error: { message: "token no registrado en el test" } }, { status: 401 });
    }
    if (entry.delayMs) await delay(entry.delayMs);
    return HttpResponse.json(entry.profile);
  });
}
