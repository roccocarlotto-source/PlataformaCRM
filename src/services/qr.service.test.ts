import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { AppError } from "../utils/AppError";
import { rethrowNumeroRepetido } from "./qr.service";

// --------------------------------------------------------------------------
// rethrowNumeroRepetido — §54 de docs/frontend-cambios-pendientes.md.
//
// Traduce la violación de qr_codes_branch_display_number_unique (el N° de un
// QR ya usado por otro QR activo de la misma sucursal) al 409 legible.
//
// LO QUE ESTOS TESTS NO PUEDEN VER, y por eso además hay uno de integración:
// acá el `target` se pasa a mano, así que un renombre del índice —o un índice
// recreado sin su predicado parcial— pasaría igual. Mismo límite y misma
// contraparte que rethrowAsConflict en contact.service.test.ts.
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

const NUMERO_YA_USADO = "Ya existe un QR activo con ese número en esta sucursal";

// La forma que Prisma devuelve de verdad para este índice: es parcial, el DSL
// no lo expresa, así que no lo puede mapear a nombres de campo y reporta el
// nombre crudo.
test("P2002 con el nombre del índice: 409 con el mensaje del número repetido", () => {
  assertAppError(
    () => rethrowNumeroRepetido(p2002("qr_codes_branch_display_number_unique")),
    409,
    NUMERO_YA_USADO,
  );
});

test("P2002 con el array de columnas también se traduce", () => {
  assertAppError(
    () => rethrowNumeroRepetido(p2002(["organization_id", "branch_id", "display_number"])),
    409,
    NUMERO_YA_USADO,
  );
});

// Hoy el único otro índice único de qr_codes es la PK, o sea una colisión de
// gen_random_uuid(). No es este error y no merece este mensaje: sube tal cual
// y cae al 500 genérico del errorHandler, que es lo correcto para algo que no
// debería poder pasar.
test("un P2002 de OTRA constraint de la tabla se relanza sin tocarlo", () => {
  const err = p2002("qr_codes_pkey");
  assert.throws(
    () => rethrowNumeroRepetido(err),
    (thrown: unknown) => thrown === err,
  );
});

test("un P2002 sin target se relanza sin tocarlo", () => {
  const err = p2002(undefined);
  assert.throws(
    () => rethrowNumeroRepetido(err),
    (thrown: unknown) => thrown === err,
  );
});

// Importa para el 404 anti-enumeración del PATCH y para P2028/P2034, que
// traduce centralmente utils/prismaErrors.ts: si este catch se tragara todo,
// un "QR no encontrado" o un conflicto transitorio se convertirían en "ya
// existe un QR con ese número".
test("un error que no es P2002 se relanza sin tocarlo", () => {
  const err = new Prisma.PrismaClientKnownRequestError("Record not found", {
    code: "P2025",
    clientVersion: "5.22.0",
  });
  assert.throws(
    () => rethrowNumeroRepetido(err),
    (thrown: unknown) => thrown === err,
  );
});

test("un error cualquiera que no viene de Prisma se relanza sin tocarlo", () => {
  const err = new Error("boom");
  assert.throws(
    () => rethrowNumeroRepetido(err),
    (thrown: unknown) => thrown === err,
  );
});
