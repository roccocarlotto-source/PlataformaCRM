import assert from "node:assert/strict";
import { test } from "node:test";
import { createPaymentSchema, updatePaymentSchema } from "./payment.controller";

// ---------------------------------------------------------------------------
// El borde de /api/payments (§43): qué rechazan los schemas antes de llegar al
// service. Sin HTTP ni base, mismo criterio que quote.controller.test.ts.
// ---------------------------------------------------------------------------

const OPPORTUNITY_ID = "7a6f1c1e-7c1a-4b2a-9d53-0d6b7e0a1f01";

const valido = {
  opportunityId: OPPORTUNITY_ID,
  amount: 5_000,
  method: "TRANSFER",
  paidAt: "2026-09-16",
};

test("create: oportunidad, monto, método y fecha; paidAt llega como fecha a medianoche UTC", () => {
  const parsed = createPaymentSchema.parse(valido);
  assert.equal(parsed.amount, 5_000);
  assert.equal(parsed.method, "TRANSFER");
  assert.equal(parsed.paidAt.toISOString(), "2026-09-16T00:00:00.000Z");
});

test("create: los cuatro campos son obligatorios — paidAt no tiene default", () => {
  for (const campo of ["opportunityId", "amount", "method", "paidAt"] as const) {
    const resto: Record<string, unknown> = { ...valido };
    delete resto[campo];
    const result = createPaymentSchema.safeParse(resto);
    assert.equal(result.success, false, `sin ${campo}`);
  }
});

test("create: amount 0, negativo, string o null es 400 — un pago de $0 no es un pago", () => {
  for (const amount of [0, -1, -0.01, "5000", null]) {
    const result = createPaymentSchema.safeParse({ ...valido, amount });
    assert.equal(result.success, false, `amount ${JSON.stringify(amount)}`);
  }
});

test("create: un monto que Decimal(14, 2) redondearía a 0.00 es 400 y no un 500 del CHECK", () => {
  assert.equal(createPaymentSchema.safeParse({ ...valido, amount: 0.004 }).success, false);
  assert.equal(createPaymentSchema.safeParse({ ...valido, amount: 0.01 }).success, true);
});

test("create: un monto que no entra en Decimal(14, 2) es 400", () => {
  const result = createPaymentSchema.safeParse({ ...valido, amount: 1_000_000_000_000 });
  assert.equal(result.success, false);
});

test("create: method solo acepta los valores del enum", () => {
  for (const method of ["CASH", "TRANSFER", "CARD", "CHECK", "OTHER"]) {
    assert.equal(createPaymentSchema.safeParse({ ...valido, method }).success, true, method);
  }
  for (const method of ["cash", "Efectivo", "CRYPTO", "", null]) {
    const result = createPaymentSchema.safeParse({ ...valido, method });
    assert.equal(result.success, false, `method ${JSON.stringify(method)}`);
  }
});

test("create: paidAt null, con hora, mal formado o inexistente es 400 (no 1970 ni corrimiento)", () => {
  for (const paidAt of [
    null,
    "2026-09-16T10:00:00Z",
    "16/09/2026",
    "2026-02-30",
    "2026-13-01",
    0,
  ]) {
    const result = createPaymentSchema.safeParse({ ...valido, paidAt });
    assert.equal(result.success, false, `paidAt ${JSON.stringify(paidAt)}`);
  }
});

test("create: currency no viaja en el body — es la foto que pone el service", () => {
  const result = createPaymentSchema.safeParse({ ...valido, currency: "UYU" });
  assert.equal(result.success, false);
});

test("update: amount, method y paidAt se editan de a uno", () => {
  assert.deepEqual(updatePaymentSchema.parse({ amount: 1_500.5 }), { amount: 1_500.5 });
  assert.deepEqual(updatePaymentSchema.parse({ method: "CASH" }), { method: "CASH" });
  assert.equal(
    updatePaymentSchema.parse({ paidAt: "2026-10-01" }).paidAt?.toISOString(),
    "2026-10-01T00:00:00.000Z",
  );
});

test("update: las mismas reglas que create para cada campo", () => {
  for (const body of [{ amount: 0 }, { amount: -5 }, { method: "CRYPTO" }, { paidAt: null }]) {
    assert.equal(updatePaymentSchema.safeParse(body).success, false, JSON.stringify(body));
  }
});

test("update: opportunityId y currency son inmutables (400, no ignorados en silencio)", () => {
  assert.equal(
    updatePaymentSchema.safeParse({ opportunityId: OPPORTUNITY_ID, amount: 10 }).success,
    false,
  );
  assert.equal(updatePaymentSchema.safeParse({ opportunityId: OPPORTUNITY_ID }).success, false);
  assert.equal(updatePaymentSchema.safeParse({ currency: "UYU" }).success, false);
});

test("update: un body vacío es 400", () => {
  assert.equal(updatePaymentSchema.safeParse({}).success, false);
});
