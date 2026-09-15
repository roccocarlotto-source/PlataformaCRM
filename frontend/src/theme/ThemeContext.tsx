import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  applyResolvedTheme,
  getSystemPrefersDark,
  readStoredPreference,
  resolveTheme,
  subscribeToSystemPrefersDark,
  writeStoredPreference,
  type ThemePreference,
} from "./theme";
import { ThemeContext, type ThemeContextValue } from "./useTheme";

// ---------------------------------------------------------------------------
// Estado del tema de la app (docs/frontend-cambios-pendientes.md §31).
//
// Va en App.tsx por FUERA de QueryClientProvider y AuthProvider: no depende de
// queries ni de sesión, es un estado más global todavía — el tema se ve en la
// pantalla de login igual que adentro.
//
// Dos estados, una derivación:
//   - `preference`: lo que eligió la persona ("system" | "light" | "dark"),
//     inicializado desde localStorage y persistido ahí en cada cambio.
//   - `systemPrefersDark`: lo que dice el SO ahora mismo. Se escucha con
//     matchMedia mientras la pestaña está abierta, para que quien tiene
//     "Sistema" y cambia el tema del SO vea el cambio sin recargar. Con una
//     preferencia explícita el valor se sigue actualizando pero no se usa.
//   - `resolvedTheme` = resolveTheme(preference, systemPrefersDark), y cada
//     cambio se aplica al <html> vía data-theme (lo que consume tokens.css).
//
// El <script> inline de index.html ya puso el data-theme correcto antes de la
// primera pintura; el primer applyResolvedTheme de acá lo vuelve a escribir
// con el mismo valor (misma lógica, ver theme.ts). Es idempotente a propósito.
// ---------------------------------------------------------------------------

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [systemPrefersDark, setSystemPrefersDark] = useState(getSystemPrefersDark);

  useEffect(() => subscribeToSystemPrefersDark(setSystemPrefersDark), []);

  const resolvedTheme = resolveTheme(preference, systemPrefersDark);

  useEffect(() => {
    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    writeStoredPreference(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
