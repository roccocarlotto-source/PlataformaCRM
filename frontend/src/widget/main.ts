import { sendWidgetMessage, WidgetApiError, type WidgetApiErrorCategory } from "./api";
import { readWidgetConfig, WIDGET_LOG_PREFIX, type WidgetConfig } from "./config";
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

  const ui = mountWidgetUi({
    primaryColor: config.primaryColor,
    onSend: (text) => {
      if (sending) return;
      renderMessage(ui.messages, { role: "visitor", text });
      void deliver(text);
    },
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
