import { http, HttpResponse, delay } from "msw";

// ---------------------------------------------------------------------------
// Handlers MSW del endpoint público del widget (POST
// /api/public/agents/:agentId/web/messages). Viven aparte de handlers.ts a
// propósito: ese archivo importa config/env.ts (la SPA), y el widget no
// comparte nada con la SPA — ni siquiera en tests. Se registran solo desde
// los tests de src/widget/ vía server.use(...).
// ---------------------------------------------------------------------------

// Mismo valor que VITE_API_URL en el bloque `test.env` de vite.config.ts —
// es lo que import.meta.env.VITE_API_URL vale dentro de los tests.
export const WIDGET_TEST_API_URL = "http://localhost:4000";

export function widgetMessagesUrl(agentId: string, apiUrl = WIDGET_TEST_API_URL): string {
  return `${apiUrl}/api/public/agents/${agentId}/web/messages`;
}

export interface CapturedWidgetRequest {
  url: string;
  embedToken: string | null;
  contentType: string | null;
  body: unknown;
}

// Responde 200 con { conversationId, respuesta } y, si se pasa `capture`,
// le entrega lo que llegó (URL, header del token, cuerpo parseado) para que
// el test afirme sobre el request real. `delayMs` sirve para observar el
// estado "escribiendo…" antes de que la respuesta vuelva.
export function widgetSuccessHandler(
  url: string,
  respuesta: string | null,
  options: { capture?: (req: CapturedWidgetRequest) => void; delayMs?: number } = {},
) {
  return http.post(url, async ({ request }) => {
    options.capture?.({
      url: request.url,
      embedToken: request.headers.get("x-embed-token"),
      contentType: request.headers.get("content-type"),
      body: await request.json(),
    });
    if (options.delayMs) await delay(options.delayMs);
    return HttpResponse.json({ conversationId: "conv-test-1", respuesta });
  });
}

// Misma forma de error que errorHandler.ts del backend: { error: { message } }.
export function widgetErrorHandler(url: string, status: number, message: string) {
  return http.post(url, () => HttpResponse.json({ error: { message } }, { status }));
}

export function widgetNetworkErrorHandler(url: string) {
  return http.post(url, () => HttpResponse.error());
}

// 2xx con un cuerpo que NO cumple el contrato — violación del backend que el
// widget debe tratar como error, no como respuesta vacía.
export function widgetMalformedSuccessHandler(url: string) {
  return http.post(url, () => HttpResponse.json({ algo: "inesperado" }));
}
