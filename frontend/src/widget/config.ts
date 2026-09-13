// ---------------------------------------------------------------------------
// Configuración del widget embebible (docs/ai-agent-architecture.md §9,
// nota fechada del 13/09/2026 bajo el punto 5).
//
// Toda la configuración por instancia viaja en atributos data-* del propio
// <script> que el negocio pega en su sitio:
//
//   <script async src="https://<dominio>/widget.js"
//           data-agent-id="..." data-embed-token="embed_..."
//           data-api-url="https://api..." (opcional)
//           data-primary-color="#0f766e" (opcional)></script>
//
// A PROPÓSITO NO IMPORTA src/config/env.ts: ese módulo valida las cuatro
// variables de la SPA al importarse (Supabase incluido) y tiraría en un
// build que no las tenga. El widget solo necesita VITE_API_URL, y solo como
// fallback de data-api-url. La normalización de la barra final se copia
// (son tres líneas) en vez de importarse, para no acoplar los dos builds.
// ---------------------------------------------------------------------------

export interface WidgetConfig {
  agentId: string;
  embedToken: string;
  /** Base de la API, sin barra final. */
  apiUrl: string;
  /** Color de acento opcional (data-primary-color), tal cual lo escribió el sitio. */
  primaryColor?: string;
}

export const WIDGET_LOG_PREFIX = "[plataforma-crm-widget]";

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function readAttribute(script: Element, name: string): string | undefined {
  const value = script.getAttribute(name)?.trim();
  return value ? value : undefined;
}

// Devuelve null cuando el widget NO debe montarse. Nunca tira: una excepción
// acá rompería el resto del JavaScript de la página del cliente, y el
// widget es un invitado en ese sitio. El motivo va a console.error para que
// quien lo está integrando lo vea.
//
// `script` es un parámetro con default y no una lectura interna fija para
// que los tests puedan pasar un <script> armado a mano; main.ts lo llama sin
// argumentos, en el tope del módulo, que es el único momento en que
// document.currentScript apunta a este script (ver la nota de §9).
export function readWidgetConfig(
  script: HTMLOrSVGScriptElement | null = document.currentScript,
): WidgetConfig | null {
  if (!script) {
    console.error(
      `${WIDGET_LOG_PREFIX} No se pudo leer el <script> que carga el widget ` +
        "(document.currentScript es null). Cargalo con una etiqueta " +
        '<script src="..."> con sus atributos data-*, no insertándolo dinámicamente.',
    );
    return null;
  }

  const agentId = readAttribute(script, "data-agent-id");
  const embedToken = readAttribute(script, "data-embed-token");
  if (!agentId || !embedToken) {
    console.error(
      `${WIDGET_LOG_PREFIX} Faltan atributos obligatorios en el <script>: ` +
        "se necesitan data-agent-id y data-embed-token. El widget no se monta.",
    );
    return null;
  }

  // Vite reemplaza import.meta.env.VITE_API_URL en build por el valor del
  // .env del paquete (el mismo que usa la SPA). Puede no estar definida (un
  // build sin .env) — por eso el tipo local admite undefined aunque
  // vite-env.d.ts la declare como string.
  const envApiUrl = import.meta.env.VITE_API_URL as string | undefined;
  const rawApiUrl = readAttribute(script, "data-api-url") ?? envApiUrl?.trim();
  if (!rawApiUrl) {
    console.error(
      `${WIDGET_LOG_PREFIX} No hay URL de la API: ni data-api-url en el <script> ` +
        "ni VITE_API_URL en el build. El widget no se monta.",
    );
    return null;
  }

  // Sin validar que agentId sea UUID a propósito: el backend ya lo rechaza
  // con su propio 400/401 y una segunda validación acá solo sería una
  // oportunidad más de que las dos diverjan.
  return {
    agentId,
    embedToken,
    apiUrl: stripTrailingSlash(rawApiUrl),
    primaryColor: readAttribute(script, "data-primary-color"),
  };
}
