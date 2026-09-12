import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";
import { AppError } from "../utils/AppError";
import { createContact, qualifyLead, updateContact } from "./contact.service";

// M-10 (docs/auditoria-2026-08-29.md) — PATCH no podía vaciar los campos
// opcionales de Contact. Para phone/jobTitle/source el bug vivía solo en el
// schema del controller (contact.controller.test.ts). Para `email` y
// `companyId` el schema era la mitad: updateContact colapsaba el `null` a
// `undefined` (`input.email ?? undefined`, M-29 del 21/08) o lo trataba como
// "no vino" (`if (input.companyId)`), y Prisma ignora `undefined` en un
// update — 200 sin cambiar nada. Este archivo prueba que un `null` explícito
// llega HASTA POSTGRES y queda como NULL.
//
// Mismo estilo que pipeline.service.integration-test.ts: service + repositorio
// + Prisma reales contra la base, sin Express. Contact tiene owner_id hacia
// users, y users.email lo completa un trigger que lee auth.users, así que hace
// falta una identidad real de Supabase Auth — mismo motivo que en
// soft-delete-restrict.integration-test.ts.

interface Escenario {
  orgId: string;
  userId: string;
  authId: string;
  companyId: string;
  // Una segunda organización con su propia empresa, para el caso de
  // aislamiento de companyId. Sin usuario: no se opera "como" ella.
  otraOrgId: string;
  companyDeOtraOrgId: string;
}

async function montar(): Promise<Escenario> {
  const adminRole = await findRoleByName("ADMIN");
  if (!adminRole) {
    throw new Error("No está sembrado el rol ADMIN. Abortando.");
  }

  const org = await prisma.organization.create({
    data: { name: `M-10 contact ${randomUUID()}`, slug: `m10-contact-${randomUUID()}` },
  });

  const email = `m10-contact-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear usuario real de Supabase Auth: ${error?.message}`);
  }
  const user = await prisma.user.create({
    data: {
      id: data.user.id,
      organizationId: org.id,
      roleId: adminRole.id,
      email: `placeholder-${data.user.id}@example.test`,
      fullName: "M-10 contact",
    },
  });

  const company = await prisma.company.create({
    data: { organizationId: org.id, name: `M-10 company ${randomUUID()}` },
  });

  const otraOrg = await prisma.organization.create({
    data: { name: `M-10 otra org ${randomUUID()}`, slug: `m10-otra-org-${randomUUID()}` },
  });
  const companyDeOtraOrg = await prisma.company.create({
    data: { organizationId: otraOrg.id, name: `M-10 company ajena ${randomUUID()}` },
  });

  return {
    orgId: org.id,
    userId: user.id,
    authId: data.user.id,
    companyId: company.id,
    otraOrgId: otraOrg.id,
    companyDeOtraOrgId: companyDeOtraOrg.id,
  };
}

async function desmontar(escenario: Escenario) {
  for (const orgId of [escenario.orgId, escenario.otraOrgId]) {
    await prisma.contact.deleteMany({ where: { organizationId: orgId } });
    await prisma.company.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  }
  await getSupabaseAdmin().auth.admin.deleteUser(escenario.authId);
}

function assertAppError(err: unknown, statusCode: number) {
  assert.ok(err instanceof AppError, `debe ser AppError, no un error crudo. Fue: ${String(err)}`);
  assert.equal(err.statusCode, statusCode);
  return true;
}

// ---------------------------------------------------------------------------
// email — M-29 del 21/08, la mitad backend
// ---------------------------------------------------------------------------

test("M-10/M-29: updateContact con email: null deja el email NULL en la base, no el valor anterior", async () => {
  const escenario = await montar();
  try {
    const creado = await createContact(escenario.orgId, escenario.userId, {
      firstName: "Ana",
      lastName: "Pérez",
      email: "ana@example.test",
    });
    assert.equal(creado.email, "ana@example.test", "setup");

    const devuelto = await updateContact(escenario.orgId, escenario.userId, creado.id, {
      email: null,
    });
    assert.equal(devuelto.email, null);

    const fila = await prisma.contact.findUnique({ where: { id: creado.id } });
    assert.equal(fila?.email, null, "antes: 200 y el email seguía siendo ana@example.test");
    assert.equal(fila?.firstName, "Ana", "el resto no se tocó");
  } finally {
    await desmontar(escenario);
  }
});

test("M-10: updateContact con un email con valor sigue pasando por normalizeEmail (trim) — sin cambios", async () => {
  const escenario = await montar();
  try {
    const creado = await createContact(escenario.orgId, escenario.userId, {
      firstName: "Ana",
      lastName: "Pérez",
    });

    await updateContact(escenario.orgId, escenario.userId, creado.id, {
      email: "  ana@example.test  ",
    });

    const fila = await prisma.contact.findUnique({ where: { id: creado.id } });
    assert.equal(fila?.email, "ana@example.test");
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// phone / jobTitle / source — solo schema, el service ya los pasaba tal cual
// ---------------------------------------------------------------------------

test("M-10: updateContact con phone/jobTitle/source en null los deja NULL en la base", async () => {
  const escenario = await montar();
  try {
    const creado = await createContact(escenario.orgId, escenario.userId, {
      firstName: "Ana",
      lastName: "Pérez",
      phone: "+54 341 555-0000",
      jobTitle: "CTO",
      source: "landing",
    });
    const antes = await prisma.contact.findUnique({ where: { id: creado.id } });
    assert.deepEqual(
      { phone: antes?.phone, jobTitle: antes?.jobTitle, source: antes?.source },
      { phone: "+54 341 555-0000", jobTitle: "CTO", source: "landing" },
      "setup: los tres campos tienen valor antes del PATCH",
    );

    const devuelto = await updateContact(escenario.orgId, escenario.userId, creado.id, {
      phone: null,
      jobTitle: null,
      source: null,
    });
    assert.equal(devuelto.phone, null);
    assert.equal(devuelto.jobTitle, null);
    assert.equal(devuelto.source, null);

    const despues = await prisma.contact.findUnique({ where: { id: creado.id } });
    assert.ok(despues);
    assert.equal(despues.phone, null);
    assert.equal(despues.jobTitle, null);
    assert.equal(despues.source, null);
    assert.equal(despues.lastName, "Pérez", "el resto no se tocó");
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// companyId — antes no admitía null en ningún lado: un contacto no se podía
// desvincular de su empresa
// ---------------------------------------------------------------------------

test("M-10: updateContact con companyId: null desvincula al contacto (companyId NULL en la base)", async () => {
  const escenario = await montar();
  try {
    const creado = await createContact(escenario.orgId, escenario.userId, {
      firstName: "Ana",
      lastName: "Pérez",
      companyId: escenario.companyId,
    });
    assert.equal(creado.companyId, escenario.companyId, "setup: vinculado a una Company real");

    const devuelto = await updateContact(escenario.orgId, escenario.userId, creado.id, {
      companyId: null,
    });
    assert.equal(devuelto.companyId, null);

    const fila = await prisma.contact.findUnique({ where: { id: creado.id } });
    assert.equal(
      fila?.companyId,
      null,
      "antes: `if (input.companyId)` trataba null como 'no vino'",
    );
  } finally {
    await desmontar(escenario);
  }
});

test("M-10: updateContact con companyId de una Company real de la organización sigue vinculando — sin cambios", async () => {
  const escenario = await montar();
  try {
    const creado = await createContact(escenario.orgId, escenario.userId, {
      firstName: "Ana",
      lastName: "Pérez",
    });
    assert.equal(creado.companyId, null, "setup: sin empresa");

    const devuelto = await updateContact(escenario.orgId, escenario.userId, creado.id, {
      companyId: escenario.companyId,
    });
    assert.equal(devuelto.companyId, escenario.companyId);

    const fila = await prisma.contact.findUnique({ where: { id: creado.id } });
    assert.equal(fila?.companyId, escenario.companyId);
  } finally {
    await desmontar(escenario);
  }
});

test("M-10: updateContact con companyId inexistente o de OTRA organización sigue dando 400 y no toca el vínculo — sin cambios", async () => {
  const escenario = await montar();
  try {
    const creado = await createContact(escenario.orgId, escenario.userId, {
      firstName: "Ana",
      lastName: "Pérez",
      companyId: escenario.companyId,
    });

    await assert.rejects(
      () =>
        updateContact(escenario.orgId, escenario.userId, creado.id, {
          companyId: randomUUID(),
        }),
      (err: unknown) => assertAppError(err, 400),
    );

    await assert.rejects(
      () =>
        updateContact(escenario.orgId, escenario.userId, creado.id, {
          companyId: escenario.companyDeOtraOrgId,
        }),
      (err: unknown) => assertAppError(err, 400),
    );

    const fila = await prisma.contact.findUnique({ where: { id: creado.id } });
    assert.equal(fila?.companyId, escenario.companyId, "el vínculo original sigue intacto");
  } finally {
    await desmontar(escenario);
  }
});

test("M-10: updateContact SIN companyId en el input no toca el vínculo (undefined ≠ null)", async () => {
  const escenario = await montar();
  try {
    const creado = await createContact(escenario.orgId, escenario.userId, {
      firstName: "Ana",
      lastName: "Pérez",
      companyId: escenario.companyId,
    });

    await updateContact(escenario.orgId, escenario.userId, creado.id, { jobTitle: "CEO" });

    const fila = await prisma.contact.findUnique({ where: { id: creado.id } });
    assert.equal(fila?.companyId, escenario.companyId, "no venir no es lo mismo que venir en null");
    assert.equal(fila?.jobTitle, "CEO");
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// qualifyLead — paso 3 del módulo de Agentes de IA. Contra Postgres real
// porque lo que importa es lo que QUEDA en la fila: que notes se agregue,
// que aiData se mergee, y que lifecycleStage/customFields no se muevan.
// ---------------------------------------------------------------------------

const HOY = new Date().toISOString().slice(0, 10);

test("qualifyLead: escribe solo los campos que vienen y devuelve el contacto actualizado", async () => {
  const escenario = await montar();
  try {
    const creado = await createContact(escenario.orgId, escenario.userId, {
      firstName: "Ana",
      lastName: "Pérez",
    });

    const calificado = await qualifyLead(escenario.orgId, creado.id, {
      score: 70,
      intent: "comprar un auto usado",
      urgency: "HIGH",
      budgetAmount: 15000,
      budgetCurrency: "USD",
    });

    assert.equal(calificado.leadScore, 70);
    assert.equal(calificado.leadIntent, "comprar un auto usado");
    assert.equal(calificado.leadUrgency, "HIGH");
    assert.equal(Number(calificado.leadBudgetAmount), 15000);
    assert.equal(calificado.leadBudgetCurrency, "USD");
    // Lo que no vino sigue en NULL.
    assert.equal(calificado.leadServiceOfInterest, null);
    assert.equal(calificado.leadLocation, null);
    assert.equal(calificado.leadNotes, null);
    assert.equal(calificado.leadAiData, null);

    // Una segunda calificación pisa lo que trae y conserva lo demás:
    // idempotente, sin distinción create/update.
    const otraVez = await qualifyLead(escenario.orgId, creado.id, {
      score: 85,
      location: "Pocitos",
    });
    assert.equal(otraVez.leadScore, 85);
    assert.equal(otraVez.leadLocation, "Pocitos");
    assert.equal(otraVez.leadIntent, "comprar un auto usado", "no se toca lo que no vino");
  } finally {
    await desmontar(escenario);
  }
});

test("qualifyLead: leadNotes se AGREGA con marcador de fecha — sobre null y sobre notas existentes", async () => {
  const escenario = await montar();
  try {
    const creado = await createContact(escenario.orgId, escenario.userId, {
      firstName: "Ana",
      lastName: "Pérez",
    });

    const primera = await qualifyLead(escenario.orgId, creado.id, {
      notes: "  Prefiere automático  ",
    });
    assert.equal(primera.leadNotes, `[${HOY}] Prefiere automático`);

    const segunda = await qualifyLead(escenario.orgId, creado.id, {
      notes: "Duda entre dos modelos",
    });
    assert.equal(
      segunda.leadNotes,
      `[${HOY}] Prefiere automático\n[${HOY}] Duda entre dos modelos`,
      "la nota anterior se conserva íntegra",
    );

    // Una nota vacía no agrega una línea vacía ni pisa nada.
    const vacia = await qualifyLead(escenario.orgId, creado.id, { notes: "   ", score: 10 });
    assert.equal(vacia.leadNotes, segunda.leadNotes);
    assert.equal(vacia.leadScore, 10);
  } finally {
    await desmontar(escenario);
  }
});

test("qualifyLead: leadAiData se mergea superficialmente — claves nuevas pisan, el resto se conserva", async () => {
  const escenario = await montar();
  try {
    const creado = await createContact(escenario.orgId, escenario.userId, {
      firstName: "Ana",
      lastName: "Pérez",
    });

    const primera = await qualifyLead(escenario.orgId, creado.id, {
      aiData: { color: "rojo", puertas: 4, extras: { techo: true } },
    });
    assert.deepEqual(primera.leadAiData, { color: "rojo", puertas: 4, extras: { techo: true } });

    const segunda = await qualifyLead(escenario.orgId, creado.id, {
      aiData: { color: "negro", extras: { gps: true } },
    });
    // Superficial: `extras` se reemplaza entero (no se mergea adentro), `puertas` sobrevive.
    assert.deepEqual(segunda.leadAiData, { color: "negro", puertas: 4, extras: { gps: true } });

    // Si lo guardado no es un objeto (escrito por otra vía), el nuevo va tal cual.
    await prisma.contact.update({ where: { id: creado.id }, data: { leadAiData: "texto suelto" } });
    const tercera = await qualifyLead(escenario.orgId, creado.id, { aiData: { color: "gris" } });
    assert.deepEqual(tercera.leadAiData, { color: "gris" });
  } finally {
    await desmontar(escenario);
  }
});

test("qualifyLead: NUNCA toca lifecycleStage ni customFields ni el resto de Contact", async () => {
  const escenario = await montar();
  try {
    const creado = await createContact(escenario.orgId, escenario.userId, {
      firstName: "Ana",
      lastName: "Pérez",
      email: "ana@example.test",
      companyId: escenario.companyId,
    });
    await prisma.contact.update({
      where: { id: creado.id },
      data: { lifecycleStage: "CUSTOMER", customFields: { tratamiento: "ortodoncia" } },
    });

    await qualifyLead(escenario.orgId, creado.id, {
      score: 99,
      intent: "x",
      serviceOfInterest: "y",
      urgency: "LOW",
      budgetAmount: 1,
      budgetCurrency: "UYU",
      location: "z",
      notes: "n",
      aiData: { k: "v" },
    });

    const fila = await prisma.contact.findUniqueOrThrow({ where: { id: creado.id } });
    assert.equal(fila.lifecycleStage, "CUSTOMER", "decisión humana, no del agente");
    assert.deepEqual(fila.customFields, { tratamiento: "ortodoncia" });
    assert.equal(fila.email, "ana@example.test");
    assert.equal(fila.companyId, escenario.companyId);
    assert.equal(fila.ownerId, escenario.userId);
    assert.equal(fila.firstName, "Ana");
  } finally {
    await desmontar(escenario);
  }
});

test("qualifyLead: 404 sobre un contacto de OTRA organización, uno inexistente y uno borrado — y nada cambia", async () => {
  const escenario = await montar();
  try {
    const creado = await createContact(escenario.orgId, escenario.userId, {
      firstName: "Ana",
      lastName: "Pérez",
    });

    // Otra organización intenta calificarlo.
    const ajeno = await qualifyLead(escenario.otraOrgId, creado.id, { score: 1 }).catch(
      (err: unknown) => err,
    );
    assertAppError(ajeno, 404);

    const inexistente = await qualifyLead(escenario.orgId, randomUUID(), { score: 1 }).catch(
      (err: unknown) => err,
    );
    assertAppError(inexistente, 404);

    await prisma.contact.update({ where: { id: creado.id }, data: { deletedAt: new Date() } });
    const borrado = await qualifyLead(escenario.orgId, creado.id, { score: 1 }).catch(
      (err: unknown) => err,
    );
    assertAppError(borrado, 404);

    const fila = await prisma.contact.findUniqueOrThrow({ where: { id: creado.id } });
    assert.equal(fila.leadScore, null);
  } finally {
    await desmontar(escenario);
  }
});
