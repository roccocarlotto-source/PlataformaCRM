import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export interface EmptyStateProps {
  /** Sin `title`: el texto del estado, en la forma compacta (una línea gris).
   *  Con `title`: la descripción que va debajo del título. */
  children?: ReactNode;
  /** Pasa el estado a la forma completa: bloque centrado con título y,
   *  opcionalmente, ícono, descripción y acción. */
  title?: ReactNode;
  icon?: LucideIcon;
  /** La salida del estado vacío: un Button o un Link con `.ds-link-button`.
   *  Solo en la forma completa. */
  action?: ReactNode;
}

// R1.1 — mismo criterio que LoadingState/ErrorState: solo el contenedor
// visual, el texto ("No hay empresas para mostrar.", etc.) lo sigue
// decidiendo cada página.
//
// Dos formas, según cuánto ocupa el estado en la pantalla:
//
// - Compacta (solo `children`): una línea de texto gris, la de siempre. Para
//   el vacío de una sección chica dentro de una tarjeta ("Sin líneas
//   adicionales."), donde un bloque centrado con ícono sería más ruido que
//   información.
// - Completa (`title`): el vacío de una pantalla o de un listado entero. Un
//   bloque centrado con ícono, título, descripción y la acción que lo
//   resuelve ("Todavía no hay empresas" + "Nueva empresa"). Hasta acá esos
//   vacíos eran la misma línea gris que la forma compacta, y una pantalla sin
//   datos se leía como una pantalla rota.
//
// El título es un <p> y no un heading: el estado vive adentro de una página
// que ya tiene su <h1>, y en un listado el vacío reemplaza a la tabla, no es
// una sección nueva del documento.
export function EmptyState({ children, title, icon: Icon, action }: EmptyStateProps) {
  if (title === undefined) {
    return <p className="ds-empty">{children}</p>;
  }
  return (
    <div className="ds-empty-state">
      {Icon ? (
        <span className="ds-empty-state-icon" aria-hidden="true">
          <Icon size={20} strokeWidth={1.5} />
        </span>
      ) : null}
      <p className="ds-empty-state-title">{title}</p>
      {children ? <p className="ds-empty-state-text">{children}</p> : null}
      {action ? <div className="ds-empty-state-action">{action}</div> : null}
    </div>
  );
}
