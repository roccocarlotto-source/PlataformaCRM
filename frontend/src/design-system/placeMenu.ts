import type { CSSProperties } from "react";

// Distancia entre el trigger y el menú, y mínima entre el menú y el borde de
// la ventana, en px (= --space-1).
const GAP = 4;

type Rect = Pick<DOMRect, "top" | "bottom" | "right">;

// Dónde va el menú de ActionsMenu (estilos position: fixed) según el trigger,
// el tamaño del menú y la ventana. Debajo si entra; si no, arriba si entra;
// si no entra de ningún lado (una ventana baja), del lado con más lugar y con
// un alto máximo que scrollea, para que ningún ítem quede fuera de la
// pantalla (UX-11). Alineado al borde derecho del trigger —es la última
// columna— salvo que así se salga por la izquierda.
export function placeMenu(
  trigger: Rect,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
): CSSProperties {
  const below = viewport.height - trigger.bottom - GAP * 2;
  const above = trigger.top - GAP * 2;
  const horizontal: CSSProperties =
    trigger.right - menu.width < GAP ? { left: GAP } : { right: viewport.width - trigger.right };
  if (menu.height <= below) return { ...horizontal, top: trigger.bottom + GAP };
  if (menu.height <= above) {
    return { ...horizontal, bottom: viewport.height - trigger.top + GAP };
  }
  return below >= above
    ? { ...horizontal, top: trigger.bottom + GAP, maxHeight: below, overflowY: "auto" }
    : {
        ...horizontal,
        bottom: viewport.height - trigger.top + GAP,
        maxHeight: above,
        overflowY: "auto",
      };
}
