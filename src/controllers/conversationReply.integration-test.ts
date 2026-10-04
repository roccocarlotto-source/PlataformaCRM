import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { DateTime } from "luxon";
import { createClient } from "@supabase/supabase-js";
import express from "express";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import { applyDeliveryStatusByExternalId } from "../repositories/message.repository";
import { findRoleByName } from "../repositories/role.repository";
import { createConversationRouter } from "../routes/conversation.routes";
import { PREFIJO_TAREA_DE_DERIVACION, runAgentTurn } from "../services/agentOrchestration.service";
import {
  AVISO_SIN_RESPUESTA,
  MOTIVO_VENTANA_CERRADA,
  MOTIVO_VENTANA_CERRADA_META,
  PREFIJO_DEL_AVISO,
  textoDelAviso,
} from "../services/avisoSinRespuesta.service";
import { atencionFueraDeHorario } from "../utils/fueraDeHorario";
import type { FranjaSemanal } from "../utils/workingHours";
import {
  MENSAJE_CERRADA,
  MENSAJE_SIN_PERMISO,
  MENSAJE_VENTANA_VENCIDA,
  MENSAJE_VENTANA_VENCIDA_META,
  type DepsDeRespuestaHumana,
} from "../services/conversationReply.service";
import type { LlmProvider } from "../services/llmProvider.service";
import { MENSAJE_PAGINA_RECONECTADA } from "../services/metaPageConnection.service";
import { MetaSendError, type SendMetaTextInput } from "../services/metaSend.service";
import { AppError } from "../utils/AppError";
import { WhatsappGraphError, type SendWhatsappTextInput } from "../services/whatsappGraph.service";

// ---------------------------------------------------------------------------
// Responder desde el CRM (I-03 de
// docs-privados/auditoria-2026-09-24-punta-a-punta.md, local), por HTTP real
// contra el router real —con su authenticate— y Postgres y GoTrue reales. El
// envío por la Graph API es un doble que registra lo que se habría mandado (o
// falla cuando el test lo pide): mismo patrón que
// whatsappTemplate.controller.integration-test.ts.
//
// Lo que se prueba:
//   1. El mensaje sale por WhatsApp desde el número del agente al del
//      cliente, y queda OUTBOUND / HUMAN / SENT con su wamid.
//   2. Permisos: el vendedor asignado y cualquier ADMIN; nadie más.
//   3. La ventana de 24 h de WhatsApp, el canal y el status.
//   4. Un fallo de Meta queda a la vista (FAILED con el motivo) y se reintenta
//      sobre el MISMO mensaje.
//   5. El agente se calla mientras una persona atiende, y "Devolver al agente"
//      lo reactiva.
//   6. Devolver sin haberle respondido al cliente: el aviso, la tarea y la
//      marca (avisoSinRespuesta.service.ts).
//   8. Messenger e Instagram: por el Send API con el token de la página por la
//      que escribió el cliente, con las mismas reglas (permisos, ventana,
//      FAILED con reintento, aviso al devolver).
//   9. Web: sin ventana ni envío; queda en el hilo para el widget.
//
// Cada organización de este archivo es propia (los archivos de integración
// corren en paralelo contra una base compartida).
// ---------------------------------------------------------------------------

const PASSWORD = "Reply-test-password-123!";
const HORA = 60 * 60 * 1000;

interface FixtureUser {
  accessToken: string;
  authUserId: string;
  userId: string;
}

const envios: SendWhatsappTextInput[] = [];
// Lo que devuelve el próximo envío: un wamid, o un error a lanzar.
let proximoFallo: Error | null = null;
// Messenger e Instagram: lo que se mandó por el Send API. Si la página no es
// PAGINA_CONECTADA, el token se rechaza como lo hace obtenerTokenParaEnviar
// cuando la organización reconectó otra.
const enviosMeta: SendMetaTextInput[] = [];
let proximoFalloMeta: Error | null = null;
const PAGINA_CONECTADA = `pg${Date.now()}${Math.floor(Math.random() * 1000)}`;

const deps: DepsDeRespuestaHumana = {
  accessToken: () => "token-de-prueba",
  sendText: async (input) => {
    if (proximoFallo) {
      const err = proximoFallo;
      proximoFallo = null;
      throw err;
    }
    envios.push(input);
    return { wamid: `wamid.${randomUUID()}` };
  },
  pageAccessToken: (_organizationId, pageId) =>
    pageId === PAGINA_CONECTADA
      ? Promise.resolve(`page-token-${pageId}`)
      : Promise.reject(new AppError(MENSAJE_PAGINA_RECONECTADA, 409)),
  sendMetaText: async (input) => {
    if (proximoFalloMeta) {
      const err = proximoFalloMeta;
      proximoFalloMeta = null;
      throw err;
    }
    enviosMeta.push(input);
  },
};

let orgId: string;
let otraOrgId: string;
let branchId: string;
let agentId: string;
let agentWebId: string;
let agentMetaId: string;
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
  app.use("/api", createConversationRouter(deps));
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
  const email = `reply-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
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
  const user = await prisma.user.create({
    data: {
      id: data.user.id,
      organizationId,
      roleId: roleRow.id,
      email,
      fullName: `Reply Test ${label}`,
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
  return {
    accessToken: signInData.session.access_token,
    authUserId: data.user.id,
    userId: user.id,
  };
}

interface OpcionesDeConversacion {
  channel?: "WHATSAPP" | "WEB" | "MESSENGER" | "INSTAGRAM";
  // Messenger/Instagram: la página por la que entró el mensaje del cliente.
  pageId?: string;
  status?: "ACTIVE" | "TRANSFERRED_TO_HUMAN" | "CLOSED";
  assignedUserId?: string | null;
  // Hace cuánto escribió el cliente por última vez; null = nunca escribió.
  ultimoEntranteHace?: number | null;
  organizationId?: string;
}

// Una conversación de WhatsApp con un contacto propio (el índice de "una
// abierta por contacto" no deja reusar el mismo contacto entre tests).
async function crearConversacion(opciones: OpcionesDeConversacion = {}) {
  const organizationId = opciones.organizationId ?? orgId;
  const channel = opciones.channel ?? "WHATSAPP";
  const waId = `598${Math.floor(Math.random() * 1e8)}`;
  const contacto = await prisma.contact.create({
    data: { organizationId, firstName: "Cliente", lastName: randomUUID().slice(0, 6) },
  });
  const agente =
    organizationId === orgId
      ? channel === "WEB"
        ? agentWebId
        : channel === "WHATSAPP"
          ? agentId
          : agentMetaId
      : (await prisma.agent.findFirstOrThrow({ where: { organizationId }, select: { id: true } }))
          .id;
  const sucursal =
    organizationId === orgId
      ? branchId
      : (await prisma.agent.findUniqueOrThrow({ where: { id: agente } })).branchId;
  const conversation = await prisma.conversation.create({
    data: {
      organizationId,
      branchId: sucursal,
      agentId: agente,
      contactId: contacto.id,
      channel,
      status: opciones.status ?? "TRANSFERRED_TO_HUMAN",
      assignedUserId: opciones.assignedUserId === undefined ? null : opciones.assignedUserId,
      externalThreadId: waId,
    },
  });
  const hace = opciones.ultimoEntranteHace === undefined ? HORA : opciones.ultimoEntranteHace;
  if (hace !== null) {
    const entrante = await prisma.message.create({
      data: {
        organizationId,
        conversationId: conversation.id,
        direction: "INBOUND",
        senderType: "CONTACT",
        content: "Hola, ¿sigue disponible?",
        createdAt: new Date(Date.now() - hace),
      },
    });
    if (channel === "MESSENGER" || channel === "INSTAGRAM") {
      // Lo que deja el webhook de Meta: el job con el Page ID.
      await prisma.agentInboundJob.create({
        data: {
          organizationId,
          messageId: entrante.id,
          channel,
          channelAccountId: opciones.pageId ?? PAGINA_CONECTADA,
          externalUserId: waId,
          status: "DONE",
        },
      });
    }
  }
  return { id: conversation.id, contactId: contacto.id, waId };
}

function call(method: string, path: string, token?: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

interface Detalle {
  status: string;
  assignedUserId: string | null;
  agentPaused: boolean;
  replyWindowEndsAt: string | null;
  messages: {
    id: string;
    direction: string;
    senderType: string;
    senderUserId: string | null;
    content: string;
    deliveryStatus: string | null;
    deliveryError: string | null;
    externalMessageId: string | null;
  }[];
}

async function responder(token: string, conversationId: string, text: string) {
  return call("POST", `/api/conversations/${conversationId}/messages`, token, { text });
}

async function mensajeDeError(res: Response): Promise<string> {
  const body = (await res.json()) as { error: { message: string } };
  return body.error.message;
}

function humanos(detalle: Detalle) {
  return detalle.messages.filter((m) => m.senderType === "HUMAN");
}

before(async () => {
  const started = await startTestApp();
  baseUrl = started.url;
  closeApp = started.close;

  const org = await prisma.organization.create({
    data: {
      name: `Reply ${randomUUID()}`,
      slug: `reply-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  orgId = org.id;
  const branch = await prisma.branch.create({
    data: { organizationId: orgId, name: "Centro", timezone: "America/Montevideo" },
  });
  branchId = branch.id;
  phoneNumberId = `9${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 18);
  const agentBase = {
    organizationId: orgId,
    branchId,
    instructions: "Atendé consultas.",
    modelProvider: "openrouter",
    modelName: "test/model",
    enabledTools: [],
    guardrails: {},
  };
  agentId = (
    await prisma.agent.create({
      data: {
        ...agentBase,
        name: "Vera",
        channels: ["WHATSAPP"],
        whatsappPhoneNumberId: phoneNumberId,
      },
    })
  ).id;
  agentWebId = (
    await prisma.agent.create({ data: { ...agentBase, name: "Nilo", channels: ["WEB"] } })
  ).id;
  agentMetaId = (
    await prisma.agent.create({
      data: {
        ...agentBase,
        name: "Mia",
        channels: ["MESSENGER", "INSTAGRAM"],
        facebookPageId: PAGINA_CONECTADA,
      },
    })
  ).id;

  const otra = await prisma.organization.create({
    data: {
      name: `Reply B ${randomUUID()}`,
      slug: `reply-b-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  otraOrgId = otra.id;
  const otraBranch = await prisma.branch.create({
    data: { organizationId: otraOrgId, name: "Costa", timezone: "America/Montevideo" },
  });
  await prisma.agent.create({
    data: {
      ...agentBase,
      organizationId: otraOrgId,
      branchId: otraBranch.id,
      name: "Otro",
      channels: ["WHATSAPP"],
    },
  });

  admin = await createFixtureUser("admin", orgId, "ADMIN");
  vendedor = await createFixtureUser("vendedor", orgId, "USER");
  otroVendedor = await createFixtureUser("otro-vendedor", orgId, "USER");
  adminOtraOrg = await createFixtureUser("admin-b", otraOrgId, "ADMIN");
});

after(async () => {
  if (closeApp) await closeApp();
  for (const id of [orgId, otraOrgId]) {
    if (!id) continue;
    await prisma.activity.deleteMany({ where: { organizationId: id } });
    await prisma.agentInboundJob.deleteMany({ where: { organizationId: id } });
    await prisma.message.deleteMany({ where: { organizationId: id } });
    await prisma.conversation.deleteMany({ where: { organizationId: id } });
    await prisma.agent.deleteMany({ where: { organizationId: id } });
    await prisma.contact.deleteMany({ where: { organizationId: id } });
    await prisma.branch.deleteMany({ where: { organizationId: id } });
    await prisma.user.deleteMany({ where: { organizationId: id } });
    await prisma.organization.delete({ where: { id } });
  }
  for (const u of [admin, vendedor, otroVendedor, adminOtraOrg]) {
    if (u) await getSupabaseAdmin().auth.admin.deleteUser(u.authUserId);
  }
});

// ---------------------------------------------------------------------------
// 1. El envío
// ---------------------------------------------------------------------------

test("el vendedor asignado responde: sale por WhatsApp y queda HUMAN / SENT con su wamid", async () => {
  const conv = await crearConversacion({ assignedUserId: vendedor.userId });
  const antes = envios.length;

  const res = await responder(vendedor.accessToken, conv.id, "  Hola, soy de la concesionaria.  ");
  assert.equal(res.status, 201, await res.clone().text());
  const detalle = (await res.json()) as Detalle;

  assert.equal(envios.length, antes + 1);
  const envio = envios.at(-1)!;
  assert.equal(envio.phoneNumberId, phoneNumberId, "sale desde el número del agente");
  assert.equal(envio.to, conv.waId, "al número del cliente");
  assert.equal(envio.body, "Hola, soy de la concesionaria.", "el texto va recortado");

  const [mensaje] = humanos(detalle);
  assert.equal(mensaje.direction, "OUTBOUND");
  assert.equal(mensaje.senderUserId, vendedor.userId);
  assert.equal(mensaje.deliveryStatus, "SENT");
  assert.match(mensaje.externalMessageId ?? "", /^wamid\./, "el wamid queda para los estados");
  assert.equal(detalle.status, "TRANSFERRED_TO_HUMAN");
  assert.equal(detalle.agentPaused, true);
  assert.equal(detalle.assignedUserId, vendedor.userId);
});

test("un estado de Meta posterior (entregado) encuentra el mensaje por su wamid", async () => {
  const conv = await crearConversacion({ assignedUserId: vendedor.userId });
  const detalle = (await (
    await responder(vendedor.accessToken, conv.id, "Hola")
  ).json()) as Detalle;
  const [mensaje] = humanos(detalle);
  const aplicado = await applyDeliveryStatusByExternalId(orgId, mensaje.externalMessageId!, {
    status: "DELIVERED",
  });
  assert.equal(aplicado.count, 1);
});

test("un ADMIN responde una conversación sin asignar y pasa a ser suya", async () => {
  const conv = await crearConversacion({ status: "ACTIVE", assignedUserId: null });
  const res = await responder(admin.accessToken, conv.id, "Te atiendo yo");
  assert.equal(res.status, 201);
  const detalle = (await res.json()) as Detalle;
  assert.equal(detalle.assignedUserId, admin.userId);
  assert.equal(detalle.status, "TRANSFERRED_TO_HUMAN", "contestar sin handoff previo la deriva");
});

test("un ADMIN que responde una conversación de otro vendedor no se la quita", async () => {
  const conv = await crearConversacion({ assignedUserId: vendedor.userId });
  const detalle = (await (await responder(admin.accessToken, conv.id, "Hola")).json()) as Detalle;
  assert.equal(detalle.assignedUserId, vendedor.userId);
});

// ---------------------------------------------------------------------------
// 2. Permisos
// ---------------------------------------------------------------------------

test("un vendedor que no es el asignado no puede responder: 403 y no sale nada", async () => {
  const conv = await crearConversacion({ assignedUserId: vendedor.userId });
  const antes = envios.length;
  const res = await responder(otroVendedor.accessToken, conv.id, "Hola");
  assert.equal(res.status, 403);
  assert.equal(await mensajeDeError(res), MENSAJE_SIN_PERMISO);
  assert.equal(envios.length, antes);
  assert.equal(
    await prisma.message.count({ where: { conversationId: conv.id, senderType: "HUMAN" } }),
    0,
  );
});

test("una conversación sin asignar solo la toma un ADMIN: un vendedor recibe 403", async () => {
  const conv = await crearConversacion({ assignedUserId: null });
  const res = await responder(vendedor.accessToken, conv.id, "Hola");
  assert.equal(res.status, 403);
});

test("otra organización: 404 en responder, reintentar y devolver", async () => {
  const conv = await crearConversacion({ assignedUserId: vendedor.userId });
  assert.equal((await responder(adminOtraOrg.accessToken, conv.id, "Hola")).status, 404);
  assert.equal(
    (await call("POST", `/api/conversations/${conv.id}/return-to-agent`, adminOtraOrg.accessToken))
      .status,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        `/api/conversations/${conv.id}/messages/${randomUUID()}/retry`,
        adminOtraOrg.accessToken,
      )
    ).status,
    404,
  );
});

test("sin sesión es 401; texto vacío o faltante es 400", async () => {
  const conv = await crearConversacion({ assignedUserId: vendedor.userId });
  assert.equal((await responder("", conv.id, "Hola")).status, 401);
  assert.equal((await responder(admin.accessToken, conv.id, "   ")).status, 400);
  assert.equal(
    (await call("POST", `/api/conversations/${conv.id}/messages`, admin.accessToken, {})).status,
    400,
  );
  assert.equal((await responder(admin.accessToken, conv.id, "x".repeat(4097))).status, 400);
});

// ---------------------------------------------------------------------------
// 3. Ventana de 24 h, canal y status
// ---------------------------------------------------------------------------

test("pasadas 24 h del último mensaje del cliente: 409 con la explicación y no sale nada", async () => {
  const conv = await crearConversacion({
    assignedUserId: vendedor.userId,
    ultimoEntranteHace: 25 * HORA,
  });
  const antes = envios.length;
  const res = await responder(vendedor.accessToken, conv.id, "Hola");
  assert.equal(res.status, 409);
  assert.equal(await mensajeDeError(res), MENSAJE_VENTANA_VENCIDA);
  assert.equal(envios.length, antes);

  const detalle = (await (
    await call("GET", `/api/conversations/${conv.id}`, admin.accessToken)
  ).json()) as Detalle;
  assert.ok(detalle.replyWindowEndsAt, "el detalle dice cuándo venció");
  assert.ok(new Date(detalle.replyWindowEndsAt) < new Date());
});

test("dentro de la ventana, el detalle dice hasta cuándo se puede responder", async () => {
  const conv = await crearConversacion({ ultimoEntranteHace: 2 * HORA });
  const detalle = (await (
    await call("GET", `/api/conversations/${conv.id}`, admin.accessToken)
  ).json()) as Detalle;
  const fin = new Date(detalle.replyWindowEndsAt!).getTime();
  const esperado = Date.now() + 22 * HORA;
  assert.ok(Math.abs(fin - esperado) < 60_000, "24 h desde el último mensaje del cliente");
});

test("si el cliente nunca escribió, no hay ventana: 409", async () => {
  const conv = await crearConversacion({ ultimoEntranteHace: null });
  const res = await responder(admin.accessToken, conv.id, "Hola");
  assert.equal(res.status, 409);
  assert.equal(await mensajeDeError(res), MENSAJE_VENTANA_VENCIDA);
});

test("web: se responde sin ventana (el visitante escribió hace días) y queda en el hilo, SENT, sin envío", async () => {
  const conv = await crearConversacion({
    channel: "WEB",
    assignedUserId: vendedor.userId,
    ultimoEntranteHace: 72 * HORA,
  });
  const antes = envios.length + enviosMeta.length;

  const res = await responder(vendedor.accessToken, conv.id, "Hola, te escribo del equipo");
  assert.equal(res.status, 201, await res.clone().text());
  const detalle = (await res.json()) as Detalle;

  assert.equal(envios.length + enviosMeta.length, antes, "la web no manda por ningún lado");
  const [mensaje] = humanos(detalle);
  assert.equal(mensaje.deliveryStatus, "SENT");
  assert.equal(detalle.replyWindowEndsAt, null, "la web no tiene ventana");
  assert.equal(detalle.agentPaused, true);
});

test("una conversación cerrada no se responde (409)", async () => {
  const conv = await crearConversacion({ status: "CLOSED" });
  const res = await responder(admin.accessToken, conv.id, "Hola");
  assert.equal(res.status, 409);
  assert.equal(await mensajeDeError(res), MENSAJE_CERRADA);
});

// ---------------------------------------------------------------------------
// 4. Errores de Meta y reintento
// ---------------------------------------------------------------------------

test("si Meta rechaza el envío, el mensaje queda FAILED con el motivo y se reintenta el MISMO", async () => {
  const conv = await crearConversacion({ assignedUserId: vendedor.userId });
  proximoFallo = new WhatsappGraphError(
    400,
    JSON.stringify({ error: { message: "Recipient phone number not in allowed list" } }),
  );

  const res = await responder(vendedor.accessToken, conv.id, "¿Te llegó?");
  assert.equal(res.status, 201, "un fallo de Meta no es un error del request");
  const detalle = (await res.json()) as Detalle;
  const [fallido] = humanos(detalle);
  assert.equal(fallido.deliveryStatus, "FAILED");
  assert.equal(fallido.deliveryError, "Recipient phone number not in allowed list");
  assert.equal(detalle.agentPaused, true, "el agente se calla igual: la persona tomó el hilo");

  const antes = envios.length;
  const retry = await call(
    "POST",
    `/api/conversations/${conv.id}/messages/${fallido.id}/retry`,
    vendedor.accessToken,
  );
  assert.equal(retry.status, 200, await retry.clone().text());
  const despues = (await retry.json()) as Detalle;
  assert.equal(envios.length, antes + 1);
  assert.equal(envios.at(-1)!.body, "¿Te llegó?");
  const reenviados = humanos(despues);
  assert.equal(reenviados.length, 1, "no se duplicó el mensaje");
  assert.equal(reenviados[0].id, fallido.id);
  assert.equal(reenviados[0].deliveryStatus, "SENT");
  assert.equal(reenviados[0].deliveryError, null);
});

test("un corte de red también queda FAILED, no como un 500", async () => {
  const conv = await crearConversacion({ assignedUserId: vendedor.userId });
  proximoFallo = new Error("fetch failed");
  const res = await responder(vendedor.accessToken, conv.id, "Hola");
  assert.equal(res.status, 201);
  const [fallido] = humanos((await res.json()) as Detalle);
  assert.equal(fallido.deliveryStatus, "FAILED");
});

test("reintentar un mensaje que ya salió es 409; uno que no es de la conversación, 404", async () => {
  const conv = await crearConversacion({ assignedUserId: vendedor.userId });
  const detalle = (await (
    await responder(vendedor.accessToken, conv.id, "Hola")
  ).json()) as Detalle;
  const [enviado] = humanos(detalle);
  const res = await call(
    "POST",
    `/api/conversations/${conv.id}/messages/${enviado.id}/retry`,
    vendedor.accessToken,
  );
  assert.equal(res.status, 409);

  const otra = await crearConversacion({ assignedUserId: vendedor.userId });
  const cruzado = await call(
    "POST",
    `/api/conversations/${otra.id}/messages/${enviado.id}/retry`,
    vendedor.accessToken,
  );
  assert.equal(cruzado.status, 404);
});

// ---------------------------------------------------------------------------
// 5. El agente callado y "Devolver al agente"
// ---------------------------------------------------------------------------

function proveedorQueCuenta(): { proveedor: LlmProvider; llamadas: () => number } {
  let llamadas = 0;
  return {
    proveedor: {
      name: "openrouter",
      complete: async () => {
        llamadas++;
        return { text: "Respuesta del agente", toolCalls: [] };
      },
    },
    llamadas: () => llamadas,
  };
}

function turnoDelCliente(conv: { contactId: string; waId: string }, proveedor: LlmProvider) {
  return runAgentTurn(
    {
      organizationId: orgId,
      agentId,
      contactId: conv.contactId,
      channel: "WHATSAPP",
      texto: "¿Y el precio?",
      externalThreadId: conv.waId,
    },
    { llmProvider: proveedor },
  );
}

test("después de que una persona responde, el agente no contesta; devuelto, vuelve a contestar", async () => {
  const conv = await crearConversacion({ status: "ACTIVE", assignedUserId: vendedor.userId });
  assert.equal((await responder(vendedor.accessToken, conv.id, "Te atiendo yo")).status, 201);

  const callado = proveedorQueCuenta();
  const turno = await turnoDelCliente(conv, callado.proveedor);
  assert.equal(turno.respuesta, null, "el agente no contesta");
  assert.equal(callado.llamadas(), 0, "ni siquiera llama al modelo");
  assert.equal(
    turno.conversationId,
    conv.id,
    "el mensaje del cliente cae en la misma conversación",
  );

  const devuelta = await call(
    "POST",
    `/api/conversations/${conv.id}/return-to-agent`,
    vendedor.accessToken,
  );
  assert.equal(devuelta.status, 200);
  const detalle = (await devuelta.json()) as Detalle;
  assert.equal(detalle.status, "ACTIVE");
  assert.equal(detalle.agentPaused, false);
  assert.equal(detalle.assignedUserId, vendedor.userId, "el vendedor sigue asignado");

  const activo = proveedorQueCuenta();
  const otroTurno = await turnoDelCliente(conv, activo.proveedor);
  assert.equal(activo.llamadas(), 1);
  assert.equal(otroTurno.respuesta, "Respuesta del agente");
});

test("devolver al agente: el vendedor no asignado recibe 403; devolver una ya activa es idempotente", async () => {
  const conv = await crearConversacion({ assignedUserId: vendedor.userId });
  const ajeno = await call(
    "POST",
    `/api/conversations/${conv.id}/return-to-agent`,
    otroVendedor.accessToken,
  );
  assert.equal(ajeno.status, 403);

  const activa = await crearConversacion({ status: "ACTIVE", assignedUserId: vendedor.userId });
  const res = await call(
    "POST",
    `/api/conversations/${activa.id}/return-to-agent`,
    admin.accessToken,
  );
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as Detalle).status, "ACTIVE");
});

test("devolver una cerrada no la reabre", async () => {
  const conv = await crearConversacion({ status: "CLOSED" });
  const res = await call(
    "POST",
    `/api/conversations/${conv.id}/return-to-agent`,
    admin.accessToken,
  );
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as Detalle).status, "CLOSED");
});

// ---------------------------------------------------------------------------
// 6. "Devolver al agente" sin haberle respondido al cliente
// ---------------------------------------------------------------------------

interface DetalleConMarca extends Detalle {
  humanRequestUnanswered: boolean;
}

function avisos(detalle: Detalle) {
  return detalle.messages.filter(
    (m) => m.senderType === "AUTOMATION" && m.content === AVISO_SIN_RESPUESTA,
  );
}

async function devolver(token: string, conversationId: string) {
  const res = await call("POST", `/api/conversations/${conversationId}/return-to-agent`, token);
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()) as DetalleConMarca;
}

async function detalleDe(conversationId: string) {
  const res = await call("GET", `/api/conversations/${conversationId}`, admin.accessToken);
  return (await res.json()) as DetalleConMarca;
}

async function marcaEnElListado(contactId: string): Promise<boolean> {
  const res = await call("GET", `/api/conversations?contactId=${contactId}`, admin.accessToken);
  const body = (await res.json()) as { data: { humanRequestUnanswered: boolean }[] };
  assert.equal(body.data.length, 1);
  return body.data[0].humanRequestUnanswered;
}

// La tarea que deja una derivación con vendedor (crearActivityDeAviso).
function tareaDeDerivacion(contactId: string, assigneeId: string) {
  return prisma.activity.create({
    data: {
      organizationId: orgId,
      authorId: assigneeId,
      assigneeId,
      contactId,
      type: "TASK",
      subject: `${PREFIJO_TAREA_DE_DERIVACION}Vera: Cliente`,
    },
  });
}

function tareasDelContacto(contactId: string) {
  return prisma.activity.findMany({ where: { organizationId: orgId, contactId } });
}

test("devolver sin responder: el cliente recibe el aviso, la tarea sigue abierta y aparece la marca", async () => {
  const conv = await crearConversacion({ assignedUserId: vendedor.userId });
  const tarea = await tareaDeDerivacion(conv.contactId, vendedor.userId);
  const antes = envios.length;

  const detalle = await devolver(vendedor.accessToken, conv.id);

  assert.equal(detalle.status, "ACTIVE", "el agente sigue atendiendo");
  assert.equal(envios.length, antes + 1);
  const envio = envios.at(-1)!;
  assert.equal(envio.body, AVISO_SIN_RESPUESTA, "texto fijo, no del modelo");
  assert.equal(envio.phoneNumberId, phoneNumberId);
  assert.equal(envio.to, conv.waId);
  const [aviso] = avisos(detalle);
  assert.equal(aviso.direction, "OUTBOUND");
  assert.equal(aviso.deliveryStatus, "SENT");
  assert.match(aviso.externalMessageId ?? "", /^wamid\./);
  assert.equal(detalle.humanRequestUnanswered, true);
  assert.equal(await marcaEnElListado(conv.contactId), true);

  const tareas = await tareasDelContacto(conv.contactId);
  assert.equal(tareas.length, 1, "la tarea de la derivación no se duplica");
  assert.equal(tareas[0].id, tarea.id);
  assert.equal(tareas[0].completedAt, null, "y no se toca");

  // Completar la tarea apaga la marca.
  await prisma.activity.update({ where: { id: tarea.id }, data: { completedAt: new Date() } });
  assert.equal((await detalleDe(conv.id)).humanRequestUnanswered, false);
  assert.equal(await marcaEnElListado(conv.contactId), false);
});

test("devolver dos veces seguidas manda un solo aviso", async () => {
  const conv = await crearConversacion({ assignedUserId: vendedor.userId });
  await tareaDeDerivacion(conv.contactId, vendedor.userId);
  const antes = envios.length;

  await devolver(vendedor.accessToken, conv.id);
  const segunda = await devolver(vendedor.accessToken, conv.id);

  assert.equal(envios.length, antes + 1);
  assert.equal(avisos(segunda).length, 1);
  assert.equal((await tareasDelContacto(conv.contactId)).length, 1);
});

test("si una persona ya le había respondido, devolver queda como antes: sin aviso ni marca", async () => {
  const conv = await crearConversacion({ assignedUserId: vendedor.userId });
  await responder(vendedor.accessToken, conv.id, "Hola, te atiendo yo");
  const antes = envios.length;

  const detalle = await devolver(vendedor.accessToken, conv.id);

  assert.equal(detalle.status, "ACTIVE");
  assert.equal(envios.length, antes);
  assert.equal(avisos(detalle).length, 0);
  assert.equal(detalle.humanRequestUnanswered, false);
  assert.equal((await tareasDelContacto(conv.contactId)).length, 0);
});

test("con la ventana de 24 h cerrada el aviso no sale: queda FAILED con el motivo, y la marca igual", async () => {
  const conv = await crearConversacion({
    assignedUserId: vendedor.userId,
    ultimoEntranteHace: 25 * HORA,
  });
  await tareaDeDerivacion(conv.contactId, vendedor.userId);
  const antes = envios.length;

  const detalle = await devolver(vendedor.accessToken, conv.id);

  assert.equal(envios.length, antes, "no se le pide nada a Meta");
  const [aviso] = avisos(detalle);
  assert.equal(aviso.deliveryStatus, "FAILED");
  assert.equal(aviso.deliveryError, MOTIVO_VENTANA_CERRADA);
  assert.equal(detalle.status, "ACTIVE");
  assert.equal(detalle.humanRequestUnanswered, true);
});

test("sin vendedor (derivación sin tarea): se crea una para el ADMIN, y la marca se va cuando una persona escribe", async () => {
  const conv = await crearConversacion({ assignedUserId: null });

  const detalle = await devolver(admin.accessToken, conv.id);
  assert.equal(avisos(detalle).length, 1);
  assert.equal(detalle.humanRequestUnanswered, true);

  const [tarea] = await tareasDelContacto(conv.contactId);
  assert.equal(tarea.type, "TASK");
  assert.equal(tarea.assigneeId, admin.userId);
  assert.equal(tarea.completedAt, null);
  assert.match(
    tarea.subject,
    /^Contactar a Cliente .+: pidió hablar con una persona y nadie respondió$/,
  );

  assert.equal((await responder(admin.accessToken, conv.id, "Hola, ya te llamo")).status, 201);
  assert.equal((await detalleDe(conv.id)).humanRequestUnanswered, false);
  assert.equal(await marcaEnElListado(conv.contactId), false);
});

test("un vendedor que devuelve sin tarea abierta: la nueva tarea va a un ADMIN activo", async () => {
  const conv = await crearConversacion({ assignedUserId: vendedor.userId });

  await devolver(vendedor.accessToken, conv.id);

  const [tarea] = await tareasDelContacto(conv.contactId);
  assert.equal(tarea.assigneeId, admin.userId);
  assert.equal(tarea.authorId, vendedor.userId);
});

test("Web: el aviso queda en el hilo (SENT, para el widget), sin envío", async () => {
  const conv = await crearConversacion({ channel: "WEB", assignedUserId: vendedor.userId });
  await tareaDeDerivacion(conv.contactId, vendedor.userId);
  const antes = envios.length + enviosMeta.length;

  const detalle = await devolver(vendedor.accessToken, conv.id);

  assert.equal(envios.length + enviosMeta.length, antes);
  const [aviso] = avisos(detalle);
  assert.equal(aviso.deliveryStatus, "SENT");
  assert.equal(detalle.humanRequestUnanswered, true);
});

// ---------------------------------------------------------------------------
// 7. El aviso fuera del horario de la sucursal
// ---------------------------------------------------------------------------

// Un horario que está cerrado AHORA, corra el test cuando corra: abre solo
// pasado mañana (en la zona de la sucursal), de 9 a 20.
function horarioCerradoAhora(zona: string): FranjaSemanal[] {
  const DIAS = [
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
    "SUNDAY",
  ] as const;
  const pasadoManana = DateTime.now().setZone(zona).plus({ days: 2 });
  return [{ weekday: DIAS[pasadoManana.weekday - 1]!, startMinute: 9 * 60, endMinute: 20 * 60 }];
}

async function conHorario<T>(franjas: FranjaSemanal[], fn: () => Promise<T>): Promise<T> {
  await prisma.branchBusinessHours.createMany({
    data: franjas.map((f) => ({ organizationId: orgId, branchId, ...f })),
  });
  try {
    return await fn();
  } finally {
    await prisma.branchBusinessHours.deleteMany({ where: { organizationId: orgId, branchId } });
  }
}

test("fuera de horario el aviso dice cuándo atiende el equipo y cuándo le escriben; la marca funciona igual", async () => {
  const franjas = horarioCerradoAhora("America/Montevideo");
  const esperado = textoDelAviso(atencionFueraDeHorario(franjas, "America/Montevideo", new Date()));
  assert.notEqual(esperado, AVISO_SIN_RESPUESTA);
  assert.ok(esperado.startsWith(PREFIJO_DEL_AVISO));
  assert.match(
    esperado,
    /Nuestro equipo atiende los \S+ de 9 a 20 h\. Te vamos a escribir el \S+ a partir de las 9\./,
  );

  const conv = await crearConversacion({ assignedUserId: vendedor.userId });
  await tareaDeDerivacion(conv.contactId, vendedor.userId);
  const antes = envios.length;

  const detalle = await conHorario(franjas, () => devolver(vendedor.accessToken, conv.id));

  assert.equal(envios.length, antes + 1);
  assert.equal(envios.at(-1)!.body, esperado);
  const aviso = detalle.messages.filter((m) => m.senderType === "AUTOMATION");
  assert.equal(aviso.length, 1);
  assert.equal(aviso[0].content, esperado);
  // El aviso con horario se reconoce igual: detalle y listado.
  assert.equal(detalle.humanRequestUnanswered, true);
  assert.equal(await marcaEnElListado(conv.contactId), true);
});

test("dentro del horario cargado el aviso es el de siempre", async () => {
  const todoElDia: FranjaSemanal[] = (
    ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const
  ).map((weekday) => ({ weekday, startMinute: 0, endMinute: 24 * 60 }));
  const conv = await crearConversacion({ assignedUserId: vendedor.userId });
  await tareaDeDerivacion(conv.contactId, vendedor.userId);

  await conHorario(todoElDia, () => devolver(vendedor.accessToken, conv.id));

  assert.equal(envios.at(-1)!.body, AVISO_SIN_RESPUESTA);
});

// ---------------------------------------------------------------------------
// 8. Messenger e Instagram
// ---------------------------------------------------------------------------

for (const canal of ["MESSENGER", "INSTAGRAM"] as const) {
  test(`${canal}: el vendedor asignado responde por el Send API con el token de la página y queda HUMAN / SENT`, async () => {
    const conv = await crearConversacion({ channel: canal, assignedUserId: vendedor.userId });
    const antes = enviosMeta.length;

    const res = await responder(vendedor.accessToken, conv.id, "  Hola, te escribo del equipo  ");
    assert.equal(res.status, 201, await res.clone().text());
    const detalle = (await res.json()) as Detalle;

    assert.equal(enviosMeta.length, antes + 1);
    assert.deepEqual(enviosMeta.at(-1), {
      pageAccessToken: `page-token-${PAGINA_CONECTADA}`,
      recipientId: conv.waId,
      text: "Hola, te escribo del equipo",
    });
    const [mensaje] = humanos(detalle);
    assert.equal(mensaje.senderUserId, vendedor.userId);
    assert.equal(mensaje.deliveryStatus, "SENT");
    assert.equal(detalle.status, "TRANSFERRED_TO_HUMAN");
    assert.equal(detalle.agentPaused, true, "el agente queda en pausa");
    assert.ok(detalle.replyWindowEndsAt, "el detalle dice hasta cuándo se puede responder");
  });
}

test("Messenger: un vendedor que no es el asignado recibe 403 y no sale nada", async () => {
  const conv = await crearConversacion({ channel: "MESSENGER", assignedUserId: vendedor.userId });
  const antes = enviosMeta.length;
  const res = await responder(otroVendedor.accessToken, conv.id, "Hola");
  assert.equal(res.status, 403);
  assert.equal(await mensajeDeError(res), MENSAJE_SIN_PERMISO);
  assert.equal(enviosMeta.length, antes);
});

test("Instagram con la ventana de 24 h vencida: 409 con la explicación y no sale nada", async () => {
  const conv = await crearConversacion({
    channel: "INSTAGRAM",
    assignedUserId: vendedor.userId,
    ultimoEntranteHace: 25 * HORA,
  });
  const antes = enviosMeta.length;
  const res = await responder(vendedor.accessToken, conv.id, "Hola");
  assert.equal(res.status, 409);
  assert.equal(await mensajeDeError(res), MENSAJE_VENTANA_VENCIDA_META);
  assert.equal(enviosMeta.length, antes);
  assert.equal(
    await prisma.message.count({ where: { conversationId: conv.id, senderType: "HUMAN" } }),
    0,
  );
});

test("Messenger: si Meta lo rechaza queda FAILED con el motivo, y se reintenta el MISMO mensaje", async () => {
  const conv = await crearConversacion({ channel: "MESSENGER", assignedUserId: vendedor.userId });
  proximoFalloMeta = new MetaSendError(
    400,
    JSON.stringify({ error: { message: "This message is sent outside of allowed window." } }),
    10,
    2018278,
  );

  const res = await responder(vendedor.accessToken, conv.id, "Hola");
  assert.equal(res.status, 201, "un rechazo de Meta no es un fallo del request");
  const [fallido] = humanos((await res.json()) as Detalle);
  assert.equal(fallido.deliveryStatus, "FAILED");
  assert.equal(fallido.deliveryError, MENSAJE_VENTANA_VENCIDA_META);

  const antes = enviosMeta.length;
  const reintento = await call(
    "POST",
    `/api/conversations/${conv.id}/messages/${fallido.id}/retry`,
    vendedor.accessToken,
  );
  assert.equal(reintento.status, 200, await reintento.clone().text());
  const mensajes = humanos((await reintento.json()) as Detalle);
  assert.equal(mensajes.length, 1, "es el mismo mensaje, no uno nuevo");
  assert.equal(mensajes[0]!.deliveryStatus, "SENT");
  assert.equal(enviosMeta.length, antes + 1);
});

test("Messenger: si la organización reconectó otra página, queda FAILED con el motivo y no sale nada", async () => {
  const conv = await crearConversacion({
    channel: "MESSENGER",
    assignedUserId: vendedor.userId,
    pageId: "pagina-anterior",
  });
  const antes = enviosMeta.length;
  const res = await responder(vendedor.accessToken, conv.id, "Hola");
  assert.equal(res.status, 201);
  const [mensaje] = humanos((await res.json()) as Detalle);
  assert.equal(mensaje.deliveryStatus, "FAILED");
  assert.equal(mensaje.deliveryError, MENSAJE_PAGINA_RECONECTADA);
  assert.equal(enviosMeta.length, antes);
});

test("Instagram: devolver sin responder le manda el aviso por el Send API y deja la marca", async () => {
  const conv = await crearConversacion({ channel: "INSTAGRAM", assignedUserId: vendedor.userId });
  await tareaDeDerivacion(conv.contactId, vendedor.userId);
  const antes = enviosMeta.length;

  const detalle = await devolver(vendedor.accessToken, conv.id);

  assert.equal(detalle.status, "ACTIVE");
  assert.equal(enviosMeta.length, antes + 1);
  assert.equal(enviosMeta.at(-1)!.recipientId, conv.waId);
  assert.ok(enviosMeta.at(-1)!.text.startsWith(PREFIJO_DEL_AVISO));
  const [aviso] = avisos(detalle);
  assert.equal(aviso.deliveryStatus, "SENT");
  assert.equal(detalle.humanRequestUnanswered, true);
});

test("Messenger con la ventana cerrada: el aviso no sale, queda FAILED con el motivo de Meta", async () => {
  const conv = await crearConversacion({
    channel: "MESSENGER",
    assignedUserId: vendedor.userId,
    ultimoEntranteHace: 30 * HORA,
  });
  await tareaDeDerivacion(conv.contactId, vendedor.userId);
  const antes = enviosMeta.length;

  const detalle = await devolver(vendedor.accessToken, conv.id);

  assert.equal(enviosMeta.length, antes);
  const [aviso] = avisos(detalle);
  assert.equal(aviso.deliveryStatus, "FAILED");
  assert.equal(aviso.deliveryError, MOTIVO_VENTANA_CERRADA_META);
});
