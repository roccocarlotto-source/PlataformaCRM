import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "./ThemeContext";
import { ThemeToggle } from "../design-system/ThemeToggle";
import { useTheme } from "./useTheme";
import { THEME_STORAGE_KEY } from "./theme";

// Test de integración liviano del §31: ThemeProvider REAL + ThemeToggle REAL,
// sin mocks de módulos. Lo que se verifica es el efecto observable de punta a
// punta — el data-theme de <html> (lo que consume tokens.css) y lo que quedó
// en localStorage (lo que va a leer el script inline de index.html la
// próxima vez) — no el estado interno del provider.

// jsdom no implementa matchMedia. Este stub simula el SO y permite disparar
// un cambio de preferencia del SO con la pestaña abierta.
function stubMatchMedia(initialMatches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQueryList = {
    matches: initialMatches,
    addEventListener: (_type: string, handler: (event: MediaQueryListEvent) => void) => {
      listeners.add(handler);
    },
    removeEventListener: (_type: string, handler: (event: MediaQueryListEvent) => void) => {
      listeners.delete(handler);
    },
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mediaQueryList),
  );
  return {
    listeners,
    setSystemPrefersDark(matches: boolean) {
      mediaQueryList.matches = matches;
      for (const handler of listeners) handler({ matches } as MediaQueryListEvent);
    },
  };
}

function renderWithProvider() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
});

describe("ThemeProvider + ThemeToggle (integración)", () => {
  it("click en 'Oscuro' → <html data-theme=\"dark\"> al instante y la preferencia queda en localStorage", async () => {
    renderWithProvider();
    expect(document.documentElement.dataset.theme).toBe("light");

    await userEvent.click(screen.getByRole("button", { name: "Oscuro" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.getByRole("button", { name: "Oscuro" })).toHaveAttribute("aria-pressed", "true");
  });

  it("camino inverso: con localStorage ya en 'dark' arranca en oscuro sin ningún click", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");

    renderWithProvider();

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("button", { name: "Oscuro" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Sistema" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("sin nada guardado arranca en 'Sistema' y resuelve con lo que diga el SO", () => {
    stubMatchMedia(true);

    renderWithProvider();

    expect(screen.getByRole("button", { name: "Sistema" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.dataset.theme).toBe("dark");
    // Nunca eligió nada: no se escribe nada en storage por el solo hecho de montar.
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("con 'Sistema' elegido, cambiar el tema del SO con la pestaña abierta actualiza el data-theme sin recargar", () => {
    const system = stubMatchMedia(false);
    renderWithProvider();
    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => system.setSystemPrefersDark(true));
    expect(document.documentElement.dataset.theme).toBe("dark");

    act(() => system.setSystemPrefersDark(false));
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("con una preferencia explícita, un cambio del SO NO mueve el tema", async () => {
    const system = stubMatchMedia(false);
    renderWithProvider();
    await userEvent.click(screen.getByRole("button", { name: "Claro" }));

    act(() => system.setSystemPrefersDark(true));

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("volver a 'Sistema' retoma la preferencia del SO y la guarda como 'system'", async () => {
    const system = stubMatchMedia(true);
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    renderWithProvider();
    expect(document.documentElement.dataset.theme).toBe("light");

    await userEvent.click(screen.getByRole("button", { name: "Sistema" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");

    act(() => system.setSystemPrefersDark(false));
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("desmontar el provider se desuscribe del matchMedia (sin listeners huérfanos)", () => {
    const system = stubMatchMedia(false);
    const { unmount } = renderWithProvider();
    expect(system.listeners.size).toBe(1);

    unmount();

    expect(system.listeners.size).toBe(0);
  });

  it("un valor inválido en localStorage no rompe nada: arranca en 'Sistema'", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "azul");

    renderWithProvider();

    expect(screen.getByRole("button", { name: "Sistema" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("useTheme fuera del provider tira un error explícito (mismo criterio que useAuth/useToast)", () => {
    function Probe() {
      useTheme();
      return null;
    }
    // React loguea el error de render en consola además de tirarlo.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow("useTheme debe usarse dentro de <ThemeProvider>");
    consoleError.mockRestore();
  });
});
