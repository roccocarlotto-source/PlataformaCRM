import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../utils/AppError";
import {
  ABIERTA_CON_DATOS_DE_CIERRE,
  ESTADO_NO_COINCIDE_CON_ETAPA,
  ETAPA_DE_CIERRE_SIN_ESTADO,
  GANADA_CON_MOTIVO_DE_PERDIDA,
  hoyEnLaZona,
  resolverCamposDeCierre,
  resolverEstadoYEtapa,
  SIN_ETAPA_PARA_ESE_ESTADO,
  type EtapaConMarca,
} from "./opportunityClosing";

// Ítem 154 de docs/matriz-de-datos-crm.md. Las reglas puras; la aplicación con
// filas está en opportunityClosing.integration-test.ts.

const nuevo: EtapaConMarca = { id: "nuevo", isWon: false, isLost: false };
const negociacion: EtapaConMarca = { id: "negociacion", isWon: false, isLost: false };
const ganado: EtapaConMarca = { id: "ganado", isWon: true, isLost: false };
const perdido: EtapaConMarca = { id: "perdido", isWon: false, isLost: true };
const completo = [nuevo, negociacion, ganado, perdido];
const sinCierre = [nuevo, negociacion];

function falla(fn: () => unknown, mensaje: string) {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, 400);
    assert.equal(err.message, mensaje);
    return true;
  });
}

const base = { creando: false, etapasDelPipeline: completo };

test("mover de etapa sin estado: el estado sale de la etapa (gana, pierde, reabre)", () => {
  for (const [etapa, esperado] of [
    [ganado, "WON"],
    [perdido, "LOST"],
    [nuevo, "OPEN"],
  ] as const) {
    assert.deepEqual(
      resolverEstadoYEtapa({
        ...base,
        etapa,
        etapaCambia: true,
        statusPedido: undefined,
        statusActual: "LOST",
      }),
      { status: esperado, stageId: etapa.id },
    );
  }
});

test("mover de etapa con un estado que la contradice es 400 (O1/O3 del ítem 150)", () => {
  falla(
    () =>
      resolverEstadoYEtapa({
        ...base,
        etapa: nuevo,
        etapaCambia: true,
        statusPedido: "WON",
        statusActual: "OPEN",
      }),
    ESTADO_NO_COINCIDE_CON_ETAPA,
  );
  falla(
    () =>
      resolverEstadoYEtapa({
        ...base,
        etapa: ganado,
        etapaCambia: true,
        statusPedido: "OPEN",
        statusActual: "OPEN",
      }),
    ESTADO_NO_COINCIDE_CON_ETAPA,
  );
});

test("solo el estado: la oportunidad se mueve a la primera etapa que lo significa", () => {
  assert.deepEqual(
    resolverEstadoYEtapa({
      ...base,
      etapa: negociacion,
      etapaCambia: false,
      statusPedido: "LOST",
      statusActual: "OPEN",
    }),
    { status: "LOST", stageId: "perdido" },
  );
  assert.deepEqual(
    resolverEstadoYEtapa({
      ...base,
      etapa: ganado,
      etapaCambia: false,
      statusPedido: "OPEN",
      statusActual: "WON",
    }),
    { status: "OPEN", stageId: "nuevo" },
  );
});

test("vía de escape del §51: un pipeline sin etapas de cierre sigue cerrando por estado", () => {
  const sinEtapaDeCierre = { ...base, etapasDelPipeline: sinCierre };
  assert.deepEqual(
    resolverEstadoYEtapa({
      ...sinEtapaDeCierre,
      etapa: negociacion,
      etapaCambia: false,
      statusPedido: "WON",
      statusActual: "OPEN",
    }),
    { status: "WON", stageId: "negociacion" },
  );
  assert.deepEqual(
    resolverEstadoYEtapa({
      ...sinEtapaDeCierre,
      creando: true,
      etapa: nuevo,
      etapaCambia: true,
      statusPedido: "LOST",
      statusActual: undefined,
    }),
    { status: "LOST", stageId: "nuevo" },
  );
});

test("sin etapa para ese estado y parada en una de cierre: 400", () => {
  falla(
    () =>
      resolverEstadoYEtapa({
        ...base,
        etapasDelPipeline: [ganado, perdido],
        etapa: ganado,
        etapaCambia: false,
        statusPedido: "OPEN",
        statusActual: "WON",
      }),
    SIN_ETAPA_PARA_ESE_ESTADO,
  );
});

test("nada cambia: una fila en drift se guarda tal cual (criterio del §50)", () => {
  assert.deepEqual(
    resolverEstadoYEtapa({
      ...base,
      etapa: nuevo,
      etapaCambia: false,
      statusPedido: "WON",
      statusActual: "WON",
    }),
    { status: "WON", stageId: "nuevo" },
  );
});

test("crear en una etapa de cierre sin estado es 400; con el estado que corresponde, vale", () => {
  falla(
    () =>
      resolverEstadoYEtapa({
        ...base,
        creando: true,
        etapa: ganado,
        etapaCambia: true,
        statusPedido: undefined,
        statusActual: undefined,
      }),
    ETAPA_DE_CIERRE_SIN_ESTADO,
  );
  assert.deepEqual(
    resolverEstadoYEtapa({
      ...base,
      creando: true,
      etapa: ganado,
      etapaCambia: true,
      statusPedido: "WON",
      statusActual: undefined,
    }),
    { status: "WON", stageId: "ganado" },
  );
});

// ---------------------------------------------------------------------------
// Campos de cierre
// ---------------------------------------------------------------------------

const hoy = new Date("2026-09-23T00:00:00.000Z");
const vacio = { actualCloseDate: null, lostReason: null };

test("cerrar sin fecha pone hoy; una fecha cargada no se pisa (O2 del ítem 150)", () => {
  assert.deepEqual(
    resolverCamposDeCierre({ status: "WON", previo: "OPEN", body: {}, actual: vacio, hoy }),
    { actualCloseDate: hoy },
  );
  const cargada = new Date("2026-09-01T00:00:00.000Z");
  assert.deepEqual(
    resolverCamposDeCierre({
      status: "LOST",
      previo: "OPEN",
      body: { actualCloseDate: cargada, lostReason: "Precio" },
      actual: vacio,
      hoy,
    }),
    { actualCloseDate: cargada, lostReason: "Precio" },
  );
  assert.deepEqual(
    resolverCamposDeCierre({ status: "WON", previo: undefined, body: {}, actual: vacio, hoy }),
    { actualCloseDate: hoy },
  );
});

test("reabrir vacía fecha y motivo; traerlos con OPEN es 400 (O4)", () => {
  assert.deepEqual(
    resolverCamposDeCierre({
      status: "OPEN",
      previo: "LOST",
      body: {},
      actual: { actualCloseDate: hoy, lostReason: "Precio" },
      hoy,
    }),
    { actualCloseDate: null, lostReason: null },
  );
  assert.throws(
    () =>
      resolverCamposDeCierre({
        status: "OPEN",
        previo: undefined,
        body: { lostReason: "Precio" },
        actual: vacio,
        hoy,
      }),
    { message: ABIERTA_CON_DATOS_DE_CIERRE },
  );
});

test("ganada: motivo de pérdida en el body es 400, y el que traía de antes se vacía", () => {
  assert.throws(
    () =>
      resolverCamposDeCierre({
        status: "WON",
        previo: "OPEN",
        body: { lostReason: "Competencia" },
        actual: vacio,
        hoy,
      }),
    { message: GANADA_CON_MOTIVO_DE_PERDIDA },
  );
  assert.deepEqual(
    resolverCamposDeCierre({
      status: "WON",
      previo: "LOST",
      body: {},
      actual: { actualCloseDate: hoy, lostReason: "Competencia" },
      hoy,
    }),
    { lostReason: null },
  );
});

test("sin transición no se reescribe nada de una fila vieja", () => {
  assert.deepEqual(
    resolverCamposDeCierre({ status: "WON", previo: "WON", body: {}, actual: vacio, hoy }),
    {},
  );
});

test("hoy es el día de la zona de la organización, no el día UTC", () => {
  // 01:30 UTC del 24 = 22:30 del 23 en Montevideo.
  const ahora = new Date("2026-09-24T01:30:00.000Z");
  assert.equal(hoyEnLaZona("America/Montevideo", ahora).toISOString(), "2026-09-23T00:00:00.000Z");
  assert.equal(hoyEnLaZona("UTC", ahora).toISOString(), "2026-09-24T00:00:00.000Z");
});
