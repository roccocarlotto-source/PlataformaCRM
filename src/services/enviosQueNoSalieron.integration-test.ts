import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { listarEnviosQueNoSalieron } from "./enviosQueNoSalieron.service";

// ---------------------------------------------------------------------------
// La lista "Envíos que no salieron" (enviosQueNoSalieron.service.ts) contra
// Postgres real, con cupones (que tienen sede) y automatizaciones
// (sin sede).
//
//   1. ADMIN sin filtro: todo, del más reciente al más viejo, con el motivo
//      traducido y sin los que no fallaron.
//   2. ADMIN con una sede: solo esa sede; lo que no tiene sede queda afuera.
//   3. RECEPCION de clínica: solo sus sedes, aunque pida otra.
//   4. Un contacto borrado no se muestra ni se linkea.
//   5. Paginación sobre la lista mezclada.
//   6. Otra organización no ve nada de esta.
// ---------------------------------------------------------------------------

let orgId: string;
let otraOrgId: string;
let sedeA: string;
let sedeB: string;
let automationId: string;
let ana: string;
let beto: string;
let borrado: string;

const ADMIN = { role: "ADMIN" as const, industry: "CLINICA" as const };

let pipelineId: string;
let stageId: string;
let vendedorId: string;
let authId: string | undefined;

async function cuponFallido(
  contactId: string,
  branchId: string,
  minutosAtras: number,
  status = "FAILED",
) {
  const opp = await prisma.opportunity.create({
    data: {
      organizationId: orgId,
      title: "Venta",
      pipelineId,
      stageId,
      contactId,
      ownerId: vendedorId,
    },
  });
  return prisma.discountVoucherFollowUp.create({
    data: {
      organizationId: orgId,
      automationId,
      opportunityId: opp.id,
      contactId,
      branchId,
      label: "10% off",
      expiresInDays: 30,
      scheduledFor: new Date(),
      nextAttemptAt: new Date(),
      status: status as "FAILED",
      lastError: "WhatsApp Graph API returned 400: (#100) Invalid parameter",
      updatedAt: new Date(Date.now() - minutosAtras * 60_000),
    },
  });
}

before(async () => {
  process.env.LOG_LEVEL = "fatal";
  const org = await prisma.organization.create({
    data: {
      name: `Envios ${randomUUID()}`,
      slug: `envios-ns-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  orgId = org.id;
  otraOrgId = (
    await prisma.organization.create({
      data: {
        name: `Envios otra ${randomUUID()}`,
        slug: `envios-ns-${Date.now()}-${randomUUID().slice(0, 8)}`,
      },
    })
  ).id;
  sedeA = (await prisma.branch.create({ data: { organizationId: orgId, name: "Centro" } })).id;
  sedeB = (await prisma.branch.create({ data: { organizationId: orgId, name: "Pocitos" } })).id;
  pipelineId = (await prisma.pipeline.create({ data: { organizationId: orgId, name: "Ventas" } }))
    .id;
  stageId = (
    await prisma.stage.create({
      data: { organizationId: orgId, pipelineId, name: "Nuevo", order: 0 },
    })
  ).id;
  const email = `envios-ns-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data: auth, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password: "Envios-ns-test-123!",
    email_confirm: true,
  });
  if (error || !auth.user)
    throw new Error(`No se pudo crear el usuario de Auth: ${error?.message}`);
  authId = auth.user.id;
  const rol = await prisma.role.findFirstOrThrow({ where: { name: "USER" } });
  vendedorId = (
    await prisma.user.create({
      data: { id: authId, organizationId: orgId, roleId: rol.id, email, fullName: "Vendedor" },
    })
  ).id;
  automationId = (
    await prisma.automation.create({
      data: {
        organizationId: orgId,
        name: "Recordar service",
        triggerType: "test.trigger",
        actionType: "test.accion",
        actionConfig: {},
      },
    })
  ).id;
  const contacto = async (nombre: string) =>
    (
      await prisma.contact.create({
        data: { organizationId: orgId, firstName: nombre, lastName: "Prueba" },
      })
    ).id;
  ana = await contacto("Ana");
  beto = await contacto("Beto");
  borrado = await contacto("Borrado");

  await cuponFallido(ana, sedeA, 10);
  await cuponFallido(beto, sedeB, 20);
  await cuponFallido(borrado, sedeA, 30);
  await prisma.contact.update({ where: { id: borrado }, data: { deletedAt: new Date() } });
  // Uno que no falló: no aparece.
  await cuponFallido(ana, sedeA, 5, "PENDING");
  // Una automatización muerta, sin sede, la más reciente.
  await prisma.outboxEvent.create({
    data: {
      organizationId: orgId,
      eventType: "test.evento",
      payload: { contactId: beto },
      status: "DEAD_LETTER",
      lastError: `1 de 1 automatizaciones fallaron para el evento ${randomUUID()}`,
    },
  });
});

after(async () => {
  if (authId) await getSupabaseAdmin().auth.admin.deleteUser(authId);
  for (const id of [orgId, otraOrgId].filter(Boolean)) {
    await prisma.outboxEvent.deleteMany({ where: { organizationId: id } });
    await prisma.discountVoucherFollowUp.deleteMany({ where: { organizationId: id } });
    await prisma.opportunity.deleteMany({ where: { organizationId: id } });
    await prisma.stage.deleteMany({ where: { organizationId: id } });
    await prisma.pipeline.deleteMany({ where: { organizationId: id } });
    await prisma.user.deleteMany({ where: { organizationId: id } });
    await prisma.automation.deleteMany({ where: { organizationId: id } });
    await prisma.contact.deleteMany({ where: { organizationId: id } });
    await prisma.branch.deleteMany({ where: { organizationId: id } });
    await prisma.organization.delete({ where: { id } });
  }
});

test("1. ADMIN sin filtro: todo, del más reciente al más viejo, con el motivo traducido", async () => {
  const { data, pagination } = await listarEnviosQueNoSalieron(orgId, ADMIN, {
    page: 1,
    pageSize: 20,
  });

  assert.equal(pagination.total, 4);
  assert.deepEqual(
    data.map((e) => e.tipo),
    ["AUTOMATIZACION", "CUPON", "CUPON", "CUPON"],
  );
  assert.deepEqual(data[0].contacto, { id: beto, nombre: "Beto Prueba" });
  assert.equal(data[0].sede, null);
  assert.equal(data[0].motivo, "La automatización falló después de varios intentos");
  assert.deepEqual(data[1].sede, { id: sedeA, nombre: "Centro" });
  assert.equal(data[1].motivo, "WhatsApp rechazó el envío");
  assert.ok(!JSON.stringify(data).includes("Graph API"), "nunca el error crudo");
});

test("2. ADMIN con una sede: solo esa sede, sin lo que no tiene sede", async () => {
  const { data } = await listarEnviosQueNoSalieron(orgId, ADMIN, {
    page: 1,
    pageSize: 20,
    branchId: sedeB,
  });

  assert.deepEqual(
    data.map((e) => e.contacto?.id),
    [beto],
  );
});

test("3. RECEPCION: solo sus sedes, aunque pida otra", async () => {
  const recepcion = { role: "RECEPCION" as const, industry: "CLINICA" as const, sedes: [sedeA] };

  const propias = await listarEnviosQueNoSalieron(orgId, recepcion, { page: 1, pageSize: 20 });
  assert.ok(propias.data.every((e) => e.sede?.id === sedeA));
  assert.equal(propias.data.length, 2);

  const ajena = await listarEnviosQueNoSalieron(orgId, recepcion, {
    page: 1,
    pageSize: 20,
    branchId: sedeB,
  });
  assert.equal(ajena.data.length, 0);
  assert.equal(ajena.pagination.total, 0);
});

test("4. un contacto borrado no se muestra ni se linkea", async () => {
  const { data } = await listarEnviosQueNoSalieron(orgId, ADMIN, { page: 1, pageSize: 20 });
  const ultimo = data.at(-1);
  assert.equal(ultimo?.contacto, null);
  assert.ok(!JSON.stringify(data).includes("Borrado"));
});

test("5. paginación sobre la lista mezclada", async () => {
  const pagina2 = await listarEnviosQueNoSalieron(orgId, ADMIN, { page: 2, pageSize: 3 });

  assert.equal(pagina2.data.length, 1);
  assert.equal(pagina2.pagination.totalPages, 2);
  assert.equal(pagina2.data[0].contacto, null, "el más viejo: el del contacto borrado");
});

test("6. otra organización no ve nada de esta", async () => {
  const { data, pagination } = await listarEnviosQueNoSalieron(otraOrgId, ADMIN, {
    page: 1,
    pageSize: 20,
  });
  assert.equal(data.length, 0);
  assert.equal(pagination.total, 0);
});
