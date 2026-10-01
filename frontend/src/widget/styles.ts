// ---------------------------------------------------------------------------
// Estilos del widget como un string de CSS plano, inyectado en un <style>
// dentro del shadow root (ui.ts). Sin CSS Modules ni CSS-in-JS: el build del
// widget es un solo archivo JS y no hay nada que justifique una dependencia.
//
// El Shadow DOM aísla los selectores en ambos sentidos, pero las propiedades
// HEREDADAS (font, color, line-height...) sí atraviesan el límite desde el
// sitio anfitrión — por eso `:host { all: initial }` las resetea y el widget
// define las suyas. `all` no toca custom properties, así que --widget-accent
// seteada inline en el host (data-primary-color) sigue llegando.
//
// z-index 2147483647 en el contenedor raíz: el máximo práctico, mismo
// criterio que Intercom/Drift, para no perder contra el CSS del sitio.
//
// La paleta copia los VALORES del tema claro de design-system/tokens.css (el
// acento, los textos, los bordes y el rojo de la marca), no las variables:
// tokens.css no llega al shadow root de un sitio ajeno. Sin tema oscuro
// automático (D-5 de la auditoría de diseño): el widget vive en el sitio del
// cliente, y un panel oscuro sobre un sitio claro desentonaría. La tipografía
// sigue siendo la del sistema: cargar Public Sans en un sitio ajeno es un
// pedido de red más para un chat.
// ---------------------------------------------------------------------------

export const WIDGET_STYLES = `
:host {
  all: initial;
  --widget-accent: #3d47ad;
  --pcw-accent-text: #ffffff;
  --pcw-surface: #ffffff;
  --pcw-surface-muted: #f0efeb;
  --pcw-text: #1b1b18;
  --pcw-text-muted: #57564d;
  --pcw-border: #e6e5e0;
  --pcw-danger: #b8402f;
  --pcw-danger-bg: #fbecea;
  --pcw-danger-border: rgba(184, 64, 47, 0.25);
  --pcw-danger-hover: rgba(184, 64, 47, 0.08);
  --pcw-radius: 14px;
  --pcw-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

.pcw-root {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.45;
  color: var(--pcw-text);
}

.pcw-bubble {
  width: 56px;
  height: 56px;
  border: 0;
  border-radius: 50%;
  background: var(--widget-accent);
  color: var(--pcw-accent-text);
  box-shadow: var(--pcw-shadow);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: transform 120ms ease;
}
.pcw-bubble:hover {
  transform: scale(1.05);
}
.pcw-bubble:focus-visible,
.pcw-send:focus-visible,
.pcw-retry:focus-visible,
.pcw-close:focus-visible {
  outline: 2px solid var(--widget-accent);
  outline-offset: 2px;
}
.pcw-bubble svg {
  width: 26px;
  height: 26px;
  display: block;
}

.pcw-panel {
  width: 360px;
  max-width: calc(100vw - 40px);
  height: 520px;
  max-height: calc(100vh - 110px);
  max-height: calc(100dvh - 110px);
  display: flex;
  flex-direction: column;
  background: var(--pcw-surface);
  border: 1px solid var(--pcw-border);
  border-radius: var(--pcw-radius);
  box-shadow: var(--pcw-shadow);
  overflow: hidden;
}
.pcw-panel[hidden] {
  display: none;
}

.pcw-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  background: var(--widget-accent);
  color: var(--pcw-accent-text);
}
.pcw-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.pcw-close {
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}
.pcw-close:hover {
  background: rgba(255, 255, 255, 0.18);
}

.pcw-messages {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--pcw-surface);
}

.pcw-msg {
  max-width: 82%;
  padding: 9px 12px;
  border-radius: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.pcw-msg--visitor {
  align-self: flex-end;
  background: var(--widget-accent);
  color: var(--pcw-accent-text);
  border-bottom-right-radius: 4px;
}
.pcw-msg--agent {
  align-self: flex-start;
  background: var(--pcw-surface-muted);
  color: var(--pcw-text);
  border-bottom-left-radius: 4px;
}

.pcw-typing {
  align-self: flex-start;
  color: var(--pcw-text-muted);
  font-style: italic;
  padding: 4px 12px;
}

.pcw-error {
  align-self: stretch;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--pcw-danger-bg);
  color: var(--pcw-danger);
  border: 1px solid var(--pcw-danger-border);
}
.pcw-retry {
  border: 1px solid var(--pcw-danger);
  background: transparent;
  color: var(--pcw-danger);
  border-radius: 8px;
  padding: 5px 10px;
  font: inherit;
  cursor: pointer;
}
.pcw-retry:hover {
  background: var(--pcw-danger-hover);
}

.pcw-composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px;
  border-top: 1px solid var(--pcw-border);
  background: var(--pcw-surface);
}
.pcw-input {
  flex: 1;
  resize: none;
  min-height: 40px;
  max-height: 120px;
  padding: 9px 12px;
  border: 1px solid var(--pcw-border);
  border-radius: 10px;
  font: inherit;
  font-size: max(16px, 1rem);
  color: var(--pcw-text);
  background: var(--pcw-surface);
}
.pcw-input:focus {
  outline: 2px solid var(--widget-accent);
  outline-offset: -1px;
}
.pcw-input:disabled,
.pcw-send:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.pcw-send {
  height: 40px;
  padding: 0 14px;
  border: 0;
  border-radius: 10px;
  background: var(--widget-accent);
  color: var(--pcw-accent-text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

@media (max-width: 480px) {
  .pcw-root {
    right: 12px;
    bottom: 12px;
  }
  .pcw-panel {
    width: calc(100vw - 24px);
    max-width: none;
    height: calc(100vh - 100px);
    height: calc(100dvh - 100px);
  }
}
`;
