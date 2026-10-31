import { describe, expect, it } from "vitest";
import { cumpleLaPoliticaDeContrasena } from "./politicaDeContrasena";

// La misma regla que Supabase Auth exige en producción desde el 23/10.
describe("cumpleLaPoliticaDeContrasena", () => {
  it.each([
    ["abcd1234", true],
    ["ABCDEFG9", true],
    ["abc123", false], // corta
    ["abcdefgh", false], // sin números
    ["12345678", false], // sin letras
    ["ñáéíóú12", false], // ñ y acentos no cuentan como letra para Supabase
    ["ñandú12x", true],
  ])("%s → %s", (contrasena, esperado) => {
    expect(cumpleLaPoliticaDeContrasena(contrasena)).toBe(esperado);
  });
});
