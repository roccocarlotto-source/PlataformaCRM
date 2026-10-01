import type { ReactNode } from "react";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";

export type NoticeTone = "info" | "warning" | "danger";

export interface NoticeProps {
  /** `info`: contexto que conviene saber. `warning`: algo a leer antes de
   *  seguir (la fuente está pausada, el texto se va a cortar). `danger`: una
   *  consecuencia seria e irreversible (el secreto se muestra una sola vez). */
  tone?: NoticeTone;
  title?: ReactNode;
  /** Si se anuncia con role="alert". Por defecto, sí en warning y danger. En
   *  false para un aviso que está desde que carga la pantalla o que aparece
   *  mientras se escribe: no irrumpe, se lee en su orden. */
  alert?: boolean;
  children: ReactNode;
}

const ICONOS = { info: Info, warning: TriangleAlert, danger: CircleAlert } as const;

// Aviso en la página — lo que NO es un error pero tampoco es texto de ayuda.
// Hasta acá esos avisos se pintaban de dos formas equivocadas: con la caja
// roja de ErrorState (una advertencia permanente se leía como una falla
// apenas cargaba la pantalla) o con el gris de .ds-hint (un límite que
// bloquea el guardado se leía como una ayuda opcional).
//
// warning y danger llevan role="alert" por defecto, el mismo que tenían como
// ErrorState: son avisos que se tienen que anunciar. info no lleva rol: es
// contexto, no algo que interrumpa. `alert` lo decide cada pantalla cuando
// el default no es el que ya tenía.
export function Notice({ tone = "info", title, alert = tone !== "info", children }: NoticeProps) {
  const Icon = ICONOS[tone];
  return (
    <div className={`ds-notice ds-notice--${tone}`} role={alert ? "alert" : undefined}>
      <Icon className="ds-notice-icon" size={16} strokeWidth={1.5} aria-hidden="true" />
      <div className="ds-notice-body">
        {title ? <p className="ds-notice-title">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}
