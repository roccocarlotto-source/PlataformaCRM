import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./Button";

// ---------------------------------------------------------------------------
// Primer modal del proyecto. Es un primitivo de UI —contenedor, título, botón
// de cierre— y por eso vive acá y no en el feature que lo estrenó, a diferencia
// de FieldMappingEditor, que sí era lógica de un dominio.
//
// NO SE CIERRA AL HACER CLICK AFUERA NI CON ESCAPE, y es la decisión central de
// este componente. El caso que lo motiva es el secreto de una API key: no se
// puede volver a mostrar, así que un cierre accidental sería IRREVERSIBLE. Los
// dos gestos que un modal normalmente acepta son exactamente los dos que se
// disparan sin querer, así que no se implementan. El cierre es siempre un click
// explícito en el botón.
//
// Si alguna vez hace falta un modal descartable (una confirmación, un detalle),
// esto se extiende con una prop —`dismissible`, o similar— y el default sigue
// siendo el seguro. No se agrega hoy: no hay un segundo consumidor que diga qué
// forma tendría que tener.
//
// ACCESIBILIDAD: role="dialog" + aria-modal, título asociado por aria-labelledby,
// y el foco se lleva al diálogo al montarlo para que el teclado entre adentro.
// No hay trap de foco: sería una pieza bastante más grande (ciclo de tabulación,
// restauración del foco previo, manejo de portales) y el caso de uso —un cuadro
// con dos controles— no la necesita todavía.
// ---------------------------------------------------------------------------

export interface ModalProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  // Texto del botón de cierre. "Listo" por defecto y no "Cerrar" porque en el
  // caso que estrena el componente el cierre es una confirmación ("ya guardé la
  // clave"), no un descarte.
  closeLabel?: string;
}

export function Modal({ title, children, onClose, closeLabel = "Listo" }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Llevar el foco al diálogo al montarlo. Sin esto, quien navega con teclado
  // seguiría parado en el botón que abrió el modal, detrás del overlay.
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
        <h2 id={titleId} className="ds-modal-title">
          {title}
        </h2>
        <div className="ds-modal-body">{children}</div>
        <div className="ds-modal-actions">
          <Button variant="primary" onClick={onClose}>
            {closeLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
