import type { ReactNode } from "react";

export interface EmptyStateProps {
  children: ReactNode;
}

// R1.1 — mismo criterio que LoadingState/ErrorState: solo el contenedor
// visual, el texto ("No hay empresas para mostrar.", etc.) lo sigue
// decidiendo cada página, igual que hoy.
export function EmptyState({ children }: EmptyStateProps) {
  return <p className="ds-empty">{children}</p>;
}
