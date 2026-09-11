import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canReadActivity,
  canSelfServiceCompleteActivity,
  scopeActivityFiltersToActor,
} from "./activity.service";

// --------------------------------------------------------------------------
// canSelfServiceCompleteActivity — la regla de autorización por recurso de
// PATCH /api/activities/:id, que reemplazó a authorize("ADMIN") en la ruta.
// Función pura: se prueba sin base ni mocks, mismo criterio que
// contact.service.test.ts. La aplicación real con filas y roles reales está
// en activity.service.integration-test.ts.
// --------------------------------------------------------------------------

const admin = { userId: "admin-1", role: "ADMIN" as const };
const user = { userId: "user-1", role: "USER" as const };
const own = { assigneeId: "user-1" };
const ajena = { assigneeId: "user-2" };
const sinAsignar = { assigneeId: null };

test("ADMIN: cualquier campo, cualquier assignee (incluso sin asignar)", () => {
  assert.equal(canSelfServiceCompleteActivity(admin, ajena, { subject: "x" }), true);
  assert.equal(canSelfServiceCompleteActivity(admin, sinAsignar, { assigneeId: "u9" }), true);
  assert.equal(
    canSelfServiceCompleteActivity(admin, own, { completedAt: new Date(), type: "CALL" }),
    true,
  );
});

test("USER completando su propia actividad, solo completedAt: true", () => {
  assert.equal(canSelfServiceCompleteActivity(user, own, { completedAt: new Date() }), true);
});

test("USER reabriendo su propia actividad (completedAt: null): true", () => {
  assert.equal(canSelfServiceCompleteActivity(user, own, { completedAt: null }), true);
});

test("USER assignee mandando otro campo además de completedAt: false", () => {
  assert.equal(
    canSelfServiceCompleteActivity(user, own, { completedAt: new Date(), subject: "x" }),
    false,
  );
});

test("USER assignee mandando un campo que NO es completedAt: false", () => {
  assert.equal(canSelfServiceCompleteActivity(user, own, { subject: "x" }), false);
  // Reasignarse a sí mismo o a otro tampoco: no es completedAt.
  assert.equal(canSelfServiceCompleteActivity(user, own, { assigneeId: "user-2" }), false);
});

test("USER con completedAt pero NO siendo el assignee: false (ajena y sin asignar)", () => {
  assert.equal(canSelfServiceCompleteActivity(user, ajena, { completedAt: new Date() }), false);
  assert.equal(
    canSelfServiceCompleteActivity(user, sinAsignar, { completedAt: new Date() }),
    false,
  );
});

test("USER con body vacío: false", () => {
  assert.equal(canSelfServiceCompleteActivity(user, own, {}), false);
});

// Una clave presente con valor undefined sigue siendo una clave del body
// (Object.keys la ve): { completedAt: x, subject: undefined } NO es "solo
// completedAt". Es la lectura estricta a propósito — el schema del
// controller nunca produce claves undefined, así que en producción no
// cambia nada, pero la regla no depende de esa suposición.
test("USER: una clave extra con valor undefined también cuenta como campo extra", () => {
  assert.equal(
    canSelfServiceCompleteActivity(user, own, { completedAt: new Date(), subject: undefined }),
    false,
  );
});

// --------------------------------------------------------------------------
// §25 — lectura acotada por assignee para USER (GET listado y GET :id).
// Las dos reglas son puras y se prueban solas, como la de arriba; su
// aplicación con filas y roles reales (y por HTTP, con el actor armado desde
// req.auth) está en activity.service.integration-test.ts y
// activity.controller.integration-test.ts.
// --------------------------------------------------------------------------

test("scopeActivityFiltersToActor: ADMIN conserva los filtros tal cual, incluido el assigneeId de otra persona", () => {
  const filters = { assigneeId: "user-2", type: "TASK" as const, completed: false };
  assert.deepEqual(scopeActivityFiltersToActor(admin, filters), filters);
  // Sin assigneeId tampoco se le agrega ninguno: ADMIN ve todo.
  assert.deepEqual(scopeActivityFiltersToActor(admin, { completed: false }), {
    completed: false,
  });
});

test("scopeActivityFiltersToActor: USER sin assigneeId recibe el propio forzado; el resto de los filtros se conserva", () => {
  assert.deepEqual(scopeActivityFiltersToActor(user, { completed: false, type: "TASK" as const }), {
    completed: false,
    type: "TASK",
    assigneeId: "user-1",
  });
});

test("scopeActivityFiltersToActor: USER mandando el assigneeId de otra persona lo ve pisado por el propio", () => {
  assert.deepEqual(scopeActivityFiltersToActor(user, { assigneeId: "user-2" }), {
    assigneeId: "user-1",
  });
});

test("scopeActivityFiltersToActor: el caso exacto de 'Mis tareas' (assigneeId propio + completed=false) queda idéntico", () => {
  const misTareas = { assigneeId: "user-1", completed: false };
  assert.deepEqual(scopeActivityFiltersToActor(user, misTareas), misTareas);
});

test("scopeActivityFiltersToActor: no muta el objeto recibido", () => {
  const filters = { assigneeId: "user-2" };
  scopeActivityFiltersToActor(user, filters);
  assert.deepEqual(filters, { assigneeId: "user-2" });
});

test("canReadActivity: ADMIN lee cualquiera — propia, ajena o sin asignar", () => {
  assert.equal(canReadActivity(admin, own), true);
  assert.equal(canReadActivity(admin, ajena), true);
  assert.equal(canReadActivity(admin, sinAsignar), true);
});

test("canReadActivity: USER lee solo la propia; ajena y sin asignar no", () => {
  assert.equal(canReadActivity(user, own), true);
  assert.equal(canReadActivity(user, ajena), false);
  assert.equal(canReadActivity(user, sinAsignar), false);
});
