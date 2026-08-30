import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { AppError } from "./AppError";
import { traducirErrorDePrisma } from "./prismaErrors";

// M-11 (c) de docs/auditoria-2026-08-29.md — la traducción central de los
// códigos genéricos de Prisma. Sin base: el error se construye a mano con el
// mismo constructor que usa el cliente, y eso alcanza porque la función solo
// mira `instanceof` y `code`.

// El mensaje crudo imita lo que Prisma devuelve de verdad: nombra tabla y
// constraint. Ninguna traducción puede dejarlo pasar.
const MENSAJE_CRUDO =
  "Foreign key constraint violated on the constraint: `contacts_company_id_fkey` (table: contacts)";

function errorDePrisma(code: string) {
  return new Prisma.PrismaClientKnownRequestError(MENSAJE_CRUDO, { code, clientVersion: "x" });
}

for (const code of ["P2034", "P2028"]) {
  test(`${code} se traduce a un 409 operacional con mensaje de reintento`, () => {
    const traducido = traducirErrorDePrisma(errorDePrisma(code));

    assert.ok(traducido instanceof AppError);
    assert.equal(traducido.statusCode, 409);
    assert.equal(traducido.isOperational, true, "el mensaje que le dimos es seguro para mostrar");
    assert.match(traducido.message, /conflicto temporal/);
    assert.match(traducido.message, /Reintentá/);
    assert.ok(!traducido.message.includes("contacts"), "nada del mensaje crudo llega");
  });
}

test("P2003 se traduce a un 400 operacional — el llamador referenció un id que no existe", () => {
  const traducido = traducirErrorDePrisma(errorDePrisma("P2003"));

  assert.ok(traducido instanceof AppError);
  assert.equal(traducido.statusCode, 400);
  assert.equal(traducido.isOperational, true);
  assert.match(traducido.message, /recurso que no existe/);
  assert.ok(!traducido.message.includes("fkey"), "nada del mensaje crudo llega");
});

// NO es un fallback: P2002 se traduce por servicio (cada uno sabe cuál
// constraint de negocio se violó), y cualquier otro código sigue al 500
// genérico de errorHandler.
test("P2002, P2025 y cualquier otro código devuelven undefined", () => {
  assert.equal(traducirErrorDePrisma(errorDePrisma("P2002")), undefined);
  assert.equal(traducirErrorDePrisma(errorDePrisma("P2025")), undefined);
  assert.equal(traducirErrorDePrisma(errorDePrisma("P1001")), undefined);
});

test("lo que no es un PrismaClientKnownRequestError devuelve undefined", () => {
  assert.equal(traducirErrorDePrisma(new Error("P2003")), undefined);
  assert.equal(traducirErrorDePrisma(new AppError("P2003", 400)), undefined);
  assert.equal(traducirErrorDePrisma({ code: "P2003" }), undefined);
  assert.equal(traducirErrorDePrisma(undefined), undefined);
});
