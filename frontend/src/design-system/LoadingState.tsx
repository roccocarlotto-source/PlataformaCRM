import type { ReactNode } from "react";

export interface LoadingStateProps {
  children?: ReactNode;
}

// R1.1 — mismo texto por defecto ("Cargando…") que ya usaban las 8
// pantallas, ahora en un solo lugar.
export function LoadingState({ children = "Cargando…" }: LoadingStateProps) {
  return <p className="ds-loading">{children}</p>;
}
