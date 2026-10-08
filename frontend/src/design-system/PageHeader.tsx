import type { ReactNode } from "react";
import { ChevronLeft, CircleQuestionMark } from "lucide-react";
import { Link } from "react-router-dom";

export interface PageHeaderBack {
  to: string;
  /** El destino, no la acción: "Agentes", no "Volver a Agentes". */
  label: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Solo en subpantallas: el detalle de una conversación, las etapas de un
   *  proceso, la instalación de un agente. Los formularios no lo llevan
   *  (decisión documentada en CompanyFormPage). */
  back?: PageHeaderBack;
  /** La acción principal (y, si hace falta, alguna más) a la derecha del
   *  título; baja debajo cuando no entra. */
  actions?: ReactNode;
  /** A qué lugar de la guía de uso lleva el ícono "?" al lado del título:
   *  `<sección>#<ancla>`, siempre un valor de features/guia/anclas.ts
   *  (AYUDA), nunca un string suelto — anclas.test.ts verifica que existan. */
  help?: string;
}

// El encabezado de toda pantalla dentro del shell. Hasta acá se armaba a mano
// de tres formas (.ds-page-header con h1 y acción, un h1 suelto en los
// formularios, el contexto y el "volver" metidos en un .ds-hint) y el
// "volver" tenía tres estilos distintos. Una sola forma: título, subtítulo
// opcional, "volver" arriba del título, acciones a la derecha, y el "?" de la
// guía pegado al título.
export function PageHeader({ title, subtitle, back, actions, help }: PageHeaderProps) {
  return (
    <div className="ds-page-header">
      <div className="ds-page-header-main">
        {back ? (
          <Link to={back.to} className="ds-page-back">
            <ChevronLeft size={16} strokeWidth={1.5} aria-hidden="true" />
            {back.label}
          </Link>
        ) : null}
        <div className="ds-page-title">
          <h1>{title}</h1>
          {help ? (
            <Link
              to={`/ayuda/${help}`}
              className="ds-page-help"
              aria-label="Ayuda de esta pantalla"
              title="Ayuda de esta pantalla"
            >
              <CircleQuestionMark size={18} strokeWidth={1.5} aria-hidden="true" />
            </Link>
          ) : null}
        </div>
        {subtitle ? <p className="ds-page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="ds-page-header-actions">{actions}</div> : null}
    </div>
  );
}
