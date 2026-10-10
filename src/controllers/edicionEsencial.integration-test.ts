import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { app } from "../app";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";

// ---------------------------------------------------------------------------
// ESENCIAL de punta a punta (docs/ediciones.md §10, H1), contra la app REAL de
// app.ts: authenticate con JWT de GoTrue, el gate de módulos y todas las
// rutas, sin dobles. Es lo mismo que la prueba a mano en producción, en
// orden: el platform admin da de alta una organización ESENCIAL, su ADMIN
// fundador entra, usa lo que la edición tiene y no lo que no tiene, y al
// final el platform admin la sube a COMPLETA.
//
// Los tests dependen uno del anterior (comparten la organización): el runner
// de node:test los corre en orden dentro del archivo.
// ---------------------------------------------------------------------------

const PASSWORD = "Esencial-punta-a-punta-123!";
const TZ = "America/Montevideo";

let baseUrl: string;
let cerrarApp: () => Promise<void>;

// El platform admin: un usuario real de una organización COMPLETA cualquiera,
// en la allowlist platform_admins.
let plataformaOrgId: string;
let plataformaToken: string;
let plataformaUserId: string;

// Lo que crea el alta.
let orgId: string;
let adminId: string;
let adminToken: string;
let branchId: string;
let contactId: string;
let opportunityId: string;

const identidades: string[] = [];

async function iniciarSesion(email: string): Promise<string> {
  const anon = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw new Error(`signIn: ${error?.message}`);
  return data.session.access_token;
}

function api(token: string, metodo: string, ruta: string, cuerpo?: unknown) {
  return fetch(`${baseUrl}/api${ruta}`, {
    method: metodo,
    headers: {
      authorization: `Bearer ${token}`,
      ...(cuerpo === undefined ? {} : { "content-type": "application/json" }),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
}

async function json<T>(res: Response, esperado: number): Promise<T> {
  const texto = await res.text();
  assert.equal(res.status, esperado, texto);
  return (texto ? JSON.parse(texto) : undefined) as T;
}

before(async () => {
  await new Promise<void>((resolve) => {
    const server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      cerrarApp = () => new Promise((r) => server.close(() => r()));
      resolve();
    });
  });

  const rol = await findRoleByName("ADMIN");
  if (!rol) throw new Error("No está sembrado el rol ADMIN");
  const sufijo = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({
    data: { name: `Punta plataforma ${sufijo}`, slug: `punta-plataforma-${sufijo}` },
  });
  plataformaOrgId = org.id;
  const email = `punta-plataforma-${sufijo}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  identidades.push(data.user.id);
  plataformaUserId = data.user.id;
  await prisma.user.create({
    data: {
      id: data.user.id,
      organizationId: org.id,
      roleId: rol.id,
      email,
      fullName: "Plataforma",
    },
  });
  await prisma.platformAdmin.create({ data: { userId: data.user.id } });
  plataformaToken = await iniciarSesion(email);
});

after(async () => {
  try {
    for (const id of [orgId, plataformaOrgId].filter(Boolean)) {
      const where = { organizationId: id };
      await prisma.outboxEvent.deleteMany({ where });
      await prisma.delivery.deleteMany({ where });
      await prisma.opportunity.deleteMany({ where });
      await prisma.agent.deleteMany({ where });
      await prisma.contact.deleteMany({ where });
      await prisma.stage.deleteMany({ where });
      await prisma.pipeline.deleteMany({ where });
      await prisma.branch.deleteMany({ where });
      await prisma.invitation.deleteMany({ where });
      await prisma.user.deleteMany({ where });
      await prisma.organization.deleteMany({ where: { id } });
    }
    await prisma.platformAdmin.deleteMany({ where: { userId: plataformaUserId } });
    for (const id of identidades) await getSupabaseAdmin().auth.admin.deleteUser(id);
  } finally {
    await cerrarApp();
  }
});

test("1. el platform admin ve ESENCIAL entre las ediciones y da de alta una organización ESENCIAL", async () => {
  const ediciones = await json<{ editions: string[] }>(
    await api(plataformaToken, "GET", "/admin/organizations/editions"),
    200,
  );
  assert.deepEqual(ediciones.editions, ["COMPLETA", "ESENCIAL"]);

  const email = `esencial-punta-${randomUUID().slice(0, 8)}@example.test`;
  const creado = await json<{ organization: { id: string }; admin: { id: string } }>(
    await api(plataformaToken, "POST", "/admin/organizations", {
      organizationName: `Esencial Punta ${Date.now()}`,
      adminFullName: "Ana Pérez",
      adminEmail: email,
      edition: "ESENCIAL",
    }),
    201,
  );
  orgId = creado.organization.id;
  adminId = creado.admin.id;
  identidades.push(adminId);

  // La invitación se acepta poniendo contraseña (lo que hace la pantalla de
  // aceptar invitación); acá, con la API de admin de GoTrue.
  const { error } = await getSupabaseAdmin().auth.admin.updateUserById(adminId, {
    password: PASSWORD,
    email_confirm: true,
  });
  assert.equal(error, null);
  adminToken = await iniciarSesion(email);
});

test("2. /me del ADMIN fundador: ESENCIAL, sin empresas ni procesos de venta, con el dashboard de atención", async () => {
  const me = await json<{ edition: string; modulos: string[]; role: string }>(
    await api(adminToken, "GET", "/me"),
    200,
  );
  assert.equal(me.edition, "ESENCIAL");
  assert.equal(me.role, "ADMIN");
  for (const excluido of ["empresas", "procesos_de_venta", "cotizaciones", "pagos", "entregas"]) {
    assert.ok(!me.modulos.includes(excluido), excluido);
  }
  for (const incluido of ["contactos", "oportunidades", "agentes", "dashboard_atencion"]) {
    assert.ok(me.modulos.includes(incluido), incluido);
  }
});

test("3. lo que ESENCIAL no tiene responde 403 MODULO_NO_INCLUIDO", async () => {
  for (const ruta of ["/companies", "/pipelines", "/opportunities/dashboard-summary"]) {
    const res = await api(adminToken, "GET", ruta);
    const cuerpo = await res.text();
    assert.equal(res.status, 403, `${ruta}: ${cuerpo}`);
    assert.match(cuerpo, /MODULO_NO_INCLUIDO/, ruta);
  }
});

test("4. sucursal y contacto, sin empresa", async () => {
  branchId = (
    await json<{ id: string }>(
      await api(adminToken, "POST", "/branches", { name: "Centro", timezone: TZ }),
      201,
    )
  ).id;
  contactId = (
    await json<{ id: string }>(
      await api(adminToken, "POST", "/contacts", { firstName: "Juana", lastName: "Gómez" }),
      201,
    )
  ).id;
  const conEmpresa = await api(adminToken, "POST", "/contacts", {
    firstName: "Otro",
    lastName: "Contacto",
    companyId: randomUUID(),
  });
  assert.equal(conEmpresa.status, 400);
  assert.match(await conEmpresa.text(), /CAMPO_NO_INCLUIDO/);
});

test("5. oportunidad sin proceso: nace En curso, Vendida mueve la etapa, y pipelineId se rechaza", async () => {
  const conProceso = await api(adminToken, "POST", "/opportunities", {
    title: "Con proceso",
    contactId,
    pipelineId: randomUUID(),
    stageId: randomUUID(),
  });
  assert.equal(conProceso.status, 400);
  assert.match(await conProceso.text(), /CAMPO_NO_INCLUIDO/);

  const creada = await json<{ id: string; status: string; stageId: string }>(
    await api(adminToken, "POST", "/opportunities", {
      title: "Hilux para Juana",
      contactId,
      amount: 25000,
      currency: "USD",
    }),
    201,
  );
  opportunityId = creada.id;
  assert.equal(creada.status, "OPEN");
  const etapa = (id: string) => prisma.stage.findUniqueOrThrow({ where: { id } });
  assert.equal((await etapa(creada.stageId)).name, "En curso");

  const vendida = await json<{ status: string; stageId: string; actualCloseDate: string | null }>(
    await api(adminToken, "PATCH", `/opportunities/${opportunityId}`, { status: "WON" }),
    200,
  );
  assert.equal(vendida.status, "WON");
  assert.equal((await etapa(vendida.stageId)).name, "Vendida");
  assert.notEqual(vendida.actualCloseDate, null, "el servidor completa la fecha real");
});

test("6. agente: nace sin nivel e inactivo; no se activa sin elegir; elegido, queda activo con la fecha de elección", async () => {
  const agente = await json<{
    id: string;
    isActive: boolean;
    participation: string | null;
    participationChosenAt: string | null;
  }>(
    await api(adminToken, "POST", "/agents", {
      branchId,
      name: "Agente web",
      instructions: "Sos el agente de la sucursal.",
      guardrails: {},
      guardrailsText: "",
      channels: ["WEB"],
    }),
    201,
  );
  assert.equal(agente.participation, null);
  assert.equal(agente.participationChosenAt, null);
  assert.equal(agente.isActive, false);

  const sinNivel = await api(adminToken, "PATCH", `/agents/${agente.id}`, { isActive: true });
  assert.equal(sinNivel.status, 400, await sinNivel.text());

  const elegido = await json<{
    isActive: boolean;
    participation: string;
    participationChosenAt: string | null;
  }>(
    await api(adminToken, "PATCH", `/agents/${agente.id}`, {
      participation: "PRIMER_CONTACTO",
      isActive: true,
    }),
    200,
  );
  assert.equal(elegido.participation, "PRIMER_CONTACTO");
  assert.equal(elegido.isActive, true);
  assert.notEqual(elegido.participationChosenAt, null);
});

test("7. el dashboard de atención responde", async () => {
  const atencion = await json<{ conversacionesNuevas: { total: number } }>(
    await api(adminToken, "GET", "/dashboard/atencion?granularity=month"),
    200,
  );
  assert.equal(typeof atencion.conversacionesNuevas.total, "number");
});

test("8. el platform admin la sube a COMPLETA: aparecen procesos de venta y la oportunidad sigue en Vendida", async () => {
  await json(
    await api(plataformaToken, "PATCH", `/admin/organizations/${orgId}/edition`, {
      edition: "COMPLETA",
    }),
    200,
  );
  const me = await json<{ edition: string; modulos: string[] }>(
    await api(adminToken, "GET", "/me"),
    200,
  );
  assert.equal(me.edition, "COMPLETA");
  assert.ok(me.modulos.includes("procesos_de_venta"));

  const pipelines = await json<{ data: { name: string }[] }>(
    await api(adminToken, "GET", "/pipelines"),
    200,
  );
  assert.deepEqual(
    pipelines.data.map((p) => p.name),
    ["Ventas"],
  );
  const oportunidad = await json<{ status: string; pipelineId: string }>(
    await api(adminToken, "GET", `/opportunities/${opportunityId}`),
    200,
  );
  assert.equal(oportunidad.status, "WON");
  assert.equal((await api(adminToken, "GET", "/companies")).status, 200);
});
