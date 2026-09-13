import { afterEach, describe, expect, it, vi } from "vitest";
import type { WidgetApiErrorCategory } from "./api";
import {
  clearError,
  clearTyping,
  ERROR_MESSAGES,
  mountWidgetUi,
  renderError,
  renderMessage,
  renderTyping,
  WIDGET_HOST_ID,
} from "./ui";

function pressEnter(target: HTMLElement, shiftKey = false): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey, bubbles: true }));
}

describe("mountWidgetUi", () => {
  afterEach(() => {
    document.getElementById(WIDGET_HOST_ID)?.remove();
  });

  it("monta un host en body con shadow root abierto, panel oculto y burbuja", () => {
    const ui = mountWidgetUi({ onSend: vi.fn() });

    const host = document.getElementById(WIDGET_HOST_ID);
    expect(host).toBe(ui.host);
    expect(host?.shadowRoot).toBe(ui.shadowRoot);
    expect(ui.shadowRoot.querySelector("style")?.textContent).toContain("--widget-accent");
    expect(ui.isOpen()).toBe(false);
    expect(ui.shadowRoot.querySelector<HTMLElement>(".pcw-panel")?.hidden).toBe(true);
    expect(ui.shadowRoot.querySelector(".pcw-bubble")).not.toBeNull();
    expect(ui.messages.getAttribute("aria-live")).toBe("polite");
  });

  it("el click en la burbuja abre y cierra el panel, con aria-expanded acorde", () => {
    const ui = mountWidgetUi({ onSend: vi.fn() });
    const bubble = ui.shadowRoot.querySelector<HTMLButtonElement>(".pcw-bubble")!;

    bubble.click();
    expect(ui.isOpen()).toBe(true);
    expect(bubble.getAttribute("aria-expanded")).toBe("true");

    bubble.click();
    expect(ui.isOpen()).toBe(false);
    expect(bubble.getAttribute("aria-expanded")).toBe("false");
  });

  it("aplica data-primary-color como --widget-accent inline en el host", () => {
    const ui = mountWidgetUi({ onSend: vi.fn(), primaryColor: "#0f766e" });

    expect(ui.host.style.getPropertyValue("--widget-accent")).toBe("#0f766e");
  });

  it("Enter envía el texto recortado y limpia el input; Shift+Enter no envía", () => {
    const onSend = vi.fn();
    const ui = mountWidgetUi({ onSend });
    const input = ui.shadowRoot.querySelector<HTMLTextAreaElement>(".pcw-input")!;

    input.value = "  hola  ";
    pressEnter(input, true);
    expect(onSend).not.toHaveBeenCalled();

    pressEnter(input);
    expect(onSend).toHaveBeenCalledWith("hola");
    expect(input.value).toBe("");
  });

  it("no envía texto vacío y no envía mientras está ocupado", () => {
    const onSend = vi.fn();
    const ui = mountWidgetUi({ onSend });
    const input = ui.shadowRoot.querySelector<HTMLTextAreaElement>(".pcw-input")!;

    input.value = "   ";
    pressEnter(input);
    expect(onSend).not.toHaveBeenCalled();

    ui.setBusy(true);
    expect(input.disabled).toBe(true);
    expect(ui.shadowRoot.querySelector<HTMLButtonElement>(".pcw-send")?.disabled).toBe(true);
    input.value = "hola";
    pressEnter(input);
    expect(onSend).not.toHaveBeenCalled();

    ui.setBusy(false);
    pressEnter(input);
    expect(onSend).toHaveBeenCalledWith("hola");
  });

  it("el textarea limita el largo al máximo que acepta el backend", () => {
    const ui = mountWidgetUi({ onSend: vi.fn() });
    const input = ui.shadowRoot.querySelector<HTMLTextAreaElement>(".pcw-input")!;

    expect(input.maxLength).toBe(4000);
  });
});

describe("renderMessage", () => {
  it("inserta el texto como texto literal: markup en el contenido no se interpreta", () => {
    const container = document.createElement("div");
    const payload = '<img src=x onerror="alert(1)"><script>alert(1)</script>';

    const visitor = renderMessage(container, { role: "visitor", text: payload });
    const agent = renderMessage(container, { role: "agent", text: payload });

    expect(visitor.textContent).toBe(payload);
    expect(agent.textContent).toBe(payload);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(visitor.className).toContain("pcw-msg--visitor");
    expect(agent.className).toContain("pcw-msg--agent");
  });
});

describe("renderTyping / clearTyping", () => {
  it("muestra un único indicador y lo quita", () => {
    const container = document.createElement("div");

    renderTyping(container);
    renderTyping(container);
    expect(container.querySelectorAll("[data-pcw-typing]")).toHaveLength(1);

    clearTyping(container);
    expect(container.querySelector("[data-pcw-typing]")).toBeNull();
  });
});

describe("renderError", () => {
  const categories: WidgetApiErrorCategory[] = [
    "validation",
    "unauthorized",
    "rate_limited",
    "network",
    "unknown",
  ];

  it.each(categories)("muestra solo el texto amigable de la categoría %s", (category) => {
    const container = document.createElement("div");

    const box = renderError(container, category, vi.fn());

    // renderError recibe una categoría, nunca el Error: el mensaje real del
    // backend no tiene por dónde llegar al DOM.
    expect(box.textContent).toBe(`${ERROR_MESSAGES[category]}Reintentar`);
    expect(box.getAttribute("role")).toBe("alert");
  });

  it("Reintentar quita el error y llama a onRetry; clearError también lo quita", () => {
    const container = document.createElement("div");
    const onRetry = vi.fn();

    renderError(container, "network", onRetry);
    container.querySelector<HTMLButtonElement>(".pcw-retry")!.click();

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-pcw-error]")).toBeNull();

    renderError(container, "unknown", onRetry);
    renderError(container, "unknown", onRetry);
    expect(container.querySelectorAll("[data-pcw-error]")).toHaveLength(1);
    clearError(container);
    expect(container.querySelector("[data-pcw-error]")).toBeNull();
  });
});
