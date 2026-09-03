import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  // Título visible de la tarjeta, renderizado como <h2 class="ds-card-title">.
  // Se llama `heading` y no `title` para no pisar el atributo HTML title
  // (tooltip), que sigue disponible vía ...props.
  heading?: ReactNode;
  // <section> por defecto: cada tarjeta del Dashboard es una región con su
  // propio aria-label. "div" para tarjetas que viven DENTRO de una sección
  // (las KPI del resumen comercial), donde una <section> anidada sin nombre
  // sería ruido para un lector de pantalla.
  as?: "section" | "div";
  children: ReactNode;
}

// ---------------------------------------------------------------------------
// Tarjeta: superficie blanca, borde sutil, radio grande, sombra suave — los
// mismos tokens que ya usa .ds-table-wrap. Es componente y no una clase
// suelta porque nace con cuatro consumidores reales (las cuatro secciones del
// Dashboard) y va a tener más en cada pantalla que migre: el mismo criterio
// por el que Badge/Avatar se promovieron a componente y ds-mapping-rows, con
// un único consumidor, se quedó como clase.
//
// Solo contenedor + título opcional. Los estados (LoadingState, EmptyState,
// ErrorState) los sigue componiendo cada consumidor adentro, igual que hoy.
// ---------------------------------------------------------------------------
export function Card({ heading, as: Tag = "section", className, children, ...props }: CardProps) {
  const classes = ["ds-card", className].filter(Boolean).join(" ");
  return (
    <Tag className={classes} {...props}>
      {heading !== undefined ? (
        <div className="ds-card-header">
          <h2 className="ds-card-title">{heading}</h2>
        </div>
      ) : null}
      {children}
    </Tag>
  );
}
