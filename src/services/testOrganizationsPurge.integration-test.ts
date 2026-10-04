import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";
import { ejecutarPurga, simularPurga } from "./testOrganizationsPurge.service";
import { borrador, montar } from "./vehicle.test-helper";

// ---------------------------------------------------------------------------
// Purga de organizaciones de test contra Postgres real (Supabase local).
//
// ACOTADA A LOS FIXTURES con `alcance`: el script real corre sobre toda la
// base, y este test no puede borrar lo que otro archivo dejó. Pero `alcance`
// solo acota — las organizaciones que entran igual tienen que coincidir con un
// patrón y no estar protegidas, y eso es lo que se prueba:
//
//   A  veh-purga-...            coincide            -> se borra entera
//   B  purga-orgs-protegida-... coincide, protegida por id     -> intacta
//   C  purga-orgs-admin-...     coincide, tiene platform admin -> intacta
//   D  cliente-real-...         no coincide                    -> intacta
//
// A tiene un ciclo de FKs (opportunities.vehicle_id <-> vehicles.
// trade_in_opportunity_id) para probar que el orden calculado lo corta, y
// cuatro identidades de auth: una que se borra, una con email que no es .test,
// una invitada a otra organización y una invitación nunca aceptada. Y dos
// identidades sin ninguna organización: una .test (se borra) y una que no.
// ---------------------------------------------------------------------------

const sufijo = () => `${Date.now()}-${randomUUID().slice(0, 8)}`;

async function identidad(email: string): Promise<string> {
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`No se pudo crear ${email}: ${error?.message}`);
  return data.user.id;
}

async function existeIdentidad(id: string): Promise<boolean> {
  const filas = await prisma.$queryRawUnsafe<unknown[]>(
    "select 1 from auth.users where id = $1::uuid",
    id,
  );
  return filas.length > 0;
}

let fx: {
  a: string;
  b: string;
  c: string;
  d: string;
  borrable: string;
  noEsTest: string;
  enOtraOrg: string;
  invitado: string;
  adminDeB: string;
  adminDeC: string;
  huerfana: string;
  huerfanaNoTest: string;
};

before(async () => {
  const rol = await findRoleByName("ADMIN");
  if (!rol) throw new Error("No está sembrado el rol ADMIN. Abortando.");

  const e = await montar("purga");
  const a = e.organizationId;
  const [b, c, d] = await Promise.all(
    [
      `purga-orgs-protegida-${sufijo()}`,
      `purga-orgs-admin-${sufijo()}`,
      `cliente-real-${randomUUID().slice(0, 8)}`,
    ].map((slug) => prisma.organization.create({ data: { name: `Purga orgs ${slug}`, slug } })),
  ).then((orgs) => orgs.map((o) => o.id));

  const noEsTest = await identidad(`purga-${sufijo()}@example.com`);
  const enOtraOrg = await identidad(`purga-otra-${sufijo()}@example.test`);
  const invitado = await identidad(`purga-inv-${sufijo()}@example.test`);
  for (const id of [noEsTest, enOtraOrg]) {
    const { data } = await getSupabaseAdmin().auth.admin.getUserById(id);
    await prisma.user.create({
      data: { id, organizationId: a, roleId: rol.id, email: data.user?.email ?? "", fullName: "X" },
    });
  }
  const emailDe = async (id: string) =>
    (await getSupabaseAdmin().auth.admin.getUserById(id)).data.user?.email ?? "";
  const vence = new Date(Date.now() + 86_400_000);
  await prisma.invitation.create({
    data: {
      organizationId: a,
      email: await emailDe(invitado),
      roleId: rol.id,
      invitedById: e.userId,
      expiresAt: vence,
    },
  });

  // users.email lo completa un trigger desde auth.users: todo User necesita
  // su identidad.
  const usuario = async (organizationId: string, email: string) => {
    const id = await identidad(email);
    await prisma.user.create({
      data: { id, organizationId, roleId: rol.id, email, fullName: "X" },
    });
    return id;
  };

  // C: un platform admin.
  const adminDeC = await usuario(c, `purga-pa-${sufijo()}@example.test`);
  await prisma.platformAdmin.create({ data: { userId: adminDeC } });

  // B: una invitación al email de `enOtraOrg`, que es usuario de A.
  const adminDeB = await usuario(b, `purga-b-${sufijo()}@example.test`);
  await prisma.invitation.create({
    data: {
      organizationId: b,
      email: await emailDe(enOtraOrg),
      roleId: rol.id,
      invitedById: adminDeB,
      expiresAt: vence,
    },
  });

  // A: el ciclo opportunities <-> vehicles.
  const pipeline = await prisma.pipeline.create({ data: { organizationId: a, name: "Ventas" } });
  const stage = await prisma.stage.create({
    data: { organizationId: a, pipelineId: pipeline.id, name: "Nuevo", order: 1 },
  });
  const contacto = await prisma.contact.create({
    data: { organizationId: a, firstName: "Ana", lastName: "Compradora" },
  });
  const vehiculo = await borrador(e);
  const oportunidad = await prisma.opportunity.create({
    data: {
      organizationId: a,
      ownerId: e.userId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      contactId: contacto.id,
      title: "Corolla",
      vehicleId: vehiculo.id,
    },
  });
  await prisma.vehicle.update({
    where: { id: vehiculo.id },
    data: { tradeInOpportunityId: oportunidad.id },
  });

  fx = {
    a,
    b,
    c,
    d,
    borrable: e.authUserId,
    noEsTest,
    enOtraOrg,
    invitado,
    adminDeB,
    adminDeC,
    huerfana: await identidad(`purga-huerfana-${sufijo()}@example.test`),
    huerfanaNoTest: await identidad(`purga-huerfana-${sufijo()}@example.com`),
  };
});

after(async () => {
  if (!fx) return;
  await prisma.platformAdmin.deleteMany({ where: { userId: fx.adminDeC } });
  for (const org of [fx.b, fx.c, fx.d]) {
    await prisma.invitation.deleteMany({ where: { organizationId: org } });
    await prisma.user.deleteMany({ where: { organizationId: org } });
    await prisma.organization.deleteMany({ where: { id: org } });
  }
  // Si la purga falló a mitad, A puede seguir ahí: se reintenta con la misma
  // purga (B, C y D ya no existen, así que no hay nada más que alcanzar).
  await ejecutarPurga(prisma, {
    protegidas: [fx.b],
    alcance: { organizaciones: [fx.a], identidades: [] },
  }).catch(() => undefined);
  for (const id of [
    fx.huerfana,
    fx.huerfanaNoTest,
    fx.borrable,
    fx.noEsTest,
    fx.enOtraOrg,
    fx.invitado,
    fx.adminDeB,
    fx.adminDeC,
  ]) {
    await getSupabaseAdmin()
      .auth.admin.deleteUser(id)
      .catch(() => undefined);
  }
});

const opciones = () => ({
  protegidas: [fx.b],
  alcance: {
    organizaciones: [fx.a, fx.b, fx.c, fx.d],
    identidades: [fx.huerfana, fx.huerfanaNoTest, fx.noEsTest, fx.enOtraOrg, fx.adminDeC],
  },
});

test("simulación: solo A, con sus filas e identidades, y sin escribir nada", async () => {
  const plan = await simularPurga(prisma, opciones());

  assert.deepEqual(
    plan.organizaciones.map((o) => o.id),
    [fx.a],
  );
  const a = plan.organizaciones[0];
  assert.ok(a.patrones.some((p) => p.origen === "src/services/vehicle.test-helper.ts"));
  assert.equal(a.filasPorTabla.users, 3);
  assert.equal(a.filasPorTabla.invitations, 1);
  assert.equal(a.filasPorTabla.vehicles, 1);
  assert.equal(a.filasPorTabla.opportunities, 1);
  assert.equal(a.filasPorTabla.stages, 1);
  assert.equal(a.filasPorTabla.branches, 1);
  assert.equal(a.filasPorTabla.contacts, 1);

  const destino = new Map(a.identidades.map((i) => [i.id, i]));
  assert.equal(destino.get(fx.borrable)?.seBorra, true);
  assert.equal(destino.get(fx.invitado)?.seBorra, true);
  assert.equal(destino.get(fx.invitado)?.vinculo, "invitado");
  assert.match(destino.get(fx.noEsTest)?.motivoParaConservarla ?? "", /no es de test/);
  assert.match(destino.get(fx.enOtraOrg)?.motivoParaConservarla ?? "", /otra organización/);

  const protegidas = new Map(plan.protegidas.map((p) => [p.id, p]));
  assert.equal(protegidas.get(fx.b)?.motivo, "PURGE_PROTECTED_ORG_IDS");
  assert.equal(protegidas.get(fx.b)?.coincidiaConUnPatron, true);
  assert.equal(protegidas.get(fx.c)?.motivo, "platform admin");
  assert.equal(protegidas.get(fx.c)?.coincidiaConUnPatron, true);

  // Solo la huérfana .test: las demás del alcance tienen organización o no
  // son de test.
  assert.deepEqual(
    plan.identidadesHuerfanas.map((i) => i.id),
    [fx.huerfana],
  );

  assert.ok(plan.fksQueSeAnulan.length > 0, "el ciclo vehicles <-> opportunities se corta");
  assert.equal(plan.puedeBorrarAuthUsers, true);

  // Read only de verdad: todo sigue ahí.
  assert.equal(await prisma.organization.count({ where: { id: fx.a } }), 1);
  assert.equal(await existeIdentidad(fx.borrable), true);
});

test("--confirm: borra A entera y sus identidades borrables; B, C, D y las otras identidades quedan", async () => {
  const { plan, resultados, huerfanasBorradas } = await ejecutarPurga(prisma, opciones());
  assert.equal(huerfanasBorradas, 1);
  assert.equal(await existeIdentidad(fx.huerfana), false);
  assert.equal(await existeIdentidad(fx.huerfanaNoTest), true);

  assert.deepEqual(
    resultados.map((r) => ({
      id: r.id,
      ok: r.ok,
      identidades: r.identidadesBorradas,
      error: r.error,
    })),
    [{ id: fx.a, ok: true, identidades: 2, error: undefined }],
  );

  for (const tabla of plan.tablasEnOrden) {
    const [{ n }] = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `select count(*)::int as n from "${tabla}" where organization_id = $1::uuid`,
      fx.a,
    );
    assert.equal(n, 0, `quedaron filas de A en ${tabla}`);
  }
  assert.equal(await prisma.organization.count({ where: { id: fx.a } }), 0);

  assert.equal(await existeIdentidad(fx.borrable), false);
  assert.equal(await existeIdentidad(fx.invitado), false);
  assert.equal(await existeIdentidad(fx.noEsTest), true);
  assert.equal(await existeIdentidad(fx.enOtraOrg), true);

  assert.equal(await prisma.organization.count({ where: { id: { in: [fx.b, fx.c, fx.d] } } }), 3);
  assert.equal(await prisma.invitation.count({ where: { organizationId: fx.b } }), 1);
  assert.equal(await prisma.platformAdmin.count({ where: { userId: fx.adminDeC } }), 1);
});
