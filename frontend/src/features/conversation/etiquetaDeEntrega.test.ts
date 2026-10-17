import { describe, expect, it } from "vitest";
import { MARCA_SIMULADO, etiquetaDeEntrega } from "./labels";

describe("etiquetaDeEntrega (modo demo)", () => {
  it("sin estado de entrega no hay etiqueta", () => {
    expect(
      etiquetaDeEntrega({ deliveryStatus: null, externalMessageId: "demo:x" }, true),
    ).toBeNull();
  });

  it("en modo demo, un id demo: es Simulado; otro id, el estado de siempre", () => {
    expect(etiquetaDeEntrega({ deliveryStatus: "SENT", externalMessageId: "demo:x" }, true)).toBe(
      MARCA_SIMULADO,
    );
    expect(etiquetaDeEntrega({ deliveryStatus: "SENT", externalMessageId: "wamid.1" }, true)).toBe(
      "Enviado",
    );
    expect(etiquetaDeEntrega({ deliveryStatus: "FAILED", externalMessageId: null }, true)).toBe(
      "No entregado",
    );
  });

  it("sin modo demo, un id demo: no cambia nada", () => {
    expect(etiquetaDeEntrega({ deliveryStatus: "SENT", externalMessageId: "demo:x" }, false)).toBe(
      "Enviado",
    );
  });
});
