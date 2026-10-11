import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../test/msw/server";
import {
  widgetErrorHandler,
  widgetMessagesUrl,
  widgetSuccessHandler,
  widgetThreadHandler,
  widgetThreadUrl,
  type CapturedWidgetRequest,
} from "../test/msw/widgetHandlers";
import { POLL_INTERVAL_MS } from "./config";
import { ERROR_MESSAGES, WIDGET_HOST_ID } from "./ui";

// ---------------------------------------------------------------------------
// Integración del entry point en un DOM jsdom limpio. main.ts se ejecuta al
// importarse (bootstrap() en el tope del módulo), así que cada test lo
// importa dinámicamente después de vi.resetModules() y de simular el
// <script> que lo carga vía document.currentScript.
// ---------------------------------------------------------------------------

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const EMBED_TOKEN = "embed_test_token";
const url = widgetMessagesUrl(AGENT_ID);

type WidgetWindow = Window & { __plataformaCrmWidgetLoaded?: boolean };

function simulateCurrentScript(attrs: Record<string, string> | null): void {
  if (attrs === null) {
    Reflect.deleteProperty(document, "currentScript");
    return;
  }
  const script = document.createElement("script");
  for (const [name, value] of Object.entries(attrs)) script.setAttribute(name, value);
  Object.defineProperty(document, "currentScript", { value: script, configurable: true });
}

async function loadWidget(
  attrs: Record<string, string> = { "data-agent-id": AGENT_ID, "data-embed-token": EMBED_TOKEN },
): Promise<void> {
  simulateCurrentScript(attrs);
  vi.resetModules();
  await import("./main");
}

function shadow(): ShadowRoot {
  const host = document.getElementById(WIDGET_HOST_ID);
  if (!host?.shadowRoot) throw new Error("el widget no está montado");
  return host.shadowRoot;
}

function openPanel(): void {
  shadow().querySelector<HTMLButtonElement>(".pcw-bubble")!.click();
}

function typeAndSend(text: string): void {
  const input = shadow().querySelector<HTMLTextAreaElement>(".pcw-input")!;
  input.value = text;
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

function agentMessages(): HTMLElement[] {
  return Array.from(shadow().querySelectorAll<HTMLElement>(".pcw-msg--agent"));
}

describe("widget main (integración)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Abrir el panel consulta el hilo de la sesión: por default, vacío.
    server.use(widgetThreadHandler(/\/web\/thread$/));
  });

  afterEach(() => {
    vi.useRealTimers();
    document.getElementById(WIDGET_HOST_ID)?.remove();
    delete (window as WidgetWindow).__plataformaCrmWidgetLoaded;
    simulateCurrentScript(null);
    vi.restoreAllMocks();
  });

  it("monta el widget cerrado y el click en la burbuja abre el panel", async () => {
    await loadWidget();

    expect(document.querySelectorAll(`#${WIDGET_HOST_ID}`)).toHaveLength(1);
    expect(shadow().querySelector<HTMLElement>(".pcw-panel")?.hidden).toBe(true);

    openPanel();
    expect(shadow().querySelector<HTMLElement>(".pcw-panel")?.hidden).toBe(false);
  });

  it("no monta nada si faltan atributos, y no tira", async () => {
    await expect(loadWidget({ "data-agent-id": AGENT_ID })).resolves.toBeUndefined();

    expect(document.getElementById(WIDGET_HOST_ID)).toBeNull();
    expect((window as WidgetWindow).__plataformaCrmWidgetLoaded).toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("un segundo <script> del mismo widget no duplica el montaje", async () => {
    await loadWidget();
    await loadWidget();

    expect(document.querySelectorAll(`#${WIDGET_HOST_ID}`)).toHaveLength(1);
    expect((window as WidgetWindow).__plataformaCrmWidgetLoaded).toBe(true);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("escribir + Enter dispara el POST correcto y renderiza la respuesta dentro del shadow root", async () => {
    let captured: CapturedWidgetRequest | undefined;
    server.use(
      widgetSuccessHandler(url, "¡Hola! ¿En qué te ayudo?", {
        capture: (r) => (captured = r),
        delayMs: 30,
      }),
    );
    await loadWidget();
    openPanel();

    typeAndSend("Quiero un turno");

    // La burbuja del visitante aparece de inmediato; "escribiendo…" mientras espera.
    const visitor = shadow().querySelector(".pcw-msg--visitor");
    expect(visitor?.textContent).toBe("Quiero un turno");
    expect(shadow().querySelector("[data-pcw-typing]")).not.toBeNull();
    expect(shadow().querySelector<HTMLTextAreaElement>(".pcw-input")?.disabled).toBe(true);

    await vi.waitFor(() => expect(agentMessages()).toHaveLength(1));

    expect(agentMessages()[0].textContent).toBe("¡Hola! ¿En qué te ayudo?");
    expect(shadow().querySelector("[data-pcw-typing]")).toBeNull();
    expect(shadow().querySelector<HTMLTextAreaElement>(".pcw-input")?.disabled).toBe(false);

    const sessionId = localStorage.getItem(`plataforma-crm-widget:session:${AGENT_ID}`);
    expect(sessionId).toBeTruthy();
    expect(captured?.url).toBe(url);
    expect(captured?.embedToken).toBe(EMBED_TOKEN);
    expect(captured?.body).toEqual({ sessionId, message: "Quiero un turno" });
  });

  it("data-api-url tiene prioridad sobre VITE_API_URL", async () => {
    const otherUrl = widgetMessagesUrl(AGENT_ID, "https://api.otra.test");
    let captured: CapturedWidgetRequest | undefined;
    server.use(widgetSuccessHandler(otherUrl, "ok", { capture: (r) => (captured = r) }));
    await loadWidget({
      "data-agent-id": AGENT_ID,
      "data-embed-token": EMBED_TOKEN,
      "data-api-url": "https://api.otra.test/",
    });
    openPanel();

    typeAndSend("hola");
    await vi.waitFor(() => expect(agentMessages()).toHaveLength(1));

    expect(captured?.url).toBe(otherUrl);
  });

  it("respuesta: null muestra el aviso de derivación a una persona", async () => {
    server.use(widgetSuccessHandler(url, null));
    await loadWidget();
    openPanel();

    typeAndSend("hola");
    await vi.waitFor(() => expect(agentMessages()).toHaveLength(1));

    expect(agentMessages()[0].textContent).toMatch(/derivada a una persona/);
  });

  it("R16: el aviso de privacidad de una clínica va como primer mensaje de la respuesta", async () => {
    server.use(
      http.post(url, () =>
        HttpResponse.json({
          conversationId: "conv-1",
          respuesta: "¡Hola! ¿En qué te ayudo?",
          avisoDePrivacidad:
            "Usamos tus datos para gestionar tus turnos.\n\nhttps://example.com/privacidad",
        }),
      ),
    );
    await loadWidget();
    openPanel();

    typeAndSend("hola");
    await vi.waitFor(() => expect(agentMessages()).toHaveLength(2));

    expect(agentMessages()[0].textContent).toMatch(/^Usamos tus datos/);
    expect(agentMessages()[1].textContent).toBe("¡Hola! ¿En qué te ayudo?");
  });

  it("la respuesta del agente se inserta como texto literal, nunca como markup", async () => {
    const payload = '<script>alert(1)</script><img src=x onerror="alert(1)">';
    server.use(widgetSuccessHandler(url, payload));
    await loadWidget();
    openPanel();

    typeAndSend("<b>hola</b>");
    await vi.waitFor(() => expect(agentMessages()).toHaveLength(1));

    expect(agentMessages()[0].textContent).toBe(payload);
    expect(shadow().querySelector(".pcw-msg--visitor")?.textContent).toBe("<b>hola</b>");
    expect(shadow().querySelector("script")).toBeNull();
    expect(shadow().querySelector("img")).toBeNull();
    expect(shadow().querySelector("b")).toBeNull();
  });

  it("ante un 500 muestra el error amigable con Reintentar, sin exponer el mensaje del backend, y el reintento manual funciona", async () => {
    server.use(widgetErrorHandler(url, 500, "stack trace interno secreto"));
    await loadWidget();
    openPanel();

    typeAndSend("hola");
    await vi.waitFor(() => expect(shadow().querySelector("[data-pcw-error]")).not.toBeNull());

    const errorBox = shadow().querySelector("[data-pcw-error]")!;
    expect(errorBox.textContent).toContain(ERROR_MESSAGES.unknown);
    expect(shadow().textContent ?? "").not.toContain("stack trace interno secreto");
    expect(shadow().querySelector("[data-pcw-typing]")).toBeNull();
    expect(console.error).toHaveBeenCalled();

    // Sin retry automático: el POST no se repite solo. Ahora el backend
    // responde bien y el visitante reintenta a mano.
    let captured: CapturedWidgetRequest | undefined;
    server.use(widgetSuccessHandler(url, "ahora sí", { capture: (r) => (captured = r) }));
    shadow().querySelector<HTMLButtonElement>(".pcw-retry")!.click();

    await vi.waitFor(() => expect(agentMessages()).toHaveLength(1));
    expect(agentMessages()[0].textContent).toBe("ahora sí");
    expect(captured?.body).toMatchObject({ message: "hola" });
    // La burbuja del visitante no se duplica al reintentar.
    expect(shadow().querySelectorAll(".pcw-msg--visitor")).toHaveLength(1);
    expect(shadow().querySelector("[data-pcw-error]")).toBeNull();
  });

  it("un 401 muestra el texto de widget no disponible, no el motivo interno", async () => {
    server.use(widgetErrorHandler(url, 401, "Credencial de widget inválida"));
    await loadWidget();
    openPanel();

    typeAndSend("hola");
    await vi.waitFor(() => expect(shadow().querySelector("[data-pcw-error]")).not.toBeNull());

    expect(shadow().querySelector("[data-pcw-error]")?.textContent).toContain(
      ERROR_MESSAGES.unauthorized,
    );
    expect(shadow().textContent ?? "").not.toContain("Credencial de widget inválida");
  });

  describe("mensajes del negocio fuera de la respuesta (polling)", () => {
    const threadUrl = widgetThreadUrl(AGENT_ID);

    function messageTexts(): string[] {
      return Array.from(shadow().querySelectorAll<HTMLElement>(".pcw-msg")).map(
        (m) => m.textContent ?? "",
      );
    }

    it("al abrir por primera vez trae el historial de la sesión, en orden", async () => {
      const bodies: { sessionId: string; since?: string }[] = [];
      server.use(
        widgetThreadHandler(
          threadUrl,
          () => ({
            messages: [
              { id: "m1", role: "visitor", text: "Hola", createdAt: "2026-10-01T10:00:00.000Z" },
              {
                id: "m2",
                role: "agent",
                text: "Te paso con alguien",
                createdAt: "2026-10-01T10:00:01.000Z",
              },
              {
                id: "m3",
                role: "agent",
                text: "Soy Laura del equipo",
                createdAt: "2026-10-01T11:00:00.000Z",
              },
            ],
            cursor: "2026-10-01T11:00:00.000Z",
          }),
          (b) => bodies.push(b),
        ),
      );
      await loadWidget();
      openPanel();

      await vi.waitFor(() => expect(messageTexts()).toHaveLength(3));
      expect(messageTexts()).toEqual(["Hola", "Te paso con alguien", "Soy Laura del equipo"]);
      expect(bodies[0]).toEqual({
        sessionId: localStorage.getItem(`plataforma-crm-widget:session:${AGENT_ID}`),
      });
    });

    it("con el panel abierto consulta cada POLL_INTERVAL_MS con el cursor y pinta lo nuevo una sola vez", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const bodies: { sessionId: string; since?: string }[] = [];
      server.use(
        widgetThreadHandler(
          threadUrl,
          (body) =>
            body.since === undefined
              ? { messages: [], cursor: "2026-10-01T10:00:00.000Z" }
              : {
                  // gte en el backend: puede repetir lo ya pintado, se descarta por id.
                  messages: [
                    {
                      id: "h1",
                      role: "agent",
                      text: "Hola, soy Laura",
                      createdAt: "2026-10-01T10:05:00.000Z",
                    },
                  ],
                  cursor: "2026-10-01T10:05:00.000Z",
                },
          (b) => bodies.push(b),
        ),
      );
      await loadWidget();
      openPanel();
      await vi.waitFor(() => expect(bodies).toHaveLength(1));

      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      await vi.waitFor(() => expect(messageTexts()).toEqual(["Hola, soy Laura"]));
      expect(bodies[1]?.since).toBe("2026-10-01T10:00:00.000Z");

      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      await vi.waitFor(() => expect(bodies).toHaveLength(3));
      expect(bodies[2]?.since).toBe("2026-10-01T10:05:00.000Z");
      expect(messageTexts()).toEqual(["Hola, soy Laura"]);
    });

    it("con el panel cerrado no consulta", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      let consultas = 0;
      server.use(widgetThreadHandler(threadUrl, undefined, () => (consultas += 1)));
      await loadWidget();
      openPanel();
      await vi.waitFor(() => expect(consultas).toBe(1));
      shadow().querySelector<HTMLButtonElement>(".pcw-close")!.click();

      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
      expect(consultas).toBe(1);
    });

    it("si el historial falla, el chat funciona igual y el polling sigue desde el principio", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const bodies: { sessionId: string; since?: string }[] = [];
      let primera = true;
      server.use(
        http.post(threadUrl, async ({ request }) => {
          bodies.push((await request.json()) as { sessionId: string; since?: string });
          if (primera) {
            primera = false;
            return HttpResponse.json({ error: { message: "x" } }, { status: 500 });
          }
          return HttpResponse.json({ messages: [], cursor: "1970-01-01T00:00:00.000Z" });
        }),
      );
      await loadWidget();
      openPanel();
      await vi.waitFor(() =>
        expect(shadow().querySelector<HTMLTextAreaElement>(".pcw-input")?.disabled).toBe(false),
      );
      expect(shadow().querySelector("[data-pcw-error]")).toBeNull();

      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      await vi.waitFor(() => expect(bodies).toHaveLength(2));
      expect(bodies[1]?.since).toBe("1970-01-01T00:00:00.000Z");
    });
  });
});
