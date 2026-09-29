import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AppError } from "../utils/AppError";
import {
  CONTACTO_CON_CONVERSACIONES_ABIERTAS,
  CONTACTO_CON_OPORTUNIDADES_ABIERTAS,
  CONTACTO_CON_RESERVAS_CONFIRMADAS,
  deleteContact,
  identidadAplicable,
  nombreEsUnMarcador,
  normalizeEmail,
  rethrowAsConflict,
  telefonoParaGuardar,
} from "./contact.service";
import { TELEFONO_NO_NORMALIZABLE } from "../lib/telefono";

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

// --------------------------------------------------------------------------
// deleteContact — los RESTRICT de oportunidades abiertas (ítem 155), de
// conversaciones abiertas (ítem 168) y de reservas confirmadas (ítem 167, C-04
// de la auditoría), sin base: el cliente
// de Prisma se reemplaza por uno en memoria que responde cada conteo con lo
// que el test le pida. Que Postgres cuente esas filas lo cubre
// crmIntegridad.integration-test.ts.
// --------------------------------------------------------------------------

function baseDeContactoFalsa(
  conteos: { opportunity?: number; conversation?: number; booking?: number } = {},
) {
  const borrados: unknown[] = [];
  const wheres: { conversation?: unknown } = {};
  const p = prisma as unknown as Record<string, unknown>;
  mock.property(p, "contact", {
    findFirst: async () => ({ id: "contact-1", organizationId: "org-a" }),
    updateMany: async (args: unknown) => {
      borrados.push(args);
      return { count: 1 };
    },
  });
  mock.property(p, "opportunity", { count: async () => conteos.opportunity ?? 0 });
  mock.property(p, "conversation", {
    count: async (args: { where: unknown }) => {
      wheres.conversation = args.where;
      return conteos.conversation ?? 0;
    },
  });
  mock.property(p, "booking", { count: async () => conteos.booking ?? 0 });
  return { borrados, wheres };
}

async function capturarRechazo(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  assert.fail("se esperaba un error");
}

test("deleteContact con reservas confirmadas: 409 con su mensaje, y no borra", async () => {
  try {
    const { borrados } = baseDeContactoFalsa({ booking: 1 });
    const err = await capturarRechazo(() => deleteContact("org-a", "contact-1"));
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, 409);
    assert.equal(err.message, CONTACTO_CON_RESERVAS_CONFIRMADAS);
    assert.equal(borrados.length, 0);
  } finally {
    mock.restoreAll();
  }
});

test("deleteContact con conversaciones abiertas: 409 con su mensaje, antes que el de reservas, y no borra", async () => {
  try {
    const { borrados } = baseDeContactoFalsa({ conversation: 1, booking: 1 });
    const err = await capturarRechazo(() => deleteContact("org-a", "contact-1"));
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, 409);
    assert.equal(err.message, CONTACTO_CON_CONVERSACIONES_ABIERTAS);
    assert.equal(borrados.length, 0);
  } finally {
    mock.restoreAll();
  }
});

// Ítem 168: una conversación CLOSED no entra en el conteo, así que no bloquea.
test("el conteo de conversaciones es solo de las abiertas, del contacto y de la organización", async () => {
  try {
    const { wheres } = baseDeContactoFalsa();
    await deleteContact("org-a", "contact-1");
    assert.deepEqual(wheres.conversation, {
      contactId: "contact-1",
      organizationId: "org-a",
      status: { in: ["ACTIVE", "TRANSFERRED_TO_HUMAN"] },
    });
  } finally {
    mock.restoreAll();
  }
});

test("deleteContact con oportunidades abiertas sigue dando su propio 409", async () => {
  try {
    const { borrados } = baseDeContactoFalsa({ opportunity: 1, conversation: 1, booking: 1 });
    const err = await capturarRechazo(() => deleteContact("org-a", "contact-1"));
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, 409);
    assert.equal(err.message, CONTACTO_CON_OPORTUNIDADES_ABIERTAS);
    assert.equal(borrados.length, 0);
  } finally {
    mock.restoreAll();
  }
});

test("deleteContact sin oportunidades abiertas ni reservas confirmadas lo da de baja", async () => {
  try {
    const { borrados } = baseDeContactoFalsa();
    await deleteContact("org-a", "contact-1");
    assert.equal(borrados.length, 1);
  } finally {
    mock.restoreAll();
  }
});

// --------------------------------------------------------------------------
// telefonoParaGuardar — F5 de docs-privados/prueba-en-vivo-2026-09-29.md (local, no está en GitHub). La regla de
// normalización está probada en lib/telefono.test.ts; acá, lo que agrega el
// camino HTTP: undefined no toca, null y vacío limpian, lo no normalizable es
// un 400 con el mensaje del helper.
// --------------------------------------------------------------------------

test("F5: telefonoParaGuardar normaliza a + y solo dígitos", () => {
  assert.equal(telefonoParaGuardar("59894000111"), "+59894000111");
  assert.equal(telefonoParaGuardar("+598 94 000 111"), "+59894000111");
});

test("F5: telefonoParaGuardar deja undefined como 'no vino' y trata null y vacío como sin teléfono", () => {
  assert.equal(telefonoParaGuardar(undefined), undefined);
  assert.equal(telefonoParaGuardar(null), null);
  assert.equal(telefonoParaGuardar(""), null);
  assert.equal(telefonoParaGuardar("   "), null);
});

test("F5: telefonoParaGuardar rechaza con 400 un local con 0 inicial — no inventa código de país", () => {
  assert.throws(
    () => telefonoParaGuardar("099 123 456"),
    (err: unknown) =>
      err instanceof AppError && err.statusCode === 400 && err.message === TELEFONO_NO_NORMALIZABLE,
  );
});

// F5-b (pendientes post F1–F5): con el país por defecto de la organización, un
// local con 0 inicial se completa en vez de dar 400.
test("F5-b: telefonoParaGuardar completa un local con el país por defecto", () => {
  assert.equal(telefonoParaGuardar("099 123 456", "598"), "+59899123456");
  assert.equal(telefonoParaGuardar("00598 99 123 456"), "+59899123456");
  assert.throws(
    () => telefonoParaGuardar("099 123 456", null),
    (err: unknown) => err instanceof AppError && err.statusCode === 400,
  );
});
