import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

export interface TableProps {
  children: ReactNode;
  // UX-11: la última columna ("Acciones") queda fija contra el borde derecho
  // mientras la tabla scrollea de costado, así el "⋮" de cada fila se ve
  // aunque la tabla no entre (una laptop de 1366 px). Toda tabla con una
  // columna "Acciones" lo lleva: lo exige Table.acciones.test.ts.
  accionesFijas?: boolean;
}

// R1.1 — envoltura puramente visual: cada ListPage sigue armando su propio
// <thead>/<tbody> con sus columnas (no se generaliza a un <Table
// columns={...} data={...}>, que reescribiría la lógica de render de las 8
// pantallas para un punto del Roadmap A que solo pide consistencia visual,
// no esa refactorización). El wrapper con overflow-x:auto es lo que
// permite que una tabla ancha haga scroll horizontal propio en vez de
// desbordar la página — real gap de las tablas actuales, sin solución hoy.
export function Table({ children, accionesFijas = false }: TableProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const tapaColumnas = useColumnasTapadas(wrapRef, accionesFijas);

  return (
    <div
      ref={wrapRef}
      className={accionesFijas ? "ds-table-wrap ds-table-wrap--acciones-fijas" : "ds-table-wrap"}
      data-tapa-columnas={tapaColumnas ? "" : undefined}
    >
      <table className="ds-table">{children}</table>
    </div>
  );
}

// Si quedan columnas escondidas detrás de la columna fija (a la derecha del
// área visible). Con eso el CSS le pone una sombra a la columna fija: sin
// ella, nada indicaba que la tabla seguía (UX-11). Se recalcula al scrollear
// el wrapper y cuando cambia el ancho del wrapper o de la tabla (resize de la
// ventana, filas que llegan del servidor). El 1 px de tolerancia es por el
// redondeo de scrollLeft con zoom.
function useColumnasTapadas(wrapRef: RefObject<HTMLDivElement | null>, activo: boolean): boolean {
  const [tapa, setTapa] = useState(false);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!activo || !wrap) return;
    const medir = () => setTapa(wrap.scrollWidth - wrap.clientWidth - wrap.scrollLeft > 1);
    medir();
    wrap.addEventListener("scroll", medir, { passive: true });
    // jsdom no tiene ResizeObserver: ahí alcanza con la medición inicial.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(medir);
    observer?.observe(wrap);
    if (wrap.firstElementChild) observer?.observe(wrap.firstElementChild);
    return () => {
      wrap.removeEventListener("scroll", medir);
      observer?.disconnect();
    };
  }, [wrapRef, activo]);

  return activo && tapa;
}
