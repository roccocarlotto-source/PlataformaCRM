import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { AppError } from "../utils/AppError";
import { rethrowAsConflict } from "./pipeline.service";

// Pipeline tiene dos índices únicos y hay que distinguirlos por meta.target:
// el @@unique(organizationId, name) de schema.prisma reporta
// ["organization_id","name"]; el índice parcial pipelines_org_default_unique
// reporta ["organization_id"] a secas (verificado contra la base real, ver la
// nota en pipeline.service.integration-test.ts:70-76).

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

test("P2002 sobre (organization_id, name): 409 de nombre duplicado", () => {
  assertAppError(
    () => rethrowAsConflict(p2002(["organization_id", "name"])),
    409,
    "Ya existe un pipeline con ese nombre en esta organización",
  );
});

test("P2002 sobre el índice parcial de default: 409 de default duplicado", () => {
  assertAppError(
    () => rethrowAsConflict(p2002(["organization_id"])),
    409,
    "Ya existe un pipeline marcado como default en esta organización",
  );
});

// El orden de los dos `if` importa: ["organization_id","name"] contiene las
// dos claves, y tiene que ganar el mensaje de nombre. Si alguien invierte los
// bloques, este test falla.
test("con las dos claves presentes gana el mensaje de nombre", () => {
  assertAppError(
    () => rethrowAsConflict(p2002(["organization_id", "name"])),
    409,
    "Ya existe un pipeline con ese nombre en esta organización",
  );
});

test("P2002 sin target reconocible: 409 genérico", () => {
  assertAppError(() => rethrowAsConflict(p2002(undefined)), 409, "El registro ya existe");
});

test("un error que no es P2002 se relanza sin tocarlo", () => {
  const err = new Prisma.PrismaClientKnownRequestError("Record not found", {
    code: "P2025",
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
