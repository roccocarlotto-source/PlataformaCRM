import type { HTMLAttributes } from "react";

export type BadgeVariant = "neutral" | "info" | "success" | "danger";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

// ---------------------------------------------------------------------------
// Pill de estado. Cuatro variantes semánticas con los colores del diseño
// (design-system.css, .ds-badge--*); nunca un color arbitrario.
//
// EL COLOR ES UNA PROP EXPLÍCITA DEL CONSUMIDOR, no se deriva acá de un dato.
// Se investigó qué determina el color en los datos reales y hay dos casos
// distintos, ninguno con un campo de color en el schema:
//
// - Contact.lifecycleStage es un enum FIJO de Prisma (LEAD, MQL, SQL,
//   CUSTOMER, CHURNED) — es lo que muestra la pantalla "Contactos" del
//   diseño. El mapeo es cerrado y lo decide el feature cuando migre su
//   pantalla: SQL → info, CUSTOMER → success, CHURNED → danger, LEAD y
//   MQL → neutral.
// - Stage (etapa del pipeline) es dato por organización, sin color, pero con
//   dos flags semánticos: isWon / isLost. Ahí el mapeo natural es isWon →
//   success, isLost → danger, el resto → neutral. Tampoco hace falta
//   inventar una paleta por hash del nombre.
//
// Esos dos mapeos viven en features/* (conocen sus tipos; design-system no
// importa de features), no acá. Este componente solo sabe pintar.
// ---------------------------------------------------------------------------
export function Badge({ variant = "neutral", className, ...props }: BadgeProps) {
  const classes = ["ds-badge", `ds-badge--${variant}`, className].filter(Boolean).join(" ");
  return <span className={classes} {...props} />;
}
