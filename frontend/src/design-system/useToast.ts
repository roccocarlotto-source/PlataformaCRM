import { createContext, useContext } from "react";

// ---------------------------------------------------------------------------
// Acceso al toast de la app desde cualquier pantalla: `useToast().show("…")`.
//
// El contexto y el hook viven en este archivo, separados de Toast.tsx (que
// exporta el componente y el provider), por la misma razón que AuthContext
// documenta con un eslint-disable: react-refresh/only-export-components se
// queja de un módulo que exporta un hook junto a un componente. Acá el split
// es gratis, así que no hace falta el disable.
//
// El valor del contexto es SOLO `show`: quién lo consume no necesita saber si
// hay un toast visible ni cerrarlo — el toast se cierra solo (ver Toast.tsx).
// ---------------------------------------------------------------------------

export interface ToastContextValue {
  // Muestra un toast con ese mensaje. Si ya había uno visible, lo reemplaza y
  // el tiempo de vida arranca de nuevo.
  show: (message: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === null) {
    // Error explícito y no un no-op silencioso: si una pantalla llama a show()
    // sin el provider, el toast no se vería y nadie se enteraría. Con el
    // provider montado en App.tsx esto solo puede pasar en un test que
    // renderice la pantalla sin <ToastProvider>.
    throw new Error("useToast debe usarse dentro de <ToastProvider>");
  }
  return context;
}
