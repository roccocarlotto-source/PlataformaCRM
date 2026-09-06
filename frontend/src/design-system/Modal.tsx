import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./Button";

// ---------------------------------------------------------------------------
// El diálogo del proyecto. Es un primitivo de UI —panel, encabezado, cuerpo y
// pie de acciones— y por eso vive acá y no en el feature que lo estrenó, a
// diferencia de FieldMappingEditor, que sí era lógica de un dominio.
//
// FORMA: panel deslizante pegado al borde derecho, alto completo, 360px de
// ancho (export "Reseñas QR", panel "Activar QR físico"), no una caja
// centrada. Encabezado con el título y un botón "×", cuerpo con scroll propio
// si el contenido no entra, y pie con uno o dos botones: siempre el de cierre
// (closeLabel) y, si el consumidor pasa `primaryAction`, la acción principal a
// su derecha. Los botones secundarios de un contenido (Copiar, Descargar
// imagen, Copiar mensaje) siguen viviendo en el cuerpo: el pie es solo para
// "cerrar" y "la acción principal".
//
// NO SE CIERRA AL HACER CLICK AFUERA NI CON ESCAPE, y sigue siendo la decisión
// central de este componente. El caso que lo motiva es el secreto de una API
// key: no se puede volver a mostrar, así que un cierre accidental sería
// IRREVERSIBLE. Los dos gestos que un diálogo normalmente acepta son
// exactamente los dos que se disparan sin querer, así que no se implementan:
// el overlay no tiene onClick y no hay listener de Escape. El cierre es
// siempre un click explícito, y ahora hay dos controles para eso —el "×" del
// encabezado y el botón del pie—, los dos igual de deliberados.
//
// Si alguna vez hace falta un diálogo descartable (una confirmación, un
// detalle), esto se extiende con una prop —`dismissible`, o similar— y el
// default sigue siendo el seguro. No se agrega hoy: no hay un consumidor que
// diga qué forma tendría que tener.
//
// ACCESIBILIDAD: role="dialog" + aria-modal, título asociado por aria-labelledby,
// y el foco se lleva al diálogo al montarlo para que el teclado entre adentro.
// No hay trap de foco: sería una pieza bastante más grande (ciclo de tabulación,
// restauración del foco previo, manejo de portales) y los consumidores —un
// panel con un puñado de controles— no la necesitan todavía.
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

export interface ModalProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  // Texto del botón de cierre del pie. "Listo" por defecto y no "Cerrar" porque
  // en el caso que estrenó el componente el cierre es una confirmación ("ya
  // guardé la clave"), no un descarte.
  closeLabel?: string;
  // Acción principal del pie, a la derecha del cierre. Sin ella el pie tiene
  // un solo botón y el diálogo es puramente informativo.
  primaryAction?: ModalPrimaryAction;
}

export function Modal({
  title,
  children,
  onClose,
  closeLabel = "Listo",
  primaryAction,
}: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Llevar el foco al diálogo al montarlo. Sin esto, quien navega con teclado
  // seguiría parado en el botón que abrió el panel, detrás del overlay.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    // El overlay NO tiene onClick: ver el bloque de arriba. Es solo el fondo.
    <div className="ds-modal-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // tabIndex -1 lo hace enfocable por código sin meterlo en el orden de
        // tabulación natural.
        tabIndex={-1}
        className="ds-modal"
      >
        <div className="ds-modal-header">
          <h2 id={titleId} className="ds-modal-title">
            {title}
          </h2>
          {/* El "×" es un cierre explícito más, no un gesto: mismo onClose que
              el botón del pie. aria-label porque "×" solo no es un nombre. */}
          <button
            type="button"
            className="ds-modal-close"
            onClick={onClose}
            aria-label="Cerrar panel"
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
