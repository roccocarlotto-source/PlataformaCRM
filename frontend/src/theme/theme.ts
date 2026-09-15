// ---------------------------------------------------------------------------
// Tema claro/oscuro elegido a mano (docs/frontend-cambios-pendientes.md §31).
//
// Módulo SIN React, testeable solo (mismo espíritu que taskBuckets.ts/kpi.ts):
// acá viven las reglas puras y el acceso a localStorage; ThemeContext.tsx las
// conecta con el estado de React y ThemeToggle.tsx las muestra.
//
// Tres estados, no dos. "system" es el valor por defecto y significa "seguir
// la preferencia del sistema operativo", que es exactamente lo que hacía la
// app antes de este ítem: quien nunca toca el control no nota ningún cambio.
//
// LÓGICA DUPLICADA A PROPÓSITO en el <script> inline de frontend/index.html.
// Ese script corre ANTES de que exista React (para que la primera pintura ya
// tenga el tema correcto y no haya un flash claro→oscuro al cargar) y un
// script inline no puede importar un módulo TS. Es el único punto del frontend
// donde hace falta código antes de React. Si se cambia la clave de storage, los
// valores válidos o la regla de resolución acá, hay que cambiarlos allá también.
// ---------------------------------------------------------------------------

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "plataforma-crm:theme";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

const DEFAULT_PREFERENCE: ThemePreference = "system";

// La media query que resuelve "system". La misma que usaba tokens.css antes
// de este ítem, ahora consultada desde JS.
export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as string[]).includes(value);
}

// Regla única de resolución: una preferencia explícita gana siempre; "system"
// delega en lo que diga el SO.
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

// localStorage puede TIRAR al tocarlo (modo privado en algunos navegadores,
// storage bloqueado por política del sitio) o no existir — mismo criterio de
// cautela que widget/session.ts. Nada de eso tiene por qué romper la app:
// sin storage, el tema simplemente sigue al SO.
export function readStoredPreference(): ThemePreference {
  let stored: unknown;
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return DEFAULT_PREFERENCE;
  }
  // Cualquier valor que no sea EXACTAMENTE uno de los tres (null, "", un
  // valor viejo de una versión anterior, algo escrito a mano) cae al default.
  return isThemePreference(stored) ? stored : DEFAULT_PREFERENCE;
}

export function writeStoredPreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Sin persistencia: la preferencia vale para esta carga de página y no
    // se recuerda la próxima vez. Deliberadamente silencioso — la UI ya
    // cambió de tema, que es lo que la persona pidió.
  }
}

// Lo que consume tokens.css: `:root[data-theme="dark"]` activa la paleta
// oscura; cualquier otro valor (o ninguno) deja la base clara.
export function applyResolvedTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
}

// matchMedia no existe en todos los entornos (jsdom en los tests no lo
// implementa). Sin él, "system" se resuelve a claro — que es también lo que
// hace un navegador sin soporte de prefers-color-scheme.
function systemDarkQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(DARK_SCHEME_QUERY);
}

export function getSystemPrefersDark(): boolean {
  return systemDarkQuery()?.matches ?? false;
}

// Avisa cada vez que cambia la preferencia del SO mientras la pestaña está
// abierta. Devuelve la función para desuscribirse (forma que espera un
// useEffect). Sin matchMedia, no hay nada que escuchar y el cleanup es un no-op.
export function subscribeToSystemPrefersDark(listener: (prefersDark: boolean) => void): () => void {
  const query = systemDarkQuery();
  if (!query) return () => {};
  const handleChange = (event: MediaQueryListEvent) => listener(event.matches);
  query.addEventListener("change", handleChange);
  return () => query.removeEventListener("change", handleChange);
}
