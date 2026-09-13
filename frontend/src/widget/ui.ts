import type { WidgetApiErrorCategory } from "./api";
import { WIDGET_STYLES } from "./styles";

// ---------------------------------------------------------------------------
// Construcción del DOM del widget. Todo vive dentro de un shadow root
// (mode: "open" — inspeccionable desde DevTools y desde los tests) colgado
// de un <div> host montado en document.body.
//
// REGLA DE ESTE ARCHIVO: todo texto externo entra por `textContent`, nunca
// por innerHTML con interpolación. Ni lo que escribe el visitante ni la
// respuesta del agente son confiables como HTML — la respuesta la genera un
// LLM a partir de lo que el visitante escribió, así que un visitante puede
// inducir markup en ella. Los únicos innerHTML de acá abajo son literales
// fijos sin datos (el SVG de la burbuja).
// ---------------------------------------------------------------------------

export const WIDGET_HOST_ID = "plataforma-crm-widget-root";

export type MessageRole = "visitor" | "agent";

export interface WidgetMessage {
  role: MessageRole;
  text: string;
}

export interface WidgetUiOptions {
  /** Valor de data-primary-color; se aplica como --widget-accent inline en el host. */
  primaryColor?: string;
  /** Se invoca con el texto ya recortado y no vacío. */
  onSend: (text: string) => void;
}

export interface WidgetUi {
  host: HTMLElement;
  shadowRoot: ShadowRoot;
  /** Lista de mensajes (aria-live="polite"): el contenedor que reciben las funciones render/clear. */
  messages: HTMLElement;
  /** Deshabilita input y botón de enviar mientras hay un mensaje en vuelo. */
  setBusy(busy: boolean): void;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
}

// Textos amigables por categoría. La UI NUNCA muestra el `message` del
// WidgetApiError — solo esto.
export const ERROR_MESSAGES: Record<WidgetApiErrorCategory, string> = {
  validation: "No pudimos enviar tu mensaje. Revisá que no esté vacío ni sea demasiado largo.",
  unauthorized: "El chat no está disponible en este sitio en este momento.",
  rate_limited: "Enviaste muchos mensajes seguidos. Esperá un momento y volvé a intentar.",
  network: "No pudimos conectarnos. Revisá tu conexión e intentá de nuevo.",
  unknown: "Algo salió mal al enviar tu mensaje. Intentá de nuevo.",
};

// El backend rechaza mensajes de más de 4000 caracteres (publicWidget.controller.ts).
export const MAX_MESSAGE_LENGTH = 4000;

const CHAT_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
  '<path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 1 1 21 12z"/>' +
  "</svg>";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  attrs: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

function scrollToBottom(container: HTMLElement): void {
  container.scrollTop = container.scrollHeight;
}

export function renderMessage(container: HTMLElement, message: WidgetMessage): HTMLElement {
  const bubble = el("div", `pcw-msg pcw-msg--${message.role}`);
  bubble.textContent = message.text;
  container.appendChild(bubble);
  scrollToBottom(container);
  return bubble;
}

export function renderTyping(container: HTMLElement): void {
  clearTyping(container);
  const typing = el("div", "pcw-typing", { "data-pcw-typing": "" });
  typing.textContent = "Escribiendo…";
  container.appendChild(typing);
  scrollToBottom(container);
}

export function clearTyping(container: HTMLElement): void {
  container.querySelector("[data-pcw-typing]")?.remove();
}

export function renderError(
  container: HTMLElement,
  category: WidgetApiErrorCategory,
  onRetry: () => void,
): HTMLElement {
  clearError(container);
  const box = el("div", "pcw-error", { role: "alert", "data-pcw-error": "" });
  const text = el("span");
  text.textContent = ERROR_MESSAGES[category];
  const retry = el("button", "pcw-retry", { type: "button" });
  retry.textContent = "Reintentar";
  retry.addEventListener("click", () => {
    box.remove();
    onRetry();
  });
  box.append(text, retry);
  container.appendChild(box);
  scrollToBottom(container);
  return box;
}

export function clearError(container: HTMLElement): void {
  container.querySelector("[data-pcw-error]")?.remove();
}

export function mountWidgetUi(options: WidgetUiOptions): WidgetUi {
  const host = el("div", undefined, { id: WIDGET_HOST_ID });
  if (options.primaryColor) {
    host.style.setProperty("--widget-accent", options.primaryColor);
  }
  const shadowRoot = host.attachShadow({ mode: "open" });

  const style = el("style");
  style.textContent = WIDGET_STYLES;

  const root = el("div", "pcw-root");

  // --- Panel ---------------------------------------------------------------
  const panelId = "pcw-panel";
  const panel = el("section", "pcw-panel", { id: panelId, "aria-label": "Chat" });
  panel.hidden = true;

  const header = el("header", "pcw-header");
  const title = el("h2", "pcw-title");
  title.textContent = "Chat";
  const closeButton = el("button", "pcw-close", { type: "button", "aria-label": "Cerrar chat" });
  closeButton.textContent = "×";
  header.append(title, closeButton);

  // aria-live="polite": un lector de pantalla anuncia cada mensaje nuevo sin
  // interrumpir lo que esté leyendo. role="log" describe la semántica real.
  const messages = el("div", "pcw-messages", { role: "log", "aria-live": "polite" });

  const composer = el("form", "pcw-composer");
  const input = el("textarea", "pcw-input", {
    rows: "1",
    placeholder: "Escribí tu mensaje…",
    "aria-label": "Mensaje",
    maxlength: String(MAX_MESSAGE_LENGTH),
  });
  const sendButton = el("button", "pcw-send", { type: "submit" });
  sendButton.textContent = "Enviar";
  composer.append(input, sendButton);

  panel.append(header, messages, composer);

  // --- Burbuja flotante ----------------------------------------------------
  const bubble = el("button", "pcw-bubble", {
    type: "button",
    "aria-label": "Abrir chat",
    "aria-expanded": "false",
    "aria-controls": panelId,
  });
  bubble.innerHTML = CHAT_ICON_SVG; // literal fijo, sin datos externos

  root.append(panel, bubble);
  shadowRoot.append(style, root);

  // --- Comportamiento --------------------------------------------------------
  let busy = false;

  function isOpen(): boolean {
    return !panel.hidden;
  }
  function open(): void {
    panel.hidden = false;
    bubble.setAttribute("aria-expanded", "true");
    bubble.setAttribute("aria-label", "Cerrar chat");
    input.focus();
  }
  function close(): void {
    panel.hidden = true;
    bubble.setAttribute("aria-expanded", "false");
    bubble.setAttribute("aria-label", "Abrir chat");
  }
  function toggle(): void {
    if (isOpen()) close();
    else open();
  }

  function submit(): void {
    if (busy) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    options.onSend(text);
  }

  bubble.addEventListener("click", toggle);
  closeButton.addEventListener("click", close);
  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });
  // Enter envía; Shift+Enter inserta el salto de línea (comportamiento
  // nativo del textarea, no se intercepta).
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });

  function setBusy(value: boolean): void {
    busy = value;
    input.disabled = value;
    sendButton.disabled = value;
    if (!value && isOpen()) input.focus();
  }

  document.body.appendChild(host);

  return { host, shadowRoot, messages, setBusy, open, close, toggle, isOpen };
}
