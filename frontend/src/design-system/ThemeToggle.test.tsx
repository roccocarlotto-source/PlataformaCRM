import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeToggle } from "./ThemeToggle";
import type { ThemeContextValue } from "../theme/useTheme";
import type { ThemePreference } from "../theme/theme";

// Se mockea el hook por ruta de módulo (mismo patrón que los tests que
// mockean useAuth): acá se prueba SOLO el control — qué botón se ve
// presionado y con qué valor llama a setPreference. La integración con el
// provider real (data-theme, localStorage) vive en theme/ThemeContext.test.tsx.
const useThemeMock = vi.hoisted(() => vi.fn<() => ThemeContextValue>());
vi.mock("../theme/useTheme", () => ({ useTheme: useThemeMock }));

function mockTheme(preference: ThemePreference) {
  const setPreference = vi.fn();
  useThemeMock.mockReturnValue({
    preference,
    resolvedTheme: preference === "dark" ? "dark" : "light",
    setPreference,
  });
  return { setPreference };
}

const LABELS = ["Sistema", "Claro", "Oscuro"] as const;
const VALUE_BY_LABEL: Record<(typeof LABELS)[number], ThemePreference> = {
  Sistema: "system",
  Claro: "light",
  Oscuro: "dark",
};

beforeEach(() => {
  useThemeMock.mockReset();
});

describe("ThemeToggle", () => {
  it("es un grupo llamado 'Tema' con tres botones solo-ícono con nombre accesible, en orden Sistema/Claro/Oscuro", () => {
    mockTheme("system");
    render(<ThemeToggle />);

    const group = screen.getByRole("group", { name: "Tema" });
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([...LABELS]);
    for (const button of buttons) {
      expect(group).toContainElement(button);
      expect(button).toHaveAttribute("type", "button");
      expect(button).toHaveAttribute("title", button.getAttribute("aria-label"));
    }
  });

  it.each(LABELS)(
    "con la preferencia '%s' solo ese botón está presionado (aria-pressed)",
    (label) => {
      mockTheme(VALUE_BY_LABEL[label]);
      render(<ThemeToggle />);

      for (const other of LABELS) {
        const button = screen.getByRole("button", { name: other });
        expect(button).toHaveAttribute("aria-pressed", other === label ? "true" : "false");
        if (other === label) {
          expect(button).toHaveClass("is-active");
        } else {
          expect(button).not.toHaveClass("is-active");
        }
      }
    },
  );

  it.each(LABELS)(
    "clickear '%s' llama a setPreference con el valor correspondiente",
    async (label) => {
      const { setPreference } = mockTheme("system");
      render(<ThemeToggle />);

      await userEvent.click(screen.getByRole("button", { name: label }));

      expect(setPreference).toHaveBeenCalledTimes(1);
      expect(setPreference).toHaveBeenCalledWith(VALUE_BY_LABEL[label]);
    },
  );

  it("muestra la PREFERENCIA, no el tema resuelto: con 'Sistema' y el SO en oscuro, el presionado es 'Sistema'", () => {
    useThemeMock.mockReturnValue({
      preference: "system",
      resolvedTheme: "dark",
      setPreference: vi.fn(),
    });
    render(<ThemeToggle />);

    expect(screen.getByRole("button", { name: "Sistema" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Oscuro" })).toHaveAttribute("aria-pressed", "false");
  });
});
