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
import { activityRouter } from "../routes/activity.routes";

// ---------------------------------------------------------------------------
// §25 (docs/frontend-cambios-pendientes.md) — GET /api/activities y GET
// /api/activities/:id por HTTP real contra una app Express real, montando el
// router real con su authenticate, contra Postgres y GoTrue reales. Mismo
// patrón que organization.controller.integration-test.ts.
//
// Lo que este archivo prueba y el test del service no puede: que el
// controller arma el actor desde req.auth (el JWT) y NO desde la query. La
// regla en sí (USER solo ve lo asignado a sí mismo, ADMIN todo) ya está
// cubierta en activity.service.test.ts (pura) y
// activity.service.integration-test.ts (filas reales).
//
//   1. USER con ?assigneeId=<otra persona> recibe solo lo suyo.
//   2. USER sin filtro recibe solo lo suyo.
//   3. USER pidiendo por id una ajena: 404 con el mismo mensaje que un id
//      inexistente; la propia: 200.
//   4. ADMIN sin cambios: filtrar por el assigneeId de cualquier persona
//      devuelve lo pedido, y cualquier id se lee.
// ---------------------------------------------------------------------------

const PASSWORD = "Act-test-password-123!";

interface FixtureUser {
  id: string;
  accessToken: string;
}

let orgId: string;
let admin: FixtureUser;
let user: FixtureUser;
let other: FixtureUser;
let propiaId: string;
let ajenaId: string;
let baseUrl: string;
let closeApp: () => Promise<void>;

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use("/api", activityRouter);
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

async function createFixtureUser(
  label: string,
  organizationId: string,
  role: "ADMIN" | "USER",
): Promise<FixtureUser> {
  const email = `act-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;

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
      organizationId,
      roleId: roleRow.id,
      email,
      fullName: `Act Test ${label}`,
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

function get(path: string, token: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
}

interface ListBody {
  data: { id: string; assigneeId: string | null }[];
  pagination: { total: number };
}

before(async () => {
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;

  const org = await prisma.organization.create({
    data: {
      name: `Activity read test ${randomUUID()}`,
      slug: `activity-read-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  orgId = org.id;
  admin = await createFixtureUser("admin", orgId, "ADMIN");
  user = await createFixtureUser("user", orgId, "USER");
  other = await createFixtureUser("other", orgId, "USER");

  const company = await prisma.company.create({
    data: { organizationId: orgId, name: "Act Company" },
  });
  const propia = await prisma.activity.create({
    data: {
      organizationId: orgId,
      authorId: admin.id,
      assigneeId: user.id,
      companyId: company.id,
      type: "TASK",
      subject: "§25 propia",
    },
  });
  const ajena = await prisma.activity.create({
    data: {
      organizationId: orgId,
      authorId: admin.id,
      assigneeId: other.id,
      companyId: company.id,
      type: "TASK",
      subject: "§25 ajena",
    },
  });
  propiaId = propia.id;
  ajenaId = ajena.id;
});

after(async () => {
  if (closeApp) await closeApp();
  if (!orgId) return;
  await prisma.activity.deleteMany({ where: { organizationId: orgId } });
  await prisma.company.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  for (const u of [admin, user, other]) {
    if (u) await getSupabaseAdmin().auth.admin.deleteUser(u.id);
  }
});

test("GET /api/activities — USER mandando ?assigneeId=<otra persona> recibe solo lo suyo: el filtro se ignora", async () => {
  const res = await get(`/api/activities?assigneeId=${other.id}`, user.accessToken);
  assert.equal(res.status, 200);
  const body = (await res.json()) as ListBody;

  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].id, propiaId);
  assert.equal(body.data[0].assigneeId, user.id);
  assert.equal(body.pagination.total, 1);
});

test("GET /api/activities — USER sin filtro recibe solo lo suyo, no el listado completo de la organización", async () => {
  const res = await get("/api/activities", user.accessToken);
  assert.equal(res.status, 200);
  const body = (await res.json()) as ListBody;

  assert.deepEqual(
    body.data.map((a) => a.id),
    [propiaId],
  );
  assert.equal(body.pagination.total, 1);
});

test("GET /api/activities/:id — USER: la propia es 200; una ajena es 404 con el mismo mensaje que un id inexistente", async () => {
  const propia = await get(`/api/activities/${propiaId}`, user.accessToken);
  assert.equal(propia.status, 200);
  assert.equal(((await propia.json()) as { id: string }).id, propiaId);

  const ajena = await get(`/api/activities/${ajenaId}`, user.accessToken);
  assert.equal(ajena.status, 404);
  const ajenaBody = (await ajena.json()) as { error: { message: string } };

  const inexistente = await get(`/api/activities/${randomUUID()}`, user.accessToken);
  assert.equal(inexistente.status, 404);
  const inexistenteBody = (await inexistente.json()) as { error: { message: string } };

  assert.equal(ajenaBody.error.message, "Actividad no encontrada");
  assert.equal(ajenaBody.error.message, inexistenteBody.error.message);
});

test("GET /api/activities — ADMIN sin cambios: filtrar por el assigneeId de cualquier persona devuelve lo pedido, y lee cualquier id", async () => {
  const deOtro = await get(`/api/activities?assigneeId=${other.id}`, admin.accessToken);
  assert.equal(deOtro.status, 200);
  const deOtroBody = (await deOtro.json()) as ListBody;
  assert.deepEqual(
    deOtroBody.data.map((a) => a.id),
    [ajenaId],
  );

  const todo = await get("/api/activities", admin.accessToken);
  assert.equal(todo.status, 200);
  const todoBody = (await todo.json()) as ListBody;
  assert.equal(todoBody.pagination.total, 2);

  const ajena = await get(`/api/activities/${ajenaId}`, admin.accessToken);
  assert.equal(ajena.status, 200);
});
