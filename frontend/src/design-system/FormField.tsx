import type { ReactNode } from "react";

export interface FormFieldProps {
  label: ReactNode;
  children: ReactNode;
}

// R1.1 — mismo patrón de accesibilidad que ya usaba cada formulario
// (label envolviendo el control, sin id/htmlFor) — deliberadamente NO se
// cambia a un patrón con id explícito: los tests existentes usan
// getByLabelText, que ya funciona con label-envuelve-input, y no hay
// ninguna razón funcional para el cambio en este punto del Roadmap A. Esto
// es solo la envoltura visual (espaciado, tamaño de label) sobre el mismo
// contrato de accesibilidad.
export function FormField({ label, children }: FormFieldProps) {
  return (
    <label className="ds-field">
      <span className="ds-field-label">{label}</span>
      {children}
    </label>
  );
}
