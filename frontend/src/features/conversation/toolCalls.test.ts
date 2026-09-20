import { describe, expect, it } from "vitest";
import { parseToolCalls } from "./toolCalls";

// Message.toolCalls es Json? sin forma impuesta por la base. Esta función es
// la única frontera entre ese valor y el bloque que lo muestra, así que lo
// que importa probar es qué reconoce y, sobre todo, qué NO afirma cuando el
// dato no lo dice.

describe("parseToolCalls", () => {
  it("reconoce la forma que persiste runAgentTurn", () => {
    const llamadas = parseToolCalls([
      {
        id: "call-1",
        name: "create_opportunity",
        arguments: { title: "Corolla" },
        allowed: true,
        result: { ok: true, data: { opportunityId: "op-1" } },
      },
    ]);

    expect(llamadas).toEqual([
      {
        id: "call-1",
        name: "create_opportunity",
        arguments: { title: "Corolla" },
        allowed: true,
        result: { ok: true, data: { opportunityId: "op-1" } },
      },
    ]);
  });

  it("una tool bloqueada conserva su motivo", () => {
    const [llamada] = parseToolCalls([
      { id: "c1", name: "update_opportunity", allowed: false, reason: "prohibida" },
    ])!;

    expect(llamada.allowed).toBe(false);
    expect(llamada.reason).toBe("prohibida");
  });

  it("sin `allowed` NO se muestra como bloqueada: el dato no lo dice", () => {
    const [llamada] = parseToolCalls([{ name: "create_lead" }])!;

    // Afirmar que las reglas del agente la frenaron sería inventar un hecho.
    expect(llamada.allowed).toBe(true);
    expect(llamada.arguments).toEqual({});
    // Sin id propio, la posición alcanza como key: dentro de un mensaje el
    // orden no cambia nunca.
    expect(llamada.id).toBe("tool-0");
  });

  it("un `result` sin la unión discriminada se ignora, pero la llamada se conserva", () => {
    const [llamada] = parseToolCalls([{ name: "create_lead", result: { algo: 1 } }])!;

    expect(llamada.result).toBeUndefined();
    expect(llamada.name).toBe("create_lead");
  });

  it("un `result` fallido conserva el error como texto", () => {
    const [llamada] = parseToolCalls([
      { name: "create_booking", result: { ok: false, error: "sin disponibilidad" } },
    ])!;

    expect(llamada.result).toEqual({ ok: false, error: "sin disponibilidad" });
  });

  it("es todo o nada: una sola entrada irreconocible descarta la lista entera", () => {
    // Mostrar tres de cuatro escondería en silencio justo la que no se
    // entendió, que es la que alguien querría ver. El llamador muestra el
    // JSON crudo completo.
    expect(parseToolCalls([{ name: "create_lead" }, { herramienta: "nueva" }])).toBeNull();
  });

  it("lo que no es una lista con contenido es null", () => {
    for (const valor of [null, undefined, [], {}, "create_lead", 7]) {
      expect(parseToolCalls(valor)).toBeNull();
    }
  });
});
