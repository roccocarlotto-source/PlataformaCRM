import { describe, expect, it } from "vitest";
import { EQUIPMENT_CODE_MAX, finalizeEquipmentCode, normalizeEquipmentCode } from "./equipment";

describe("normalizeEquipmentCode", () => {
  it("pasa a mayúsculas y cambia los espacios por guión bajo", () => {
    expect(normalizeEquipmentCode("Aire acondicionado")).toBe("AIRE_ACONDICIONADO");
  });

  it("saca las tildes y la diéresis, y la ñ queda como n", () => {
    expect(normalizeEquipmentCode("Cámara de visión")).toBe("CAMARA_DE_VISION");
    expect(normalizeEquipmentCode("pingüino ñandú")).toBe("PINGUINO_NANDU");
  });

  it("un guión también es separador y varios seguidos son un solo guión bajo", () => {
    expect(normalizeEquipmentCode("techo-solar")).toBe("TECHO_SOLAR");
    expect(normalizeEquipmentCode("techo  -  solar")).toBe("TECHO_SOLAR");
  });

  it("descarta lo que no sea letra, dígito o guión bajo (la coma incluida)", () => {
    expect(normalizeEquipmentCode("ABS, AIRBAG")).toBe("ABS_AIRBAG");
    expect(normalizeEquipmentCode("v8 (turbo)!")).toBe("V8_TURBO");
  });

  it("no deja guión bajo al principio pero sí al final, que es el estado entre dos palabras", () => {
    expect(normalizeEquipmentCode("  abs")).toBe("ABS");
    expect(normalizeEquipmentCode("aire ")).toBe("AIRE_");
  });

  it("corta a los 50 caracteres del backend", () => {
    const largo = "a".repeat(EQUIPMENT_CODE_MAX + 10);
    expect(normalizeEquipmentCode(largo)).toBe("A".repeat(EQUIPMENT_CODE_MAX));
  });

  it("un código ya válido queda igual", () => {
    expect(normalizeEquipmentCode("AIRBAG_LATERAL")).toBe("AIRBAG_LATERAL");
  });
});

describe("finalizeEquipmentCode", () => {
  it("recorta los guiones bajos sobrantes de los extremos", () => {
    expect(finalizeEquipmentCode("Aire acondicionado ")).toBe("AIRE_ACONDICIONADO");
    expect(finalizeEquipmentCode("abs__")).toBe("ABS");
  });

  it("devuelve vacío si no quedó nada", () => {
    expect(finalizeEquipmentCode("   ")).toBe("");
    expect(finalizeEquipmentCode("¿?")).toBe("");
  });
});
