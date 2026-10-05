import {
  fetchWidgetThread,
  sendWidgetMessage,
  WidgetApiError,
  type WidgetApiErrorCategory,
  type WidgetThreadMessage,
} from "./api";
import { POLL_INTERVAL_MS, readWidgetConfig, WIDGET_LOG_PREFIX, type WidgetConfig } from "./config";
import { getOrCreateSessionId } from "./session";
import {
  clearError,
  clearTyping,
  mountWidgetUi,
  renderError,
  renderMessage,
  renderTyping,
} from "./ui";

// ---------------------------------------------------------------------------
// Entry point del widget embebible (build aparte: vite.widget.config.ts →
// dist/widget.js, formato IIFE). Diseño en docs/ai-agent-architecture.md §9,
// nota fechada del 13/09/2026 bajo el punto 5.
//
// El único código que corre acá es `bootstrap()`, de forma síncrona en el
// tope del módulo: readWidgetConfig() lee document.currentScript, que solo
// apunta a este <script> mientras se ejecuta su código de nivel superior.
// Cualquier `await` antes de esa lectura la rompería (y también si el
// sitio lo carga con `async`, que es lo recomendado).
// ---------------------------------------------------------------------------

// Contrato de 5b: `respuesta: null` significa que la conversación ya estaba
// derivada a una persona y el agente no responde. El visitante tiene que
// enterarse de eso, no ver un silencio.
const HANDOFF_NOTICE =
  "Tu conversación fue derivada a una persona del equipo. En breve te responden por acá.";

// El cursor si el historial no se pudo cargar: desde el principio. El polling
// trae solo lo que escribió el negocio fuera de las respuestas (pocos), y los
// ids ya pintados se descartan.
const CURSOR_DESDE_EL_PRINCIPIO = new Date(0).toISOString();

// Idempotencia: si el sitio incluyó el <script> dos veces (un CMS que lo
// inyecta en un partial y en el layout, por ejemplo), el segundo no monta
// nada. Cast puntual: no hay ninguna extensión global de Window en el
// proyecto y no vale la pena crear un .d.ts para un solo flag.
type WidgetWindow = Window & { __plataformaCrmWidgetLoaded?: boolean };

// Con `<script async>` en el <head>, este código puede correr antes de que
// exista document.body. La config ya se leyó de forma síncrona; el montaje
// puede esperar.
function whenBodyReady(callback: () => void): void {
  if (document.body) {
    callback();
    return;
  }
  document.addEventListener("DOMContentLoaded", callback, { once: true });
}

function mount(config: WidgetConfig): void {
  const sessionId = getOrCreateSessionId(config.agentId);
  let sending = false;

  // --- Mensajes del negocio fuera de la respuesta al visitante ----------------
  // Una persona del equipo que contesta desde el CRM, o el aviso de "nadie
  // disponible", no llegan como respuesta a un POST: se consultan. Al abrir
  // el panel por primera vez, el historial de la sesión (si el visitante
  // cerró la pestaña, la respuesta lo espera acá); después, polling liviano
  // mientras el panel esté abierto y la pestaña visible.
  let historyRequested = false;
  let loadingHistory = false;
  let cursor = CURSOR_DESDE_EL_PRINCIPIO;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let polling = false;
  let pollFailing = false;
  const rendered = new Set<string>();

  function renderFromThread(messages: WidgetThreadMessage[], before: Node | null = null): void {
    for (const message of messages) {
      if (rendered.has(message.id)) continue;
      rendered.add(message.id);
      renderMessage(
        ui.messages,
        { role: message.role, author: message.author, text: message.text },
        before,
      );
    }
  }

  function shouldPoll(): boolean {
    return ui.isOpen() && document.visibilityState !== "hidden";
  }

  function stopPolling(): void {
    if (pollTimer !== null) clearTimeout(pollTimer);
    pollTimer = null;
  }

  function schedulePoll(): void {
    if (pollTimer !== null || !historyRequested || loadingHistory || !shouldPoll()) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void poll();
    }, POLL_INTERVAL_MS);
  }

  async function poll(): Promise<void> {
    if (polling || !shouldPoll()) return;
    polling = true;
    try {
      const thread = await fetchWidgetThread(config, sessionId, cursor);
      renderFromThread(thread.messages);
      cursor = thread.cursor;
      pollFailing = false;
    } catch (err) {
      // Silencioso para el visitante (no hay nada que pueda hacer), y una
      // sola línea de consola por racha de fallos, no una cada 5 s.
      if (!pollFailing)
        console.warn(`${WIDGET_LOG_PREFIX} No se pudieron consultar mensajes nuevos`, err);
      pollFailing = true;
    } finally {
      polling = false;
      schedulePoll();
    }
  }

  // El composer NO se bloquea mientras carga: si el visitante ya escribió,
  // el historial (que es anterior) se inserta arriba de lo que haya.
  async function loadHistory(): Promise<void> {
    historyRequested = true;
    loadingHistory = true;
    const anchor = ui.messages.firstChild;
    try {
      const thread = await fetchWidgetThread(config, sessionId);
      renderFromThread(thread.messages, anchor);
      cursor = thread.cursor;
    } catch (err) {
      console.warn(`${WIDGET_LOG_PREFIX} No se pudo cargar la conversación anterior`, err);
    } finally {
      loadingHistory = false;
      schedulePoll();
    }
  }

  const ui = mountWidgetUi({
    primaryColor: config.primaryColor,
    onSend: (text) => {
      if (sending) return;
      renderMessage(ui.messages, { role: "visitor", text });
      void deliver(text);
    },
    onOpenChange: (open) => {
      if (!open) {
        stopPolling();
      } else if (!historyRequested) {
        void loadHistory();
      } else {
        schedulePoll();
      }
    },
  });

  document.addEventListener("visibilitychange", () => {
    if (shouldPoll()) schedulePoll();
    else stopPolling();
  });

  // Manda `text` al backend y pinta el resultado. La burbuja del visitante ya
  // está renderizada por quien llama: así "Reintentar" vuelve a mandar el
  // MISMO texto sin duplicar la burbuja. El reintento es siempre manual
  // (punto 11 de la nota de §9): cada POST paga una llamada a un LLM y un
  // retry automático podría duplicar el mensaje si el primero sí se procesó.
  async function deliver(text: string): Promise<void> {
    sending = true;
    ui.setBusy(true);
    clearError(ui.messages);
    renderTyping(ui.messages);
    try {
      const result = await sendWidgetMessage(config, sessionId, text);
      clearTyping(ui.messages);
      renderMessage(ui.messages, { role: "agent", text: result.respuesta ?? HANDOFF_NOTICE });
    } catch (err) {
      clearTyping(ui.messages);
      // El detalle real va SOLO a consola; la UI decide el texto por categoría.
      console.error(`${WIDGET_LOG_PREFIX} Falló el envío del mensaje`, err);
      const category: WidgetApiErrorCategory =
        err instanceof WidgetApiError ? err.category : "unknown";
      renderError(ui.messages, category, () => void deliver(text));
    } finally {
      sending = false;
      ui.setBusy(false);
    }
  }
}

function bootstrap(): void {
  const config = readWidgetConfig();
  if (!config) return;

  const w = window as WidgetWindow;
  if (w.__plataformaCrmWidgetLoaded) {
    console.warn(`${WIDGET_LOG_PREFIX} El widget ya estaba cargado en esta página; se ignora.`);
    return;
  }
  w.__plataformaCrmWidgetLoaded = true;

  whenBodyReady(() => mount(config));
}

bootstrap();
