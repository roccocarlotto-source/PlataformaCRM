import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import {
  priceFromVehicle,
  transicionaAGanada,
  vehicleStatusForOpportunityStatus,
} from "./opportunity.service";

// ---------------------------------------------------------------------------
// Las dos reglas puras del vínculo Vehicle ↔ Opportunity (Fase 2c), sin base:
// qué estado toma la unidad según el de la oportunidad, y qué precio toma la
// oportunidad de la unidad. Que el service las aplique sobre filas reales se
// prueba en opportunityVehicle.integration-test.ts.
// ---------------------------------------------------------------------------

test("vehicleStatusForOpportunityStatus: OPEN reserva, WON vende, LOST no reserva nada", () => {
  assert.equal(vehicleStatusForOpportunityStatus("OPEN"), "RESERVED");
  assert.equal(vehicleStatusForOpportunityStatus("WON"), "SOLD");
  assert.equal(vehicleStatusForOpportunityStatus("LOST"), "AVAILABLE");
});

test("priceFromVehicle: el precio en USD manda aunque haya precio local y moneda configurada", () => {
  const precio = priceFromVehicle(
    {
      priceListUsd: new Prisma.Decimal("25000.00"),
      priceListLocal: new Prisma.Decimal(30_000_000),
    },
    { preferredCurrency: "ARS" },
  );
  assert.deepEqual(precio, { amount: 25_000, currency: "USD" });
});

test("priceFromVehicle: solo precio local → moneda de preferencia de la organización", () => {
  const precio = priceFromVehicle(
    { priceListUsd: null, priceListLocal: new Prisma.Decimal("30000000.00") },
    { preferredCurrency: "ARS" },
  );
  assert.deepEqual(precio, { amount: 30_000_000, currency: "ARS" });
});

test("priceFromVehicle: solo precio local SIN moneda configurada → {} — no se inventa la moneda", () => {
  const precio = priceFromVehicle(
    { priceListUsd: null, priceListLocal: 30_000_000 },
    { preferredCurrency: null },
  );
  assert.deepEqual(precio, {});
});

test("priceFromVehicle: sin ningún precio → {}", () => {
  assert.deepEqual(
    priceFromVehicle({ priceListUsd: null, priceListLocal: null }, { preferredCurrency: "ARS" }),
    {},
  );
});

// ---------------------------------------------------------------------------
// Trigger opportunity.won (docs/automations-architecture.md §7): la detección
// de la transición, sin base. Que el service emita el evento de verdad —y solo
// en estos casos— se prueba en automationOpportunityWon.integration-test.ts.
// ---------------------------------------------------------------------------

test("transicionaAGanada: WON alcanzado desde cualquier otro estado dispara", () => {
  assert.equal(transicionaAGanada("OPEN", "WON"), true);
  assert.equal(transicionaAGanada("LOST", "WON"), true);
});

test("transicionaAGanada: WON → WON NO dispara — un PATCH sobre una ya ganada no es una transición", () => {
  assert.equal(transicionaAGanada("WON", "WON"), false);
});

test("transicionaAGanada: las transiciones que no terminan en WON no disparan", () => {
  assert.equal(transicionaAGanada("OPEN", "LOST"), false);
  assert.equal(transicionaAGanada("OPEN", "OPEN"), false);
  assert.equal(transicionaAGanada("WON", "OPEN"), false, "reabrir una ganada tampoco dispara");
  assert.equal(transicionaAGanada("WON", "LOST"), false);
});
