import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { AppError } from "../utils/AppError";
import {
  identidadAplicable,
  nombreEsUnMarcador,
  normalizeEmail,
  rethrowAsConflict,
} from "./contact.service";

// --------------------------------------------------------------------------
// normalizeEmail — después de M-13 recorta espacios y NADA MÁS.
//
// El case lo garantiza contacts_org_email_unique, que ahora es un índice sobre
// lower(email): no depende de que la aplicación se acuerde de normalizar, que
// era todo el problema de M-13. Los espacios sí siguen dependiendo de esto,
// con el CHECK contacts_email_trimmed_check como respaldo.
// --------------------------------------------------------------------------

// El case se conserva a propósito: se guarda lo que la persona escribió, y la
// unicidad la resuelve la base. Si esta aserción vuelve a "john@acme.com",
// alguien reintrodujo el toLowerCase y con él la asimetría entre el service y
// la promoción desde staging.
test("conserva el case que escribió la persona", () => {
  assert.equal(normalizeEmail("John@Acme.com"), "John@Acme.com");
});

test("recorta espacios en los extremos", () => {
  assert.equal(normalizeEmail("  john@acme.com  "), "john@acme.com");
});

test("el trim es lo único que queda, y sigue siendo necesario", () => {
  // lower(' x ') !== lower('x'): sin esto, un espacio al borde crearía un
  // duplicado que el índice no puede atrapar.
  assert.equal(normalizeEmail(" john@acme.com "), normalizeEmail("john@acme.com"));
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

// ---------------------------------------------------------------------------
// Ítem 116: qué datos de identidad puede escribir el agente, y cuáles no
// ---------------------------------------------------------------------------
// Unitarios y sin base: identidadAplicable es pura, y es donde vive la
// decisión. Pisar el nombre de un contacto es justo el tipo de cosa que la IA
// no puede hacer solo porque el modelo lo decidió, así que la regla se prueba
// sola, sin depender de que el resto del camino esté bien.

const MARCADOR = { firstName: "WhatsApp", lastName: "+5491155550000", email: null };
const CARGADO = { firstName: "Diego", lastName: "Ramírez", email: "diego@ejemplo.com" };

test("nombreEsUnMarcador: el placeholder del canal y el vacío sí, un nombre real no", () => {
  assert.equal(nombreEsUnMarcador(MARCADOR), true);
  assert.equal(nombreEsUnMarcador({ firstName: "   ", lastName: null }), true);
  assert.equal(nombreEsUnMarcador(CARGADO), false);
  // Un nombre que EMPIEZA con la palabra no es el marcador.
  assert.equal(nombreEsUnMarcador({ firstName: "WhatsApp Soporte", lastName: null }), false);
});

test("sobre un contacto sin identificar, se guarda todo lo que el cliente dijo", () => {
  // El caso real: llegó por WhatsApp sin nombre de perfil, dijo cómo se llama
  // y dio su mail, y el CRM se quedaba con "WhatsApp +549...".
  const { aplica, ignorados } = identidadAplicable(MARCADOR, {
    firstName: "Diego",
    lastName: "Ramírez",
    email: "diego.ramirez@ejemplo.com",
  });
  assert.deepEqual(aplica, {
    firstName: "Diego",
    lastName: "Ramírez",
    email: "diego.ramirez@ejemplo.com",
  });
  assert.deepEqual(ignorados, []);
});

test("un nombre ya cargado NO se pisa desde el chat, y se avisa cuál no se aplicó", () => {
  // Si un vendedor ya escribió el nombre, gana el vendedor: el modelo puede
  // estar leyendo mal un apodo, y un CRM que se renombra solo es peor que uno
  // desactualizado.
  const { aplica, ignorados } = identidadAplicable(CARGADO, {
    firstName: "Diegui",
    lastName: "R.",
  });
  assert.deepEqual(aplica, {});
  assert.deepEqual(ignorados, ["firstName", "lastName"]);
});

test("el mail se completa si falta y nunca se reemplaza", () => {
  // Es por dónde el negocio le escribe al cliente: pisarlo con uno mal
  // transcripto rompe el contacto sin que nadie se entere.
  assert.deepEqual(
    identidadAplicable({ ...CARGADO, email: null }, { email: "nuevo@ejemplo.com" }).aplica,
    { email: "nuevo@ejemplo.com" },
  );
  const conMail = identidadAplicable(CARGADO, { email: "otro@ejemplo.com" });
  assert.deepEqual(conMail.aplica, {});
  assert.deepEqual(conMail.ignorados, ["email"]);
});

test("el nombre y el mail son independientes: uno puede entrar y el otro no", () => {
  // Contacto con nombre cargado por un vendedor pero sin mail.
  const { aplica, ignorados } = identidadAplicable(
    { firstName: "Diego", lastName: "Ramírez", email: null },
    { firstName: "Otro", email: "diego@ejemplo.com" },
  );
  assert.deepEqual(aplica, { email: "diego@ejemplo.com" });
  assert.deepEqual(ignorados, ["firstName"]);
});

test("los vacíos y los espacios no cuentan como dato", () => {
  // Un modelo que manda firstName: "" no está pidiendo borrar el nombre.
  const { aplica, ignorados } = identidadAplicable(MARCADOR, {
    firstName: "   ",
    lastName: "",
    email: "  ",
  });
  assert.deepEqual(aplica, {});
  assert.deepEqual(ignorados, []);
});

test("lo que se guarda va trimeado", () => {
  assert.deepEqual(identidadAplicable(MARCADOR, { firstName: "  Diego  " }).aplica, {
    firstName: "Diego",
  });
});
