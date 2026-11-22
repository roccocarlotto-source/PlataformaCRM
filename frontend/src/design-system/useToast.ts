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

// "confirmacion" (el de siempre, con la tilde) o "aviso": algo que la persona
// tiene que saber y no es un error (ISSUE-020 e ISSUE-021), con el ícono de
// información.
export type TonoDeToast = "confirmacion" | "aviso";

export interface ToastContextValue {
  // Muestra un toast con ese mensaje. Si ya había uno visible, lo reemplaza y
  // el tiempo de vida arranca de nuevo.
  show: (message: string, opciones?: { tono?: TonoDeToast }) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

// Para una pieza de infraestructura que se monta en muchos lugares (un guard
// de rutas, AdminRoute): si no hay provider, no avisa en vez de romper. En la
// app el provider siempre está (App.tsx); sin él solo se renderiza en tests
// que no miran el aviso. Las pantallas usan useToast().
export function useToastSiHay(): ToastContextValue | null {
  return useContext(ToastContext);
}

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
