import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { Express } from "express";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";
import { createEmbedToken } from "../services/agentEmbedToken.service";
import {
  devolverAlAgente,
  responderDesdeElCrm,
  type DepsDeRespuestaHumana,
} from "../services/conversationReply.service";
import { resetLlmProviderParaTests, setLlmProviderForTests } from "../services/llmProvider.service";
import { PREFIJO_DEL_AVISO } from "../services/avisoSinRespuesta.service";

// ---------------------------------------------------------------------------
// El widget recibe lo que escribe una persona del equipo:
// POST /api/public/agents/:agentId/web/thread, por HTTP real contra LA APP
// REAL de app.ts (su cadena de CORS, parser y embed token) y Postgres real.
// La respuesta de la persona sale de responderDesdeElCrm, el mismo servicio
// del endpoint del CRM; el LLM del primer mensaje del visitante es un doble.
//
// Lo que se prueba:
//   1. El visitante escribe, una persona responde desde el CRM, y el polling
//      del widget trae esa respuesta (y solo esa: la del agente ya la pintó
//      el POST). Al llegarle, el mensaje pasa a DELIVERED.
//   2. Al volver (sin cursor), el historial completo de la sesión, en orden.
//   3. El aviso de "nadie disponible" también le llega.
//   4. Alcance: otra sesión, otro agente u otro token no ven nada; una sesión
//      sin conversación devuelve vacío y no crea un contacto.
//   5. La misma seguridad que web/messages: sin token o con un Origin no
//      permitido, el 401 genérico; validación del cuerpo.
// ---------------------------------------------------------------------------

const ORIGEN = "https://cliente.example";
const PASSWORD = "Widget-thread-password-123!";

const sinMeta: DepsDeRespuestaHumana = {
  accessToken: () => undefined,
  sendText: () => Promise.reject(new Error("la web no manda por WhatsApp")),
  pageAccessToken: () => Promise.reject(new Error("la web no manda por Meta")),
  sendMetaText: () => Promise.reject(new Error("la web no manda por Meta")),
};

let baseUrl: string;
let cerrar: () => Promise<void>;
let orgId: string;
let agente: string;
let token: string;
let otroAgente: string;
let tokenOtroAgente: string;
let adminId: string;
let adminAuthId: string;

before(async () => {
  process.env.LOG_LEVEL = "fatal";
  const { app }: { app: Express } = await import("../app.js");
  await new Promise<void>((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      cerrar = () => new Promise((r) => server.close(() => r()));
      resolve();
    });
  });
  setLlmProviderForTests({
    name: "doble",
    complete: () => Promise.resolve({ text: "Hola, soy el asistente.", toolCalls: [] }),
  });

  const org = await prisma.organization.create({
    data: {
      name: `Widget thread ${randomUUID()}`,
      slug: `widget-thread-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  orgId = org.id;
  const branch = await prisma.branch.create({
    data: { organizationId: orgId, name: "Centro", timezone: "America/Montevideo" },
  });
  const crearAgente = async () =>
    (
      await prisma.agent.create({
        data: {
          organizationId: orgId,
          branchId: branch.id,
          name: `Agente ${randomUUID().slice(0, 8)}`,
          instructions: "Atendé.",
          modelProvider: "openrouter",
          modelName: "doble/modelo",
          enabledTools: [],
          channels: ["WEB"],
          guardrails: {},
          allowedOrigins: [ORIGEN],
        },
      })
    ).id;
  agente = await crearAgente();
  otroAgente = await crearAgente();
  token = (await createEmbedToken(orgId, agente)).token;
  tokenOtroAgente = (await createEmbedToken(orgId, otroAgente)).token;

  const email = `widget-thread-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear el usuario de Supabase Auth: ${error?.message}`);
  }
  adminAuthId = data.user.id;
  const rol = await findRoleByName("ADMIN");
  if (!rol) throw new Error("No está sembrado el rol ADMIN.");
  adminId = (
    await prisma.user.create({
      data: { id: adminAuthId, organizationId: orgId, roleId: rol.id, email, fullName: "Admin" },
    })
  ).id;
});

after(async () => {
  resetLlmProviderParaTests();
  if (cerrar) await cerrar();
  if (!orgId) return;
  const where = { organizationId: orgId };
  await prisma.agentInboundJob.deleteMany({ where });
  await prisma.message.deleteMany({ where });
  await prisma.conversation.deleteMany({ where });
  await prisma.activity.deleteMany({ where });
  await prisma.agentEmbedToken.deleteMany({ where });
  await prisma.agent.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.branch.deleteMany({ where });
  await prisma.organization.delete({ where: { id: orgId } });
  if (adminAuthId) await getSupabaseAdmin().auth.admin.deleteUser(adminAuthId);
});

interface Hilo {
  messages: { id: string; role: "visitor" | "agent"; text: string; createdAt: string }[];
  cursor: string;
}

function post(
  path: "messages" | "thread",
  body: unknown,
  opciones: { agentId?: string; token?: string | null; origin?: string } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: opciones.origin ?? ORIGEN,
  };
  const t = opciones.token === undefined ? token : opciones.token;
  if (t !== null) headers["x-embed-token"] = t;
  return fetch(`${baseUrl}/api/public/agents/${opciones.agentId ?? agente}/web/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function leerHilo(sessionId: string, since?: string, agentId?: string, t?: string) {
  const res = await post(
    "thread",
    { sessionId, ...(since ? { since } : {}) },
    { agentId, token: t },
  );
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(res.headers.get("access-control-allow-origin"), ORIGEN);
  return (await res.json()) as Hilo;
}

// El visitante escribe por el widget; devuelve la conversación que se creó.
async function visitanteEscribe(sessionId: string, message = "Hola, quiero hablar con alguien") {
  const res = await post("messages", { sessionId, message });
  assert.equal(res.status, 200, await res.clone().text());
  return ((await res.json()) as { conversationId: string }).conversationId;
}

const actor = () => ({ userId: adminId, role: "ADMIN" as const });

test("el polling trae la respuesta de una persona (no la del agente) y la deja DELIVERED", async () => {
  const sessionId = randomUUID();
  const conversationId = await visitanteEscribe(sessionId);

  // El widget recién abierto: el historial, con lo que ya pintó.
  const inicial = await leerHilo(sessionId);
  assert.deepEqual(
    inicial.messages.map((m) => m.role),
    ["visitor", "agent"],
  );

  // Nada nuevo todavía: vacío, y el cursor no se mueve.
  const sinNovedad = await leerHilo(sessionId, inicial.cursor);
  assert.deepEqual(sinNovedad.messages, []);
  assert.equal(sinNovedad.cursor, inicial.cursor);

  await responderDesdeElCrm(actor(), orgId, conversationId, "Hola, soy Laura del equipo.", sinMeta);
  const enviado = await prisma.message.findFirstOrThrow({
    where: { conversationId, senderType: "HUMAN" },
  });
  assert.equal(enviado.deliveryStatus, "SENT", "en la web no hay envío: queda en el hilo");

  const nuevo = await leerHilo(sessionId, sinNovedad.cursor);
  assert.equal(nuevo.messages.length, 1);
  assert.deepEqual(
    { id: nuevo.messages[0]!.id, role: nuevo.messages[0]!.role, text: nuevo.messages[0]!.text },
    { id: enviado.id, role: "agent", text: "Hola, soy Laura del equipo." },
  );
  assert.equal(
    Object.keys(nuevo.messages[0]!).sort().join(","),
    "createdAt,id,role,text",
    "proyección mínima: nada de senderUserId ni estados",
  );
  assert.equal(
    (await prisma.message.findUniqueOrThrow({ where: { id: enviado.id } })).deliveryStatus,
    "DELIVERED",
    "le llegó al navegador del visitante",
  );
});

test("al volver (sin cursor) el visitante ve el hilo entero, en orden, con la respuesta de la persona", async () => {
  const sessionId = randomUUID();
  const conversationId = await visitanteEscribe(sessionId);
  await responderDesdeElCrm(actor(), orgId, conversationId, "Te escribo yo.", sinMeta);
  await responderDesdeElCrm(actor(), orgId, conversationId, "¿Seguís ahí?", sinMeta);

  const hilo = await leerHilo(sessionId);
  assert.deepEqual(
    hilo.messages.map((m) => m.text),
    [
      "Hola, quiero hablar con alguien",
      "Hola, soy el asistente.",
      "Te escribo yo.",
      "¿Seguís ahí?",
    ],
  );
  assert.equal(hilo.cursor, hilo.messages.at(-1)!.createdAt);
});

test("el aviso de 'nadie disponible' también le llega al widget", async () => {
  const sessionId = randomUUID();
  const conversationId = await visitanteEscribe(sessionId);
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: "TRANSFERRED_TO_HUMAN", assignedUserId: adminId },
  });
  const { cursor } = await leerHilo(sessionId);

  await devolverAlAgente(actor(), orgId, conversationId, sinMeta);

  const nuevo = await leerHilo(sessionId, cursor);
  assert.equal(nuevo.messages.length, 1);
  assert.ok(nuevo.messages[0]!.text.startsWith(PREFIJO_DEL_AVISO));
});

test("alcance: otra sesión, otro agente u otro token no ven nada; una sesión sin conversación no crea contacto", async () => {
  const sessionId = randomUUID();
  const conversationId = await visitanteEscribe(sessionId);
  await responderDesdeElCrm(actor(), orgId, conversationId, "Solo para esta sesión.", sinMeta);

  assert.deepEqual((await leerHilo(randomUUID())).messages, [], "otra sesión");
  assert.deepEqual(
    (await leerHilo(sessionId, undefined, otroAgente, tokenOtroAgente)).messages,
    [],
    "el mismo sessionId en otro agente es otra sesión",
  );

  const contactosAntes = await prisma.contact.count({ where: { organizationId: orgId } });
  await leerHilo(randomUUID());
  assert.equal(
    await prisma.contact.count({ where: { organizationId: orgId } }),
    contactosAntes,
    "leer no da de alta un visitante",
  );
});

test("la misma seguridad que web/messages: token ajeno, sin token u Origin no permitido dan el 401 genérico", async () => {
  const sessionId = randomUUID();
  await visitanteEscribe(sessionId);

  const tokenDeOtro = await post("thread", { sessionId }, { token: tokenOtroAgente });
  assert.equal(tokenDeOtro.status, 401, "el token tiene que ser del agente de la URL");
  assert.equal((await post("thread", { sessionId }, { token: null })).status, 401);
  const intruso = await post("thread", { sessionId }, { origin: "https://intruso.example" });
  assert.equal(intruso.status, 401);
  assert.equal(intruso.headers.get("access-control-allow-origin"), null);
});

test("validación: sin sessionId o con un since que no es una fecha, 400", async () => {
  assert.equal((await post("thread", {})).status, 400);
  assert.equal((await post("thread", { sessionId: "s", since: "ayer" })).status, 400);
});

test("preflight del thread desde un origen permitido refleja ese origen", async () => {
  const res = await fetch(`${baseUrl}/api/public/agents/${agente}/web/thread`, {
    method: "OPTIONS",
    headers: {
      origin: ORIGEN,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,x-embed-token",
    },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), ORIGEN);
});
