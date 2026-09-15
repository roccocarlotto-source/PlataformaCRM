import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "../theme/useTheme";
import type { ThemePreference } from "../theme/theme";

// ---------------------------------------------------------------------------
// Selector de tema Sistema / Claro / Oscuro (docs/frontend-cambios-pendientes.md
// §31). Vive en el pie de la sidebar (AppLayout) para estar siempre a mano:
// hoy no existe ninguna pantalla de configuración y crear una sería un ítem
// aparte.
//
// Tres botones solo-ícono dentro de un role="group" con nombre ("Tema"). Cada
// botón lleva aria-label y title con el nombre completo — un ícono suelto no
// tiene nombre accesible — y aria-pressed con si es la preferencia actual:
// un lector de pantalla anuncia "Oscuro, botón, presionado". El estado activo
// reutiliza los tokens de .ds-sidebar-link.is-active (design-system.css), no
// inventa un "activo" nuevo.
//
// Lee y escribe la PREFERENCIA (lo que eligió la persona), no el tema
// resuelto: con "Sistema" elegido y el SO en oscuro, el botón presionado es
// "Sistema", no "Oscuro" — es lo que la persona pidió y lo que va a seguir
// pasando cuando el SO cambie.
// ---------------------------------------------------------------------------

const OPTIONS: ReadonlyArray<{
  value: ThemePreference;
  label: string;
  icon: typeof Monitor;
}> = [
  { value: "system", label: "Sistema", icon: Monitor },
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
];

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();

  return (
    <div className="ds-theme-toggle" role="group" aria-label="Tema">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const isActive = preference === value;
        return (
          <button
            key={value}
            type="button"
            className={`ds-theme-toggle-button${isActive ? " is-active" : ""}`}
            aria-label={label}
            title={label}
            aria-pressed={isActive}
            onClick={() => setPreference(value)}
          >
            <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
