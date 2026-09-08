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
import { organizationRouter } from "../routes/organization.routes";
import { MONEDAS_IGUALES } from "../services/organization.service";

// ---------------------------------------------------------------------------
// GET/PATCH /api/organization (Fase 2c) por HTTP real contra una app Express
// real, montando el router real —con su authenticate, su authorize y su rate
// limiter— contra Postgres y GoTrue reales. Mismo patrón que
// apiKey.controller.integration-test.ts.
//
//   1. USER recibe 403 en el PATCH; el GET lo lee cualquiera de la organización.
//   2. preferredCurrency === alternateCurrency es 400 (también cuando el body
//      trae una sola y choca con la otra ya guardada).
//   3. null des-configura una moneda.
//   4. El GET trae la cotización MÁS RECIENTE de cada moneda configurada, sin
//      USD, y NINGUNO de los campos internos de billing/QR del row — se
//      verifica sobre el texto crudo de la respuesta, no campo por campo.
//
// exchange_rates es global: se usan códigos que ningún otro archivo usa (ZY*)
// y se limpian al final.
// ---------------------------------------------------------------------------

const PASSWORD = "Org-test-password-123!";
const MONEDAS = { preferida: "ZYA", alternativa: "ZYB" };

interface FixtureUser {
  accessToken: string;
  authUserId: string;
}

let orgId: string;
let admin: FixtureUser;
let user: FixtureUser;
let baseUrl: string;
let closeApp: () => Promise<void>;

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use("/api", organizationRouter);
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
  const email = `org-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;

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
      fullName: `Org Test ${label}`,
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

  return { accessToken: signInData.session.access_token, authUserId: data.user.id };
}

function call(method: string, path: string, token: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function dia(iso: string) {
  return new Date(iso);
}

before(async () => {
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;

  const org = await prisma.organization.create({
    data: {
      name: `Org settings test ${randomUUID()}`,
      slug: `org-settings-${Date.now()}-${randomUUID().slice(0, 8)}`,
      // Un valor interno del row que NO tiene que salir por la API.
      qrBillingExempt: true,
    },
  });
  orgId = org.id;
  admin = await createFixtureUser("admin", orgId, "ADMIN");
  user = await createFixtureUser("user", orgId, "USER");

  // Dos días de cotización por moneda: el GET tiene que servir la más nueva.
  await prisma.exchangeRate.deleteMany({
    where: { targetCurrency: { in: Object.values(MONEDAS) } },
  });
  await prisma.exchangeRate.createMany({
    data: [
      {
        baseCurrency: "USD",
        targetCurrency: MONEDAS.preferida,
        rate: 1400,
        rateDate: dia("2026-09-05"),
        fetchedAt: new Date(),
      },
      {
        baseCurrency: "USD",
        targetCurrency: MONEDAS.preferida,
        rate: 1480.5,
        rateDate: dia("2026-09-06"),
        fetchedAt: new Date(),
      },
      {
        baseCurrency: "USD",
        targetCurrency: MONEDAS.alternativa,
        rate: 40.123456,
        rateDate: dia("2026-09-06"),
        fetchedAt: new Date(),
      },
    ],
  });
});

after(async () => {
  if (closeApp) await closeApp();
  await prisma.exchangeRate.deleteMany({
    where: { targetCurrency: { in: Object.values(MONEDAS) } },
  });
  if (!orgId) return;
  await prisma.user.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  for (const u of [admin, user]) {
    if (u) await getSupabaseAdmin().auth.admin.deleteUser(u.authUserId);
  }
});

test("GET /api/organization — sin moneda configurada: las dos en null, sin cotizaciones, y sin campos internos", async () => {
  const res = await call("GET", "/api/organization", user.accessToken);
  assert.equal(res.status, 200);
  const crudo = await res.text();
  const body = JSON.parse(crudo);
  assert.deepEqual(body, {
    id: orgId,
    name: body.name,
    preferredCurrency: null,
    alternateCurrency: null,
    exchangeRates: [],
  });
  for (const interno of ["qrBillingExempt", "qrMercadopago", "nextVehicleStockNumber", "slug"]) {
    assert.ok(!crudo.includes(interno), `${interno} no debe salir por la API`);
  }
});

test("PATCH /api/organization — USER recibe 403 y nada cambia", async () => {
  const res = await call("PATCH", "/api/organization", user.accessToken, {
    preferredCurrency: MONEDAS.preferida,
  });
  assert.equal(res.status, 403);
  const row = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
  assert.equal(row.preferredCurrency, null);
});

test("PATCH /api/organization — ADMIN configura las dos; el GET trae la cotización más reciente de cada una", async () => {
  const patch = await call("PATCH", "/api/organization", admin.accessToken, {
    preferredCurrency: MONEDAS.preferida.toLowerCase(),
    alternateCurrency: MONEDAS.alternativa,
  });
  assert.equal(patch.status, 200);
  const body = (await patch.json()) as Record<string, unknown>;
  assert.equal(body.preferredCurrency, MONEDAS.preferida);
  assert.equal(body.alternateCurrency, MONEDAS.alternativa);
  assert.deepEqual(body.exchangeRates, [
    { targetCurrency: MONEDAS.preferida, rate: "1480.5", rateDate: "2026-09-06" },
    { targetCurrency: MONEDAS.alternativa, rate: "40.123456", rateDate: "2026-09-06" },
  ]);

  const get = await call("GET", "/api/organization", user.accessToken);
  assert.equal(get.status, 200);
  assert.deepEqual(await get.json(), body);
});

test("PATCH /api/organization — preferida === alternativa es 400, también contra lo ya guardado", async () => {
  const ambas = await call("PATCH", "/api/organization", admin.accessToken, {
    preferredCurrency: "ARS",
    alternateCurrency: "ARS",
  });
  assert.equal(ambas.status, 400);
  const errorBody = (await ambas.json()) as { error: { message: string } };
  assert.equal(errorBody.error.message, MONEDAS_IGUALES);

  // Solo la alternativa, igual a la preferida que ya está guardada (ZYA).
  const unaSola = await call("PATCH", "/api/organization", admin.accessToken, {
    alternateCurrency: MONEDAS.preferida,
  });
  assert.equal(unaSola.status, 400);

  const row = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
  assert.equal(row.preferredCurrency, MONEDAS.preferida);
  assert.equal(row.alternateCurrency, MONEDAS.alternativa);
});

test("PATCH /api/organization — null limpia una moneda y USD no pide cotización", async () => {
  const res = await call("PATCH", "/api/organization", admin.accessToken, {
    preferredCurrency: "USD",
    alternateCurrency: null,
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    id: orgId,
    name: (await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).name,
    preferredCurrency: "USD",
    alternateCurrency: null,
    exchangeRates: [],
  });
});

test("PATCH /api/organization — body vacío o moneda inválida es 400", async () => {
  assert.equal((await call("PATCH", "/api/organization", admin.accessToken, {})).status, 400);
  assert.equal(
    (await call("PATCH", "/api/organization", admin.accessToken, { preferredCurrency: "PESOS" }))
      .status,
    400,
  );
});
