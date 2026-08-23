import type { ReactNode } from "react";

export interface ErrorStateProps {
  children: ReactNode;
}

// R1.1 — mismo role="alert" que ya usaba cada pantalla (necesario para que
// los tests existentes con getByRole("alert") sigan encontrándolo, y para
// que un lector de pantalla anuncie el error). El texto/composición del
// mensaje queda igual que hoy en cada página (prefijo + mensaje real del
// error) — este componente es solo el contenedor visual, no la lógica de
// qué decir.
export function ErrorState({ children }: ErrorStateProps) {
  return (
    <p role="alert" className="ds-error">
      {children}
    </p>
  );
}
