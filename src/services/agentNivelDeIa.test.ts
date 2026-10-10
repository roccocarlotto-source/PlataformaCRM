import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../utils/AppError";
import {
  MAX_RESPUESTAS_PRIMER_CONTACTO,
  MOTIVO_DENTRO_DE_HORARIO,
  MOTIVO_NIVEL_SIN_ELEGIR,
  MOTIVO_SOLO_SEGUIMIENTO,
  MOTIVO_TOPE_DE_PRIMER_CONTACTO,
  NIVEL_DE_IA_SIN_ELEGIR,
  TOOLS_DE_PRIMER_CONTACTO,
  decidirAtencion,
  decidirNivelDeIa,
  nivelEfectivo,
  toolDelNivel,
  type NivelActual,
} from "./agentNivelDeIa";

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

// ---------------------------------------------------------------------------
// Paso D: el nivel que rige al atender.
// ---------------------------------------------------------------------------

test("nivelEfectivo: sin nivel, null; ESENCIAL sin fecha de elección, null; COMPLETA no mira la fecha", () => {
  assert.equal(
    nivelEfectivo({ participation: null, participationChosenAt: null }, "COMPLETA"),
    null,
  );
  assert.equal(
    nivelEfectivo({ participation: "AUTONOMA", participationChosenAt: null }, "COMPLETA"),
    "AUTONOMA",
  );
  assert.equal(
    nivelEfectivo({ participation: "AUTONOMA", participationChosenAt: null }, "ESENCIAL"),
    null,
  );
  assert.equal(
    nivelEfectivo({ participation: "PRIMER_CONTACTO", participationChosenAt: ANTES }, "ESENCIAL"),
    "PRIMER_CONTACTO",
  );
});

test("toolDelNivel: AUTONOMA todas; PRIMER_CONTACTO solo informar y tomar datos; SOLO_SEGUIMIENTO ninguna", () => {
  for (const tool of [
    "create_opportunity",
    "reserve_vehicle",
    "create_booking",
    "mark_no_interest",
  ]) {
    assert.equal(toolDelNivel(tool, "AUTONOMA"), true, tool);
    assert.equal(toolDelNivel(tool, "PRIMER_CONTACTO"), false, tool);
  }
  for (const tool of TOOLS_DE_PRIMER_CONTACTO) {
    assert.equal(toolDelNivel(tool, "PRIMER_CONTACTO"), true, tool);
    assert.equal(toolDelNivel(tool, "SOLO_SEGUIMIENTO"), false, tool);
  }
});

test("decidirAtencion: AUTONOMA siempre atiende, aun derivada (el camino de hoy)", () => {
  assert.deepEqual(
    decidirAtencion({
      nivel: "AUTONOMA",
      conversacionDerivada: true,
      onlyOutsideBusinessHours: false,
      dentroDeHorario: true,
      respuestasDelAgente: 99,
    }),
    { atiende: true },
  );
});

test("decidirAtencion: con otro nivel, derivada calla; sin elegir, solo seguimiento, dentro de horario y tope derivan", () => {
  const base = {
    conversacionDerivada: false,
    onlyOutsideBusinessHours: false,
    dentroDeHorario: false,
    respuestasDelAgente: 0,
  };
  assert.deepEqual(
    decidirAtencion({ ...base, nivel: "PRIMER_CONTACTO", conversacionDerivada: true }),
    { atiende: false, deriva: false },
  );
  assert.deepEqual(decidirAtencion({ ...base, nivel: null }), {
    atiende: false,
    deriva: true,
    motivo: MOTIVO_NIVEL_SIN_ELEGIR,
  });
  assert.deepEqual(decidirAtencion({ ...base, nivel: "SOLO_SEGUIMIENTO" }), {
    atiende: false,
    deriva: true,
    motivo: MOTIVO_SOLO_SEGUIMIENTO,
  });
  assert.deepEqual(
    decidirAtencion({
      ...base,
      nivel: "PRIMER_CONTACTO",
      onlyOutsideBusinessHours: true,
      dentroDeHorario: true,
    }),
    { atiende: false, deriva: true, motivo: MOTIVO_DENTRO_DE_HORARIO },
  );
  // Fuera de horario, o sin el interruptor: atiende hasta el tope.
  assert.deepEqual(
    decidirAtencion({ ...base, nivel: "PRIMER_CONTACTO", onlyOutsideBusinessHours: true }),
    { atiende: true },
  );
  assert.deepEqual(decidirAtencion({ ...base, nivel: "PRIMER_CONTACTO", respuestasDelAgente: 1 }), {
    atiende: true,
  });
  assert.deepEqual(
    decidirAtencion({
      ...base,
      nivel: "PRIMER_CONTACTO",
      respuestasDelAgente: MAX_RESPUESTAS_PRIMER_CONTACTO,
    }),
    { atiende: false, deriva: true, motivo: MOTIVO_TOPE_DE_PRIMER_CONTACTO },
  );
});
