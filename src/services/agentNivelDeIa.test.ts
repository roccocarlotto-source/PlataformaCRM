import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../utils/AppError";
import { NIVEL_DE_IA_SIN_ELEGIR, decidirNivelDeIa, type NivelActual } from "./agentNivelDeIa";

// Las reglas del nivel de IA en la API (docs/ediciones.md §1.2, D3; paso C).

const AHORA = new Date("2026-10-10T12:00:00.000Z");
const ANTES = new Date("2026-10-01T12:00:00.000Z");

function actual(extra: Partial<NivelActual> = {}): NivelActual {
  return {
    participation: "AUTONOMA",
    participationChosenAt: null,
    onlyOutsideBusinessHours: false,
    isActive: true,
    ...extra,
  };
}

function errorDe(fn: () => unknown): AppError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof AppError);
    return err;
  }
  assert.fail("esperaba un AppError");
}

test("COMPLETA, crear sin nivel: no escribe nada (el trigger pone AUTONOMA, como siempre)", () => {
  const r = decidirNivelDeIa({ edition: "COMPLETA", actual: null, pedido: {}, ahora: AHORA });
  assert.deepEqual(r.data, {});
  assert.equal(r.exigeHorarioDeLaSucursal, false);
  // Y activo explícito también: COMPLETA tiene nivel por el trigger.
  assert.deepEqual(
    decidirNivelDeIa({
      edition: "COMPLETA",
      actual: null,
      pedido: { isActive: true },
      ahora: AHORA,
    }).data,
    {},
  );
});

test("ESENCIAL, crear sin nivel: nace inactivo; pedirlo activo es 400 NIVEL_DE_IA_SIN_ELEGIR", () => {
  const r = decidirNivelDeIa({ edition: "ESENCIAL", actual: null, pedido: {}, ahora: AHORA });
  assert.deepEqual(r.data, { isActive: false });

  const err = errorDe(() =>
    decidirNivelDeIa({
      edition: "ESENCIAL",
      actual: null,
      pedido: { isActive: true },
      ahora: AHORA,
    }),
  );
  assert.equal(err.statusCode, 400);
  assert.deepEqual(err.details, { code: NIVEL_DE_IA_SIN_ELEGIR });
});

test("crear con nivel (cualquier edición): lo escribe con participation_chosen_at", () => {
  for (const edition of ["COMPLETA", "ESENCIAL"] as const) {
    const r = decidirNivelDeIa({
      edition,
      actual: null,
      pedido: { participation: "PRIMER_CONTACTO", isActive: true },
      ahora: AHORA,
    });
    assert.deepEqual(r.data, { participation: "PRIMER_CONTACTO", participationChosenAt: AHORA });
  }
});

test("editar: activar un agente sin nivel es 400; con el nivel en el mismo PATCH, pasa", () => {
  const sinNivel = actual({ participation: null, isActive: false });
  const err = errorDe(() =>
    decidirNivelDeIa({
      edition: "ESENCIAL",
      actual: sinNivel,
      pedido: { isActive: true },
      ahora: AHORA,
    }),
  );
  assert.deepEqual(err.details, { code: NIVEL_DE_IA_SIN_ELEGIR });

  const r = decidirNivelDeIa({
    edition: "ESENCIAL",
    actual: sinNivel,
    pedido: { isActive: true, participation: "SOLO_SEGUIMIENTO" },
    ahora: AHORA,
  });
  assert.deepEqual(r.data, { participation: "SOLO_SEGUIMIENTO", participationChosenAt: AHORA });
});

test("editar sin tocar el nivel: un agente inactivo sin nivel se puede seguir editando", () => {
  const r = decidirNivelDeIa({
    edition: "ESENCIAL",
    actual: actual({ participation: null, isActive: false }),
    pedido: {},
    ahora: AHORA,
  });
  assert.deepEqual(r.data, {});
});

test("participation_chosen_at: se escribe al elegir o cambiar; reenviar el mismo nivel ya elegido no lo toca", () => {
  // Cambia.
  assert.deepEqual(
    decidirNivelDeIa({
      edition: "COMPLETA",
      actual: actual({ participationChosenAt: ANTES }),
      pedido: { participation: "SOLO_SEGUIMIENTO" },
      ahora: AHORA,
    }).data,
    { participation: "SOLO_SEGUIMIENTO", participationChosenAt: AHORA },
  );
  // El mismo, ya elegido: nada.
  assert.deepEqual(
    decidirNivelDeIa({
      edition: "COMPLETA",
      actual: actual({ participationChosenAt: ANTES }),
      pedido: { participation: "AUTONOMA" },
      ahora: AHORA,
    }).data,
    {},
  );
  // El mismo que puso el trigger (sin fecha): guardarlo es elegirlo.
  assert.deepEqual(
    decidirNivelDeIa({
      edition: "COMPLETA",
      actual: actual({ participationChosenAt: null }),
      pedido: { participation: "AUTONOMA" },
      ahora: AHORA,
    }).data,
    { participation: "AUTONOMA", participationChosenAt: AHORA },
  );
});

test("«solo fuera de horario» va solo con PRIMER_CONTACTO, y pide el horario de la sucursal", () => {
  const err = errorDe(() =>
    decidirNivelDeIa({
      edition: "COMPLETA",
      actual: actual(),
      pedido: { onlyOutsideBusinessHours: true },
      ahora: AHORA,
    }),
  );
  assert.equal(err.statusCode, 400);

  const ok = decidirNivelDeIa({
    edition: "ESENCIAL",
    actual: null,
    pedido: { participation: "PRIMER_CONTACTO", onlyOutsideBusinessHours: true },
    ahora: AHORA,
  });
  assert.equal(ok.exigeHorarioDeLaSucursal, true);
  assert.equal(ok.data.onlyOutsideBusinessHours, true);

  // Dejar PRIMER_CONTACTO con el interruptor prendido, sin apagarlo: 400.
  errorDe(() =>
    decidirNivelDeIa({
      edition: "ESENCIAL",
      actual: actual({ participation: "PRIMER_CONTACTO", onlyOutsideBusinessHours: true }),
      pedido: { participation: "AUTONOMA" },
      ahora: AHORA,
    }),
  );
  // Apagándolo en el mismo PATCH: pasa.
  const cambio = decidirNivelDeIa({
    edition: "ESENCIAL",
    actual: actual({ participation: "PRIMER_CONTACTO", onlyOutsideBusinessHours: true }),
    pedido: { participation: "AUTONOMA", onlyOutsideBusinessHours: false },
    ahora: AHORA,
  });
  assert.equal(cambio.data.onlyOutsideBusinessHours, false);
  assert.equal(cambio.exigeHorarioDeLaSucursal, false);
});
