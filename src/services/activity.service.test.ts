import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../utils/AppError";
import {
  canReadActivity,
  canSelfServiceCompleteActivity,
  resolveConfirmationPatch,
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
const own = { assigneeId: "user-1", completedAt: null };
const ajena = { assigneeId: "user-2", completedAt: null };
const sinAsignar = { assigneeId: null, completedAt: null };
// §29: la propia, pero ya tildada (esperando confirmación o confirmada).
const ownCompletada = { assigneeId: "user-1", completedAt: new Date("2026-09-14T10:00:00Z") };

test("ADMIN: cualquier campo, cualquier assignee (incluso sin asignar)", () => {
  assert.equal(canSelfServiceCompleteActivity(admin, ajena, { subject: "x" }), true);
  assert.equal(canSelfServiceCompleteActivity(admin, sinAsignar, { assigneeId: "u9" }), true);
  assert.equal(
    canSelfServiceCompleteActivity(admin, own, { completedAt: new Date(), type: "CALL" }),
    true,
  );
  // Y sobre una ya completada también: destildar o confirmar es cosa suya.
  assert.equal(canSelfServiceCompleteActivity(admin, ownCompletada, { completedAt: null }), true);
  assert.equal(canSelfServiceCompleteActivity(admin, ownCompletada, { confirmed: true }), true);
});

test("USER completando su propia actividad pendiente, solo completedAt: true", () => {
  assert.equal(canSelfServiceCompleteActivity(user, own, { completedAt: new Date() }), true);
});

// §29: antes un USER podía mandar completedAt: null y destildarse. Con la
// confirmación de por medio, eso revertiría una tarea que ya espera
// revisión. Solo puede completar, nunca destildar.
test("§29 USER intentando destildar su propia actividad ya completada (completedAt: null): false", () => {
  assert.equal(canSelfServiceCompleteActivity(user, ownCompletada, { completedAt: null }), false);
});

test("§29 USER volviendo a mandar completedAt sobre su propia actividad ya completada: false", () => {
  assert.equal(
    canSelfServiceCompleteActivity(user, ownCompletada, { completedAt: new Date() }),
    false,
  );
});

// completedAt: null sobre una todavía pendiente no revierte nada: es un
// no-op, y la regla no lo distingue de tildar (mira la fila, no el valor).
test("USER mandando completedAt: null sobre su propia actividad todavía pendiente: true (no-op)", () => {
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

// §29: Confirmar/Rechazar no es completedAt, así que un USER nunca llega a
// la rama de confirmación — ni sobre la propia pendiente de confirmar.
test("§29 USER mandando `confirmed` (solo o con completedAt): false, sea cual sea la fila", () => {
  assert.equal(canSelfServiceCompleteActivity(user, ownCompletada, { confirmed: true }), false);
  assert.equal(canSelfServiceCompleteActivity(user, ownCompletada, { confirmed: false }), false);
  assert.equal(canSelfServiceCompleteActivity(user, own, { confirmed: false }), false);
  assert.equal(
    canSelfServiceCompleteActivity(user, own, { completedAt: new Date(), confirmed: true }),
    false,
  );
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
// §29 — resolveConfirmationPatch: qué columnas de completado/confirmación
// escribe cada camino del PATCH. Pura, con `now` inyectado para afirmar la
// fecha exacta. La escritura real (y que updateActivity la aplica) está en
// activity.service.integration-test.ts.
// --------------------------------------------------------------------------

const NOW = new Date("2026-09-14T12:00:00.000Z");
const COMPLETADA = new Date("2026-09-13T09:30:00.000Z");
const pendiente = { completedAt: null, confirmedAt: null };
const pendienteDeConfirmar = { completedAt: COMPLETADA, confirmedAt: null };
const confirmada = { completedAt: COMPLETADA, confirmedAt: new Date("2026-09-13T10:00:00Z") };

function esperarAppError(statusCode: number, message: string) {
  return (err: unknown) => {
    assert.ok(err instanceof AppError, "debe ser AppError");
    assert.equal(err.statusCode, statusCode);
    assert.equal(err.message, message);
    return true;
  };
}

test("§29 Confirmar: ADMIN sobre una completada sin confirmar → confirmedAt = now y confirmedById = quien confirma", () => {
  assert.deepEqual(
    resolveConfirmationPatch(admin, pendienteDeConfirmar, { confirmed: true }, NOW),
    { confirmedAt: NOW, confirmedById: "admin-1" },
  );
});

test("§29 Confirmar una que NO está completada: 400", () => {
  assert.throws(
    () => resolveConfirmationPatch(admin, pendiente, { confirmed: true }, NOW),
    esperarAppError(400, "No se puede confirmar una actividad que no está completada"),
  );
});

test("§29 Confirmar una ya confirmada: 400 (no se confirma dos veces)", () => {
  assert.throws(
    () => resolveConfirmationPatch(admin, confirmada, { confirmed: true }, NOW),
    esperarAppError(400, "La actividad ya está confirmada"),
  );
});

test("§29 Rechazar: ADMIN sobre una completada → vuelve a pendiente, con la confirmación borrada", () => {
  const esperado = { completedAt: null, confirmedAt: null, confirmedById: null };
  assert.deepEqual(
    resolveConfirmationPatch(admin, pendienteDeConfirmar, { confirmed: false }, NOW),
    esperado,
  );
  // Rechazar una ya confirmada también la devuelve a pendiente: el ADMIN
  // puede tocar cualquier campo, y la invariante limpia la confirmación.
  assert.deepEqual(
    resolveConfirmationPatch(admin, confirmada, { confirmed: false }, NOW),
    esperado,
  );
});

test("§29 Rechazar una que NO está completada: 400", () => {
  assert.throws(
    () => resolveConfirmationPatch(admin, pendiente, { confirmed: false }, NOW),
    esperarAppError(400, "No hay nada que rechazar: la actividad no está completada"),
  );
});

// Defensa en profundidad: canSelfServiceCompleteActivity ya rechaza a un
// USER con `confirmed` en el body, pero la rama vuelve a exigir ADMIN.
test("§29 `confirmed` con un actor USER: 403, aunque sea el assignee", () => {
  const forbidden = esperarAppError(403, "No tenés permisos para realizar esta acción");
  assert.throws(
    () => resolveConfirmationPatch(user, pendienteDeConfirmar, { confirmed: true }, NOW),
    forbidden,
  );
  assert.throws(
    () => resolveConfirmationPatch(user, pendienteDeConfirmar, { confirmed: false }, NOW),
    forbidden,
  );
});

test("§29 `confirmed` y completedAt en el mismo body: 400", () => {
  assert.throws(
    () =>
      resolveConfirmationPatch(
        admin,
        pendienteDeConfirmar,
        { confirmed: true, completedAt: NOW },
        NOW,
      ),
    esperarAppError(400, "confirmed no se combina con completedAt en el mismo PATCH"),
  );
  assert.throws(
    () =>
      resolveConfirmationPatch(
        admin,
        pendienteDeConfirmar,
        { confirmed: false, completedAt: null },
        NOW,
      ),
    esperarAppError(400, "confirmed no se combina con completedAt en el mismo PATCH"),
  );
});

test("§29 auto-confirmación: ADMIN completando una pendiente queda confirmada en la misma escritura", () => {
  assert.deepEqual(resolveConfirmationPatch(admin, pendiente, { completedAt: COMPLETADA }, NOW), {
    confirmedAt: NOW,
    confirmedById: "admin-1",
  });
});

test("§29 auto-confirmación NO aplica a un USER completando la suya: queda pendiente de confirmar", () => {
  assert.deepEqual(resolveConfirmationPatch(user, pendiente, { completedAt: COMPLETADA }, NOW), {});
});

test("§29 auto-confirmación NO aplica si la actividad ya estaba completada (ADMIN editando la fecha de una pendiente de confirmar)", () => {
  assert.deepEqual(
    resolveConfirmationPatch(admin, pendienteDeConfirmar, { completedAt: NOW }, NOW),
    {},
  );
});

test("§29 un PATCH sin completedAt ni confirmed no toca la confirmación (edición de otro campo)", () => {
  assert.deepEqual(resolveConfirmationPatch(admin, confirmada, {}, NOW), {});
  assert.deepEqual(resolveConfirmationPatch(admin, pendienteDeConfirmar, {}, NOW), {});
  assert.deepEqual(resolveConfirmationPatch(user, pendiente, {}, NOW), {});
});

test("§29 invariante: limpiar completedAt a mano (ADMIN, completedAt: null) también limpia confirmedAt/confirmedById", () => {
  const esperado = { confirmedAt: null, confirmedById: null };
  assert.deepEqual(
    resolveConfirmationPatch(admin, confirmada, { completedAt: null }, NOW),
    esperado,
  );
  assert.deepEqual(
    resolveConfirmationPatch(admin, pendienteDeConfirmar, { completedAt: null }, NOW),
    esperado,
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

// §29: "Mis tareas" pasa de completed=false a confirmed=false; el filtro se
// conserva igual que cualquier otro.
test("scopeActivityFiltersToActor: el caso exacto de 'Mis tareas' (assigneeId propio + confirmed=false) queda idéntico", () => {
  const misTareas = { assigneeId: "user-1", confirmed: false };
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
