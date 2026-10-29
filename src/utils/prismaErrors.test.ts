import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { AppError } from "./AppError";
import {
  BaseNoDisponibleError,
  esErrorDeConexionALaBase,
  traducirErrorDePrisma,
} from "./prismaErrors";

// M-11 (c) de docs-privados/auditoria-2026-08-29.md (local, no está en GitHub) — la traducción central de los
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
  assert.equal(traducirErrorDePrisma(errorDePrisma("P1003")), undefined);
});

test("lo que no es un PrismaClientKnownRequestError devuelve undefined", () => {
  assert.equal(traducirErrorDePrisma(new Error("P2003")), undefined);
  assert.equal(traducirErrorDePrisma(new AppError("P2003", 400)), undefined);
  assert.equal(traducirErrorDePrisma({ code: "P2003" }), undefined);
  assert.equal(traducirErrorDePrisma(undefined), undefined);
});

// La base que no responde: 503 operacional (el cliente puede reintentar) y,
// salvo P2024, la señal con la que los workers frenan.
for (const code of ["P1001", "P1002", "P1008", "P1017"]) {
  test(`${code} es la base que no responde: 503 operacional y frena a los workers`, () => {
    const err = errorDePrisma(code);
    const traducido = traducirErrorDePrisma(err);

    assert.ok(traducido instanceof BaseNoDisponibleError);
    assert.equal(traducido.statusCode, 503);
    assert.equal(traducido.isOperational, true);
    assert.match(traducido.message, /Reintentá/);
    assert.ok(!traducido.message.includes("contacts"), "nada del mensaje crudo llega");
    assert.equal(esErrorDeConexionALaBase(err), true);
  });
}

test("un PrismaClientInitializationError (no se pudo conectar) también es la base que no responde", () => {
  const err = new Prisma.PrismaClientInitializationError("Can't reach database server", "x");

  assert.ok(traducirErrorDePrisma(err) instanceof BaseNoDisponibleError);
  assert.equal(esErrorDeConexionALaBase(err), true);
});

test("P2024 (el pool no dio conexión a tiempo) da 503 pero NO frena a los workers", () => {
  const err = errorDePrisma("P2024");

  assert.ok(traducirErrorDePrisma(err) instanceof BaseNoDisponibleError);
  assert.equal(esErrorDeConexionALaBase(err), false);
});

test("un error de negocio o uno cualquiera no es la base que no responde", () => {
  assert.equal(esErrorDeConexionALaBase(errorDePrisma("P2002")), false);
  assert.equal(esErrorDeConexionALaBase(new Error("P1001")), false);
  assert.equal(esErrorDeConexionALaBase({ code: "P1001" }), false);
});
