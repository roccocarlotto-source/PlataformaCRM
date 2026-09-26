export interface SkeletonProps {
  /** Ancho CSS del bloque (por defecto ocupa todo el ancho disponible). */
  width?: string;
  /** Alto CSS del bloque. Por defecto, una línea de texto. */
  height?: string;
  /** `full` para píldoras/avatares redondos; por defecto el radio chico. */
  radius?: "sm" | "md" | "full";
  className?: string;
}

// Animaciones de carga — bloque gris con brillo que recorre de izquierda a
// derecha (shimmer), para la carga de listas, tablas y tarjetas: ocupa el
// lugar del contenido que viene, así la pantalla no salta cuando llega.
//
// Decorativo y `aria-hidden`: el texto del estado lo pone LoadingState.
export function Skeleton({ width, height, radius = "sm", className }: SkeletonProps) {
  const classes = ["ds-skeleton", `ds-skeleton--${radius}`, className].filter(Boolean).join(" ");
  return <span className={classes} style={{ width, height }} aria-hidden="true" />;
}

export interface SkeletonLinesProps {
  /** Cuántas líneas dibujar. */
  count?: number;
  className?: string;
}

// Varias líneas de texto en carga. La última sale más corta, que es como se
// ve un párrafo real y evita que el bloque parezca una tabla.
export function SkeletonLines({ count = 3, className }: SkeletonLinesProps) {
  const classes = ["ds-skeleton-lines", className].filter(Boolean).join(" ");
  return (
    <span className={classes} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} width={index === count - 1 ? "60%" : undefined} />
      ))}
    </span>
  );
}

export interface SkeletonRowsProps {
  /** Cuántas filas dibujar. */
  count?: number;
  className?: string;
}

// Filas de una tabla/listado en carga: barras del alto de una fila real,
// separadas por la misma línea divisoria que usa .ds-table.
export function SkeletonRows({ count = 5, className }: SkeletonRowsProps) {
  const classes = ["ds-skeleton-rows", className].filter(Boolean).join(" ");
  return (
    <span className={classes} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="ds-skeleton-row">
          <Skeleton height="14px" />
        </span>
      ))}
    </span>
  );
}
