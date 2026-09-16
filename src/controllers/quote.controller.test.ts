import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createQuoteSchema,
  updateQuoteContentSchema,
  updateQuoteStatusSchema,
} from "./quote.controller";

// ---------------------------------------------------------------------------
// El borde de /api/quotes (§39): qué rechazan los schemas antes de llegar al
// service. Sin HTTP ni base, mismo criterio que opportunity.controller.test.ts.
// ---------------------------------------------------------------------------

const OPPORTUNITY_ID = "7a6f1c1e-7c1a-4b2a-9d53-0d6b7e0a1f01";

test("create: lo mínimo es oportunidad, monto y moneda; las líneas arrancan vacías", () => {
  const parsed = createQuoteSchema.parse({
    opportunityId: OPPORTUNITY_ID,
    amount: 25_000,
    currency: "usd",
  });
  assert.equal(parsed.currency, "USD");
  assert.deepEqual(parsed.lines, []);
  assert.equal(parsed.validUntil, undefined);
});

test("create: validUntil como fecha sola, y null explícito se queda null (no 1970)", () => {
  const conFecha = createQuoteSchema.parse({
    opportunityId: OPPORTUNITY_ID,
    amount: 1,
    currency: "USD",
    validUntil: "2026-09-30",
  });
  assert.equal(conFecha.validUntil?.toISOString(), "2026-09-30T00:00:00.000Z");

  const sinFecha = createQuoteSchema.parse({
    opportunityId: OPPORTUNITY_ID,
    amount: 1,
    currency: "USD",
    validUntil: null,
  });
  assert.equal(sinFecha.validUntil, null);
});

test("create: monto negativo, string o null es 400 (z.number, no coerce — M-9)", () => {
  for (const amount of [-1, "25000", null]) {
    const result = createQuoteSchema.safeParse({
      opportunityId: OPPORTUNITY_ID,
      amount,
      currency: "USD",
    });
    assert.equal(result.success, false, `amount ${JSON.stringify(amount)}`);
  }
});

test("create: un monto que no entra en Decimal(14, 2) es 400 y no un 500 de Postgres", () => {
  const result = createQuoteSchema.safeParse({
    opportunityId: OPPORTUNITY_ID,
    amount: 1_000_000_000_000,
    currency: "USD",
  });
  assert.equal(result.success, false);
});

test("create: las líneas admiten importes negativos (descuentos) pero exigen descripción", () => {
  const ok = createQuoteSchema.safeParse({
    opportunityId: OPPORTUNITY_ID,
    amount: 25_000,
    currency: "USD",
    lines: [
      { description: "Polarizado", amount: 350 },
      { description: "Descuento", amount: -1000 },
    ],
  });
  assert.equal(ok.success, true);

  const sinDescripcion = createQuoteSchema.safeParse({
    opportunityId: OPPORTUNITY_ID,
    amount: 25_000,
    currency: "USD",
    lines: [{ description: "   ", amount: 10 }],
  });
  assert.equal(sinDescripcion.success, false);
});

test("create: más de 50 líneas es 400", () => {
  const lines = Array.from({ length: 51 }, (_, index) => ({ description: `L${index}`, amount: 1 }));
  const result = createQuoteSchema.safeParse({
    opportunityId: OPPORTUNITY_ID,
    amount: 1,
    currency: "USD",
    lines,
  });
  assert.equal(result.success, false);
});

test("PATCH de estado: solo SENT, ACCEPTED o REJECTED — EXPIRED y SUPERSEDED no se piden a mano", () => {
  for (const status of ["SENT", "ACCEPTED", "REJECTED"]) {
    assert.equal(updateQuoteStatusSchema.safeParse({ status }).success, true, status);
  }
  for (const status of ["DRAFT", "EXPIRED", "SUPERSEDED", "sent"]) {
    assert.equal(updateQuoteStatusSchema.safeParse({ status }).success, false, status);
  }
});

test("PATCH de estado: combinarlo con contenido es 400", () => {
  const result = updateQuoteStatusSchema.safeParse({ status: "SENT", amount: 10 });
  assert.equal(result.success, false);
  assert.match(result.error?.issues[0]?.message ?? "", /no se combina/);
});

test("PATCH de contenido: parcial, pero no vacío ni con campos que no son de la cotización", () => {
  assert.equal(updateQuoteContentSchema.safeParse({ amount: 24_000 }).success, true);
  assert.equal(updateQuoteContentSchema.safeParse({ validUntil: null }).success, true);
  assert.equal(updateQuoteContentSchema.safeParse({}).success, false);
  assert.equal(
    updateQuoteContentSchema.safeParse({ amount: 1, opportunityId: OPPORTUNITY_ID }).success,
    false,
  );
});
