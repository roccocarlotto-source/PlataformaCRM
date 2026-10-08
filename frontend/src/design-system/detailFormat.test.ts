import { describe, expect, it } from "vitest";
import { formatDateOnly, formatShortDateTime, formatRelativeTime } from "./detailFormat";

// Fechas armadas con el constructor local (año, mes, día, hora, minuto) y no
// con ISO en UTC: formatShortDateTime trabaja en la hora local del navegador,
// y así el test da lo mismo en cualquier zona horaria.
const ahora = new Date(2026, 8, 30, 18, 30); // 30/9/2026 18:30

function iso(...partes: [number, number, number, number, number]): string {
  return new Date(...partes).toISOString();
}

describe("formatShortDateTime", () => {
  it("hoy: solo la hora, con el día dicho en palabras", () => {
    expect(formatShortDateTime(iso(2026, 8, 30, 14, 5), ahora)).toBe("hoy 14:05");
  });

  it("ayer, aunque haya pasado más o menos de 24 horas", () => {
    expect(formatShortDateTime(iso(2026, 8, 29, 23, 59), ahora)).toBe("ayer 23:59");
    expect(formatShortDateTime(iso(2026, 8, 29, 0, 1), ahora)).toBe("ayer 00:01");
  });

  it("ayer cruzando el cambio de mes", () => {
    const primeroDeOctubre = new Date(2026, 9, 1, 9, 0);
    expect(formatShortDateTime(iso(2026, 8, 30, 14, 5), primeroDeOctubre)).toBe("ayer 14:05");
  });

  it("otro día del año en curso: día/mes sin ceros y la hora", () => {
    expect(formatShortDateTime(iso(2026, 8, 28, 9, 7), ahora)).toBe("28/9 09:07");
    expect(formatShortDateTime(iso(2026, 0, 3, 14, 5), ahora)).toBe("3/1 14:05");
  });

  it("otro año: suma el año para que no se confunda con este", () => {
    expect(formatShortDateTime(iso(2025, 11, 31, 22, 0), ahora)).toBe("31/12/2025 22:00");
  });

  it("null → vacío, igual que formatDateTime", () => {
    expect(formatShortDateTime(null, ahora)).toBe("");
  });
});

describe("formatDateOnly", () => {
  it("es la fecha local del navegador, sin hora", () => {
    const iso = "2026-08-15T12:00:00.000Z";
    expect(formatDateOnly(iso)).toBe(new Date(iso).toLocaleDateString());
  });

  it("null → vacío, para que DetailList lo muestre como dato vacío", () => {
    expect(formatDateOnly(null)).toBe("");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date(2026, 9, 8, 15, 0, 0);
  const hace = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it.each([
    [hace(20_000), "recién"],
    [hace(5 * 60_000), "hace 5 min"],
    [hace(59 * 60_000), "hace 59 min"],
    [hace(60 * 60_000), "hace 1 h"],
    [hace(23 * 3_600_000 + 59 * 60_000), "hace 23 h"],
    [hace(24 * 3_600_000), "hace 1 día"],
    [hace(2 * 24 * 3_600_000 + 3_600_000), "hace 2 días"],
    [hace(45 * 24 * 3_600_000), "hace 1 mes"],
    [hace(400 * 24 * 3_600_000), "hace 1 año"],
    [hace(800 * 24 * 3_600_000), "hace 2 años"],
  ])("%s → %s", (iso, esperado) => {
    expect(formatRelativeTime(iso, now)).toBe(esperado);
  });

  it("null → vacío", () => {
    expect(formatRelativeTime(null, now)).toBe("");
  });
});
