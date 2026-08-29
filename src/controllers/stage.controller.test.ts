import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createStageSchema, updateStageSchema } from "./stage.controller";

// M-9 (docs/auditoria-2026-08-29.md) — `order` y `probability` vienen de un
// body JSON y se validan con z.number(), no con z.coerce.number().
//
// Con coerce, `Number(null)` es 0. En `order` lo frenaba el .positive() por
// casualidad; en `probability` no había nada que excluyera el 0 como valor
// legítimo, así que `PATCH {"probability": null}` respondía 200 con
// probability = 0 sin que nadie lo pidiera. El fix es que un null explícito se
// RECHACE, no que se admita como forma de limpiar (M-10).
//
// Sin base y sin HTTP: lo que está bajo prueba es la frontera del schema.

const BASE_CREATE = { pipelineId: randomUUID(), name: "Etapa" };

test("M-9: probability: null en PATCH se rechaza — antes se convertía en 0", () => {
  const resultado = updateStageSchema.safeParse({ probability: null });
  assert.equal(resultado.success, false, "antes: success y probability === 0");
});

test("M-9: order: null en PATCH se rechaza — y ahora por tipo, no por la casualidad del .positive()", () => {
  const resultado = updateStageSchema.safeParse({ order: null });
  assert.equal(resultado.success, false);
  assert.ok(
    !resultado.success && resultado.error.issues.some((i) => i.code === "invalid_type"),
    "el rechazo tiene que venir del tipo (null no es number), no de too_small sobre un 0 coaccionado",
  );
});

test("M-9: los otros valores que Number() convierte en 0 también se rechazan, en create y en update", () => {
  for (const valor of ["", [], false]) {
    assert.equal(updateStageSchema.safeParse({ probability: valor }).success, false);
    assert.equal(
      createStageSchema.safeParse({ ...BASE_CREATE, probability: valor }).success,
      false,
    );
    assert.equal(createStageSchema.safeParse({ ...BASE_CREATE, order: valor }).success, false);
  }
});

test("M-9: un string numérico se rechaza — es un body JSON, no un query string", () => {
  assert.equal(updateStageSchema.safeParse({ probability: "50" }).success, false);
  assert.equal(updateStageSchema.safeParse({ order: "2" }).success, false);
  assert.equal(createStageSchema.safeParse({ ...BASE_CREATE, order: "2" }).success, false);
});

test("M-9: los números reales siguen aceptándose, incluido probability 0 explícito", () => {
  const creado = createStageSchema.safeParse({ ...BASE_CREATE, order: 2, probability: 0 });
  assert.equal(creado.success, true);
  assert.equal(creado.success && creado.data.probability, 0, "0 explícito es legítimo");

  const actualizado = updateStageSchema.safeParse({ order: 3, probability: 75.5 });
  assert.equal(actualizado.success, true);
  assert.deepEqual(actualizado.success && actualizado.data, { order: 3, probability: 75.5 });
});

test("M-9: los validadores encadenados siguen intactos: order entero y positivo, probability entre 0 y 100", () => {
  assert.equal(updateStageSchema.safeParse({ order: 0 }).success, false);
  assert.equal(updateStageSchema.safeParse({ order: 1.5 }).success, false);
  assert.equal(updateStageSchema.safeParse({ probability: 101 }).success, false);
  assert.equal(updateStageSchema.safeParse({ probability: -1 }).success, false);
});
