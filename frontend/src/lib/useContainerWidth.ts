import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Ancho real, en píxeles, de un elemento del DOM — medido con ResizeObserver,
// sin librería. Nace para el gráfico del Dashboard (§32 de docs/frontend-
// cambios-pendientes.md): un <svg> cuyo viewBox y cuyos width/height se arman
// con ESTE número, para que 1 unidad de viewBox sea siempre 1px y nada de lo
// que vive adentro (font-size, stroke-width) escale con la tarjeta.
//
// Devuelve `null` hasta la primera medición: el consumidor no debe dibujar
// con un ancho inventado mientras tanto (es un frame, imperceptible).
//
// Es un callback ref y no un useRef + useEffect a propósito: el elemento
// medido suele montarse recién cuando hay datos (dentro de un `isSuccess ?
// … : null`), y un efecto con deps vacías ya corrió para entonces. React 19
// llama al callback con el nodo al montar y ejecuta la limpieza que devuelve
// al desmontar, que es exactamente el ciclo de vida del observer.
// ---------------------------------------------------------------------------
export function useContainerWidth(): {
  ref: (node: HTMLElement | null) => void | (() => void);
  width: number | null;
} {
  const [width, setWidth] = useState<number | null>(null);

  const ref = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    // Piso, no redondeo: un <svg> de 601px en un contenedor de 600.5 se
    // desbordaría medio píxel.
    const measure = (value: number) => setWidth(Math.floor(value));

    if (typeof ResizeObserver === "undefined") {
      // Navegador sin ResizeObserver (ninguno de los que soporta la app):
      // una sola medición, sin seguir los cambios de tamaño.
      measure(node.getBoundingClientRect().width);
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
