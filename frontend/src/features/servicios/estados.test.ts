import { describe, expect, it } from "vitest";
// El backend es la fuente de verdad: este import (fuera de frontend/) solo
// existe en el test, no en el bundle.
import * as backend from "../../../../src/servicios/config/estados";
import { accionHacia, ESTADOS_ABIERTOS, puedePasar, TRANSICIONES } from "./estados";

describe("estados de la orden: la copia del frontend es la del backend", () => {
  it("las mismas transiciones y los mismos estados abiertos", () => {
    expect(TRANSICIONES).toEqual(backend.TRANSICIONES);
    expect(ESTADOS_ABIERTOS).toEqual(backend.ESTADOS_ABIERTOS);
  });

  it("puedePasar y los textos de los botones", () => {
    expect(puedePasar("LISTO_PARA_RETIRAR", "ENTREGADO")).toBe(true);
    expect(puedePasar("AGENDADO", "EN_TRABAJO")).toBe(false);
    // "Volver a trabajo" solo si ya estuvo en trabajo: una orden que fue de
    // Recibido a Esperando aprobación todavía no volvió (prueba de S4a).
    expect(accionHacia("EN_TRABAJO")).toBe("Pasar a En trabajo");
    expect(accionHacia("EN_TRABAJO", { yaEstuvoEnTrabajo: true })).toBe("Volver a trabajo");
    expect(accionHacia("CANCELADO")).toBe("Cancelar la orden");
  });
});
