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
import { createVoucherRouter } from "../routes/voucher.routes";
import type { DepsDeRespuestaHumana } from "../services/conversationReply.service";
import {
  MENSAJE_SIN_PERMISO_CUPON,
  MOTIVO_SIN_TELEFONO,
  MOTIVO_SIN_VENTANA,
  MOTIVO_VENCIDO,
} from "../services/discountVoucherManual.service";
import type { SendWhatsappTextInput } from "../services/whatsappGraph.service";

// ---------------------------------------------------------------------------
// "Crear cupón" a mano (discountVoucherManual.service.ts), por HTTP real
// contra el router real —con su authenticate— y Postgres y GoTrue reales. El
// envío por WhatsApp es un doble que registra lo que se habría mandado.
//
// Lo que se prueba:
//   1. El alta desde el contacto y desde la oportunidad, con las validaciones
//      de la regla.
//   2. Permisos: ADMIN siempre; un USER solo sobre lo que tiene asignado; otra
//      organización no existe (404).
//   3. La lista del contacto con su estado (vigente, canjeado, vencido).
//   4. "Enviar por WhatsApp": solo con teléfono y la ventana de 24 h abierta;
//      sale texto libre con el link, queda en el hilo y no toma la
//      conversación.
// ---------------------------------------------------------------------------

const PASSWORD = "Cupon-manual-password-123!";
const HORA = 60 * 60 * 1000;

interface FixtureUser {
  accessToken: string;
  authUserId: string;
  userId: string;
}

const envios: SendWhatsappTextInput[] = [];
const deps: DepsDeRespuestaHumana = {
  accessToken: () => "token-de-prueba",
  sendText: (input) => {
    envios.push(input);
    return Promise.resolve({ wamid: `wamid.${randomUUID()}` });
  },
  pageAccessToken: () => Promise.reject(new Error("este archivo no manda por Meta")),
  sendMetaText: () => Promise.reject(new Error("este archivo no manda por Meta")),
};

let orgId: string;
let otraOrgId: string;
let branchId: string;
let branchSinNumeroId: string;
let otraBranchId: string;
let agentId: string;
let phoneNumberId: string;
let admin: FixtureUser;
let vendedor: FixtureUser;
let otroVendedor: FixtureUser;
let adminOtraOrg: FixtureUser;
let baseUrl: string;
let closeApp: () => Promise<void>;

function startTestApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use("/api", createVoucherRouter(deps));
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
  const email = `cupon-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear usuario real de Supabase Auth (${label}): ${error?.message}`);
  }
  const roleRow = await findRoleByName(role);
  if (!roleRow) throw new Error(`No está sembrado el rol ${role}. Abortando.`);
  const user = await prisma.user.create({
    data: {
      id: data.user.id,
      organizationId,
      roleId: roleRow.id,
      email,
      fullName: `Cupon ${label}`,
    },
  });
  const anon = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!);
  const { data: s, error: e } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (e || !s.session) throw new Error(`No se pudo iniciar sesión real (${label}): ${e?.message}`);
  return { accessToken: s.session.access_token, authUserId: data.user.id, userId: user.id };
}

function call(method: string, path: string, token: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function mensajeDeError(res: Response): Promise<string> {
  return ((await res.json()) as { error: { message: string } }).error.message;
}

interface Cupon {
  id: string;
  label: string;
  status: string;
  expiresAt: string;
  contactId: string;
  opportunityId: string | null;
  branchId: string | null;
  origin: string;
  publicUrl: string;
}

function contacto(ownerId: string | null, phone: string | null = "099 123 456") {
  return prisma.contact.create({
    data: {
      organizationId: orgId,
      firstName: "Ana",
      lastName: randomUUID().slice(0, 6),
      phone,
      ownerId,
    },
  });
}

async function oportunidad(ownerId: string, contactId: string | null) {
  const pipeline = await prisma.pipeline.create({
    data: { organizationId: orgId, name: `P ${randomUUID().slice(0, 6)}` },
  });
  const stage = await prisma.stage.create({
    data: { organizationId: orgId, pipelineId: pipeline.id, name: "Nuevo", order: 0 },
  });
  // Sin contacto, la oportunidad tiene que ser de una empresa (CHECK).
  const companyId =
    contactId === null
      ? (await prisma.company.create({ data: { organizationId: orgId, name: "Empresa" } })).id
      : null;
  return prisma.opportunity.create({
    data: {
      organizationId: orgId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      title: "Venta",
      ownerId,
      contactId,
      companyId,
    },
  });
}

function crear(token: string, body: Record<string, unknown>) {
  return call("POST", "/api/vouchers", token, {
    label: "15% en el taller",
    expiresInDays: 30,
    branchId,
    ...body,
  });
}

// Una conversación de WhatsApp abierta del contacto con el agente de la
// sucursal, con el último mensaje del cliente hace `hace` ms.
async function conversacionDeWhatsapp(contactId: string, hace: number) {
  const conv = await prisma.conversation.create({
    data: {
      organizationId: orgId,
      branchId,
      agentId,
      contactId,
      channel: "WHATSAPP",
      status: "ACTIVE",
      externalThreadId: `598${Math.floor(Math.random() * 1e8)}`,
    },
  });
  await prisma.message.create({
    data: {
      organizationId: orgId,
      conversationId: conv.id,
      direction: "INBOUND",
      senderType: "CONTACT",
      content: "Hola",
      createdAt: new Date(Date.now() - hace),
    },
  });
  return conv;
}

before(async () => {
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;

  orgId = (
    await prisma.organization.create({
      data: {
        name: `Cupon ${randomUUID()}`,
        slug: `cupon-manual-${Date.now()}-${randomUUID().slice(0, 8)}`,
      },
    })
  ).id;
  branchId = (
    await prisma.branch.create({
      data: { organizationId: orgId, name: "Centro", timezone: "America/Montevideo" },
    })
  ).id;
  branchSinNumeroId = (
    await prisma.branch.create({
      data: { organizationId: orgId, name: "Costa", timezone: "America/Montevideo" },
    })
  ).id;
  phoneNumberId = `8${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 18);
  agentId = (
    await prisma.agent.create({
      data: {
        organizationId: orgId,
        branchId,
        name: "Vera",
        instructions: "Atendé.",
        modelProvider: "openrouter",
        modelName: "test/model",
        enabledTools: [],
        guardrails: {},
        channels: ["WHATSAPP"],
        whatsappPhoneNumberId: phoneNumberId,
      },
    })
  ).id;

  otraOrgId = (
    await prisma.organization.create({
      data: {
        name: `Cupon B ${randomUUID()}`,
        slug: `cupon-manual-b-${Date.now()}-${randomUUID().slice(0, 8)}`,
      },
    })
  ).id;
  otraBranchId = (
    await prisma.branch.create({
      data: { organizationId: otraOrgId, name: "Otra", timezone: "America/Montevideo" },
    })
  ).id;

  admin = await createFixtureUser("admin", orgId, "ADMIN");
  vendedor = await createFixtureUser("vendedor", orgId, "USER");
  otroVendedor = await createFixtureUser("otro", orgId, "USER");
  adminOtraOrg = await createFixtureUser("admin-b", otraOrgId, "ADMIN");
});

after(async () => {
  if (closeApp) await closeApp();
  for (const id of [orgId, otraOrgId]) {
    if (!id) continue;
    const where = { organizationId: id };
    await prisma.discountVoucher.deleteMany({ where });
    await prisma.message.deleteMany({ where });
    await prisma.conversation.deleteMany({ where });
    await prisma.agent.deleteMany({ where });
    await prisma.opportunity.deleteMany({ where });
    await prisma.stage.deleteMany({ where });
    await prisma.pipeline.deleteMany({ where });
    await prisma.contact.deleteMany({ where });
    await prisma.company.deleteMany({ where });
    await prisma.branch.deleteMany({ where });
    await prisma.user.deleteMany({ where });
    await prisma.organization.delete({ where: { id } });
  }
  for (const u of [admin, vendedor, otroVendedor, adminOtraOrg]) {
    if (u) await getSupabaseAdmin().auth.admin.deleteUser(u.authUserId);
  }
});

// ---------------------------------------------------------------------------
// 1. El alta
// ---------------------------------------------------------------------------

test("un ADMIN crea un cupón desde el contacto: 201, vigente, manual, con su link y la sucursal", async () => {
  const c = await contacto(null);
  const antes = Date.now();
  const res = await crear(admin.accessToken, { contactId: c.id, label: "  15% en el taller  " });
  assert.equal(res.status, 201, await res.clone().text());
  const cupon = (await res.json()) as Cupon;

  assert.equal(cupon.label, "15% en el taller");
  assert.equal(cupon.status, "ACTIVE");
  assert.equal(cupon.origin, "MANUAL");
  assert.equal(cupon.contactId, c.id);
  assert.equal(cupon.opportunityId, null);
  assert.equal(cupon.branchId, branchId);
  assert.ok(cupon.publicUrl.endsWith(cupon.id), "el link termina en el id del cupón");
  const vence = Date.parse(cupon.expiresAt) - antes;
  assert.ok(Math.abs(vence - 30 * 24 * HORA) < 60_000, "vence a los 30 días");

  const fila = await prisma.discountVoucher.findUniqueOrThrow({ where: { id: cupon.id } });
  assert.equal(fila.createdByUserId, admin.userId);
  assert.equal(fila.automationId, null);
});

test("desde la oportunidad: el contacto es el de la oportunidad; sin contacto, 400", async () => {
  const c = await contacto(null);
  const opp = await oportunidad(vendedor.userId, c.id);
  const res = await crear(admin.accessToken, { opportunityId: opp.id });
  assert.equal(res.status, 201, await res.clone().text());
  const cupon = (await res.json()) as Cupon;
  assert.equal(cupon.opportunityId, opp.id);
  assert.equal(cupon.contactId, c.id);

  const sinContacto = await oportunidad(vendedor.userId, null);
  assert.equal((await crear(admin.accessToken, { opportunityId: sinContacto.id })).status, 400);

  const otro = await contacto(null);
  const noCoincide = await crear(admin.accessToken, { opportunityId: opp.id, contactId: otro.id });
  assert.equal(noCoincide.status, 400);
});

test("mismas validaciones que la regla: descuento, días y sucursal", async () => {
  const c = await contacto(null);
  for (const body of [
    { contactId: c.id, label: "   " },
    { contactId: c.id, label: "x".repeat(201) },
    { contactId: c.id, expiresInDays: 0 },
    { contactId: c.id, expiresInDays: 366 },
    { contactId: c.id, expiresInDays: 1.5 },
    { contactId: c.id, branchId: "no-es-uuid" },
    { contactId: c.id, branchId: otraBranchId },
    {},
  ]) {
    const res = await crear(admin.accessToken, body);
    assert.equal(res.status, 400, `${JSON.stringify(body)} -> ${res.status}`);
  }
  assert.equal(
    await prisma.discountVoucher.count({ where: { contactId: c.id } }),
    0,
    "ningún rechazo deja un cupón",
  );
});

// ---------------------------------------------------------------------------
// 2. Permisos
// ---------------------------------------------------------------------------

test("un USER crea para su contacto asignado; para uno ajeno o sin asignar, 403", async () => {
  const suyo = await contacto(vendedor.userId);
  assert.equal((await crear(vendedor.accessToken, { contactId: suyo.id })).status, 201);

  const ajeno = await contacto(otroVendedor.userId);
  const res = await crear(vendedor.accessToken, { contactId: ajeno.id });
  assert.equal(res.status, 403);
  assert.equal(await mensajeDeError(res), MENSAJE_SIN_PERMISO_CUPON);
  assert.equal(
    (await crear(vendedor.accessToken, { contactId: (await contacto(null)).id })).status,
    403,
  );
});

test("desde una oportunidad manda el dueño de la oportunidad, no el del contacto", async () => {
  const c = await contacto(otroVendedor.userId);
  const opp = await oportunidad(vendedor.userId, c.id);
  assert.equal((await crear(vendedor.accessToken, { opportunityId: opp.id })).status, 201);
  assert.equal((await crear(otroVendedor.accessToken, { opportunityId: opp.id })).status, 403);
});

test("otra organización: el contacto, la oportunidad y el cupón no existen (404)", async () => {
  const c = await contacto(null);
  const opp = await oportunidad(admin.userId, c.id);
  const res = await call("POST", "/api/vouchers", adminOtraOrg.accessToken, {
    contactId: c.id,
    label: "x",
    expiresInDays: 10,
    branchId: otraBranchId,
  });
  assert.equal(res.status, 404);
  const desdeOpp = await call("POST", "/api/vouchers", adminOtraOrg.accessToken, {
    opportunityId: opp.id,
    label: "x",
    expiresInDays: 10,
    branchId: otraBranchId,
  });
  assert.equal(desdeOpp.status, 404);

  const cupon = (await (await crear(admin.accessToken, { contactId: c.id })).json()) as Cupon;
  assert.equal(
    (await call("GET", `/api/contacts/${c.id}/vouchers`, adminOtraOrg.accessToken)).status,
    404,
  );
  assert.equal(
    (await call("GET", `/api/vouchers/${cupon.id}/whatsapp`, adminOtraOrg.accessToken)).status,
    404,
  );
  assert.equal(
    (await call("POST", `/api/vouchers/${cupon.id}/whatsapp`, adminOtraOrg.accessToken)).status,
    404,
  );
});

// ---------------------------------------------------------------------------
// 3. La lista del contacto
// ---------------------------------------------------------------------------

test("la lista del contacto trae sus cupones con el estado: vigente, canjeado o vencido", async () => {
  const c = await contacto(null);
  const vigente = (await (await crear(admin.accessToken, { contactId: c.id })).json()) as Cupon;
  const canjeado = (await (await crear(admin.accessToken, { contactId: c.id })).json()) as Cupon;
  await prisma.discountVoucher.update({
    where: { id: canjeado.id },
    data: { status: "CONSUMED", consumedAt: new Date(), consumedByUserId: admin.userId },
  });
  const vencido = (await (await crear(admin.accessToken, { contactId: c.id })).json()) as Cupon;
  await prisma.discountVoucher.update({
    where: { id: vencido.id },
    data: { expiresAt: new Date(Date.now() - HORA) },
  });

  const res = await call("GET", `/api/contacts/${c.id}/vouchers`, vendedor.accessToken);
  assert.equal(res.status, 200, "listar es abierto a la organización");
  const { data } = (await res.json()) as { data: Cupon[] };
  const estado = new Map(data.map((v) => [v.id, v.status]));
  assert.equal(data.length, 3);
  assert.equal(estado.get(vigente.id), "ACTIVE");
  assert.equal(estado.get(canjeado.id), "CONSUMED");
  assert.equal(estado.get(vencido.id), "EXPIRED");
});

// ---------------------------------------------------------------------------
// 4. Enviar por WhatsApp
// ---------------------------------------------------------------------------

async function estadoDelEnvio(cuponId: string) {
  const res = await call("GET", `/api/vouchers/${cuponId}/whatsapp`, admin.accessToken);
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()) as {
    disponible: boolean;
    motivo: string | null;
    conversationId: string | null;
  };
}

test("con la ventana abierta sale texto libre con el link, queda en el hilo y no toma la conversación", async () => {
  const c = await contacto(vendedor.userId);
  const conv = await conversacionDeWhatsapp(c.id, HORA);
  const cupon = (await (await crear(vendedor.accessToken, { contactId: c.id })).json()) as Cupon;

  const estado = await estadoDelEnvio(cupon.id);
  assert.deepEqual(estado, { disponible: true, conversationId: conv.id, motivo: null });

  const antes = envios.length;
  const res = await call("POST", `/api/vouchers/${cupon.id}/whatsapp`, vendedor.accessToken);
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(await res.json(), {
    conversationId: conv.id,
    deliveryStatus: "SENT",
    deliveryError: null,
  });

  assert.equal(envios.length, antes + 1);
  const envio = envios.at(-1)!;
  assert.equal(envio.phoneNumberId, phoneNumberId, "desde el número de la sucursal");
  assert.equal(envio.to, conv.externalThreadId);
  assert.ok(envio.body.includes(cupon.publicUrl), "lleva el link del cupón");
  assert.ok(envio.body.includes("15% en el taller"));

  const enElHilo = await prisma.message.findFirstOrThrow({
    where: { conversationId: conv.id, senderType: "HUMAN" },
  });
  assert.equal(enElHilo.senderUserId, vendedor.userId);
  assert.equal(enElHilo.content, envio.body);
  const despues = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
  assert.equal(despues.status, "ACTIVE", "mandar un cupón no deriva la conversación");
  assert.equal(despues.assignedUserId, null, "ni la asigna");
});

test("fuera de la ventana de 24 h (o sin conversación): no disponible con la explicación, y 409 al mandar", async () => {
  const c = await contacto(null);
  const cupon = (await (await crear(admin.accessToken, { contactId: c.id })).json()) as Cupon;
  assert.deepEqual(await estadoDelEnvio(cupon.id), {
    disponible: false,
    conversationId: null,
    motivo: MOTIVO_SIN_VENTANA,
  });

  await conversacionDeWhatsapp(c.id, 25 * HORA);
  assert.equal((await estadoDelEnvio(cupon.id)).motivo, MOTIVO_SIN_VENTANA);

  const antes = envios.length;
  const res = await call("POST", `/api/vouchers/${cupon.id}/whatsapp`, admin.accessToken);
  assert.equal(res.status, 409);
  assert.equal(await mensajeDeError(res), MOTIVO_SIN_VENTANA);
  assert.equal(envios.length, antes);
});

test("sin teléfono, vencido, o de una sucursal sin número: no disponible con su motivo", async () => {
  const sinTelefono = await contacto(null, null);
  await conversacionDeWhatsapp(sinTelefono.id, HORA);
  const a = (await (await crear(admin.accessToken, { contactId: sinTelefono.id })).json()) as Cupon;
  assert.equal((await estadoDelEnvio(a.id)).motivo, MOTIVO_SIN_TELEFONO);

  const c = await contacto(null);
  await conversacionDeWhatsapp(c.id, HORA);
  const b = (await (await crear(admin.accessToken, { contactId: c.id })).json()) as Cupon;
  await prisma.discountVoucher.update({
    where: { id: b.id },
    data: { expiresAt: new Date(Date.now() - HORA) },
  });
  assert.equal((await estadoDelEnvio(b.id)).motivo, MOTIVO_VENCIDO);

  const d = (await (
    await crear(admin.accessToken, { contactId: c.id, branchId: branchSinNumeroId })
  ).json()) as Cupon;
  assert.equal((await estadoDelEnvio(d.id)).disponible, false);
});

test("mandar: un USER que no tiene asignado el contacto recibe 403 y no sale nada", async () => {
  const c = await contacto(otroVendedor.userId);
  await conversacionDeWhatsapp(c.id, HORA);
  const cupon = (await (await crear(admin.accessToken, { contactId: c.id })).json()) as Cupon;
  const antes = envios.length;
  const res = await call("POST", `/api/vouchers/${cupon.id}/whatsapp`, vendedor.accessToken);
  assert.equal(res.status, 403);
  assert.equal(envios.length, antes);
});
