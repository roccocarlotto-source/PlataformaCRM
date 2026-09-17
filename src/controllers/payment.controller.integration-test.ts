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
import { paymentRouter } from "../routes/payment.routes";

// ---------------------------------------------------------------------------
// /api/payments por HTTP real (§43 de docs/frontend-cambios-pendientes.md):
// router real con authenticate/authorize, contra Postgres y GoTrue reales.
// Mismo patrón que quote.controller.integration-test.ts.
//
// Lo que este archivo prueba y el del service no puede: la cadena de
// middlewares (lectura para cualquier autenticado, escritura y DELETE solo
// ADMIN), la forma del JSON (Decimal como string, fecha sola) y que la moneda
// del body no llega: la pone el service desde la oportunidad.
// ---------------------------------------------------------------------------

const PASSWORD = "Payment-test-password-123!";

interface FixtureUser {
  id: string;
  accessToken: string;
}

let orgId: string;
let admin: FixtureUser;
let user: FixtureUser;
let opportunityId: string;
let baseUrl: string;
let closeApp: () => Promise<void>;

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use("/api", paymentRouter);
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
  const email = `payment-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
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
      fullName: `Payment Test ${label}`,
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

interface PaymentBody {
  id: string;
  opportunityId: string;
  amount: string;
  currency: string;
  method: string;
  paidAt: string;
}

before(async () => {
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;

  const org = await prisma.organization.create({
    data: {
      name: `Payment HTTP test ${randomUUID()}`,
      slug: `payment-http-${Date.now()}-${randomUUID().slice(0, 8)}`,
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
  const opportunity = await prisma.opportunity.create({
    data: {
      organizationId: orgId,
      ownerId: admin.id,
      pipelineId: pipeline.id,
      stageId: stage.id,
      companyId: company.id,
      title: "Corolla para Ana",
      amount: 25_000,
      currency: "UYU",
    },
  });
  opportunityId = opportunity.id;
});

after(async () => {
  if (closeApp) await closeApp();
  if (!orgId) return;
  const where = { organizationId: orgId };
  await prisma.payment.deleteMany({ where });
  await prisma.opportunity.deleteMany({ where });
  await prisma.company.deleteMany({ where });
  await prisma.stage.deleteMany({ where });
  await prisma.pipeline.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.organization.delete({ where: { id: orgId } });
  for (const u of [admin, user]) {
    if (u) await getSupabaseAdmin().auth.admin.deleteUser(u.id);
  }
});

test("POST /api/payments como ADMIN: 201, la moneda sale de la oportunidad y el monto viaja como string", async () => {
  const res = await send("POST", "/api/payments", admin.accessToken, {
    opportunityId,
    amount: 5000.5,
    method: "TRANSFER",
    paidAt: "2026-09-16",
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as PaymentBody;
  assert.equal(body.currency, "UYU");
  assert.equal(typeof body.amount, "string");
  assert.equal(Number(body.amount), 5000.5);
  assert.equal(body.method, "TRANSFER");
  assert.equal(body.paidAt, "2026-09-16T00:00:00.000Z");

  // Mandar la moneda es 400, no una moneda elegida por el cliente.
  const conMoneda = await send("POST", "/api/payments", admin.accessToken, {
    opportunityId,
    amount: 1,
    method: "CASH",
    paidAt: "2026-09-16",
    currency: "USD",
  });
  assert.equal(conMoneda.status, 400);
});

test("GET /api/payments?opportunityId= como USER: 200 con el historial; sin opportunityId es 400", async () => {
  const res = await send("GET", `/api/payments?opportunityId=${opportunityId}`, user.accessToken);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: PaymentBody[]; pagination: { total: number } };
  assert.ok(body.data.length >= 1);
  assert.equal(body.pagination.total, body.data.length);

  const sinOportunidad = await send("GET", "/api/payments", user.accessToken);
  assert.equal(sinOportunidad.status, 400);
});

test("escritura como USER: POST, PATCH y DELETE son 403 y el pago no cambia", async () => {
  const creado = await send("POST", "/api/payments", admin.accessToken, {
    opportunityId,
    amount: 100,
    method: "CASH",
    paidAt: "2026-09-01",
  });
  const payment = (await creado.json()) as PaymentBody;

  const post = await send("POST", "/api/payments", user.accessToken, {
    opportunityId,
    amount: 1,
    method: "CASH",
    paidAt: "2026-09-01",
  });
  assert.equal(post.status, 403);
  const patch = await send("PATCH", `/api/payments/${payment.id}`, user.accessToken, {
    amount: 1,
  });
  assert.equal(patch.status, 403);
  const del = await send("DELETE", `/api/payments/${payment.id}`, user.accessToken);
  assert.equal(del.status, 403);

  const releido = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  assert.equal(releido.amount.toString(), "100");
});

test("PATCH y DELETE como ADMIN: editar devuelve el pago, opportunityId es 400, borrar es 204 y después 404", async () => {
  const creado = await send("POST", "/api/payments", admin.accessToken, {
    opportunityId,
    amount: 300,
    method: "CARD",
    paidAt: "2026-09-02",
  });
  const payment = (await creado.json()) as PaymentBody;

  const patch = await send("PATCH", `/api/payments/${payment.id}`, admin.accessToken, {
    amount: 350,
    paidAt: "2026-09-03",
  });
  assert.equal(patch.status, 200);
  const editado = (await patch.json()) as PaymentBody;
  assert.equal(Number(editado.amount), 350);
  assert.equal(editado.paidAt, "2026-09-03T00:00:00.000Z");
  assert.equal(editado.method, "CARD");

  const mover = await send("PATCH", `/api/payments/${payment.id}`, admin.accessToken, {
    opportunityId: randomUUID(),
  });
  assert.equal(mover.status, 400);

  const del = await send("DELETE", `/api/payments/${payment.id}`, admin.accessToken);
  assert.equal(del.status, 204);
  const leer = await send("GET", `/api/payments/${payment.id}`, admin.accessToken);
  assert.equal(leer.status, 404);
});
