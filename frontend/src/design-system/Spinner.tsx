export type SpinnerSize = "sm" | "md" | "lg";

export interface SpinnerProps {
  /** sm: dentro de un botón o una línea de texto. md: estados de carga de
   *  una sección. lg: carga de pantalla completa. */
  size?: SpinnerSize;
  className?: string;
}

// Animaciones de carga — anillo que gira, puramente CSS (sin dependencias ni
// SVG animado) y en `currentColor`, así hereda el color del botón o del texto
// donde se monta sin necesitar una variante por contexto.
//
// Siempre `aria-hidden`: es decoración. El nombre accesible del estado lo
// pone quien lo usa (el texto "Cargando…"/"Guardando…" al lado, o un
// `.ds-sr-only`), para no duplicar el anuncio en lectores de pantalla.
//
// `@media (prefers-reduced-motion: reduce)` en design-system.css lo deja
// quieto pero visible, igual que el resto de las animaciones del sistema.
export function Spinner({ size = "sm", className }: SpinnerProps) {
  const classes = ["ds-spinner", `ds-spinner--${size}`, className].filter(Boolean).join(" ");
  return <span className={classes} aria-hidden="true" />;
}
