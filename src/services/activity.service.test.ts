import assert from "node:assert/strict";
import { test } from "node:test";
import { canSelfServiceCompleteActivity } from "./activity.service";

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
