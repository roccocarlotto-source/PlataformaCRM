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
// ACCESIBILIDAD (UX-07 de docs-privados/auditoria-2026-10-21, local; decisión
// de Rocco del 2026-10-30): el overlay y la caja van dentro de un <dialog>
// NATIVO abierto con showModal(). El navegador encierra el foco adentro, deja
// inerte la página de atrás (antes se podía tabular hasta ella con una
// confirmación de "Eliminar" abierta) y devuelve el foco a quien lo abrió al
// cerrarse. El <dialog> es solo el anfitrión, transparente y a pantalla
// completa: el aspecto sigue siendo el de .ds-modal-overlay y .ds-modal.
//
// Escape: el navegador lo convierte en el evento "cancel". En el panel se
// cancela (la decisión de arriba no cambia); en el diálogo descartable cierra.
//
// Lo que se abre adentro (los menús de Select, SearchSelect, MultiSelect y
// ActionsMenu) es hijo del <dialog>, así que queda en la misma capa, encima de
// la página. Los avisos (Toast.tsx) no son hijos: van como popover para quedar
// encima del diálogo abierto.
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
  // La acción está corriendo: el botón muestra un spinner y queda
  // deshabilitado mientras dure (ver Button.tsx).
  loading?: boolean;
  // "danger" para una acción destructiva (ConfirmDialog: "Eliminar"). Por
  // defecto, primaria.
  variant?: "primary" | "danger";
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

// `primaryAction` existe en las dos variantes. Hasta ConfirmDialog el diálogo
// era solo informativo (un detalle de solo lectura, cerrar y listo) y la
// acción estaba prohibida por tipo; una confirmación es justamente un diálogo
// con una acción.
export interface ModalProps extends ModalBaseProps {
  variant?: "panel" | "dialog";
  // Acción principal del pie, a la derecha del cierre. Sin ella el pie tiene
  // un solo botón y el modal es puramente informativo.
  primaryAction?: ModalPrimaryAction;
}

export function Modal(props: ModalProps) {
  const { title, children, onClose } = props;
  const variant = props.variant ?? "panel";
  const isDialog = variant === "dialog";
  const closeLabel = props.closeLabel ?? (isDialog ? "Cerrar" : "Listo");
  const primaryAction = props.primaryAction;

  const titleId = useId();
  const hostRef = useRef<HTMLDialogElement>(null);

  // Abrir como modal y llevar el foco al diálogo (sin esto, showModal lo
  // pondría en el "×", el primer control). Sin showModal (jsdom, un
  // navegador viejo) queda abierto como diálogo común. Al desmontar se cierra
  // con close(): es lo que devuelve el foco a quien lo abrió.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (typeof host.showModal === "function") {
      if (!host.open) host.showModal();
    } else {
      host.setAttribute("open", "");
    }
    host.focus();
    return () => {
      if (typeof host.close === "function" && host.open) host.close();
    };
  }, []);

  // Escape llega como "cancel". Cierra SOLO el diálogo descartable: ver el
  // bloque de arriba. En los dos casos se cancela el cierre nativo: quien
  // desmonta el diálogo es el consumidor, vía onClose.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    function handleCancel(event: Event) {
      event.preventDefault();
      if (isDialog) onClose();
    }
    host.addEventListener("cancel", handleCancel);
    // Sin <dialog> nativo (jsdom, un navegador viejo) no hay "cancel": Escape
    // se escucha en el documento, como antes.
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && isDialog) onClose();
    }
    const sinNativo = typeof host.showModal !== "function";
    if (sinNativo) document.addEventListener("keydown", handleKeyDown);
    return () => {
      host.removeEventListener("cancel", handleCancel);
      if (sinNativo) document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDialog, onClose]);

  // Click en el overlay: solo cuando el click nació en el propio overlay. Un
  // click adentro de la caja burbujea hasta acá con otro target y no cierra.
  function handleOverlayClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <dialog
      ref={hostRef}
      className="ds-modal-host"
      aria-modal="true"
      aria-labelledby={titleId}
      // tabIndex -1: enfocable por código sin entrar en el orden de tabulación.
      tabIndex={-1}
    >
      {/* En el panel el overlay NO tiene onClick: ver el bloque de arriba. Es
          solo el fondo. En el diálogo sí, y es uno de sus dos gestos de cierre. */}
      <div
        className={isDialog ? "ds-modal-overlay ds-modal-overlay--dialog" : "ds-modal-overlay"}
        onClick={isDialog ? handleOverlayClick : undefined}
      >
        <div className={isDialog ? "ds-modal ds-modal--dialog" : "ds-modal"}>
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
          {/* Sin contenido (una confirmación que es solo la pregunta del título)
            no se dibuja el cuerpo: quedaría una franja vacía entre el título y
            los botones. */}
          {children ? <div className="ds-modal-body">{children}</div> : null}
          <div className="ds-modal-actions">
            <Button onClick={onClose}>{closeLabel}</Button>
            {primaryAction ? (
              // Con formId el botón es un submit asociado por el atributo nativo
              // form= al <form> que vive en el cuerpo: dispara su onSubmit (y
              // respeta su noValidate) aunque esté afuera del <form> en el DOM.
              <Button
                variant={primaryAction.variant ?? "primary"}
                type={primaryAction.formId ? "submit" : "button"}
                form={primaryAction.formId}
                onClick={primaryAction.onClick}
                disabled={primaryAction.disabled}
                loading={primaryAction.loading}
              >
                {primaryAction.label}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </dialog>
  );
}
