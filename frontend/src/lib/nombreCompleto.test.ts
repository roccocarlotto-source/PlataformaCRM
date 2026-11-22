import { describe, expect, it } from "vitest";
import { nombreCompleto } from "./nombreCompleto";

describe("nombreCompleto (ISSUE-028)", () => {
  it("nombre y apellido, separados por un espacio", () => {
    expect(nombreCompleto({ firstName: "Ana", lastName: "Pérez" })).toBe("Ana Pérez");
  });

  it("sin apellido (vacío, null o ausente), solo el nombre: sin espacio al final", () => {
    expect(nombreCompleto({ firstName: "Gabi", lastName: "" })).toBe("Gabi");
    expect(nombreCompleto({ firstName: "Gabi", lastName: null })).toBe("Gabi");
    expect(nombreCompleto({ firstName: "Gabi" })).toBe("Gabi");
  });
});
