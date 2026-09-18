import { describe, expect, it } from "vitest";
import { EMPTY_GUARDRAILS_TEXT, formatGuardrails, parseGuardrails } from "./guardrails";

describe("formatGuardrails", () => {
  it("formatea con indentación de 2, para que un objeto de §6 se pueda leer", () => {
    expect(formatGuardrails({ accionesProhibidas: ["update_opportunity"] })).toBe(
      '{\n  "accionesProhibidas": [\n    "update_opportunity"\n  ]\n}',
    );
  });

  it("un objeto vacío se muestra igual que el default de creación", () => {
    expect(formatGuardrails({})).toBe(EMPTY_GUARDRAILS_TEXT);
  });
});

describe("parseGuardrails", () => {
  it("un objeto plano pasa, con su contenido intacto", () => {
    const resultado = parseGuardrails('{"temasProhibidos": ["diagnósticos médicos"]}');

    expect(resultado).toEqual({
      ok: true,
      guardrails: { temasProhibidos: ["diagnósticos médicos"] },
    });
  });

  it("el objeto vacío pasa: es el estado 'sin guardrails declarados'", () => {
    expect(parseGuardrails(EMPTY_GUARDRAILS_TEXT)).toEqual({ ok: true, guardrails: {} });
  });

  it("un textarea vacío (o con solo espacios) se toma como {}, no como error", () => {
    expect(parseGuardrails("")).toEqual({ ok: true, guardrails: {} });
    expect(parseGuardrails("   \n  ")).toEqual({ ok: true, guardrails: {} });
  });

  it("no valida el CONTENIDO: una clave que no está en §6 pasa igual", () => {
    // La forma de §6 es una convención documentada, no impuesta — ni por
    // Postgres ni por el z.record del backend. Si acá se rechazara, el cliente
    // sería más estricto que el servidor y bloquearía una clave que el diseño
    // todavía no previó.
    expect(parseGuardrails('{"claveInventada": 3}')).toEqual({
      ok: true,
      guardrails: { claveInventada: 3 },
    });
  });

  it("un JSON roto no pasa, y el error dice dónde está el problema", () => {
    const resultado = parseGuardrails('{"temasProhibidos": [}');

    expect(resultado.ok).toBe(false);
    // El mensaje del motor va adentro tal cual: es lo único accionable cuando
    // un JSON escrito a mano no cierra.
    if (!resultado.ok) {
      expect(resultado.error).toMatch(/^Los guardrails tienen que ser un JSON válido: /);
    }
  });

  it("una lista NO es un objeto plano: mismo criterio que el z.record del backend", () => {
    const resultado = parseGuardrails('["update_opportunity"]');

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.error).toContain("objeto JSON");
    }
  });

  it("null y los primitivos tampoco pasan", () => {
    // Los tres son JSON perfectamente válido, así que JSON.parse no los
    // rechaza: los frena el chequeo de forma, que es la mitad de este helper.
    for (const texto of ["null", "42", '"un texto"', "true"]) {
      expect(parseGuardrails(texto).ok).toBe(false);
    }
  });
});
