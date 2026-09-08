import assert from "node:assert/strict";
import { test } from "node:test";
import { currenciesNeedingRate } from "./organization.service";

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
