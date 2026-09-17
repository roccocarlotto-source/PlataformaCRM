import { describe, expect, it } from "vitest";
import { confirmQuestion } from "./confirmQuestion";

describe("confirmQuestion", () => {
  it("con todo tildado no menciona pendientes", () => {
    expect(confirmQuestion([{ label: "Manual", checked: true }])).toBe(
      "¿Confirmar la entrega? La unidad pasa a Entregado y la entrega ya no se va a poder modificar.",
    );
  });

  it("cuenta los ítems sin marcar, en singular y en plural", () => {
    expect(confirmQuestion([{ label: "Manual", checked: false }])).toContain(
      "Quedan 1 ítem del checklist sin marcar.",
    );
    expect(
      confirmQuestion([
        { label: "Manual", checked: false },
        { label: "Llave", checked: false },
        { label: "Gato", checked: true },
      ]),
    ).toContain("Quedan 2 ítems del checklist sin marcar.");
  });
});
