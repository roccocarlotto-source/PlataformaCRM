import { createContext, useContext } from "react";

// ---------------------------------------------------------------------------
// Confirmación antes de una acción: `if (!(await confirm("¿Eliminar…?"))) return;`.
//
// Mismo split que useToast.ts (contexto y hook acá, provider en
// ConfirmDialog.tsx) y por el mismo motivo: react-refresh se queja de un
// módulo que exporta un hook junto a un componente.
// ---------------------------------------------------------------------------

export interface ConfirmOptions {
  /** El rótulo del botón que confirma ("Eliminar", "Revocar"). Por defecto,
   *  "Confirmar". */
  confirmLabel?: string;
  /** El rótulo del botón que no confirma. Por defecto, "Cancelar"; otro
   *  cuando la acción misma es cancelar algo ("Cancelar reserva"). */
  cancelLabel?: string;
  /** Acción destructiva: el botón que confirma va en rojo. */
  danger?: boolean;
}

export type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<ConfirmFn | null>(null);

// Sin <ConfirmProvider> (que App.tsx monta una sola vez, arriba del router)
// cae en window.confirm con el MISMO mensaje. No es un no-op silencioso —la
// pregunta se sigue haciendo— y es lo que permite que los tests de cada
// pantalla, que la renderizan sin App, sigan verificando la confirmación
// como hasta ahora (vi.spyOn(window, "confirm")). Toast hace lo contrario
// (tira error) porque un toast sin provider no se vería; acá la pregunta sí
// llega al usuario.
function confirmNativo(message: string): Promise<boolean> {
  return Promise.resolve(window.confirm(message));
}

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext) ?? confirmNativo;
}
