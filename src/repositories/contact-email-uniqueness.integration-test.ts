import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, before, after } from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { rethrowAsConflict } from "../services/contact.service";
import { AppError } from "../utils/AppError";

// M-13 — la unicidad de email de contacto, probada CONTRA LA BASE y no contra
// el service.
//
// Ese "y no contra el service" es el punto entero del hallazgo. Antes de este
// arreglo, contacts_org_email_unique estaba definido sobre la columna cruda y
// lo único que lo hacía deduplicar era normalizeEmail() bajando a minúsculas
// antes de escribir. La promoción desde staging (ítem 4 de
// docs/ingestion-architecture.md) no pasa por contact.service, así que la
// garantía se evaporaba exactamente en el escenario para el que existía.
//
// Por eso TODAS las escrituras de este archivo son prisma.contact.create
// directo: si el arreglo funciona, tiene que funcionar sin que ninguna capa
// nuestra colabore. Es el mismo criterio con el que se escribieron los tests de
// rechazo de FK cross-tenant del ítem 2.
//
// No usa Supabase Auth: Contact solo exige organizationId, firstName y
// lastName, así que el fixture son dos organizaciones y nada más.

interface Fixture {
  orgA: string;
  orgB: string;
}

let fx: Fixture;

// Un dominio distinto por corrida: la base de CI se reconstruye vacía, pero la
// de desarrollo no, y estos tests escriben contactos reales.
const DOMINIO = `m13-${Date.now()}-${randomUUID().slice(0, 8)}.test`;

function email(local: string): string {
  return `${local}@${DOMINIO}`;
}

async function crearContacto(organizationId: string, emailValue: string | null, label: string) {
  return prisma.contact.create({
    data: {
      organizationId,
      firstName: "M13",
      lastName: label,
      email: emailValue,
    },
  });
}

before(async () => {
  const orgA = await prisma.organization.create({
    data: {
      name: `M13 org-a ${randomUUID()}`,
      slug: `m13-org-a-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  const orgB = await prisma.organization.create({
    data: {
      name: `M13 org-b ${randomUUID()}`,
      slug: `m13-org-b-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });

  fx = { orgA: orgA.id, orgB: orgB.id };
});

after(async () => {
  if (!fx) return;
  const ambas = { in: [fx.orgA, fx.orgB] };
  await prisma.contact.deleteMany({ where: { organizationId: ambas } });
  await prisma.organization.deleteMany({ where: { id: ambas } });
});

// ---------------------------------------------------------------------------
// La propiedad central de M-13
// ---------------------------------------------------------------------------

test("dos emails que difieren solo en mayúsculas, misma organización: la base rechaza el segundo", async () => {
  const local = "juan.perez";
  await crearContacto(fx.orgA, email(local.replace("juan", "Juan")), "Mixto");

  await assert.rejects(
    () => crearContacto(fx.orgA, email(local), "Minuscula"),
    (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002",
    "Juan@… y juan@… no pueden coexistir: es la garantía que M-13 vino a poner en la base",
  );
});

test("el case que escribió la persona se guarda tal cual — la base no lo normaliza, solo lo compara", async () => {
  const escrito = email("Maria.Gonzalez");
  const contacto = await crearContacto(fx.orgA, escrito, "Case");

  assert.equal(
    contacto.email,
    escrito,
    "el índice es sobre lower(email), pero la columna guarda el valor original",
  );
});

test("el mismo email en dos organizaciones distintas: entran los dos", async () => {
  const compartido = email("compartido");

  const enA = await crearContacto(fx.orgA, compartido, "OrgA");
  const enB = await crearContacto(fx.orgB, compartido, "OrgB");

  assert.notEqual(enA.id, enB.id);
  assert.equal(enA.email, enB.email);
});

test("un contacto borrado libera su email para reuso, como antes", async () => {
  const reusable = email("reusable");

  const primero = await crearContacto(fx.orgA, reusable, "Primero");
  await prisma.contact.update({
    where: { id: primero.id },
    data: { deletedAt: new Date() },
  });

  const segundo = await crearContacto(fx.orgA, reusable, "Segundo");
  assert.notEqual(segundo.id, primero.id);
});

test("el índice sigue siendo parcial también para las variantes de case: si la que existe está borrada, la otra entra", async () => {
  const local = "parcial.case";

  const borrado = await crearContacto(fx.orgA, email(local.toUpperCase()), "Borrado");
  await prisma.contact.update({
    where: { id: borrado.id },
    data: { deletedAt: new Date() },
  });

  const nuevo = await crearContacto(fx.orgA, email(local), "Nuevo");
  assert.ok(nuevo.id);
});

test("varios contactos sin email conviven sin problema", async () => {
  const uno = await crearContacto(fx.orgA, null, "SinEmail1");
  const dos = await crearContacto(fx.orgA, null, "SinEmail2");

  assert.notEqual(uno.id, dos.id);
});

// ---------------------------------------------------------------------------
// rethrowAsConflict contra el error REAL
//
// Es el que más probabilidad tenía de romperse con este cambio, y el que ningún
// test unitario podría cubrir: contact.service.test.ts le pasa el `target` a
// mano, así que seguiría en verde aunque Prisma reportara otra cosa.
//
// La traducción depende de que err.meta.target contenga "email". Como el índice
// es parcial Y sobre expresión —dos formas que el DSL de Prisma no expresa—
// Prisma no puede mapearlo a nombres de campo y reporta el nombre crudo del
// índice. Por eso M-13 conservó el nombre contacts_org_email_unique: si lo
// hubiera renombrado a algo sin "email" adentro, el 409 específico habría
// degradado en silencio al genérico "El registro ya existe".
// ---------------------------------------------------------------------------

test("la violación real se traduce al 409 específico, no a un P2002 crudo ni al 409 genérico", async () => {
  const duplicado = email("colision.real");
  await crearContacto(fx.orgA, duplicado, "Original");

  let capturado: unknown;
  try {
    await crearContacto(fx.orgA, duplicado.toUpperCase(), "Duplicado");
  } catch (err) {
    capturado = err;
  }

  assert.ok(capturado, "la base tenía que rechazar la escritura");
  assert.ok(
    capturado instanceof Prisma.PrismaClientKnownRequestError && capturado.code === "P2002",
    "debe llegar como P2002",
  );

  // El contrato del que depende rethrowAsConflict, afirmado explícitamente:
  // cualquiera sea la forma que Prisma elija (array de columnas o nombre del
  // índice), tiene que contener "email".
  const target = Array.isArray(capturado.meta?.target)
    ? capturado.meta.target.join(",")
    : String(capturado.meta?.target ?? "");
  assert.ok(
    target.includes("email"),
    `err.meta.target debe contener "email" para que rethrowAsConflict lo reconozca — llegó: ${JSON.stringify(capturado.meta?.target)}`,
  );

  assert.throws(
    () => rethrowAsConflict(capturado),
    (err: unknown) => {
      assert.ok(err instanceof AppError, "debería ser un AppError");
      assert.equal(err.statusCode, 409);
      assert.equal(
        err.message,
        "Ya existe un contacto con ese email en esta organización",
        "si acá aparece 'El registro ya existe', el índice se renombró y la traducción degradó en silencio",
      );
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// El CHECK de espacios — respaldo, no mecanismo
// ---------------------------------------------------------------------------

test("un email con espacios al borde es rechazado por la base, no guardado tal cual", async () => {
  const conEspacios = ` ${email("con.espacios")} `;

  await assert.rejects(
    () => crearContacto(fx.orgA, conEspacios, "Espacios"),
    (err: unknown) =>
      String(err instanceof Error ? err.message : err).includes("contacts_email_trimmed_check"),
    "el CHECK existe para que sea imposible saltear el .trim() de la aplicación",
  );
});

test("sin el CHECK, un espacio al borde habría sido un duplicado que el índice no atrapa", async () => {
  // Documenta POR QUÉ hace falta el CHECK y no alcanza con el índice: para
  // lower(), estas dos cadenas son distintas. Si la base aceptara la de
  // espacios, serían dos contactos donde debería haber uno.
  const limpio = email("prueba.trim");
  const sucio = ` ${limpio} `;

  assert.notEqual(
    limpio.toLowerCase(),
    sucio.toLowerCase(),
    "lower(' x ') no es igual a lower('x') — el case lo resuelve el índice, los espacios no",
  );

  await crearContacto(fx.orgA, limpio, "Limpio");
  await assert.rejects(() => crearContacto(fx.orgA, sucio, "Sucio"));
});
