import { describe, expect, it } from "vitest";
import { formatShortDateTime } from "./detailFormat";

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
