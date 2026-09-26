import type { ButtonHTMLAttributes } from "react";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** La acción del botón está en curso: muestra un spinner antes del texto y
   *  deja el botón deshabilitado mientras dure. */
  loading?: boolean;
}

// R1.1 — único punto de estilo para las tres variantes de acción que ya
// existían implícitamente en el proyecto (submit primario, acción
// secundaria, "Eliminar"), antes sin distinguirse visualmente entre sí.
// No cambia ningún comportamiento: sigue siendo un <button> nativo, mismos
// props/eventos, type="button" por defecto para no reabrir el bug real de
// un botón dentro de un <form> disparando submit sin querer.
//
// Animaciones de carga — `loading` es el único lugar donde se resuelve el
// "esta acción está corriendo" de todos los botones: spinner + `aria-busy` +
// `disabled`. El texto lo sigue eligiendo cada pantalla (muchas cambian
// "Guardar" por "Guardando…"), porque el spinner acompaña al texto, no lo
// reemplaza: quien no ve la animación igual lee el estado.
export function Button({
  variant = "secondary",
  type = "button",
  className,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const classes = [
    "ds-button",
    `ds-button--${variant}`,
    loading ? "ds-button--loading" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner size="sm" /> : null}
      {children}
    </button>
  );
}
