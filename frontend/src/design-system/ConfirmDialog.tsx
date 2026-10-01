import { useCallback, useRef, useState, type ReactNode } from "react";
import { Modal } from "./Modal";
import { ConfirmContext, type ConfirmFn, type ConfirmOptions } from "./useConfirm";

interface Pendiente extends ConfirmOptions {
  message: string;
}

// El título del diálogo es la pregunta ("¿…?") y el cuerpo, el resto del
// texto: "¿Cancelar esta reserva? El turno queda libre…" se muestra con título
// "¿Cancelar esta reserva?", y "Este resumen lo editó una persona… ¿Seguir?"
// con título "¿Seguir?". Así cada pantalla sigue pasando un solo texto, el
// mismo que le pasaba a window.confirm. Sin pregunta, todo es título.
function partirMensaje(message: string): { title: string; body: string | null } {
  const pregunta = message.match(/¿[^?]*\?/);
  if (!pregunta) return { title: message, body: null };
  const resto = (
    message.slice(0, pregunta.index) + message.slice(pregunta.index! + pregunta[0].length)
  ).trim();
  return { title: pregunta[0], body: resto || null };
}

// Reemplaza a window.confirm en toda la app: un Modal variante dialog con
// "Cancelar" y el botón que confirma. Cerrar de cualquier forma (Cancelar, la
// ×, Escape, click afuera) es "no".
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((message, options) => {
    // Una confirmación nueva mientras otra sigue abierta (no debería pasar:
    // el diálogo tapa la pantalla) responde "no" a la anterior.
    resolver.current?.(false);
    setPendiente({ message, ...options });
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  function responder(ok: boolean) {
    resolver.current?.(ok);
    resolver.current = null;
    setPendiente(null);
  }

  const partes = pendiente ? partirMensaje(pendiente.message) : null;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pendiente && partes ? (
        <Modal
          variant="dialog"
          title={partes.title}
          closeLabel={pendiente.cancelLabel ?? "Cancelar"}
          onClose={() => responder(false)}
          primaryAction={{
            label: pendiente.confirmLabel ?? "Confirmar",
            variant: pendiente.danger ? "danger" : "primary",
            onClick: () => responder(true),
          }}
        >
          {partes.body ? <p>{partes.body}</p> : null}
        </Modal>
      ) : null}
    </ConfirmContext.Provider>
  );
}
