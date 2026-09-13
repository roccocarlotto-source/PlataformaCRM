import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { readWidgetConfig } from "./config";
import { WIDGET_TEST_API_URL } from "../test/msw/widgetHandlers";

function makeScript(attrs: Record<string, string>): HTMLScriptElement {
  const script = document.createElement("script");
  for (const [name, value] of Object.entries(attrs)) script.setAttribute(name, value);
  return script;
}

describe("readWidgetConfig", () => {
  let consoleError: MockInstance;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("con los tres atributos devuelve la config, con data-api-url sin barra final", () => {
    const config = readWidgetConfig(
      makeScript({
        "data-agent-id": "agent-1",
        "data-embed-token": "embed_abc",
        "data-api-url": "https://api.ejemplo.com/",
      }),
    );

    expect(config).toEqual({
      agentId: "agent-1",
      embedToken: "embed_abc",
      apiUrl: "https://api.ejemplo.com",
      primaryColor: undefined,
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("sin data-api-url cae a import.meta.env.VITE_API_URL", () => {
    const config = readWidgetConfig(
      makeScript({ "data-agent-id": "agent-1", "data-embed-token": "embed_abc" }),
    );

    expect(config?.apiUrl).toBe(WIDGET_TEST_API_URL);
  });

  it("normaliza también la barra final de VITE_API_URL", () => {
    vi.stubEnv("VITE_API_URL", "https://api.env.test/");

    const config = readWidgetConfig(
      makeScript({ "data-agent-id": "agent-1", "data-embed-token": "embed_abc" }),
    );

    expect(config?.apiUrl).toBe("https://api.env.test");
  });

  it("lee data-primary-color cuando está presente", () => {
    const config = readWidgetConfig(
      makeScript({
        "data-agent-id": "agent-1",
        "data-embed-token": "embed_abc",
        "data-primary-color": "#0f766e",
      }),
    );

    expect(config?.primaryColor).toBe("#0f766e");
  });

  it("sin data-agent-id devuelve null y loguea un error descriptivo", () => {
    const config = readWidgetConfig(makeScript({ "data-embed-token": "embed_abc" }));

    expect(config).toBeNull();
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0][0])).toMatch(/data-agent-id/);
  });

  it("sin data-embed-token devuelve null y loguea un error descriptivo", () => {
    const config = readWidgetConfig(makeScript({ "data-agent-id": "agent-1" }));

    expect(config).toBeNull();
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0][0])).toMatch(/data-embed-token/);
  });

  it("un atributo presente pero vacío cuenta como ausente", () => {
    const config = readWidgetConfig(
      makeScript({ "data-agent-id": "   ", "data-embed-token": "embed_abc" }),
    );

    expect(config).toBeNull();
  });

  it("sin data-api-url ni VITE_API_URL devuelve null y loguea el error", () => {
    vi.stubEnv("VITE_API_URL", "");

    const config = readWidgetConfig(
      makeScript({ "data-agent-id": "agent-1", "data-embed-token": "embed_abc" }),
    );

    expect(config).toBeNull();
    expect(String(consoleError.mock.calls[0][0])).toMatch(/VITE_API_URL/);
  });

  it("con document.currentScript null (default) devuelve null sin tirar", () => {
    // jsdom no ejecuta scripts, así que document.currentScript es null acá —
    // exactamente el caso de un script insertado dinámicamente.
    expect(document.currentScript).toBeNull();

    expect(() => readWidgetConfig()).not.toThrow();
    expect(readWidgetConfig()).toBeNull();
    expect(String(consoleError.mock.calls[0][0])).toMatch(/currentScript/);
  });
});
