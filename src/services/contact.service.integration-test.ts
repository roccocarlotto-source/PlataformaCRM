import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";
import { AppError } from "../utils/AppError";
import { createContact, updateContact } from "./contact.service";

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
