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
import { quoteRouter } from "../routes/quote.routes";

// ---------------------------------------------------------------------------
// /api/quotes por HTTP real (§39 de docs/frontend-cambios-pendientes.md):
// router real con authenticate/authorize, contra Postgres y GoTrue reales.
// Mismo patrón que activity.controller.integration-test.ts.
//
// Lo que este archivo prueba y el del service no puede: la cadena de
// middlewares (lectura para cualquier autenticado, escritura ADMIN), que
// createdById sale del JWT y no del body, la forma del JSON (Decimal como
// string, activeQuoteId) y las dos formas excluyentes del PATCH. Las reglas
// de estado están en quote.service.integration-test.ts.
// ---------------------------------------------------------------------------

const PASSWORD = "Quote-test-password-123!";

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
  app.use("/api", quoteRouter);
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
  const email = `quote-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
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
      fullName: `Quote Test ${label}`,
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

interface QuoteBody {
  id: string;
  status: string;
  amount: string;
  createdById: string;
  createdBy: { id: string; fullName: string };
  lines: { description: string; amount: string }[];
}

before(async () => {
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;

  const org = await prisma.organization.create({
    data: {
      name: `Quote HTTP test ${randomUUID()}`,
      slug: `quote-http-${Date.now()}-${randomUUID().slice(0, 8)}`,
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
    },
  });
  opportunityId = opportunity.id;
});

after(async () => {
  if (closeApp) await closeApp();
  if (!orgId) return;
  const where = { organizationId: orgId };
  await prisma.quote.deleteMany({ where });
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

test("POST /api/quotes como ADMIN: 201, createdById sale del JWT (no del body) y los importes viajan como string", async () => {
  const res = await send("POST", "/api/quotes", admin.accessToken, {
    opportunityId,
    amount: 25000,
    currency: "USD",
    lines: [{ description: "Descuento contado", amount: -500 }],
    validUntil: "2099-12-31",
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as QuoteBody;
  assert.equal(body.status, "DRAFT");
  assert.equal(body.createdById, admin.id);
  assert.equal(body.createdBy.fullName, "Quote Test admin");
  assert.equal(typeof body.amount, "string");
  assert.equal(Number(body.amount), 25000);
  assert.deepEqual(body.lines, [{ description: "Descuento contado", amount: "-500.00" }]);

  // Un createdById en el body no es parte del schema: zod lo descarta en el
  // borde y el autor sigue siendo quien firma el JWT.
  const conAutor = await send("POST", "/api/quotes", admin.accessToken, {
    opportunityId,
    amount: 1,
    currency: "USD",
    createdById: user.id,
  });
  assert.equal(conAutor.status, 201);
  assert.equal(((await conAutor.json()) as QuoteBody).createdById, admin.id);
});

test("GET /api/quotes?opportunityId= como USER: 200 con el historial y activeQuoteId; sin opportunityId es 400", async () => {
  const res = await send("GET", `/api/quotes?opportunityId=${opportunityId}`, user.accessToken);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    data: QuoteBody[];
    activeQuoteId: string | null;
    pagination: { total: number };
  };
  assert.ok(body.data.length > 0);
  assert.equal(body.activeQuoteId, body.data[0].id);
  assert.equal(body.pagination.total, body.data.length);

  const sinOportunidad = await send("GET", "/api/quotes", user.accessToken);
  assert.equal(sinOportunidad.status, 400);
});

test("escritura como USER: POST y PATCH son 403 y no escriben nada", async () => {
  const antes = await prisma.quote.count({ where: { organizationId: orgId } });
  const post = await send("POST", "/api/quotes", user.accessToken, {
    opportunityId,
    amount: 1,
    currency: "USD",
  });
  assert.equal(post.status, 403);

  const activa = await prisma.quote.findFirstOrThrow({
    where: { organizationId: orgId, status: "DRAFT" },
  });
  const patch = await send("PATCH", `/api/quotes/${activa.id}`, user.accessToken, {
    status: "SENT",
  });
  assert.equal(patch.status, 403);

  assert.equal(await prisma.quote.count({ where: { organizationId: orgId } }), antes);
  assert.equal(
    (await prisma.quote.findUniqueOrThrow({ where: { id: activa.id } })).status,
    "DRAFT",
  );
});

test("PATCH como ADMIN: status y contenido juntos es 400; editar el borrador y enviarlo por separado funciona; editar la enviada es 409", async () => {
  const created = await send("POST", "/api/quotes", admin.accessToken, {
    opportunityId,
    amount: 24000,
    currency: "USD",
  });
  const quote = (await created.json()) as QuoteBody;

  const mezcla = await send("PATCH", `/api/quotes/${quote.id}`, admin.accessToken, {
    status: "SENT",
    amount: 23000,
  });
  assert.equal(mezcla.status, 400);

  const editada = await send("PATCH", `/api/quotes/${quote.id}`, admin.accessToken, {
    amount: 23000,
  });
  assert.equal(editada.status, 200);
  assert.equal(Number(((await editada.json()) as QuoteBody).amount), 23000);

  const enviada = await send("PATCH", `/api/quotes/${quote.id}`, admin.accessToken, {
    status: "SENT",
  });
  assert.equal(enviada.status, 200);
  assert.equal(((await enviada.json()) as QuoteBody).status, "SENT");

  const tarde = await send("PATCH", `/api/quotes/${quote.id}`, admin.accessToken, {
    amount: 1,
  });
  assert.equal(tarde.status, 409);
});
