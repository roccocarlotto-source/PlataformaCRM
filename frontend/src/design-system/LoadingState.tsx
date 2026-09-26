import type { ReactNode } from "react";
import { Spinner } from "./Spinner";
import { SkeletonLines, SkeletonRows } from "./Skeleton";

export type LoadingStateVariant = "spinner" | "rows" | "lines";

export interface LoadingStateProps {
  children?: ReactNode;
  /** `spinner` (por defecto): anillo girando al lado del texto, para cargas
   *  cortas o de una sección chica. `rows`: esqueleto de filas, para el
   *  cuerpo de un listado o una tabla. `lines`: esqueleto de párrafo, para
   *  el contenido de una tarjeta o un detalle. */
  variant?: LoadingStateVariant;
  /** Cuántas filas/líneas dibuja el esqueleto. Ignorado en `spinner`. */
  count?: number;
}

// R1.1 — mismo texto por defecto ("Cargando…") que ya usaban las 8
// pantallas, ahora en un solo lugar.
//
// Animaciones de carga — el estado dejó de ser un texto quieto: siempre trae
// una animación asociada, y la variante elige cuál según el contexto. En
// `spinner` el texto se sigue viendo al lado del anillo; en los esqueletos
// pasa a `.ds-sr-only`, porque ahí lo que comunica la espera es la forma
// animada del contenido que viene, pero el estado tiene que seguir
// anunciándose a un lector de pantalla (y siendo un único nodo de texto, que
// es lo que buscan los tests con getByText("Cargando…")).
//
// `aria-live="polite"` (sin `role="status"`) para que el cambio a "cargando" y
// su desaparición se anuncien sin interrumpir lo que se esté leyendo. El rol
// `status` queda reservado para la región de avisos de Toast.tsx, que es la
// que el proyecto busca con getByRole("status"): ponerlo también acá haría
// ambigua esa consulta cada vez que una pantalla carga y avisa a la vez.
export function LoadingState({
  children = "Cargando…",
  variant = "spinner",
  count,
}: LoadingStateProps) {
  const classes = ["ds-loading", `ds-loading--${variant}`].join(" ");

  if (variant === "spinner") {
    return (
      <p className={classes} aria-live="polite">
        <Spinner size="sm" />
        <span>{children}</span>
      </p>
    );
  }

  return (
    <p className={classes} aria-live="polite" aria-busy="true">
      {variant === "rows" ? <SkeletonRows count={count} /> : <SkeletonLines count={count} />}
      <span className="ds-sr-only">{children}</span>
    </p>
  );
}

export interface InlineLoadingProps {
  children?: ReactNode;
}

// Animaciones de carga — la versión en línea de LoadingState: un <span>, para
// los estados de carga que viven DENTRO de una frase, una celda o un <li>
// (el "Cargando…" de la entidad seleccionada en los *Select, el "Buscando…"
// de la lista de resultados), donde un <p> con padding propio rompería la
// línea. Mismo criterio que arriba: el spinner acompaña al texto, no lo
// reemplaza, y el texto queda en un único nodo.
export function InlineLoading({ children = "Cargando…" }: InlineLoadingProps) {
  return (
    <span className="ds-inline-loading" aria-live="polite">
      <Spinner size="sm" />
      <span>{children}</span>
    </span>
  );
}

export interface LoadingScreenProps {
  children?: ReactNode;
}

// Animaciones de carga — la espera a pantalla completa, antes de que exista
// el layout de la app: el gate de ruta privada (auth/ProtectedRoute.tsx)
// mientras se resuelve la sesión y el perfil. Es el estado de carga que más
// ve el usuario, porque aparece en cada carga fría de cualquier pantalla, y
// hasta ahora era un <div> con texto pelado, sin centrar y sin animación.
//
// Spinner grande y centrado en el alto de la ventana, no el inline de una
// sección: acá no hay nada más en pantalla que lo acompañe.
export function LoadingScreen({ children = "Cargando…" }: LoadingScreenProps) {
  return (
    <div className="ds-loading-screen" aria-live="polite" aria-busy="true">
      <Spinner size="lg" />
      <p>{children}</p>
    </div>
  );
}
