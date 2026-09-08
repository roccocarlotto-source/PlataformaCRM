import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { priceFromVehicle, vehicleStatusForOpportunityStatus } from "./opportunity.service";

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
