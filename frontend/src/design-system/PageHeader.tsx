import { useContext, useEffect, useRef, type ReactNode } from "react";
import { ChevronLeft, CircleQuestionMark } from "lucide-react";
import { Link } from "react-router-dom";
import { useAsistente, useEsCelular, useRegistrarPantalla } from "../asistente/contexto";
import { OrganizacionDeLaPestana, TITULO_BASE, tituloDeLaPestana } from "./tituloDeLaPestana";

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
  /** El título de la pestaña del navegador, si no tiene que ser el mismo del
   *  encabezado: cuando el encabezado lleva datos de una persona (ver
   *  tituloDeLaPestana.ts). Sin pasarlo, el texto del encabezado. */
  tituloDePestana?: string;
}

// El encabezado de toda pantalla dentro del shell. Hasta acá se armaba a mano
// de tres formas (.ds-page-header con h1 y acción, un h1 suelto en los
// formularios, el contexto y el "volver" metidos en un .ds-hint) y el
// "volver" tenía tres estilos distintos. Una sola forma: título, subtítulo
// opcional, "volver" arriba del título, acciones a la derecha, y el "?" de la
// guía pegado al título.
//
// El asistente "¿Cómo se hace?": el "?" le dice en qué pantalla está la persona
// (useRegistrarPantalla) y, en el celular, abre la hoja con "Preguntale a la
// guía" y "Ver la guía de esta pantalla" en vez de ir directo a la guía. Sin el
// asistente (o fuera de AppLayout), el "?" es el link de siempre.
export function PageHeader({
  title,
  subtitle,
  back,
  actions,
  help,
  tituloDePestana,
}: PageHeaderProps) {
  useRegistrarPantalla(help);
  // UX-08: "<pantalla> · <organización>" en la pestaña. El texto sale del h1
  // ya dibujado, así sirve también cuando el título no es un string.
  const organizacion = useContext(OrganizacionDeLaPestana);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const pantalla = tituloDePestana ?? tituloRef.current?.textContent ?? "";
    document.title = tituloDeLaPestana(pantalla, organizacion);
    return () => {
      document.title = TITULO_BASE;
    };
  }, [title, tituloDePestana, organizacion]);
  const asistente = useAsistente();
  const esCelular = useEsCelular();
  const conHoja = help !== undefined && esCelular && asistente?.disponible === true;
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
          <h1 ref={tituloRef}>{title}</h1>
          {help && conHoja ? (
            <button
              type="button"
              className="ds-page-help"
              aria-label="Ayuda de esta pantalla"
              title="Ayuda de esta pantalla"
              onClick={() => asistente?.abrirHojaDeAyuda(help)}
            >
              <CircleQuestionMark size={18} strokeWidth={1.5} aria-hidden="true" />
            </button>
          ) : help ? (
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
