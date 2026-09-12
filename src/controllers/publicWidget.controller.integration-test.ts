import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { Express } from "express";
import express from "express";
import { prisma } from "../lib/prisma";
import { authenticateEmbedToken } from "../middlewares/authenticateEmbedToken";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import { createWidgetRateLimiter } from "../middlewares/rateLimit";
import { WIDGET_MAX_BODY_BYTES } from "../middlewares/widgetBody";
import { requireWidgetJsonContentType, widgetJsonParser } from "../middlewares/widgetBody";
import { buildWidgetCorsMiddleware } from "../middlewares/widgetCors";
import { createEmbedToken } from "../services/agentEmbedToken.service";
import { LAST_USED_AT_GRANULARITY_MS } from "../services/ingestAuth.service";
import {
  resetLlmProviderParaTests,
  setLlmProviderForTests,
  type LlmCompletionRequest,
} from "../services/llmProvider.service";
import {
  WIDGET_CONTACT_FIRST_NAME,
  widgetContactLastName,
} from "../services/widgetContact.service";
import { generateEmbedToken } from "../utils/agentEmbedToken";
import { sendWidgetMessageHandler } from "./publicWidget.controller";

// ---------------------------------------------------------------------------
// El endpoint público del canal Web (paso 5b):
// POST /api/public/agents/:agentId/web/messages, por HTTP real contra LA APP
// REAL de app.ts —con su orden de middlewares completo, que es la mitad del
// diseño (CORS del widget antes del cors() global, parser propio antes del
// global)— contra Postgres real. El LLM es el único doble, instalado con
// setLlmProviderForTests como en agent.controller.integration-test.ts.
//
// Lo que este archivo prueba, y por qué cada cosa:
//
//   1. Los NUEVE rechazos de autenticación (header ausente, repetido, basura,
//      revocado, agente borrado, inactivo, agentId que no coincide, Origin
//      ausente, Origin no registrado) dan el MISMO 401 con el MISMO cuerpo —
//      el contrato anti-oráculo, verificado como en la ingesta.
//   2. Caso feliz: req.widgetAuth resuelto, lastUsedAt escrito una vez por
//      ventana, respuesta = proyección mínima.
//   3. CORS: preflight desde un origen permitido refleja ese origen; desde
//      uno no permitido, no; el POST real también lo lleva.
//   4. Rate limit por embedTokenId: el request MAX+1 da 429 con Retry-After y
//      otro token no se ve afectado.
//   5. Continuidad de sesión: mismo sessionId = mismo Contact placeholder y
//      misma Conversation mientras siga ACTIVE; nueva Conversation si estaba
//      CLOSED, con el mismo Contact.
//   6. Validación del cuerpo: 400 / 413 / 415 desde la cadena propia.
//   7. Un AppError de runAgentTurn (agente sin WEB) llega como 400.
// ---------------------------------------------------------------------------

const ORIGEN = "https://cliente.example";
const OTRO_ORIGEN = "https://intruso.example";

interface Fixture {
  orgId: string;
  branchId: string;
  agente: string;
  token: string;
  tokenId: string;
  otroAgente: string;
  tokenOtroAgente: string;
  tokenRevocado: string;
  tokenAgenteInactivo: string;
  tokenAgenteBorrado: string;
  agenteSinWeb: string;
  tokenAgenteSinWeb: string;
  agenteSinOrigenes: string;
  tokenAgenteSinOrigenes: string;
}

let fx: Fixture;
let baseUrl: string;
let cerrar: () => Promise<void>;
let requests: LlmCompletionRequest[] = [];

// Un token con la forma correcta que NUNCA se insertó, generado con el
// generador real para que "inexistente" no sea distinguible por su forma.
const TOKEN_INEXISTENTE = generateEmbedToken().token;

async function crearAgente(
  orgId: string,
  branchId: string,
  overrides: {
    channels?: ("WEB" | "WHATSAPP")[];
    allowedOrigins?: string[];
    isActive?: boolean;
  } = {},
) {
  const agent = await prisma.agent.create({
    data: {
      organizationId: orgId,
      branchId,
      name: `Agente widget ${randomUUID().slice(0, 8)}`,
      instructions: "Sos el agente del widget.",
      modelProvider: "openrouter",
      modelName: "doble/modelo",
      enabledTools: [],
      channels: overrides.channels ?? ["WEB"],
      guardrails: {},
      allowedOrigins: overrides.allowedOrigins ?? [ORIGEN],
      isActive: overrides.isActive ?? true,
    },
  });
  return agent.id;
}

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
    complete(request) {
      requests.push(request);
      return Promise.resolve({ text: "Hola, ¿en qué te ayudo?", toolCalls: [] });
    },
  });

  const org = await prisma.organization.create({
    data: {
      name: `Widget test ${randomUUID()}`,
      slug: `widget-test-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  const branch = await prisma.branch.create({
    data: { organizationId: org.id, name: "Centro", timezone: "America/Montevideo" },
  });

  const agente = await crearAgente(org.id, branch.id);
  const otroAgente = await crearAgente(org.id, branch.id);
  const agenteInactivo = await crearAgente(org.id, branch.id, { isActive: false });
  const agenteBorrado = await crearAgente(org.id, branch.id);
  const agenteSinWeb = await crearAgente(org.id, branch.id, { channels: ["WHATSAPP"] });
  const agenteSinOrigenes = await crearAgente(org.id, branch.id, { allowedOrigins: [] });

  const token = await createEmbedToken(org.id, agente);
  const revocado = await createEmbedToken(org.id, agente);
  await prisma.agentEmbedToken.update({
    where: { id: revocado.id },
    data: { revokedAt: new Date() },
  });
  const tokenBorrado = await createEmbedToken(org.id, agenteBorrado);
  // deletedAt directo, SIN pasar por deleteAgent (que revocaría el token en
  // cascada): así se ejercita la defensa en profundidad del middleware, no la
  // cascada.
  await prisma.agent.update({ where: { id: agenteBorrado }, data: { deletedAt: new Date() } });

  fx = {
    orgId: org.id,
    branchId: branch.id,
    agente,
    token: token.token,
    tokenId: token.id,
    otroAgente,
    tokenOtroAgente: (await createEmbedToken(org.id, otroAgente)).token,
    tokenRevocado: revocado.token,
    tokenAgenteInactivo: (await createEmbedToken(org.id, agenteInactivo)).token,
    tokenAgenteBorrado: tokenBorrado.token,
    agenteSinWeb,
    tokenAgenteSinWeb: (await createEmbedToken(org.id, agenteSinWeb)).token,
    agenteSinOrigenes,
    tokenAgenteSinOrigenes: (await createEmbedToken(org.id, agenteSinOrigenes)).token,
  };
});

after(async () => {
  resetLlmProviderParaTests();
  if (cerrar) await cerrar();
  if (!fx) return;
  const where = { organizationId: fx.orgId };
  await prisma.message.deleteMany({ where });
  await prisma.conversation.deleteMany({ where });
  await prisma.activity.deleteMany({ where });
  await prisma.agentEmbedToken.deleteMany({ where });
  await prisma.agent.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await prisma.branch.deleteMany({ where });
  await prisma.organization.delete({ where: { id: fx.orgId } });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Opciones {
  token?: string;
  origin?: string;
  body?: unknown;
  rawBody?: string;
  contentType?: string;
  url?: string;
}

function enviar(agentId: string, opciones: Opciones = {}): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": opciones.contentType ?? "application/json",
  };
  if (opciones.token !== undefined) headers["x-embed-token"] = opciones.token;
  if (opciones.origin !== undefined) headers.origin = opciones.origin;

  return fetch(`${opciones.url ?? baseUrl}/api/public/agents/${agentId}/web/messages`, {
    method: "POST",
    headers,
    body:
      opciones.rawBody ??
      JSON.stringify(opciones.body ?? { sessionId: randomUUID(), message: "Hola" }),
  });
}

// http.request de Node para poder mandar un header REPETIDO en el wire (fetch
// une los duplicados antes de que salgan) — mismo helper que la ingesta.
function enviarCrudo(
  agentId: string,
  headers: Record<string, string | string[]>,
): Promise<{ status: number; texto: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port: Number(new URL(baseUrl).port),
        path: `/api/public/agents/${agentId}/web/messages`,
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGEN, ...headers },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, texto: data }));
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify({ sessionId: randomUUID(), message: "Hola" }));
  });
}

function preflight(agentId: string, origin: string): Promise<Response> {
  return fetch(`${baseUrl}/api/public/agents/${agentId}/web/messages`, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,x-embed-token",
    },
  });
}

async function conversacionesDe(contactId: string) {
  return prisma.conversation.findMany({ where: { contactId }, orderBy: { createdAt: "asc" } });
}

// ---------------------------------------------------------------------------
// 2. Caso feliz
// ---------------------------------------------------------------------------

test("caso feliz: 200 con la proyección mínima, Contact placeholder, Conversation con el sessionId y ACAO reflejado", async () => {
  const sessionId = randomUUID();
  requests = [];

  const res = await enviar(fx.agente, {
    token: fx.token,
    origin: ORIGEN,
    body: { sessionId, message: "Hola, quiero info" },
  });
  const crudo = await res.text();
  assert.equal(res.status, 200, crudo);

  // Proyección mínima: NADA de toolCalls, handoff, status ni auditoría.
  const body = JSON.parse(crudo) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["conversationId", "respuesta"]);
  assert.equal(body.respuesta, "Hola, ¿en qué te ayudo?");

  // El POST real también lleva el CORS del widget.
  assert.equal(res.headers.get("access-control-allow-origin"), ORIGEN);
  assert.equal(res.headers.get("access-control-allow-credentials"), null);

  // El modelo recibió el mensaje del visitante.
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].messages, [{ role: "user", content: "Hola, quiero info" }]);

  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: String(body.conversationId) },
  });
  assert.equal(conversation.organizationId, fx.orgId);
  assert.equal(conversation.agentId, fx.agente);
  assert.equal(conversation.branchId, fx.branchId);
  assert.equal(conversation.channel, "WEB");
  assert.equal(conversation.externalThreadId, sessionId);

  const contacto = await prisma.contact.findUniqueOrThrow({
    where: { id: conversation.contactId },
  });
  assert.equal(contacto.firstName, WIDGET_CONTACT_FIRST_NAME);
  assert.equal(contacto.lastName, widgetContactLastName(sessionId));
  assert.equal(contacto.lastName.length, 8);
  assert.equal(contacto.ownerId, null);
  assert.equal(contacto.source, "Widget web");
});

test("lastUsedAt del token queda escrito, y dentro de la ventana de un minuto no se reescribe", async () => {
  const nuevo = await createEmbedToken(fx.orgId, fx.agente);
  const inicial = await prisma.agentEmbedToken.findUniqueOrThrow({
    where: { id: nuevo.id },
    select: { lastUsedAt: true },
  });
  assert.equal(inicial.lastUsedAt, null, "nace en null");

  const antes = Date.now();
  assert.equal((await enviar(fx.agente, { token: nuevo.token, origin: ORIGEN })).status, 200);
  const despues = await prisma.agentEmbedToken.findUniqueOrThrow({
    where: { id: nuevo.id },
    select: { lastUsedAt: true },
  });
  assert.ok(despues.lastUsedAt !== null);
  assert.ok(despues.lastUsedAt.getTime() >= antes - 1000);

  assert.equal((await enviar(fx.agente, { token: nuevo.token, origin: ORIGEN })).status, 200);
  const tercera = await prisma.agentEmbedToken.findUniqueOrThrow({
    where: { id: nuevo.id },
    select: { lastUsedAt: true },
  });
  assert.equal(
    tercera.lastUsedAt?.getTime(),
    despues.lastUsedAt.getTime(),
    `dentro de los ${LAST_USED_AT_GRANULARITY_MS} ms no debe haber una segunda escritura`,
  );
});

// ---------------------------------------------------------------------------
// 1. Los rechazos de autenticación: un solo 401, un solo cuerpo
// ---------------------------------------------------------------------------

test("los nueve rechazos de autenticación dan el MISMO 401 con el MISMO cuerpo, y ninguno crea nada", async () => {
  const antes = await prisma.conversation.count({ where: { organizationId: fx.orgId } });

  const casos: [string, () => Promise<{ status: number; texto: string }>][] = [
    ["header ausente", async () => aTexto(await enviar(fx.agente, { origin: ORIGEN }))],
    ["header repetido", () => enviarCrudo(fx.agente, { "x-embed-token": [fx.token, fx.token] })],
    [
      "token basura",
      async () => aTexto(await enviar(fx.agente, { token: "no-es-un-token", origin: ORIGEN })),
    ],
    [
      "token inexistente con forma válida",
      async () => aTexto(await enviar(fx.agente, { token: TOKEN_INEXISTENTE, origin: ORIGEN })),
    ],
    [
      "token revocado",
      async () => aTexto(await enviar(fx.agente, { token: fx.tokenRevocado, origin: ORIGEN })),
    ],
    [
      "agente borrado",
      async () => aTexto(await enviar(fx.agente, { token: fx.tokenAgenteBorrado, origin: ORIGEN })),
    ],
    [
      "agente inactivo",
      async () =>
        aTexto(await enviar(fx.agente, { token: fx.tokenAgenteInactivo, origin: ORIGEN })),
    ],
    [
      "agentId de la URL no coincide con el del token",
      async () => aTexto(await enviar(fx.otroAgente, { token: fx.token, origin: ORIGEN })),
    ],
    ["Origin ausente", async () => aTexto(await enviar(fx.agente, { token: fx.token }))],
    [
      "Origin no registrado",
      async () => aTexto(await enviar(fx.agente, { token: fx.token, origin: OTRO_ORIGEN })),
    ],
    [
      "agente sin orígenes (widget deshabilitado)",
      async () =>
        aTexto(
          await enviar(fx.agenteSinOrigenes, { token: fx.tokenAgenteSinOrigenes, origin: ORIGEN }),
        ),
    ],
  ];

  const respuestas: { caso: string; status: number; texto: string }[] = [];
  for (const [caso, ejecutar] of casos) {
    const r = await ejecutar();
    respuestas.push({ caso, ...r });
  }

  const referencia = respuestas[0];
  assert.equal(referencia.status, 401);
  for (const r of respuestas) {
    assert.equal(
      r.status,
      401,
      `"${r.caso}" respondió ${r.status}: la diferencia permite enumerar`,
    );
    assert.equal(
      r.texto,
      referencia.texto,
      `"${r.caso}" respondió un cuerpo distinto: la diferencia permite enumerar`,
    );
  }
  for (const palabra of ["revoc", "borrad", "inactiv", "existe", "origin", "coincid", "agente"]) {
    assert.ok(
      !referencia.texto.toLowerCase().includes(palabra),
      `el 401 no puede insinuar el motivo (contiene "${palabra}"): ${referencia.texto}`,
    );
  }

  assert.equal(
    await prisma.conversation.count({ where: { organizationId: fx.orgId } }),
    antes,
    "un 401 no crea conversación ni contacto",
  );
});

async function aTexto(res: Response) {
  return { status: res.status, texto: await res.text() };
}

// ---------------------------------------------------------------------------
// 3. CORS
// ---------------------------------------------------------------------------

test("preflight desde un origen permitido refleja ese origen; desde uno no permitido, no", async () => {
  const ok = await preflight(fx.agente, ORIGEN);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("access-control-allow-origin"), ORIGEN);
  assert.match(ok.headers.get("access-control-allow-headers") ?? "", /x-embed-token/i);
  assert.match(ok.headers.get("access-control-allow-methods") ?? "", /POST/);
  assert.equal(ok.headers.get("access-control-max-age"), "600");
  assert.equal(ok.headers.get("access-control-allow-credentials"), null, "sin credenciales");

  const no = await preflight(fx.agente, OTRO_ORIGEN);
  assert.equal(no.status, 204);
  assert.equal(no.headers.get("access-control-allow-origin"), null);

  // Un agente con allowedOrigins vacío no refleja nada: widget deshabilitado.
  const deshabilitado = await preflight(fx.agenteSinOrigenes, ORIGEN);
  assert.equal(deshabilitado.headers.get("access-control-allow-origin"), null);

  // Un agentId que no es UUID tampoco, y sin tocar la base.
  const invalido = await preflight("no-es-uuid", ORIGEN);
  assert.equal(invalido.headers.get("access-control-allow-origin"), null);

  // Normalización: el Origin llega tal cual lo manda el navegador; con otra
  // capitalización del host sigue matcheando el registrado.
  const mayusculas = await preflight(fx.agente, "https://CLIENTE.example");
  assert.equal(mayusculas.headers.get("access-control-allow-origin"), "https://CLIENTE.example");
});

// ---------------------------------------------------------------------------
// 4. Rate limit por embedTokenId
// ---------------------------------------------------------------------------

test("el rate limit cuenta por embedTokenId: el request MAX+1 da 429 con Retry-After y otro token no se ve afectado", async () => {
  const MAX = 2;
  const app = express();
  const PATH = "/api/public/agents/:agentId/web/messages";
  app.use(PATH, buildWidgetCorsMiddleware());
  app.post(
    PATH,
    requireWidgetJsonContentType,
    widgetJsonParser,
    authenticateEmbedToken,
    createWidgetRateLimiter({ windowMs: 60_000, max: MAX }),
    sendWidgetMessageHandler,
  );
  app.use(notFound);
  app.use(errorHandler);
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const limitado = (await createEmbedToken(fx.orgId, fx.agente)).token;
    const otro = (await createEmbedToken(fx.orgId, fx.agente)).token;
    const sessionId = randomUUID();
    const post = (token: string) =>
      enviar(fx.agente, { url, token, origin: ORIGEN, body: { sessionId, message: "hola" } });

    for (let i = 0; i < MAX; i++) {
      assert.equal((await post(limitado)).status, 200, `el request ${i + 1} debe pasar`);
    }
    const bloqueado = await post(limitado);
    assert.equal(bloqueado.status, 429);
    const retryAfter = bloqueado.headers.get("retry-after");
    assert.ok(retryAfter && Number(retryAfter) > 0, "429 tiene que traer Retry-After");

    // Mismo agente, misma IP, otro token: pasa.
    assert.equal((await post(otro)).status, 200);
  } finally {
    await new Promise((r) => server.close(() => r(undefined)));
  }
});

// ---------------------------------------------------------------------------
// 5. Continuidad de sesión
// ---------------------------------------------------------------------------

test("mismo sessionId = mismo Contact y misma Conversation; cerrada la conversación, una nueva con el mismo Contact; otro sessionId = otro Contact", async () => {
  const sessionId = randomUUID();
  const primera = (await (
    await enviar(fx.agente, { token: fx.token, origin: ORIGEN, body: { sessionId, message: "1" } })
  ).json()) as { conversationId: string };
  const segunda = (await (
    await enviar(fx.agente, { token: fx.token, origin: ORIGEN, body: { sessionId, message: "2" } })
  ).json()) as { conversationId: string };
  assert.equal(segunda.conversationId, primera.conversationId, "sigue ACTIVE: misma conversación");

  const conv = await prisma.conversation.findUniqueOrThrow({
    where: { id: primera.conversationId },
  });
  const contactId = conv.contactId;

  await prisma.conversation.update({ where: { id: conv.id }, data: { status: "CLOSED" } });
  const tercera = (await (
    await enviar(fx.agente, { token: fx.token, origin: ORIGEN, body: { sessionId, message: "3" } })
  ).json()) as { conversationId: string };
  assert.notEqual(tercera.conversationId, primera.conversationId, "cerrada: conversación nueva");

  const todas = await conversacionesDe(contactId);
  assert.equal(todas.length, 2, "dos conversaciones del MISMO contacto");
  assert.ok(todas.every((c) => c.externalThreadId === sessionId));
  assert.equal(
    await prisma.contact.count({
      where: { organizationId: fx.orgId, lastName: widgetContactLastName(sessionId) },
    }),
    1,
    "un solo Contact placeholder por sesión",
  );

  // Otra sesión: otro Contact.
  const otraSesion = randomUUID();
  const cuarta = (await (
    await enviar(fx.agente, {
      token: fx.token,
      origin: ORIGEN,
      body: { sessionId: otraSesion, message: "4" },
    })
  ).json()) as { conversationId: string };
  const convOtra = await prisma.conversation.findUniqueOrThrow({
    where: { id: cuarta.conversationId },
  });
  assert.notEqual(convOtra.contactId, contactId);
});

// ---------------------------------------------------------------------------
// 6. Validación del cuerpo — desde la cadena propia
// ---------------------------------------------------------------------------

test("message vacío o de más de 4000 caracteres, y sessionId ausente, dan 400", async () => {
  const casos: [string, unknown][] = [
    ["message vacío", { sessionId: randomUUID(), message: "   " }],
    ["message largo", { sessionId: randomUUID(), message: "x".repeat(4001) }],
    ["sessionId ausente", { message: "hola" }],
    ["sessionId vacío", { sessionId: "", message: "hola" }],
  ];
  for (const [caso, body] of casos) {
    const res = await enviar(fx.agente, { token: fx.token, origin: ORIGEN, body });
    assert.equal(res.status, 400, caso);
  }
});

test("un cuerpo por encima de WIDGET_MAX_BODY_BYTES da 413; un Content-Type que no sea JSON da 415; JSON inválido da 400", async () => {
  const grande = await enviar(fx.agente, {
    token: fx.token,
    origin: ORIGEN,
    body: { sessionId: randomUUID(), message: "x".repeat(WIDGET_MAX_BODY_BYTES) },
  });
  assert.equal(grande.status, 413);

  const texto = await enviar(fx.agente, {
    token: fx.token,
    origin: ORIGEN,
    contentType: "text/plain",
    rawBody: "hola",
  });
  assert.equal(texto.status, 415);

  const invalido = await enviar(fx.agente, {
    token: fx.token,
    origin: ORIGEN,
    rawBody: "{ no es json",
  });
  assert.equal(invalido.status, 400);
});

// ---------------------------------------------------------------------------
// 7. Un AppError de runAgentTurn se propaga
// ---------------------------------------------------------------------------

test("un agente que no opera en WEB da 400 desde runAgentTurn, a través del controller nuevo", async () => {
  const res = await enviar(fx.agenteSinWeb, { token: fx.tokenAgenteSinWeb, origin: ORIGEN });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { message: string } };
  assert.match(body.error.message, /no opera en el canal WEB/);
  // Un agente DESACTIVADO, en cambio, no llega a runAgentTurn: lo rechaza la
  // autenticación con el 401 genérico (caso "agente inactivo" de arriba).
});
