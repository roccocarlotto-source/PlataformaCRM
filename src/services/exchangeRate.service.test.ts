import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import {
  currenciesNeedingRate,
  dispararActualizacionDeCotizaciones,
  type ResumenDeActualizacion,
} from "./exchangeRate.service";

// ---------------------------------------------------------------------------
// Sin base ni red. El ciclo completo de fetchAndStoreExchangeRates se prueba
// contra Postgres en exchangeRate.integration-test.ts; acá va lo que se
// decide en memoria: qué monedas hay que cotizar, y el disparo a pedido del
// §24 (docs/frontend-cambios-pendientes.md) — cuándo dispara, que no espera,
// y que un fallo se loguea en vez de perderse o de subir al caller.
// ---------------------------------------------------------------------------

// Deja correr las microtareas pendientes: el `.then` del disparo corre recién
// después de que la promesa de la búsqueda se asienta.
const dejarCorrer = () => new Promise<void>((resolve) => setImmediate(resolve));

// Qué monedas hay que cotizar dadas las configuradas (Fase 2c): sin
// repetidos, sin nulls y sin la base — USD→USD no se guarda (y el CHECK de
// exchange_rates lo prohíbe). La usa el GET /organization con las dos
// monedas de una organización, y el worker con las de todas.

test("currenciesNeedingRate: deduplica, descarta null/undefined y excluye USD", () => {
  assert.deepEqual(currenciesNeedingRate(["ARS", "USD", null, "UYU", "ARS", undefined, "USD"]), [
    "ARS",
    "UYU",
  ]);
});

test("currenciesNeedingRate: sin nada configurado, o solo USD, no hay nada que buscar", () => {
  assert.deepEqual(currenciesNeedingRate([]), []);
  assert.deepEqual(currenciesNeedingRate([null, null]), []);
  assert.deepEqual(currenciesNeedingRate(["USD", "USD"]), []);
});

// ---------------------------------------------------------------------------
// Disparo a pedido (§24)
// ---------------------------------------------------------------------------

test("dispararActualizacionDeCotizaciones: con una moneda distinta de USD dispara la búsqueda y loguea el resumen", async () => {
  const resumen: ResumenDeActualizacion = { actualizadas: 1, fallidas: 0 };
  const actualizar = mock.fn(() => Promise.resolve(resumen));
  const infoLog = mock.method(logger, "info", () => undefined);
  try {
    assert.equal(dispararActualizacionDeCotizaciones(["USD", "UYU"], actualizar), true);
    assert.equal(actualizar.mock.callCount(), 1);

    await dejarCorrer();
    const logueado = infoLog.mock.calls.find((c) => c.arguments[0] === resumen);
    assert.ok(logueado, "el resumen de la pasada se loguea como info, igual que el del worker");
  } finally {
    infoLog.mock.restore();
  }
});

test("dispararActualizacionDeCotizaciones: con solo USD, o nada configurado, no dispara", () => {
  const actualizar = mock.fn(() => Promise.resolve({ actualizadas: 0, fallidas: 0 }));

  assert.equal(dispararActualizacionDeCotizaciones(["USD", null], actualizar), false);
  assert.equal(dispararActualizacionDeCotizaciones([null, undefined], actualizar), false);
  assert.equal(dispararActualizacionDeCotizaciones([], actualizar), false);

  assert.equal(actualizar.mock.callCount(), 0);
});

test("dispararActualizacionDeCotizaciones: con EXCHANGE_RATE_WORKER_ENABLED=false no le pega a la fuente", () => {
  const actualizar = mock.fn(() => Promise.resolve({ actualizadas: 0, fallidas: 0 }));
  const infoLog = mock.method(logger, "info", () => undefined);
  const original = env.EXCHANGE_RATE_WORKER_ENABLED;
  env.EXCHANGE_RATE_WORKER_ENABLED = false;
  try {
    assert.equal(dispararActualizacionDeCotizaciones(["ARS"], actualizar), false);
    assert.equal(actualizar.mock.callCount(), 0);
    // Que quede rastro de por qué no se buscó: es el mismo motivo que ya
    // loguea el worker al no arrancar.
    assert.equal(infoLog.mock.callCount(), 1);
  } finally {
    env.EXCHANGE_RATE_WORKER_ENABLED = original;
    infoLog.mock.restore();
  }
});

test("dispararActualizacionDeCotizaciones: un rechazo de la búsqueda se loguea como error y no se propaga", async () => {
  const falla = new Error("se cayó la consulta de organizaciones");
  const errorLog = mock.method(logger, "error", () => undefined);
  try {
    // Si el rechazo se propagara, o quedara sin manejar, esta llamada
    // lanzaría o el runner reportaría un unhandledRejection: ninguna de las
    // dos cosas puede pasar por un fallo de un efecto secundario.
    assert.equal(
      dispararActualizacionDeCotizaciones(["ARS"], () => Promise.reject(falla)),
      true,
    );

    await dejarCorrer();
    assert.equal(errorLog.mock.callCount(), 1);
    const [contexto] = errorLog.mock.calls[0].arguments as [{ err: unknown }];
    assert.equal(contexto.err, falla);
  } finally {
    errorLog.mock.restore();
  }
});
