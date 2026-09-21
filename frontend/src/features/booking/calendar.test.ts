import { describe, expect, it } from "vitest";
import {
  diaDeLaSemana,
  estaAbierto,
  estaEnLaGrilla,
  franjasDelDia,
  instanteLocal,
  minutoDelDia,
  sumarDias,
} from "./calendar";

describe("calendar", () => {
  it("sumarDias cruza meses y años", () => {
    expect(sumarDias("2026-09-30", 1)).toBe("2026-10-01");
    expect(sumarDias("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("diaDeLaSemana habla el enum del backend", () => {
    expect(diaDeLaSemana("2026-09-21")).toBe("MONDAY");
    expect(diaDeLaSemana("2026-09-27")).toBe("SUNDAY");
  });

  it("instanteLocal ubica la hora de pared en la zona de la sucursal", () => {
    // Montevideo es UTC-3: 09:00 local = 12:00Z.
    expect(instanteLocal("2026-09-22", 9 * 60, "America/Montevideo").toISOString()).toBe(
      "2026-09-22T12:00:00.000Z",
    );
    // 1440 = medianoche del día siguiente.
    expect(instanteLocal("2026-09-22", 1440, "America/Montevideo").toISOString()).toBe(
      "2026-09-23T03:00:00.000Z",
    );
  });

  it("instanteLocal respeta el horario de verano (Santiago en enero es UTC-3, en julio UTC-4)", () => {
    expect(instanteLocal("2026-01-15", 9 * 60, "America/Santiago").toISOString()).toBe(
      "2026-01-15T12:00:00.000Z",
    );
    expect(instanteLocal("2026-07-15", 9 * 60, "America/Santiago").toISOString()).toBe(
      "2026-07-15T13:00:00.000Z",
    );
  });

  it("minutoDelDia es la inversa y acota al día", () => {
    const zona = "America/Montevideo";
    expect(minutoDelDia("2026-09-22T12:30:00.000Z", "2026-09-22", zona)).toBe(9 * 60 + 30);
    expect(minutoDelDia("2026-09-23T04:00:00.000Z", "2026-09-22", zona)).toBe(1440);
    expect(minutoDelDia("2026-09-22T01:00:00.000Z", "2026-09-22", zona)).toBe(0);
  });

  it("franjasDelDia toma solo las del día de la semana, en minutos y ordenadas", () => {
    const franjas = franjasDelDia(
      [
        { weekday: "MONDAY", startTime: "14:00", endTime: "18:00" },
        { weekday: "MONDAY", startTime: "09:00", endTime: "13:00" },
        { weekday: "TUESDAY", startTime: "09:00", endTime: "13:00" },
      ],
      "2026-09-21",
    );
    expect(franjas).toEqual([
      { inicio: 540, fin: 780 },
      { inicio: 840, fin: 1080 },
    ]);
  });

  it("estaAbierto y estaEnLaGrilla replican la contención y la grilla del backend", () => {
    const franjas = [{ inicio: 555, fin: 780 }]; // 09:15–13:00
    expect(estaAbierto(600, 630, franjas)).toBe(true);
    expect(estaAbierto(540, 570, franjas)).toBe(false);
    // Grilla de 30 relativa al borde de la franja: 9:15, 9:45, …
    expect(estaEnLaGrilla(585, 30, franjas)).toBe(true);
    expect(estaEnLaGrilla(600, 30, franjas)).toBe(false);
    // Excede el cierre.
    expect(estaEnLaGrilla(765, 30, franjas)).toBe(false);
  });
});
