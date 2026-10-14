import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api";
import { descripcionDe, formatearFecha, vehiculoDuplicadoDe } from "./formato";

describe("formato del taller", () => {
  it("formatearFecha: una fecha sin hora es ese día, sin correrse por la zona", () => {
    expect(formatearFecha("2027-01-10")).toBe(new Date(2027, 0, 10).toLocaleDateString());
    expect(formatearFecha(null)).toBe("");
  });

  it("descripcionDe: marca, modelo y año si lo hay", () => {
    expect(descripcionDe({ make: "Toyota", model: "Hilux", year: 2020 })).toBe("Toyota Hilux 2020");
    expect(descripcionDe({ make: "Fiat", model: "Uno", year: null })).toBe("Fiat Uno");
  });

  it("vehiculoDuplicadoDe: solo el 409 de duplicado trae el vehículo existente", () => {
    const duplicado = new ApiError(409, "Ya hay", {
      code: "VEHICULO_DUPLICADO",
      vehiculoId: "cv9",
    });
    expect(vehiculoDuplicadoDe(duplicado)).toBe("cv9");
    expect(vehiculoDuplicadoDe(new ApiError(409, "Otro conflicto"))).toBeNull();
    expect(vehiculoDuplicadoDe(new ApiError(400, "x", { code: "VEHICULO_DUPLICADO" }))).toBeNull();
    expect(vehiculoDuplicadoDe(new Error("x"))).toBeNull();
  });
});
