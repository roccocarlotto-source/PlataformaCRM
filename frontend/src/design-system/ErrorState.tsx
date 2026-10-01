import type { ReactNode } from "react";
import { Button } from "./Button";

export interface ErrorStateProps {
  children: ReactNode;
  /** Agrega un botón para reintentar, adentro de la caja del error. */
  onRetry?: () => void;
  retryLabel?: string;
  /** El reintento está en curso: el botón muestra el spinner y se deshabilita. */
  retrying?: boolean;
}

// R1.1 — mismo role="alert" que ya usaba cada pantalla (necesario para que
// los tests existentes con getByRole("alert") sigan encontrándolo, y para
// que un lector de pantalla anuncie el error). El texto/composición del
// mensaje queda igual que hoy en cada página (prefijo + mensaje real del
// error) — este componente es solo el contenedor visual, no la lógica de
// qué decir.
//
// `onRetry` existe porque "error + botón Reintentar" se armaba a mano en cada
// pantalla que lo necesitaba (cuatro veces solo en AcceptInvitationPage), con
// el botón suelto debajo de la caja. Con reintento, el role="alert" queda en
// el párrafo del mensaje y no en la caja: así getByRole("alert") sigue
// devolviendo exactamente el texto del error, sin el rótulo del botón.
export function ErrorState({
  children,
  onRetry,
  retryLabel = "Reintentar",
  retrying = false,
}: ErrorStateProps) {
  if (!onRetry) {
    return (
      <p role="alert" className="ds-error">
        {children}
      </p>
    );
  }
  return (
    <div className="ds-error ds-error--retry">
      <p role="alert">{children}</p>
      <Button onClick={onRetry} loading={retrying}>
        {retryLabel}
      </Button>
    </div>
  );
}
