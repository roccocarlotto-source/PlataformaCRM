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
import { INTERNAL_PROXY_SECRET_HEADER } from "../middlewares/requireInternalProxySecret";
import { consumirDiscountVoucher } from "../repositories/discountVoucher.repository";
import { findRoleByName } from "../repositories/role.repository";
import { voucherRouter } from "../routes/voucher.routes";
import { voucherPublicRouter } from "../routes/voucherPublic.routes";
import { voucherQrDataUrl } from "../utils/voucherLanding";
import {
  CUPON_NO_ENCONTRADO,
  CUPON_VENCIDO,
  CUPON_YA_CANJEADO,
  crearDiscountVoucher,
} from "./discountVoucher.service";

// ---------------------------------------------------------------------------
// Ítem 176: el cupón de descuento de un solo uso, por HTTP real contra
// Postgres y GoTrue reales — la app monta los dos routers reales
// (voucherPublicRouter con su gate de secreto, voucherRouter con su
// authenticate y su rate limiter) + notFound + errorHandler.
//
// Lo que se fija acá y no se puede fijar sin base:
//
//   1. La creación real pasa las FKs compuestas y el CHECK de consistencia.
//   2. GET /vouchers/resolve/:id: la página HTML de ACTIVE (con el QR del link
//      público) / CONSUMED / EXPIRED (sin QR), y que un id
//      inexistente responde byte a byte lo mismo que el gate sin secreto.
//   3. POST /api/vouchers/:id/redeem: lo canjea un USER (sin authorize), 409
//      al segundo canje y al vencido (que queda ACTIVE), 404 desde otra
//      organización o para un id inexistente.
//   4. La carrera: dos canjes simultáneos del mismo id — gana uno, el otro
//      recibe 409, nunca los dos 200. Mismo patrón que reserve_vehicle (ítem
//      175): Promise.all sobre el camino real, sin locks simulados. Lo que
//      decide es el `WHERE status = 'ACTIVE'` del UPDATE — y como por HTTP
//      el perdedor suele caer ya en la lectura previa del service, hay un
//      segundo caso que le pega directo al UPDATE, sin esa lectura.
// ---------------------------------------------------------------------------

const PASSWORD = "Voucher-test-password-123!";
const SECRETO = "secreto-de-prueba-vouchers";
const BASE_PUBLICA = "https://cupones.example.test";
const DIA_MS = 24 * 60 * 60 * 1000;

interface FixtureUser {
  accessToken: string;
  authUserId: string;
}

interface Escenario {
  organizationId: string;
  opportunityId: string;
  contactId: string;
  automationId: string;
}

let baseUrl: string;
let closeApp: () => Promise<void>;
let a: Escenario;
let orgB: string;
let userA: FixtureUser;
let userB: FixtureUser;
const secretoOriginal = env.QR_RESOLVE_PROXY_SECRET;
const basePublicaOriginal = env.QR_PUBLIC_BASE_URL;

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use(voucherPublicRouter);
  app.use("/api", voucherRouter);
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

async function crearOrganizacion(etiqueta: string): Promise<string> {
  const org = await prisma.organization.create({
    data: {
      name: `Cupones ${etiqueta} ${randomUUID()}`,
      slug: `cupones-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  return org.id;
}

async function createFixtureUser(
  label: string,
  organizationId: string,
  role: "ADMIN" | "USER",
): Promise<FixtureUser> {
  const email = `cupones-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;

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
      fullName: `Cupones Test ${label}`,
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

// Oportunidad ganada + contacto + la regla que "emitió" el cupón. Por
// Prisma directo: lo que se prueba acá es el cupón, no esos services.
async function montarNegocio(organizationId: string, ownerId: string): Promise<Escenario> {
  const pipeline = await prisma.pipeline.create({ data: { organizationId, name: "Ventas" } });
  const stage = await prisma.stage.create({
    data: { organizationId, pipelineId: pipeline.id, name: "Ganada", order: 1 },
  });
  const contacto = await prisma.contact.create({
    data: { organizationId, firstName: "Ana", lastName: "Cupón" },
  });
  const oportunidad = await prisma.opportunity.create({
    data: {
      organizationId,
      contactId: contacto.id,
      ownerId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      title: "Service 10.000 km",
      status: "WON",
    },
  });
  const regla = await prisma.automation.create({
    data: {
      organizationId,
      name: "Cupón post-venta",
      triggerType: "opportunity.won",
      actionType: "opportunity.send_discount_voucher",
      actionConfig: {},
    },
  });
  return {
    organizationId,
    opportunityId: oportunidad.id,
    contactId: contacto.id,
    automationId: regla.id,
  };
}

function nuevoCupon(e: Escenario, expiresAt = new Date(Date.now() + 30 * DIA_MS)) {
  return crearDiscountVoucher(e.organizationId, {
    automationId: e.automationId,
    opportunityId: e.opportunityId,
    contactId: e.contactId,
    label: "15% de descuento en el taller",
    expiresAt,
  });
}

// El vencido no se puede crear por el service con una fecha pasada sin que
// eso sea lo que se prueba; se crea vigente y se corre la fecha por Prisma.
async function cuponVencido(e: Escenario) {
  const c = await nuevoCupon(e);
  return prisma.discountVoucher.update({
    where: { id: c.id },
    data: { expiresAt: new Date(Date.now() - DIA_MS) },
  });
}

// `secreto` explícito solo lo usan los casos del gate; `null` = sin header.
function resolver(id: string, secreto: string | null = SECRETO) {
  return fetch(`${baseUrl}/vouchers/resolve/${id}`, {
    headers: secreto === null ? {} : { [INTERNAL_PROXY_SECRET_HEADER]: secreto },
  });
}

function canjear(id: string, token: string) {
  return fetch(`${baseUrl}/api/vouchers/${id}/redeem`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

async function mensajeDeError(res: Response): Promise<string> {
  const body = (await res.json()) as { error: { message: string } };
  return body.error.message;
}

before(async () => {
  env.QR_RESOLVE_PROXY_SECRET = SECRETO;
  env.QR_PUBLIC_BASE_URL = BASE_PUBLICA;
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;

  const orgA = await crearOrganizacion("a");
  orgB = await crearOrganizacion("b");
  // USER y no ADMIN, a propósito: el canje no lleva authorize.
  userA = await createFixtureUser("user-a", orgA, "USER");
  userB = await createFixtureUser("user-b", orgB, "USER");
  a = await montarNegocio(orgA, userA.authUserId);
});

after(async () => {
  env.QR_RESOLVE_PROXY_SECRET = secretoOriginal;
  env.QR_PUBLIC_BASE_URL = basePublicaOriginal;
  if (closeApp) await closeApp();
  for (const org of [a?.organizationId, orgB]) {
    if (!org) continue;
    await prisma.discountVoucher.deleteMany({ where: { organizationId: org } });
    await prisma.automation.deleteMany({ where: { organizationId: org } });
    await prisma.opportunity.deleteMany({ where: { organizationId: org } });
    await prisma.contact.deleteMany({ where: { organizationId: org } });
    await prisma.stage.deleteMany({ where: { organizationId: org } });
    await prisma.pipeline.deleteMany({ where: { organizationId: org } });
    await prisma.user.deleteMany({ where: { organizationId: org } });
    await prisma.organization.delete({ where: { id: org } });
  }
  for (const u of [userA, userB]) {
    if (u) await getSupabaseAdmin().auth.admin.deleteUser(u.authUserId);
  }
});

// ---------------------------------------------------------------------------
// Creación
// ---------------------------------------------------------------------------

test("crearDiscountVoucher guarda la fila ACTIVE, sin datos de canje", async () => {
  const c = await nuevoCupon(a);
  const fila = await prisma.discountVoucher.findUniqueOrThrow({ where: { id: c.id } });
  assert.equal(fila.organizationId, a.organizationId);
  assert.equal(fila.opportunityId, a.opportunityId);
  assert.equal(fila.contactId, a.contactId);
  assert.equal(fila.automationId, a.automationId);
  assert.equal(fila.status, "ACTIVE");
  assert.equal(fila.consumedAt, null);
  assert.equal(fila.consumedByUserId, null);
});

test("crearDiscountVoucher con una oportunidad de otra organización -> 400, no crea nada", async () => {
  const antes = await prisma.discountVoucher.count({ where: { organizationId: orgB } });
  await assert.rejects(
    crearDiscountVoucher(orgB, {
      automationId: a.automationId,
      opportunityId: a.opportunityId,
      contactId: a.contactId,
      label: "x",
      expiresAt: new Date(Date.now() + DIA_MS),
    }),
    /El opportunityId indicado no existe/,
  );
  assert.equal(await prisma.discountVoucher.count({ where: { organizationId: orgB } }), antes);
});

test("el CHECK de consistencia frena un CONSUMED sin consumed_at / consumed_by_user_id", async () => {
  const c = await nuevoCupon(a);
  await assert.rejects(
    prisma.discountVoucher.update({ where: { id: c.id }, data: { status: "CONSUMED" } }),
    /discount_vouchers_consumed_consistency_check/,
  );
});

// ---------------------------------------------------------------------------
// GET /vouchers/resolve/:id
// ---------------------------------------------------------------------------

test("GET público: activo -> 200 HTML con label, 'Activo' y el QR del link público, sin datos del contacto", async () => {
  const c = await nuevoCupon(a);
  const res = await resolver(c.id);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("content-type")?.startsWith("text/html"));
  const html = await res.text();
  assert.ok(html.includes("<h1>15% de descuento en el taller</h1>"));
  assert.ok(html.includes(">Activo<"));
  // El QR codifica el link de ESTA página por el Worker, no el del backend.
  assert.ok(
    html.includes(`src="${await voucherQrDataUrl(`${BASE_PUBLICA}/v/${c.id}`)}"`),
    "el QR codifica ${QR_PUBLIC_BASE_URL}/v/:id",
  );
  for (const dato of [a.contactId, a.opportunityId, a.organizationId]) {
    assert.equal(html.includes(dato), false);
  }

  // Abrirlo no lo consume, las veces que sea.
  await resolver(c.id);
  const fila = await prisma.discountVoucher.findUniqueOrThrow({ where: { id: c.id } });
  assert.equal(fila.status, "ACTIVE");
});

test("GET público: consumido -> 'Ya canjeado'; vencido -> 'Vencido' (derivado, la base sigue en ACTIVE); ninguno con QR", async () => {
  const consumido = await nuevoCupon(a);
  assert.equal((await canjear(consumido.id, userA.accessToken)).status, 200);
  const resConsumido = await resolver(consumido.id);
  assert.equal(resConsumido.status, 200);
  assert.ok(resConsumido.headers.get("content-type")?.startsWith("text/html"));
  const htmlConsumido = await resConsumido.text();
  assert.ok(htmlConsumido.includes(">Ya canjeado<"));
  assert.equal(htmlConsumido.includes("<img"), false);

  const vencido = await cuponVencido(a);
  const res = await resolver(vencido.id);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("content-type")?.startsWith("text/html"));
  const html = await res.text();
  assert.ok(html.includes(">Vencido<"));
  assert.equal(html.includes("<img"), false);
  const fila = await prisma.discountVoucher.findUniqueOrThrow({ where: { id: vencido.id } });
  assert.equal(fila.status, "ACTIVE");
});

test("GET público: inexistente, malformado y sin secreto -> el MISMO 404, byte a byte (DEC-007)", async () => {
  const c = await nuevoCupon(a);

  const inexistente = await resolver(randomUUID());
  const malformado = await resolver("no-es-un-uuid");
  const sinSecreto = await resolver(c.id, null);
  const otroSecreto = await resolver(c.id, "no-es-el-secreto");

  const cuerpos: string[] = [];
  for (const res of [inexistente, malformado, sinSecreto, otroSecreto]) {
    assert.equal(res.status, 404);
    assert.ok(res.headers.get("content-type")?.startsWith("text/html"));
    cuerpos.push(await res.text());
  }
  assert.equal(new Set(cuerpos).size, 1, "las cuatro respuestas son idénticas");
});

// ---------------------------------------------------------------------------
// POST /api/vouchers/:id/redeem
// ---------------------------------------------------------------------------

test("canje: un USER (no ADMIN) lo canjea -> 200 con consumedAt y consumedByUserId", async () => {
  const c = await nuevoCupon(a);
  const res = await canjear(c.id, userA.accessToken);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    id: string;
    status: string;
    consumedAt: string;
    consumedByUserId: string;
  };
  assert.equal(body.id, c.id);
  assert.equal(body.status, "CONSUMED");
  assert.equal(body.consumedByUserId, userA.authUserId);
  assert.ok(body.consumedAt);

  const fila = await prisma.discountVoucher.findUniqueOrThrow({ where: { id: c.id } });
  assert.equal(fila.status, "CONSUMED");
  assert.equal(fila.consumedByUserId, userA.authUserId);
  assert.ok(fila.consumedAt);
});

test("canje: segundo canje del mismo cupón -> 409 'ya fue canjeado', con consumedAt en el detalle", async () => {
  const c = await nuevoCupon(a);
  assert.equal((await canjear(c.id, userA.accessToken)).status, 200);
  const primero = await prisma.discountVoucher.findUniqueOrThrow({ where: { id: c.id } });

  const res = await canjear(c.id, userA.accessToken);
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error: { message: string; consumedAt?: string } };
  assert.equal(body.error.message, CUPON_YA_CANJEADO);
  assert.equal(body.error.consumedAt, primero.consumedAt?.toISOString());

  // El segundo intento no pisó nada.
  const despues = await prisma.discountVoucher.findUniqueOrThrow({ where: { id: c.id } });
  assert.deepEqual(despues.consumedAt, primero.consumedAt);
});

test("canje: vencido -> 409 'venció' y queda ACTIVE, sin datos de canje", async () => {
  const c = await cuponVencido(a);
  const res = await canjear(c.id, userA.accessToken);
  assert.equal(res.status, 409);
  assert.equal(await mensajeDeError(res), CUPON_VENCIDO);

  const fila = await prisma.discountVoucher.findUniqueOrThrow({ where: { id: c.id } });
  assert.equal(fila.status, "ACTIVE");
  assert.equal(fila.consumedAt, null);
  assert.equal(fila.consumedByUserId, null);
});

test("canje: desde otra organización o con un id inexistente -> 404, y el cupón queda intacto", async () => {
  const c = await nuevoCupon(a);

  const otraOrg = await canjear(c.id, userB.accessToken);
  assert.equal(otraOrg.status, 404);
  assert.equal(await mensajeDeError(otraOrg), CUPON_NO_ENCONTRADO);

  const inexistente = await canjear(randomUUID(), userA.accessToken);
  assert.equal(inexistente.status, 404);
  assert.equal(await mensajeDeError(inexistente), CUPON_NO_ENCONTRADO);

  const fila = await prisma.discountVoucher.findUniqueOrThrow({ where: { id: c.id } });
  assert.equal(fila.status, "ACTIVE");
});

test("canje: sin token -> 401", async () => {
  const c = await nuevoCupon(a);
  const res = await fetch(`${baseUrl}/api/vouchers/${c.id}/redeem`, { method: "POST" });
  assert.equal(res.status, 401);
});

test("carrera: dos canjes simultáneos del mismo cupón — gana uno, el otro recibe 409, nunca los dos 200", async () => {
  const c = await nuevoCupon(a);

  const respuestas = await Promise.all([
    canjear(c.id, userA.accessToken),
    canjear(c.id, userA.accessToken),
  ]);
  const estados = respuestas.map((r) => r.status).sort();
  assert.deepEqual(estados, [200, 409], JSON.stringify(estados));

  const perdedor = respuestas.find((r) => r.status === 409)!;
  assert.equal(await mensajeDeError(perdedor), CUPON_YA_CANJEADO);

  const fila = await prisma.discountVoucher.findUniqueOrThrow({ where: { id: c.id } });
  assert.equal(fila.status, "CONSUMED");
});

test("carrera en el UPDATE mismo: cinco consumos simultáneos sin lectura previa — exactamente uno afecta la fila", async () => {
  // Por HTTP, el perdedor casi siempre ve CONSUMED en la lectura previa de
  // canjearDiscountVoucher y nunca llega al UPDATE. Acá no hay lectura previa:
  // los cinco llegan a la escritura con el cupón ACTIVE, y lo único que decide
  // es el `WHERE status = 'ACTIVE'`. Sin él, los cinco "ganarían".
  const c = await nuevoCupon(a);
  const ahora = new Date();

  const resultados = await Promise.all(
    Array.from({ length: 5 }, () =>
      consumirDiscountVoucher(c.id, a.organizationId, userA.authUserId, ahora),
    ),
  );

  assert.equal(resultados.filter((r) => r !== null).length, 1, "un solo ganador");
  const fila = await prisma.discountVoucher.findUniqueOrThrow({ where: { id: c.id } });
  assert.equal(fila.status, "CONSUMED");
});
