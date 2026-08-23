import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { AppError } from "../utils/AppError";
import { computeFinalOrderIds, rethrowAsConflict } from "./stage.service";

// --------------------------------------------------------------------------
// computeFinalOrderIds — el cálculo puro del reordenamiento.
//
// `siblings` llega siempre ordenado por `order` asc y sin borrados
// (findStagesByPipeline). El resultado es la lista de ids en el orden final,
// que reindexStages persiste como order = 1..n.
// --------------------------------------------------------------------------

const siblings = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

test("mover la última etapa al primer lugar", () => {
  assert.deepEqual(computeFinalOrderIds(siblings, "d", 1), ["d", "a", "b", "c"]);
});

test("mover la primera etapa al último lugar", () => {
  assert.deepEqual(computeFinalOrderIds(siblings, "a", 4), ["b", "c", "d", "a"]);
});

test("mover una etapa hacia abajo", () => {
  assert.deepEqual(computeFinalOrderIds(siblings, "b", 3), ["a", "c", "b", "d"]);
});

test("mover una etapa hacia arriba", () => {
  assert.deepEqual(computeFinalOrderIds(siblings, "c", 2), ["a", "c", "b", "d"]);
});

test("mover una etapa a la posición que ya ocupa no cambia nada", () => {
  assert.deepEqual(computeFinalOrderIds(siblings, "b", 2), ["a", "b", "c", "d"]);
});

test("un orden por debajo del rango se acota a la primera posición", () => {
  assert.deepEqual(computeFinalOrderIds(siblings, "c", 0), ["c", "a", "b", "d"]);
  assert.deepEqual(computeFinalOrderIds(siblings, "c", -10), ["c", "a", "b", "d"]);
});

test("un orden por encima del rango se acota a la última posición", () => {
  assert.deepEqual(computeFinalOrderIds(siblings, "b", 99), ["a", "c", "d", "b"]);
});

test("el resultado siempre conserva a todos los hermanos, una sola vez", () => {
  for (let order = -2; order <= 7; order += 1) {
    for (const moved of ["a", "b", "c", "d"]) {
      const result = computeFinalOrderIds(siblings, moved, order);
      assert.equal(result.length, siblings.length);
      assert.deepEqual([...result].sort(), ["a", "b", "c", "d"]);
    }
  }
});

test("un pipeline con una sola etapa es un no-op", () => {
  assert.deepEqual(computeFinalOrderIds([{ id: "a" }], "a", 1), ["a"]);
  assert.deepEqual(computeFinalOrderIds([{ id: "a" }], "a", 5), ["a"]);
});

// --------------------------------------------------------------------------
// rethrowAsConflict — traducción de errores de Postgres a 409 legibles.
// --------------------------------------------------------------------------

function p2002(target: unknown): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "5.22.0",
    meta: { target },
  });
}

function assertAppError(fn: () => never, statusCode: number, message: string) {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof AppError, "debería ser un AppError");
    assert.equal(err.statusCode, statusCode);
    assert.equal(err.message, message);
    return true;
  });
}

test("P2002 sobre el nombre: 409 con el mensaje de nombre duplicado", () => {
  assertAppError(
    () => rethrowAsConflict(p2002(["pipeline_id", "name"])),
    409,
    "Ya existe una etapa con ese nombre en este pipeline",
  );
});

test("P2002 sobre isWon: 409 con el mensaje de etapa ganada", () => {
  assertAppError(
    () => rethrowAsConflict(p2002(["stages_pipeline_won_unique"])),
    409,
    "Ya existe una etapa marcada como ganada en este pipeline",
  );
});

test("P2002 sobre isLost: 409 con el mensaje de etapa perdida", () => {
  assertAppError(
    () => rethrowAsConflict(p2002(["stages_pipeline_lost_unique"])),
    409,
    "Ya existe una etapa marcada como perdida en este pipeline",
  );
});

test("P2002 con target string (no array) también se traduce", () => {
  assertAppError(
    () => rethrowAsConflict(p2002("stages_pipeline_name_unique")),
    409,
    "Ya existe una etapa con ese nombre en este pipeline",
  );
});

test("P2002 sin target reconocible: 409 genérico", () => {
  assertAppError(
    () => rethrowAsConflict(p2002(undefined)),
    409,
    "El registro ya existe",
  );
});

// El CHECK stages_won_lost_exclusive_check no expone meta.target: se
// reconoce por el nombre exacto de la constraint dentro del mensaje, con las
// comillas escapadas tal como las expone Prisma (ver el comentario en
// stage.service.ts).
test("el CHECK won/lost se traduce a 409", () => {
  const err = new Prisma.PrismaClientUnknownRequestError(
    'ERROR: new row for relation "stages" violates check constraint \\"stages_won_lost_exclusive_check\\"',
    { clientVersion: "5.22.0" },
  );
  assertAppError(
    () => rethrowAsConflict(err),
    409,
    "Esta etapa no puede quedar marcada como ganada y perdida a la vez",
  );
});

test("un error desconocido de Prisma sin esa constraint se relanza tal cual", () => {
  const err = new Prisma.PrismaClientUnknownRequestError("otro error cualquiera", {
    clientVersion: "5.22.0",
  });
  assert.throws(
    () => rethrowAsConflict(err),
    (thrown: unknown) => thrown === err,
  );
});

test("un error que no es de Prisma se relanza sin tocarlo", () => {
  const err = new Error("boom");
  assert.throws(
    () => rethrowAsConflict(err),
    (thrown: unknown) => thrown === err,
  );
});

test("un P2025 (no encontrado) no se convierte en 409", () => {
  const err = new Prisma.PrismaClientKnownRequestError("Record not found", {
    code: "P2025",
    clientVersion: "5.22.0",
  });
  assert.throws(
    () => rethrowAsConflict(err),
    (thrown: unknown) => thrown === err,
  );
});
