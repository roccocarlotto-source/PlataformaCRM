import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";
import { Button } from "./Button";

// ---------------------------------------------------------------------------
// El diálogo del proyecto. Es un primitivo de UI —panel, encabezado, cuerpo y
// pie de acciones— y por eso vive acá y no en el feature que lo estrenó, a
// diferencia de FieldMappingEditor, que sí era lógica de un dominio.
//
// DOS FORMAS, elegidas con `variant`:
//
// "panel" (default, la forma original): panel deslizante pegado al borde
// derecho, alto completo, 360px de ancho (export "Reseñas QR", panel "Activar
// QR físico"), no una caja centrada. Encabezado con el título y un botón "×",
// cuerpo con scroll propio si el contenido no entra, y pie con uno o dos
// botones: siempre el de cierre (closeLabel) y, si el consumidor pasa
// `primaryAction`, la acción principal a su derecha. Los botones secundarios
// de un contenido (Copiar, Descargar imagen, Copiar mensaje) siguen viviendo
// en el cuerpo: el pie es solo para "cerrar" y "la acción principal".
//
// El panel NO SE CIERRA AL HACER CLICK AFUERA NI CON ESCAPE, y sigue siendo la
// decisión central de esa variante. El caso que lo motiva es el secreto de
// una API key: no se puede volver a mostrar, así que un cierre accidental
// sería IRREVERSIBLE. Los dos gestos que un diálogo normalmente acepta son
// exactamente los dos que se disparan sin querer, así que no se implementan:
// el overlay no tiene onClick y no hay listener de Escape. El cierre es
// siempre un click explícito, y hay dos controles para eso —el "×" del
// encabezado y el botón del pie—, los dos igual de deliberados.
//
// "dialog" (docs/frontend-cambios-pendientes.md §28): caja CENTRADA, más
// angosta que alta, para contenido DESCARTABLE —el primer consumidor es el
// pop up "Ver detalle" de los listados, de solo lectura—. Acá no hay nada que
// perder al cerrar, así que los dos gestos que el panel rechaza SÍ valen:
// click en el overlay (solo en el overlay: un click dentro de la caja no
// cierra) y Escape. Sin `primaryAction`, y el tipo lo impide: un diálogo
// descartable no tiene una acción principal que confirmar; el pie es solo el
// botón de cierre, que acá dice "Cerrar" y no "Listo" porque es un descarte,
// no una confirmación. El default sigue siendo el seguro ("panel"): ningún
// consumidor existente cambia de comportamiento.
//
// ACCESIBILIDAD: role="dialog" + aria-modal, título asociado por aria-labelledby,
// y el foco se lleva al diálogo al montarlo para que el teclado entre adentro.
// No hay trap de foco: sería una pieza bastante más grande (ciclo de tabulación,
// restauración del foco previo, manejo de portales) y los consumidores —un
// panel con un puñado de controles, un detalle de solo lectura— no la
// necesitan todavía.
// ---------------------------------------------------------------------------

export interface ModalPrimaryAction {
  label: string;
  // Una de las dos: onClick para una acción imperativa (ej. QrSendDialog, que
  // no tiene <form>), formId para disparar el submit de un <form id=...> que
  // vive en children (atributo HTML nativo form="id" en un botón de afuera —
  // sigue disparando el submit del form sin JS adicional).
  onClick?: () => void;
  formId?: string;
  disabled?: boolean;
}

interface ModalBaseProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  // Texto del botón de cierre del pie. Sin pasarlo, "Listo" en el panel y
  // "Cerrar" en el diálogo: en el caso que estrenó el componente el cierre es
  // una confirmación ("ya guardé la clave"), no un descarte; en un diálogo
  // descartable es exactamente al revés.
  closeLabel?: string;
}

// Unión discriminada por `variant` para que `primaryAction` solo exista en el
// panel: pasarla con variant="dialog" no compila, en vez de ignorarse en
// silencio en runtime.
export type ModalProps =
  | (ModalBaseProps & {
      variant?: "panel";
      // Acción principal del pie, a la derecha del cierre. Sin ella el pie
      // tiene un solo botón y el diálogo es puramente informativo.
      primaryAction?: ModalPrimaryAction;
    })
  | (ModalBaseProps & {
      variant: "dialog";
      primaryAction?: never;
    });

export function Modal(props: ModalProps) {
  const { title, children, onClose } = props;
  const variant = props.variant ?? "panel";
  const isDialog = variant === "dialog";
  const closeLabel = props.closeLabel ?? (isDialog ? "Cerrar" : "Listo");
  const primaryAction = isDialog ? undefined : props.primaryAction;

  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Llevar el foco al diálogo al montarlo. Sin esto, quien navega con teclado
  // seguiría parado en el botón que abrió el panel, detrás del overlay.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // Escape cierra SOLO el diálogo descartable: ver el bloque de arriba. En el
  // documento y no en el div, para que funcione aunque el foco haya salido de
  // la caja (el foco no está atrapado).
  useEffect(() => {
    if (!isDialog) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isDialog, onClose]);

  // Click en el overlay: solo cuando el click nació en el propio overlay. Un
  // click adentro de la caja burbujea hasta acá con otro target y no cierra.
  function handleOverlayClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    // En el panel el overlay NO tiene onClick: ver el bloque de arriba. Es
    // solo el fondo. En el diálogo sí, y es uno de sus dos gestos de cierre.
    <div
      className={isDialog ? "ds-modal-overlay ds-modal-overlay--dialog" : "ds-modal-overlay"}
      onClick={isDialog ? handleOverlayClick : undefined}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // tabIndex -1 lo hace enfocable por código sin meterlo en el orden de
        // tabulación natural.
        tabIndex={-1}
        className={isDialog ? "ds-modal ds-modal--dialog" : "ds-modal"}
      >
        <div className="ds-modal-header">
          <h2 id={titleId} className="ds-modal-title">
            {title}
          </h2>
          {/* El "×" es un cierre explícito más, no un gesto: mismo onClose que
              el botón del pie. aria-label porque "×" solo no es un nombre, y
              distinto por variante para que en el diálogo no se llame igual
              que el botón "Cerrar" del pie (dos controles con el mismo nombre
              accesible serían indistinguibles). */}
          <button
            type="button"
            className="ds-modal-close"
            onClick={onClose}
            aria-label={isDialog ? "Cerrar diálogo" : "Cerrar panel"}
          >
            ×
          </button>
        </div>
        <div className="ds-modal-body">{children}</div>
        <div className="ds-modal-actions">
          <Button onClick={onClose}>{closeLabel}</Button>
          {primaryAction ? (
            // Con formId el botón es un submit asociado por el atributo nativo
            // form= al <form> que vive en el cuerpo: dispara su onSubmit (y
            // respeta su noValidate) aunque esté afuera del <form> en el DOM.
            <Button
              variant="primary"
              type={primaryAction.formId ? "submit" : "button"}
              form={primaryAction.formId}
              onClick={primaryAction.onClick}
              disabled={primaryAction.disabled}
            >
              {primaryAction.label}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
