import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

// R1.1 — único punto de estilo para las tres variantes de acción que ya
// existían implícitamente en el proyecto (submit primario, acción
// secundaria, "Eliminar"), antes sin distinguirse visualmente entre sí.
// No cambia ningún comportamiento: sigue siendo un <button> nativo, mismos
// props/eventos, type="button" por defecto para no reabrir el bug real de
// un botón dentro de un <form> disparando submit sin querer.
export function Button({
  variant = "secondary",
  type = "button",
  className,
  ...props
}: ButtonProps) {
  const classes = ["ds-button", `ds-button--${variant}`, className].filter(Boolean).join(" ");
  return <button type={type} className={classes} {...props} />;
}
