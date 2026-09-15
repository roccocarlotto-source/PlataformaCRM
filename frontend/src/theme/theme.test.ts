import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyResolvedTheme,
  getSystemPrefersDark,
  isThemePreference,
  readStoredPreference,
  resolveTheme,
  subscribeToSystemPrefersDark,
  THEME_STORAGE_KEY,
  writeStoredPreference,
} from "./theme";

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("resolveTheme", () => {
  it("'system' sigue al SO: oscuro si el SO prefiere oscuro, claro si no", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("una preferencia explícita gana siempre, diga lo que diga el SO", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("isThemePreference", () => {
  it("acepta exactamente los tres valores y nada más", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("Dark")).toBe(false);
    expect(isThemePreference("")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
    expect(isThemePreference(1)).toBe(false);
  });
});

describe("readStoredPreference", () => {
  it("sin nada guardado → 'system' (quien nunca tocó el control sigue al SO)", () => {
    expect(readStoredPreference()).toBe("system");
  });

  it("un valor guardado válido se devuelve tal cual", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(readStoredPreference()).toBe("dark");
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(readStoredPreference()).toBe("light");
    localStorage.setItem(THEME_STORAGE_KEY, "system");
    expect(readStoredPreference()).toBe("system");
  });

  it("un valor guardado inválido cae a 'system' en vez de propagarse a la UI", () => {
    for (const invalid of ["", "Dark", "auto", "null", " dark"]) {
      localStorage.setItem(THEME_STORAGE_KEY, invalid);
      expect(readStoredPreference()).toBe("system");
    }
  });

  it("usa la clave 'plataforma-crm:theme' (la misma que el script inline de index.html)", () => {
    expect(THEME_STORAGE_KEY).toBe("plataforma-crm:theme");
  });

  it("si localStorage.getItem tira (modo privado), devuelve 'system' sin propagar", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readStoredPreference()).toBe("system");
  });
});

describe("writeStoredPreference", () => {
  it("persiste la preferencia bajo la clave del tema", () => {
    writeStoredPreference("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("si localStorage.setItem tira (cuota, modo privado), no propaga: la UI ya cambió igual", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeStoredPreference("light")).not.toThrow();
  });
});

describe("applyResolvedTheme", () => {
  it("escribe data-theme en <html>, que es lo que consume tokens.css", () => {
    applyResolvedTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    applyResolvedTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

// jsdom no implementa window.matchMedia: estos tests cubren tanto ese caso
// (que es también el de un navegador sin soporte) como uno con un stub.
describe("getSystemPrefersDark / subscribeToSystemPrefersDark", () => {
  it("sin matchMedia (jsdom, navegador viejo) el SO cuenta como claro y suscribirse es un no-op", () => {
    expect(typeof window.matchMedia).toBe("undefined");
    expect(getSystemPrefersDark()).toBe(false);
    const listener = vi.fn();
    const unsubscribe = subscribeToSystemPrefersDark(listener);
    expect(() => unsubscribe()).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it("con matchMedia lee `matches` y avisa en cada 'change' hasta desuscribirse", () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const mediaQueryList = {
      matches: true,
      addEventListener: vi.fn((_type: string, handler: (event: MediaQueryListEvent) => void) => {
        listeners.add(handler);
      }),
      removeEventListener: vi.fn((_type: string, handler: (event: MediaQueryListEvent) => void) => {
        listeners.delete(handler);
      }),
    };
    const matchMedia = vi.fn(() => mediaQueryList);
    vi.stubGlobal("matchMedia", matchMedia);

    expect(getSystemPrefersDark()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");

    const listener = vi.fn();
    const unsubscribe = subscribeToSystemPrefersDark(listener);
    expect(mediaQueryList.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));

    for (const handler of listeners) handler({ matches: false } as MediaQueryListEvent);
    expect(listener).toHaveBeenCalledWith(false);

    unsubscribe();
    expect(listeners.size).toBe(0);
  });
});
