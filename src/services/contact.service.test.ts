import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { AppError } from "../utils/AppError";
import { normalizeEmail, rethrowAsConflict } from "./contact.service";

// --------------------------------------------------------------------------
// normalizeEmail — lo que hace que contacts_org_email_unique (case-sensitive
// en la base) cumpla su propósito.
// --------------------------------------------------------------------------

test("baja el email a minúsculas", () => {
  assert.equal(normalizeEmail("John@Acme.com"), "john@acme.com");
});

test("recorta espacios en los extremos", () => {
  assert.equal(normalizeEmail("  john@acme.com  "), "john@acme.com");
});

test("dos escrituras del mismo email chocan después de normalizar", () => {
  assert.equal(normalizeEmail("John@Acme.com"), normalizeEmail(" JOHN@ACME.COM "));
});

// El campo es opcional en el schema: undefined tiene que seguir siendo
// undefined (no "" ni null), porque es lo que distingue "no mandó email" de
// "mandó email vacío" en el update parcial.
test("undefined pasa de largo sin convertirse en string", () => {
  assert.equal(normalizeEmail(undefined), undefined);
});

test("el string vacío no se convierte en undefined", () => {
  assert.equal(normalizeEmail(""), "");
});

// --------------------------------------------------------------------------
// rethrowAsConflict — Contact tiene un solo índice de unicidad propio
// (contacts_org_email_unique).
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

test("P2002 sobre el email: 409 con el mensaje de email duplicado", () => {
  assertAppError(
    () => rethrowAsConflict(p2002(["organization_id", "email"])),
    409,
    "Ya existe un contacto con ese email en esta organización",
  );
});

test("P2002 con el nombre del índice como string también se traduce", () => {
  assertAppError(
    () => rethrowAsConflict(p2002("contacts_org_email_unique")),
    409,
    "Ya existe un contacto con ese email en esta organización",
  );
});

test("P2002 sin target reconocible: 409 genérico", () => {
  assertAppError(
    () => rethrowAsConflict(p2002(undefined)),
    409,
    "El registro ya existe",
  );
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
