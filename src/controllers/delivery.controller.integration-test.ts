import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import express from "express";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import { findRoleByName } from "../repositories/role.repository";
import { deliveryRouter } from "../routes/delivery.routes";
import { createBranch } from "../services/branch.service";
import { createOpportunity } from "../services/opportunity.service";
import { createVehicle } from "../services/vehicle.service";

// ---------------------------------------------------------------------------
// /api/deliveries por HTTP real (§40 de docs/frontend-cambios-pendientes.md):
// router real con authenticate/authorize, contra Postgres y GoTrue reales.
// Mismo patrón que quote.controller.integration-test.ts.
//
// Lo que este archivo prueba y el del service no puede: la cadena de
// middlewares (lectura para cualquier autenticado, escritura ADMIN), que
// deliveredById sale del JWT, la forma del JSON y las dos formas excluyentes
// del PATCH. Las reglas de estado, la creación automática y las carreras
// están en delivery.service.integration-test.ts.
// ---------------------------------------------------------------------------

const PASSWORD = "Delivery-test-password-123!";

interface FixtureUser {
  id: string;
  accessToken: string;
}

let orgId: string;
let admin: FixtureUser;
let user: FixtureUser;
let opportunityId: string;
let vehicleId: string;
let baseUrl: string;
let closeApp: () => Promise<void>;

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use("/api", deliveryRouter);
  app.use(notFound);
  app.use(errorHandler);

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function createFixtureUser(label: string, role: "ADMIN" | "USER"): Promise<FixtureUser> {
  const email = `delivery-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear usuario real de Supabase Auth (${label}): ${error?.message}`);
  }

  const roleRow = await findRoleByName(role);
  if (!roleRow) {
    throw new Error(`No está sembrado el rol ${role}. Abortando.`);
  }
  await prisma.user.create({
    data: {
      id: data.user.id,
      organizationId: orgId,
      roleId: roleRow.id,
      email,
      fullName: `Delivery Test ${label}`,
    },
  });

  const anonClient = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!);
  const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError || !signInData.session) {
    throw new Error(`No se pudo iniciar sesión real (${label}): ${signInError?.message}`);
  }
  return { id: data.user.id, accessToken: signInData.session.access_token };
}

function send(method: string, path: string, token: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

interface DeliveryBody {
  id: string;
  status: string;
  opportunityId: string;
  vehicleId: string | null;
  checklist: { label: string; checked: boolean }[];
  scheduledAt: string | null;
  deliveredAt: string | null;
  deliveredById: string | null;
  deliveredBy: { id: string; fullName: string } | null;
  vehicle: { id: string; status: string } | null;
}

before(async () => {
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;

  const org = await prisma.organization.create({
    data: {
      name: `Delivery HTTP test ${randomUUID()}`,
      slug: `delivery-http-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  orgId = org.id;
  admin = await createFixtureUser("admin", "ADMIN");
  user = await createFixtureUser("user", "USER");

  const pipeline = await prisma.pipeline.create({
    data: { organizationId: orgId, name: "Ventas" },
  });
  const stage = await prisma.stage.create({
    data: { organizationId: orgId, pipelineId: pipeline.id, name: "Contacto", order: 1 },
  });
  const company = await prisma.company.create({ data: { organizationId: orgId, name: "Cliente" } });
  const branch = await createBranch(orgId, { name: "Casa central", timezone: "UTC" });
  const vehicle = await createVehicle(orgId, {
    condition: "USED",
    make: "Toyota",
    model: "Corolla",
    year: 2022,
    branchId: branch.id,
  });
  vehicleId = vehicle.id;

  // Por el service real: ganada con unidad, así la entrega nace sola como en
  // la app.
  const opportunity = await createOpportunity(orgId, admin.id, {
    pipelineId: pipeline.id,
    stageId: stage.id,
    companyId: company.id,
    title: "Corolla para Ana",
    vehicleId: vehicle.id,
    status: "WON",
  });
  opportunityId = opportunity.id;
});

after(async () => {
  if (closeApp) await closeApp();
  if (!orgId) return;
  const where = { organizationId: orgId };
  await prisma.delivery.deleteMany({ where });
  await prisma.opportunity.deleteMany({ where });
  await prisma.outboxEvent.deleteMany({ where });
  await prisma.vehicleChangeLog.deleteMany({ where });
  await prisma.vehicle.deleteMany({ where });
  await prisma.branch.deleteMany({ where });
  await prisma.company.deleteMany({ where });
  await prisma.stage.deleteMany({ where });
  await prisma.pipeline.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.organization.delete({ where: { id: orgId } });
  for (const u of [admin, user]) {
    if (u) await getSupabaseAdmin().auth.admin.deleteUser(u.id);
  }
});

async function laEntrega(): Promise<DeliveryBody> {
  const res = await send("GET", `/api/deliveries?opportunityId=${opportunityId}`, user.accessToken);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: DeliveryBody[] };
  assert.equal(body.data.length, 1);
  return body.data[0];
}

test("GET /api/deliveries?opportunityId= como USER: 200 con la entrega que nació al ganar; sin opportunityId es 400", async () => {
  const delivery = await laEntrega();
  assert.equal(delivery.status, "PENDING");
  assert.equal(delivery.vehicleId, vehicleId);
  assert.equal(delivery.vehicle?.status, "SOLD");
  assert.equal(delivery.checklist.length, 5);
  assert.equal(delivery.deliveredBy, null);

  const porId = await send("GET", `/api/deliveries/${delivery.id}`, user.accessToken);
  assert.equal(porId.status, 200);
  assert.equal(((await porId.json()) as DeliveryBody).id, delivery.id);

  const sinOportunidad = await send("GET", "/api/deliveries", user.accessToken);
  assert.equal(sinOportunidad.status, 400);
});

test("escritura como USER: editar y confirmar son 403 y no escriben nada", async () => {
  const delivery = await laEntrega();

  const editar = await send("PATCH", `/api/deliveries/${delivery.id}`, user.accessToken, {
    scheduledAt: "2026-09-30",
  });
  assert.equal(editar.status, 403);
  const confirmar = await send("PATCH", `/api/deliveries/${delivery.id}`, user.accessToken, {
    status: "DELIVERED",
  });
  assert.equal(confirmar.status, 403);

  const releida = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
  assert.equal(releida.status, "PENDING");
  assert.equal(releida.scheduledAt, null);
});

test("PATCH como ADMIN: mezclar las dos formas es 400; editar y confirmar por separado funciona, deliveredById sale del JWT; después editar es 409", async () => {
  const delivery = await laEntrega();

  const mezcla = await send("PATCH", `/api/deliveries/${delivery.id}`, admin.accessToken, {
    status: "DELIVERED",
    scheduledAt: "2026-09-30",
  });
  assert.equal(mezcla.status, 400);

  const editada = await send("PATCH", `/api/deliveries/${delivery.id}`, admin.accessToken, {
    checklist: [
      { label: "Documentación de transferencia", checked: true },
      { label: "Patente provisoria", checked: false },
    ],
    scheduledAt: "2026-09-30",
  });
  assert.equal(editada.status, 200);
  const editadaBody = (await editada.json()) as DeliveryBody;
  assert.equal(editadaBody.scheduledAt, "2026-09-30T00:00:00.000Z");
  assert.equal(editadaBody.checklist.length, 2);

  // Un deliveredById en el body no es parte de ninguna forma: 400, y quién
  // confirmó sale siempre del JWT.
  const conAutor = await send("PATCH", `/api/deliveries/${delivery.id}`, admin.accessToken, {
    status: "DELIVERED",
    deliveredById: user.id,
  });
  assert.equal(conAutor.status, 400);

  const confirmada = await send("PATCH", `/api/deliveries/${delivery.id}`, admin.accessToken, {
    status: "DELIVERED",
  });
  assert.equal(confirmada.status, 200);
  const confirmadaBody = (await confirmada.json()) as DeliveryBody;
  assert.equal(confirmadaBody.status, "DELIVERED");
  assert.equal(confirmadaBody.deliveredById, admin.id);
  assert.equal(confirmadaBody.deliveredBy?.fullName, "Delivery Test admin");
  assert.ok(confirmadaBody.deliveredAt);
  assert.equal(confirmadaBody.vehicle?.status, "DELIVERED");

  const tarde = await send("PATCH", `/api/deliveries/${delivery.id}`, admin.accessToken, {
    scheduledAt: null,
  });
  assert.equal(tarde.status, 409);
  const otraVez = await send("PATCH", `/api/deliveries/${delivery.id}`, admin.accessToken, {
    status: "DELIVERED",
  });
  assert.equal(otraVez.status, 409);
});
