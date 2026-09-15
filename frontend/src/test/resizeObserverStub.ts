import { vi } from "vitest";

// jsdom no implementa ResizeObserver, y lib/useContainerWidth.ts no dibuja
// nada hasta la primera medición. Este stub entrega una medición sincrónica
// con un ancho fijo al observar cada nodo (600 por defecto: el mismo ancho
// que tenía el viewBox fijo del gráfico antes del §32, así los números de
// los tests existentes siguen valiendo). Devuelve las instancias creadas
// para poder afirmar sobre observe/disconnect.
export interface ResizeObserverStub {
  observe: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

export function stubResizeObserver(width = 600): ResizeObserverStub[] {
  const instances: ResizeObserverStub[] = [];

  class FakeResizeObserver {
    observe: ReturnType<typeof vi.fn>;
    unobserve = vi.fn();
    disconnect = vi.fn();

    constructor(callback: ResizeObserverCallback) {
      this.observe = vi.fn((target: Element) => {
        callback(
          [{ target, contentRect: { width } } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      });
      instances.push(this);
    }
  }

  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  return instances;
}
