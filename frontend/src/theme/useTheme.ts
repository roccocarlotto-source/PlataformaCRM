import { createContext, useContext } from "react";
import type { ResolvedTheme, ThemePreference } from "./theme";

// ---------------------------------------------------------------------------
// Acceso al tema desde cualquier componente: `useTheme()`.
//
// El contexto y el hook viven acá, separados de ThemeContext.tsx (que exporta
// el provider), por la misma razón que useToast.ts está separado de Toast.tsx:
// react-refresh/only-export-components se queja de un módulo que exporta un
// hook junto a un componente, y en un módulo nuevo el split es gratis (no hay
// vi.mock por ruta que lo dependa, a diferencia de AuthContext).
// ---------------------------------------------------------------------------

export interface ThemeContextValue {
  // Lo que eligió la persona: "system" mientras no haya tocado el control.
  preference: ThemePreference;
  // Lo que se está mostrando en pantalla ahora (con "system" ya resuelto).
  resolvedTheme: ResolvedTheme;
  // Cambia el tema al instante y lo recuerda en este navegador.
  setPreference: (preference: ThemePreference) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) {
    // Mismo criterio que useAuth/useToast: error explícito en vez de un
    // no-op silencioso. Con el provider montado en App.tsx esto solo puede
    // pasar en un test que renderice el componente sin <ThemeProvider>.
    throw new Error("useTheme debe usarse dentro de <ThemeProvider>");
  }
  return context;
}
