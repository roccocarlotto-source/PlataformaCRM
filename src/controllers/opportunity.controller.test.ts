import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createOpportunitySchema, updateOpportunitySchema } from "./opportunity.controller";

// M-9 (docs/auditoria-2026-08-29.md) — `amount` viene de un body JSON y se
// valida con z.number(), no con z.coerce.number().
//
// Con coerce, `Number(null)` es 0, así que `PATCH {"amount": null}` —la forma
// natural de pedir "limpiá el monto"— respondía 200 con amount = 0 sin que
// nadie lo pidiera; lo mismo con "", [] y false. El fix es que un null
// explícito se RECHACE (400 vía parseOrThrow), no que se admita como forma de
// limpiar: eso sería .nullable() y es la conversación de M-10.
//
// Sin base y sin HTTP: lo que está bajo prueba es la frontera del schema. Es
// el mismo criterio que ingestContact.schema.test.ts.

const BASE_CREATE = {
  title: "Oportunidad",
  pipelineId: randomUUID(),
  stageId: randomUUID(),
  companyId: randomUUID(),
};

test("M-9: amount: null en PATCH se rechaza — antes se convertía en 0", () => {
  const resultado = updateOpportunitySchema.safeParse({ amount: null });
  assert.equal(resultado.success, false, "antes: success y amount === 0");
});

test("M-9: los otros valores que Number() convierte en 0 también se rechazan en PATCH", () => {
  for (const valor of ["", [], false]) {
    const resultado = updateOpportunitySchema.safeParse({ amount: valor });
    assert.equal(resultado.success, false, `${JSON.stringify(valor)} no es un número`);
  }
});

test("M-9: un amount como STRING numérico se rechaza — es un body JSON, no un query string", () => {
  // Efecto colateral esperado y correcto: "150.50" ya no se acepta en silencio.
  assert.equal(updateOpportunitySchema.safeParse({ amount: "150.50" }).success, false);
  assert.equal(
    createOpportunitySchema.safeParse({ ...BASE_CREATE, amount: "150.50" }).success,
    false,
  );
});

test("M-9: un amount numérico real sigue aceptándose en create y en update, incluido 0 explícito", () => {
  const creado = createOpportunitySchema.safeParse({ ...BASE_CREATE, amount: 150.5 });
  assert.equal(creado.success, true);
  assert.equal(creado.success && creado.data.amount, 150.5);

  const actualizado = updateOpportunitySchema.safeParse({ amount: 0 });
  assert.equal(actualizado.success, true, "0 explícito es un número válido (min 0)");
  assert.equal(actualizado.success && actualizado.data.amount, 0);
});

test("M-9: amount ausente sigue siendo opcional; negativo sigue rechazándose", () => {
  assert.equal(createOpportunitySchema.safeParse(BASE_CREATE).success, true);
  assert.equal(updateOpportunitySchema.safeParse({ amount: -1 }).success, false);
});

// ---------------------------------------------------------------------------
// Fase 2c del módulo de stock de vehículos: vehicleId/financingType/leadSource.
// En PATCH los tres admiten null (desvincular / limpiar); en POST vehicleId
// no — "crear vinculada a null" no significa nada.
// ---------------------------------------------------------------------------

test("2c: vehicleId: null se acepta en PATCH (desvincular) y se rechaza en POST", () => {
  const actualizado = updateOpportunitySchema.safeParse({ vehicleId: null });
  assert.equal(actualizado.success, true);
  assert.equal(actualizado.success && actualizado.data.vehicleId, null);

  const creado = createOpportunitySchema.safeParse({ ...BASE_CREATE, vehicleId: null });
  assert.equal(creado.success, false);
});

test("2c: vehicleId tiene que ser un uuid; financingType/leadSource, valores del enum", () => {
  assert.equal(updateOpportunitySchema.safeParse({ vehicleId: "STK-000001" }).success, false);
  assert.equal(
    createOpportunitySchema.safeParse({ ...BASE_CREATE, financingType: "LEASING" }).success,
    false,
  );
  assert.equal(updateOpportunitySchema.safeParse({ leadSource: "TIKTOK" }).success, false);

  const ok = createOpportunitySchema.safeParse({
    ...BASE_CREATE,
    vehicleId: randomUUID(),
    financingType: "INSTALLMENT_24M",
    leadSource: "SHOWROOM",
  });
  assert.equal(ok.success, true);
  assert.equal(ok.success && ok.data.financingType, "INSTALLMENT_24M");
  assert.equal(ok.success && ok.data.leadSource, "SHOWROOM");
});

test("2c: financingType/leadSource: null limpian en PATCH", () => {
  const parsed = updateOpportunitySchema.safeParse({ financingType: null, leadSource: null });
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.success && parsed.data, { financingType: null, leadSource: null });
});
