import { describe, expect, it } from "vitest";
import { LOCALE_DE_LOS_TESTS, ZONA_DE_LOS_TESTS } from "./localeFijo";

// Los tests corren con el idioma y la zona del CI en cualquier máquina
// (localeFijo.ts). Si esto falla, los snapshots con fechas u horas pueden
// salir distintos en una PC que en el CI.
describe("idioma y zona de los tests", () => {
  const instante = new Date(Date.UTC(2027, 2, 1, 15, 5, 0));

  it("la zona es UTC", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(ZONA_DE_LOS_TESTS);
    expect(instante.getHours()).toBe(15);
  });

  it("sin locale explícito, todo formatea en en-US", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().locale).toBe(LOCALE_DE_LOS_TESTS);
    expect(new Intl.DateTimeFormat().resolvedOptions().locale).toBe(LOCALE_DE_LOS_TESTS);
    expect(instante.toLocaleString()).toBe("3/1/2027, 3:05:00 PM");
    expect(instante.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })).toBe(
      "03:05 PM",
    );
    expect((1234.5).toLocaleString()).toBe("1,234.5");
    expect(new Intl.NumberFormat().format(1234.5)).toBe("1,234.5");
  });

  it("con un locale explícito, se respeta", () => {
    // Día antes que mes, y sin el "PM" del inglés (el formato exacto de la
    // hora en español cambia entre versiones de ICU).
    const enEspanol = instante.toLocaleString("es-UY", { timeZone: "UTC" });
    expect(enEspanol.startsWith("1/3/2027, ")).toBe(true);
    expect(enEspanol).not.toContain("PM");
    expect((1234.5).toLocaleString("es-UY")).toBe("1.234,5");
    expect(new Intl.DateTimeFormat("es-UY").resolvedOptions().locale).toBe("es-UY");
  });
});
