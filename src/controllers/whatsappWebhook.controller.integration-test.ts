import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import express from "express";
import { prisma } from "../lib/prisma";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import { createWhatsappWebhookRouter } from "../routes/whatsappWebhook.routes";
import { resetLlmProviderParaTests, setLlmProviderForTests } from "../services/llmProvider.service";
import type { SendWhatsappTextInput } from "../services/whatsappGraph.service";
import { WHATSAPP_CONTACT_SOURCE } from "../services/whatsappContact.service";
import { hmacSha256Hex } from "../utils/hmac";
import type { WhatsappWebhookDeps } from "./whatsappWebhook.controller";

// ---------------------------------------------------------------------------
// GET y POST /webhooks/whatsapp (ítem 81) por HTTP real, contra Postgres real,
// con LA MISMA cadena de routes/whatsappWebhook.routes.ts (vía su factory) y
// las dependencias inyectadas: secretos conocidos y un doble de la Graph API
// que registra lo que se habría mandado. El LLM es el otro doble, instalado
// con setLlmProviderForTests como en el test del canal Web. Nunca se habla con
// Meta ni con OpenRouter.
//
// Lo que este archivo fija:
//   - GET: handshake correcto -> 200 con el challenge crudo en text/plain;
//     verify token o modo incorrecto -> 403.
//   - POST: firma inválida o ausente -> 401 SIN tocar la base.
//   - mensaje de texto válido -> Contact creado (o reusado por teléfono
//     normalizado), Message entrante con externalMessageId, turno del agente
//     y respuesta mandada por el doble de la Graph API.
//   - el mismo wamid dos veces (en serie y en paralelo) -> un solo entrante,
//     un solo turno, una sola respuesta.
//   - statuses en vez de messages, tipo que no es text, phone_number_id sin
//     agente, Graph API caída -> 200 sin procesar (o sin romper).
//   - sin WHATSAPP_APP_SECRET -> 500, nunca un webhook que no verifica nada.
// ---------------------------------------------------------------------------

const VERIFY_TOKEN = "test_verify_token";
const APP_SECRET = "test_app_secret";
const ACCESS_TOKEN = "test_access_token";
const RESPUESTA_DEL_AGENTE = "¡Hola! ¿En qué te ayudo?";

// El doble de la Graph API. `fallarEnvio` simula a Meta rechazando el envío.
let enviados: SendWhatsappTextInput[] = [];
let fallarEnvio = false;
let llamadasAlLlm = 0;
let appSecretConfigurado: string | undefined = APP_SECRET;

const deps: WhatsappWebhookDeps = {
  verifyToken: () => VERIFY_TOKEN,
  appSecret: () => appSecretConfigurado,
  accessToken: () => ACCESS_TOKEN,
  sendText: async (input) => {
    if (fallarEnvio) {
      throw new Error("WhatsApp Graph API returned 500: doble");
    }
    enviados.push(input);
  },
};

interface Fixture {
  orgId: string;
  branchId: string;
  agentId: string;
  phoneNumberId: string;
  phoneNumberIdAgenteSinCanal: string;
}

let fx: Fixture;
let baseUrl: string;
let closeApp: () => Promise<void>;

// Dígitos al azar: whatsapp_phone_number_id es UNIQUE GLOBAL, y un número fijo
// chocaría con los restos de una corrida anterior que no llegó a limpiar.
function numeroAlAzar(): string {
  return `1${randomInt(10 ** 9, 10 ** 10 - 1)}${randomInt(1000, 9999)}`;
}

function waIdAlAzar(): string {
  return `598${randomInt(10_000_000, 99_999_999)}`;
}

before(async () => {
  process.env.LOG_LEVEL = "fatal";

  const app = express();
  app.use(createWhatsappWebhookRouter(deps));
  app.use(notFound);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      closeApp = () => new Promise((r) => server.close(() => r()));
      resolve();
    });
  });

  setLlmProviderForTests({
    name: "doble",
    complete() {
      llamadasAlLlm++;
      return Promise.resolve({ text: RESPUESTA_DEL_AGENTE, toolCalls: [] });
    },
  });

  const org = await prisma.organization.create({
    data: {
      name: `WhatsApp test ${randomUUID()}`,
      slug: `whatsapp-test-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  const branch = await prisma.branch.create({
    data: { organizationId: org.id, name: "Centro", timezone: "America/Montevideo" },
  });

  const phoneNumberId = numeroAlAzar();
  const agent = await prisma.agent.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      name: "Agente WhatsApp",
      instructions: "Sos el agente de WhatsApp.",
      modelProvider: "openrouter",
      modelName: "doble/modelo",
      enabledTools: [],
      channels: ["WHATSAPP"],
      guardrails: {},
      whatsappPhoneNumberId: phoneNumberId,
    },
  });

  // Un agente con número pero SIN el canal WHATSAPP: su mensaje se ignora.
  const phoneNumberIdAgenteSinCanal = numeroAlAzar();
  await prisma.agent.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      name: "Agente solo Web",
      instructions: "Solo Web.",
      modelProvider: "openrouter",
      modelName: "doble/modelo",
      enabledTools: [],
      channels: ["WEB"],
      guardrails: {},
      whatsappPhoneNumberId: phoneNumberIdAgenteSinCanal,
    },
  });

  fx = {
    orgId: org.id,
    branchId: branch.id,
    agentId: agent.id,
    phoneNumberId,
    phoneNumberIdAgenteSinCanal,
  };
});

beforeEach(() => {
  enviados = [];
  fallarEnvio = false;
  llamadasAlLlm = 0;
  appSecretConfigurado = APP_SECRET;
});

after(async () => {
  resetLlmProviderParaTests();
  if (closeApp) await closeApp();
  if (!fx) return;
  const where = { organizationId: fx.orgId };
  await prisma.message.deleteMany({ where });
  await prisma.conversation.deleteMany({ where });
  await prisma.activity.deleteMany({ where });
  await prisma.agent.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await prisma.branch.deleteMany({ where });
  await prisma.organization.delete({ where: { id: fx.orgId } });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function payloadDeTexto(opts: {
  phoneNumberId?: string;
  waId: string;
  wamid?: string;
  body?: string;
  nombre?: string;
}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-id",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                phone_number_id: opts.phoneNumberId ?? fx.phoneNumberId,
                display_phone_number: "59820000000",
              },
              contacts: [{ profile: { name: opts.nombre ?? "Ana Pérez" }, wa_id: opts.waId }],
              messages: [
                {
                  from: opts.waId,
                  id: opts.wamid ?? `wamid.${randomUUID()}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: opts.body ?? "Hola, quiero info" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

// Un POST firmado como lo firma Meta: HMAC-SHA256 del cuerpo crudo con el App
// Secret, en X-Hub-Signature-256 con el prefijo "sha256=".
function enviar(
  body: unknown,
  opts: { firma?: "valida" | "invalida" | "ausente" | "sin-prefijo" } = {},
): Promise<Response> {
  const crudo = JSON.stringify(body);
  const secreto = opts.firma === "invalida" ? "otro_secreto" : APP_SECRET;
  const hex = hmacSha256Hex(secreto, Buffer.from(crudo, "utf8"));
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.firma !== "ausente") {
    headers["x-hub-signature-256"] = opts.firma === "sin-prefijo" ? hex : `sha256=${hex}`;
  }
  return fetch(`${baseUrl}/webhooks/whatsapp`, { method: "POST", headers, body: crudo });
}

function contactosConTelefono(telefono: string) {
  return prisma.contact.findMany({ where: { organizationId: fx.orgId, phone: telefono } });
}

// ---------------------------------------------------------------------------
// GET — handshake
// ---------------------------------------------------------------------------

test("GET con modo subscribe y verify token correcto -> 200 con el challenge crudo en text/plain", async () => {
  const res = await fetch(
    `${baseUrl}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1158201444`,
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/plain/);
  assert.equal(await res.text(), "1158201444");
});

test("GET con verify token incorrecto -> 403", async () => {
  const res = await fetch(
    `${baseUrl}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=123`,
  );
  assert.equal(res.status, 403);
  assert.notEqual(await res.text(), "123");
});

test("GET con modo distinto de subscribe o sin token -> 403", async () => {
  const modo = await fetch(
    `${baseUrl}/webhooks/whatsapp?hub.mode=unsubscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1`,
  );
  assert.equal(modo.status, 403);
  const sinToken = await fetch(`${baseUrl}/webhooks/whatsapp?hub.mode=subscribe&hub.challenge=1`);
  assert.equal(sinToken.status, 403);
});

// ---------------------------------------------------------------------------
// POST — firma
// ---------------------------------------------------------------------------

test("POST con firma inválida, ausente o sin prefijo -> 401 sin tocar la base", async () => {
  const waId = waIdAlAzar();
  for (const firma of ["invalida", "ausente", "sin-prefijo"] as const) {
    const res = await enviar(payloadDeTexto({ waId }), { firma });
    assert.equal(res.status, 401, `firma ${firma}`);
  }
  assert.equal((await contactosConTelefono(`+${waId}`)).length, 0);
  assert.equal(llamadasAlLlm, 0);
  assert.equal(enviados.length, 0);
});

test("POST sin WHATSAPP_APP_SECRET configurado -> 500, nunca un webhook que no verifica", async () => {
  appSecretConfigurado = undefined;
  const res = await enviar(payloadDeTexto({ waId: waIdAlAzar() }));
  assert.equal(res.status, 500);
  assert.equal(llamadasAlLlm, 0);
});

test("POST que no es application/json -> 400", async () => {
  const res = await fetch(`${baseUrl}/webhooks/whatsapp`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "hola",
  });
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// POST — procesamiento
// ---------------------------------------------------------------------------

test("mensaje de texto de un número nuevo -> crea el Contact, persiste el entrante con el wamid, corre el turno y responde por la Graph API", async () => {
  const waId = waIdAlAzar();
  const wamid = `wamid.${randomUUID()}`;

  const res = await enviar(payloadDeTexto({ waId, wamid, nombre: "Ana María Pérez" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  const contactos = await contactosConTelefono(`+${waId}`);
  assert.equal(contactos.length, 1);
  assert.equal(contactos[0].firstName, "Ana");
  assert.equal(contactos[0].lastName, "María Pérez");
  assert.equal(contactos[0].source, WHATSAPP_CONTACT_SOURCE);

  const conversacion = await prisma.conversation.findFirstOrThrow({
    where: { organizationId: fx.orgId, contactId: contactos[0].id },
  });
  assert.equal(conversacion.channel, "WHATSAPP");
  assert.equal(conversacion.agentId, fx.agentId);
  assert.equal(conversacion.externalThreadId, waId);

  const mensajes = await prisma.message.findMany({
    where: { conversationId: conversacion.id },
    orderBy: { createdAt: "asc" },
  });
  assert.equal(mensajes.length, 2);
  assert.equal(mensajes[0].direction, "INBOUND");
  assert.equal(mensajes[0].externalMessageId, wamid);
  assert.equal(mensajes[0].content, "Hola, quiero info");
  assert.equal(mensajes[1].direction, "OUTBOUND");
  assert.equal(mensajes[1].content, RESPUESTA_DEL_AGENTE);

  assert.equal(llamadasAlLlm, 1);
  assert.deepEqual(enviados, [
    {
      phoneNumberId: fx.phoneNumberId,
      to: waId,
      body: RESPUESTA_DEL_AGENTE,
      accessToken: ACCESS_TOKEN,
    },
  ]);
});

test("un Contact existente con el mismo teléfono (con + y separadores) se reusa, no se duplica", async () => {
  const waId = waIdAlAzar();
  // El mismo número, cargado a mano con formato: +598 9X XXX XXX.
  const conFormato = `+${waId.slice(0, 3)} ${waId.slice(3, 5)} ${waId.slice(5, 8)} ${waId.slice(8)}`;
  const existente = await prisma.contact.create({
    data: { organizationId: fx.orgId, firstName: "Cliente", lastName: "Viejo", phone: conFormato },
  });

  const res = await enviar(payloadDeTexto({ waId }));
  assert.equal(res.status, 200);

  const delNumero = await prisma.contact.findMany({
    where: { organizationId: fx.orgId, OR: [{ phone: conFormato }, { phone: `+${waId}` }] },
  });
  assert.deepEqual(
    delNumero.map((c) => c.id),
    [existente.id],
  );
  const conversacion = await prisma.conversation.findFirstOrThrow({
    where: { organizationId: fx.orgId, contactId: existente.id },
  });
  assert.equal(conversacion.channel, "WHATSAPP");
});

test("el mismo wamid dos veces -> un solo entrante, un solo turno, una sola respuesta", async () => {
  const waId = waIdAlAzar();
  const payload = payloadDeTexto({ waId, wamid: `wamid.${randomUUID()}` });

  assert.equal((await enviar(payload)).status, 200);
  assert.equal((await enviar(payload)).status, 200);

  const entrantes = await prisma.message.findMany({
    where: {
      organizationId: fx.orgId,
      externalMessageId: payload.entry[0].changes[0].value.messages[0].id,
    },
  });
  assert.equal(entrantes.length, 1);
  assert.equal((await contactosConTelefono(`+${waId}`)).length, 1);
  assert.equal(llamadasAlLlm, 1);
  assert.equal(enviados.length, 1);
});

test("el mismo wamid en dos entregas PARALELAS -> el UNIQUE deja pasar una sola", async () => {
  const waId = waIdAlAzar();
  const wamid = `wamid.${randomUUID()}`;
  const payload = payloadDeTexto({ waId, wamid });

  const [a, b] = await Promise.all([enviar(payload), enviar(payload)]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);

  const entrantes = await prisma.message.findMany({
    where: { organizationId: fx.orgId, externalMessageId: wamid },
  });
  assert.equal(entrantes.length, 1);
  assert.equal((await contactosConTelefono(`+${waId}`)).length, 1);
  assert.equal(enviados.length, 1);
});

test("un change con statuses en vez de messages -> 200 sin crear nada", async () => {
  const antes = await prisma.message.count({ where: { organizationId: fx.orgId } });
  const res = await enviar({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-id",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: fx.phoneNumberId, display_phone_number: "1" },
              statuses: [
                { id: "wamid.x", status: "delivered", timestamp: "1", recipient_id: "598" },
              ],
            },
          },
        ],
      },
    ],
  });
  assert.equal(res.status, 200);
  assert.equal(await prisma.message.count({ where: { organizationId: fx.orgId } }), antes);
  assert.equal(llamadasAlLlm, 0);
  assert.equal(enviados.length, 0);
});

test("un mensaje que no es de tipo text -> 200 sin procesar", async () => {
  const waId = waIdAlAzar();
  const payload = payloadDeTexto({ waId });
  // Un mensaje de imagen no trae `text`: se reemplaza el array entero.
  (payload.entry[0].changes[0].value as { messages: unknown[] }).messages = [
    {
      from: waId,
      id: `wamid.${randomUUID()}`,
      timestamp: "1",
      type: "image",
      image: { id: "media-id", mime_type: "image/jpeg" },
    },
  ];

  const res = await enviar(payload);
  assert.equal(res.status, 200);
  assert.equal((await contactosConTelefono(`+${waId}`)).length, 0);
  assert.equal(llamadasAlLlm, 0);
  assert.equal(enviados.length, 0);
});

test("un phone_number_id sin agente, o de un agente sin el canal WHATSAPP -> 200 sin procesar, y el resto del lote sí", async () => {
  const waIdSinAgente = waIdAlAzar();
  const waIdSinCanal = waIdAlAzar();
  const waIdValido = waIdAlAzar();
  const conAgente = payloadDeTexto({ waId: waIdValido });
  const lote = {
    object: "whatsapp_business_account",
    entry: [
      payloadDeTexto({ waId: waIdSinAgente, phoneNumberId: numeroAlAzar() }).entry[0],
      payloadDeTexto({ waId: waIdSinCanal, phoneNumberId: fx.phoneNumberIdAgenteSinCanal })
        .entry[0],
      conAgente.entry[0],
    ],
  };

  const res = await enviar(lote);
  assert.equal(res.status, 200);
  assert.equal((await contactosConTelefono(`+${waIdSinAgente}`)).length, 0);
  assert.equal((await contactosConTelefono(`+${waIdSinCanal}`)).length, 0);
  assert.equal((await contactosConTelefono(`+${waIdValido}`)).length, 1);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].to, waIdValido);
});

test("si la Graph API falla al mandar la respuesta, Meta recibe 200 igual y el entrante queda registrado", async () => {
  fallarEnvio = true;
  const waId = waIdAlAzar();
  const wamid = `wamid.${randomUUID()}`;

  const res = await enviar(payloadDeTexto({ waId, wamid }));
  assert.equal(res.status, 200);
  assert.equal(
    await prisma.message.count({ where: { organizationId: fx.orgId, externalMessageId: wamid } }),
    1,
  );
});

test("un cuerpo firmado sin la forma de un webhook de Meta -> 400", async () => {
  const res = await enviar({ object: "whatsapp_business_account" });
  assert.equal(res.status, 400);
});
