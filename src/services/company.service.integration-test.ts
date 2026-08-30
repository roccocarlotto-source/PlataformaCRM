import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";
import { createCompany, updateCompany } from "./company.service";

// M-10 (docs/auditoria-2026-08-29.md) — PATCH no podía vaciar los campos
// opcionales de Company. El bug vivía SOLO en el schema del controller
// (company.controller.test.ts lo cubre); service y repositorio ya tipaban
// `string | null` y pasaban el valor tal cual. Este archivo prueba que, con
// el schema abierto, un `null` explícito llega HASTA POSTGRES y queda como
// NULL — no que el service "lo acepte" en memoria.
//
// Mismo estilo que pipeline.service.integration-test.ts: service + repositorio
// + Prisma reales contra la base, sin Express. Company tiene owner_id NOT NULL
// hacia users, y users.email lo completa un trigger que lee auth.users, así
// que hace falta una identidad real de Supabase Auth — mismo motivo que en
// soft-delete-restrict.integration-test.ts.

interface Escenario {
  orgId: string;
  userId: string;
  authId: string;
}

async function montar(): Promise<Escenario> {
  const adminRole = await findRoleByName("ADMIN");
  if (!adminRole) {
    throw new Error("No está sembrado el rol ADMIN. Abortando.");
  }

  const org = await prisma.organization.create({
    data: { name: `M-10 company ${randomUUID()}`, slug: `m10-company-${randomUUID()}` },
  });

  const email = `m10-company-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
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
      fullName: "M-10 company",
    },
  });

  return { orgId: org.id, userId: user.id, authId: data.user.id };
}

async function desmontar(escenario: Escenario) {
  await prisma.company.deleteMany({ where: { organizationId: escenario.orgId } });
  await prisma.user.deleteMany({ where: { organizationId: escenario.orgId } });
  await prisma.organization.delete({ where: { id: escenario.orgId } });
  await getSupabaseAdmin().auth.admin.deleteUser(escenario.authId);
}

const CON_VALOR = {
  domain: "acme.com",
  industry: "Software",
  phone: "+54 341 555-0000",
  city: "Rosario",
  country: "Argentina",
};

test("M-10: updateCompany con domain/industry/phone/city/country en null los deja NULL en la base", async () => {
  const escenario = await montar();
  try {
    const creada = await createCompany(escenario.orgId, escenario.userId, {
      name: "Acme",
      ...CON_VALOR,
    });
    const antes = await prisma.company.findUnique({ where: { id: creada.id } });
    assert.deepEqual(
      {
        domain: antes?.domain,
        industry: antes?.industry,
        phone: antes?.phone,
        city: antes?.city,
        country: antes?.country,
      },
      CON_VALOR,
      "setup: los cinco campos tienen valor antes del PATCH",
    );

    const devuelta = await updateCompany(escenario.orgId, escenario.userId, creada.id, {
      domain: null,
      industry: null,
      phone: null,
      city: null,
      country: null,
    });
    assert.equal(devuelta.domain, null);
    assert.equal(devuelta.industry, null);
    assert.equal(devuelta.phone, null);
    assert.equal(devuelta.city, null);
    assert.equal(devuelta.country, null);

    const despues = await prisma.company.findUnique({ where: { id: creada.id } });
    assert.ok(despues);
    assert.equal(
      despues.domain,
      null,
      "domain tiene que ser NULL en la base, no el valor anterior",
    );
    assert.equal(despues.industry, null);
    assert.equal(despues.phone, null);
    assert.equal(despues.city, null);
    assert.equal(despues.country, null);
    assert.equal(despues.name, "Acme", "name no se tocó");
    assert.equal(despues.ownerId, escenario.userId, "ownerId no se tocó");
  } finally {
    await desmontar(escenario);
  }
});

test("M-10: updateCompany con UN solo campo en null vacía ese y deja el resto intacto", async () => {
  const escenario = await montar();
  try {
    const creada = await createCompany(escenario.orgId, escenario.userId, {
      name: "Acme",
      ...CON_VALOR,
    });

    await updateCompany(escenario.orgId, escenario.userId, creada.id, { phone: null });

    const despues = await prisma.company.findUnique({ where: { id: creada.id } });
    assert.ok(despues);
    assert.equal(despues.phone, null);
    assert.equal(despues.domain, CON_VALOR.domain);
    assert.equal(despues.industry, CON_VALOR.industry);
    assert.equal(despues.city, CON_VALOR.city);
    assert.equal(despues.country, CON_VALOR.country);
  } finally {
    await desmontar(escenario);
  }
});

// Comportamiento existente, sin cambios, fijado con test: crear SIN esos
// campos los deja NULL (el `?? null` de createCompany), y el rechazo de un
// `null` explícito en create vive en createCompanySchema —
// company.controller.test.ts—, no acá: el service no lo ve nunca.
test("M-10: createCompany sin los campos opcionales los deja NULL (sin cambios)", async () => {
  const escenario = await montar();
  try {
    const creada = await createCompany(escenario.orgId, escenario.userId, { name: "Solo nombre" });
    const fila = await prisma.company.findUnique({ where: { id: creada.id } });
    assert.ok(fila);
    assert.equal(fila.domain, null);
    assert.equal(fila.industry, null);
    assert.equal(fila.phone, null);
    assert.equal(fila.city, null);
    assert.equal(fila.country, null);
  } finally {
    await desmontar(escenario);
  }
});
