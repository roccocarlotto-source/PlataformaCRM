import { describe, expect, it } from "vitest";
import { server } from "../test/msw/server";
import {
  widgetErrorHandler,
  widgetMalformedSuccessHandler,
  widgetMessagesUrl,
  widgetNetworkErrorHandler,
  widgetSuccessHandler,
  type CapturedWidgetRequest,
} from "../test/msw/widgetHandlers";
import { buildWidgetMessagesUrl, sendWidgetMessage, WidgetApiError } from "./api";
import type { WidgetConfig } from "./config";

const config: WidgetConfig = {
  agentId: "11111111-1111-4111-8111-111111111111",
  embedToken: "embed_test_token",
  apiUrl: "http://localhost:4000",
};
const url = widgetMessagesUrl(config.agentId);

async function expectWidgetApiError(promise: Promise<unknown>): Promise<WidgetApiError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(WidgetApiError);
    return err as WidgetApiError;
  }
  throw new Error("se esperaba que la promesa rechazara con WidgetApiError");
}

describe("buildWidgetMessagesUrl", () => {
  it("arma la URL del endpoint público a partir de la config", () => {
    expect(buildWidgetMessagesUrl(config)).toBe(url);
  });
});

describe("sendWidgetMessage", () => {
  it("manda POST con x-embed-token, JSON y { sessionId, message }, y devuelve el resultado", async () => {
    let captured: CapturedWidgetRequest | undefined;
    server.use(
      widgetSuccessHandler(url, "Hola, ¿en qué te ayudo?", { capture: (r) => (captured = r) }),
    );

    const result = await sendWidgetMessage(config, "session-abc", "hola");

    expect(result).toEqual({ conversationId: "conv-test-1", respuesta: "Hola, ¿en qué te ayudo?" });
    expect(captured?.url).toBe(url);
    expect(captured?.embedToken).toBe("embed_test_token");
    expect(captured?.contentType).toBe("application/json");
    expect(captured?.body).toEqual({ sessionId: "session-abc", message: "hola" });
  });

  it("200 con respuesta: null devuelve null tal cual (conversación derivada)", async () => {
    server.use(widgetSuccessHandler(url, null));

    const result = await sendWidgetMessage(config, "session-abc", "hola");

    expect(result.respuesta).toBeNull();
    expect(result.conversationId).toBe("conv-test-1");
  });

  it.each([
    [400, "validation"],
    [401, "unauthorized"],
    [429, "rate_limited"],
    [500, "unknown"],
    [413, "unknown"],
  ] as const)(
    "%i → categoría %s, con el mensaje del backend solo en el Error",
    async (status, category) => {
      server.use(widgetErrorHandler(url, status, "detalle interno del backend"));

      const err = await expectWidgetApiError(sendWidgetMessage(config, "session-abc", "hola"));

      expect(err.category).toBe(category);
      expect(err.status).toBe(status);
      expect(err.message).toBe("detalle interno del backend");
    },
  );

  it("error de red → categoría network, sin status", async () => {
    server.use(widgetNetworkErrorHandler(url));

    const err = await expectWidgetApiError(sendWidgetMessage(config, "session-abc", "hola"));

    expect(err.category).toBe("network");
    expect(err.status).toBeUndefined();
  });

  it("2xx con un cuerpo fuera de contrato → categoría unknown", async () => {
    server.use(widgetMalformedSuccessHandler(url));

    const err = await expectWidgetApiError(sendWidgetMessage(config, "session-abc", "hola"));

    expect(err.category).toBe("unknown");
  });
});
