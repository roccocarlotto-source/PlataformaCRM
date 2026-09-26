import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import express from "express";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import { findRoleByName } from "../repositories/role.repository";
import { createWhatsappWebhookRouter } from "../routes/whatsappWebhook.routes";
import {
  resetLlmProviderParaTests,
  setLlmProviderForTests,
  type LlmCompletionRequest,
} from "../services/llmProvider.service";
import { WhatsappGraphError, type SendWhatsappTextInput } from "../services/whatsappGraph.service";
import { WHATSAPP_CONTACT_SOURCE } from "../services/whatsappContact.service";
import { hmacSha256Hex } from "../utils/hmac";
import { drenarTurnosPendientes, type DepsDeEnvio } from "../workers/agentInboundWorker";
import type { WhatsappWebhookDeps } from "./whatsappWebhook.controller";

// ---------------------------------------------------------------------------
// GET y POST /webhooks/whatsapp (ítem 81) por HTTP real, contra Postgres real,
// con LA MISMA cadena de routes/whatsappWebhook.routes.ts (vía su factory) y
// secretos conocidos. Desde el ítem 125 el webhook solo ENCOLA: el turno y el
// envío los hace el worker de la cola, que acá se drena a mano
// (drenarTurnosPendientes acotado a la organización del test) con un doble de
// la Graph API que registra lo que se habría mandado. El LLM es el otro doble,
// instalado con setLlmProviderForTests como en el test del canal Web. Nunca se
// habla con Meta ni con OpenRouter.
//
// Lo que este archivo fija:
//   - GET: handshake correcto -> 200 con el challenge crudo en text/plain;
//     verify token o modo incorrecto -> 403.
//   - POST: firma inválida o ausente -> 401 SIN tocar la base.
//   - mensaje de texto válido -> Contact creado (o reusado por teléfono
//     normalizado), Message entrante con externalMessageId y un job PENDING,
//     SIN turno dentro del request; al drenar, turno del agente, respuesta
//     mandada por el doble y delivery_status SENT.
//   - el mismo wamid dos veces (en serie y en paralelo) -> un solo entrante,
//     un solo job, un solo turno, una sola respuesta.
//   - conversación derivada que nadie tomó -> el agente contesta igual; con un
//     mensaje HUMAN en el hilo -> no contesta y no se manda nada (ítem 83).
//   - statuses en vez de messages, tipo que no es text, phone_number_id sin
//     agente -> 200 sin encolar.
//   - la cola (ítem 125): envío fallido -> delivery_status FAILED y reintento
//     que reenvía SIN otro turno; 4xx de Meta -> FAILED sin reintentos; turno
//     que explota -> reintento con backoff; lease vencido -> se retoma.
//   - ráfagas (ítems 125/126): tres mensajes seguidos -> un turno que los ve a
//     los tres; un mensaje que llega a mitad de un turno -> el turno siguiente
//     lo ve DESPUÉS de la respuesta anterior; dos entregas paralelas de un
//     contacto nuevo -> una sola conversación abierta.
//   - sin WHATSAPP_APP_SECRET -> 500, nunca un webhook que no verifica nada.
//   - message_template_status_update (ítem 160): Meta aprueba o rechaza la
//     plantilla de un negocio -> la fila con ese metaTemplateId cambia de
//     estado; una plantilla que no es de este CRM no rompe nada.
// ---------------------------------------------------------------------------

const VERIFY_TOKEN = "test_verify_token";
const APP_SECRET = "test_app_secret";
const ACCESS_TOKEN = "test_access_token";
const RESPUESTA_DEL_AGENTE = "¡Hola! ¿En qué te ayudo?";

// El doble de la Graph API. `fallarEnvio` simula a Meta rechazando el envío
// con ese status.
let enviados: SendWhatsappTextInput[] = [];
let fallarEnvio: number | null = null;
let appSecretConfigurado: string | undefined = APP_SECRET;

// El doble del LLM: registra cada request. `fallosDelLlm` hace que las
// próximas N llamadas exploten con un error que NO es del proveedor (el que el
// turno deja subir), y `alLlamarAlLlm` corre algo en medio de una llamada.
let llamadasAlLlm = 0;
let requestsAlLlm: LlmCompletionRequest[] = [];
let fallosDelLlm = 0;
let alLlamarAlLlm: (() => Promise<void>) | null = null;

const deps: WhatsappWebhookDeps = {
  verifyToken: () => VERIFY_TOKEN,
  appSecret: () => appSecretConfigurado,
  accessToken: () => ACCESS_TOKEN,
};

const depsDeEnvio: DepsDeEnvio = {
  accessToken: () => ACCESS_TOKEN,
  sendText: async (input) => {
    if (fallarEnvio !== null) {
      throw new WhatsappGraphError(fallarEnvio, "doble");
    }
    enviados.push(input);
  },
};

// El worker, acotado a la organización de este archivo: los demás archivos de
// integración corren en paralelo contra la misma base.
function drenar() {
  return drenarTurnosPendientes({ organizationId: fx.orgId, deps: depsDeEnvio });
}

function jobsDe(messageId: string) {
  return prisma.agentInboundJob.findMany({ where: { organizationId: fx.orgId, messageId } });
}

async function entranteConWamid(wamid: string) {
  return prisma.message.findFirstOrThrow({
    where: { organizationId: fx.orgId, externalMessageId: wamid },
  });
}

// Un job que falló queda con su próximo intento en el futuro (backoff). Para
// no esperar de verdad, el test lo adelanta a "ya".
async function adelantarReintentos() {
  await prisma.agentInboundJob.updateMany({
    where: { organizationId: fx.orgId, status: "PENDING" },
    data: { nextAttemptAt: new Date(Date.now() - 1000) },
  });
}

interface Fixture {
  orgId: string;
  branchId: string;
  agentId: string;
  phoneNumberId: string;
  phoneNumberIdAgenteSinCanal: string;
  // Una persona de la organización, para poder escribir un Message HUMAN
  // (ítem 83): es lo único que calla al agente, y el CHECK
  // messages_sender_user_id_consistency_check exige senderUserId en ese caso.
  userId: string;
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
    async complete(request) {
      llamadasAlLlm++;
      requestsAlLlm.push(request);
      if (alLlamarAlLlm) {
        const accion = alLlamarAlLlm;
        alLlamarAlLlm = null;
        await accion();
      }
      if (fallosDelLlm > 0) {
        fallosDelLlm--;
        throw new Error("fallo del doble que no es del proveedor");
      }
      return { text: RESPUESTA_DEL_AGENTE, toolCalls: [] };
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

  // Identidad real en Supabase Auth: el trigger trg_set_user_email_from_auth
  // lee auth.users para completar users.email, así que un id inventado dejaría
  // el email en NULL y el INSERT moriría contra el NOT NULL de la columna.
  // Mismo patrón que agentOrchestration.integration-test.ts.
  const adminRole = await findRoleByName("ADMIN");
  if (!adminRole) {
    throw new Error("No está sembrado el rol ADMIN. Abortando.");
  }
  const email = `whatsapp-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data: authData, error: authError } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (authError || !authData.user) {
    throw new Error(`No se pudo crear usuario real de Supabase Auth: ${authError?.message}`);
  }
  const user = await prisma.user.create({
    data: {
      id: authData.user.id,
      organizationId: org.id,
      roleId: adminRole.id,
      email: `placeholder-${authData.user.id}@example.test`,
      fullName: "Vendedor WhatsApp",
    },
  });

  fx = {
    orgId: org.id,
    branchId: branch.id,
    agentId: agent.id,
    phoneNumberId,
    phoneNumberIdAgenteSinCanal,
    userId: user.id,
  };
});

beforeEach(async () => {
  // Cada test arranca con la cola de la organización vacía: un test que
  // encola sin drenar (porque lo que afirma es el webhook) no puede dejarle
  // un turno pendiente al siguiente, que lo contaría como propio.
  if (fx) {
    await prisma.agentInboundJob.updateMany({
      where: { organizationId: fx.orgId, status: { in: ["PENDING", "PROCESSING"] } },
      data: { status: "DONE", lockedUntil: null },
    });
  }
  enviados = [];
  fallarEnvio = null;
  llamadasAlLlm = 0;
  requestsAlLlm = [];
  fallosDelLlm = 0;
  alLlamarAlLlm = null;
  appSecretConfigurado = APP_SECRET;
});

after(async () => {
  resetLlmProviderParaTests();
  if (closeApp) await closeApp();
  if (!fx) return;
  const where = { organizationId: fx.orgId };
  // La plantilla del caso de message_template_status_update (ítem 160).
  await prisma.whatsappTemplate.deleteMany({ where });
  // Antes que messages: las dos FKs de la cola apuntan ahí.
  await prisma.agentInboundJob.deleteMany({ where });
  await prisma.message.deleteMany({ where });
  await prisma.conversation.deleteMany({ where });
  await prisma.activity.deleteMany({ where });
  await prisma.agent.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await prisma.branch.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.organization.delete({ where: { id: fx.orgId } });
  await getSupabaseAdmin().auth.admin.deleteUser(fx.userId);
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

test("mensaje de texto de un número nuevo -> el webhook crea el Contact, persiste el entrante con el wamid y ENCOLA; el worker corre el turno y responde por la Graph API", async () => {
  const waId = waIdAlAzar();
  const wamid = `wamid.${randomUUID()}`;

  const res = await enviar(payloadDeTexto({ waId, wamid, nombre: "Ana María Pérez" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  // Ítem 125: el 200 salió SIN turno. Lo que quedó es el entrante y su job.
  assert.equal(llamadasAlLlm, 0, "el webhook no corre el turno dentro del request");
  assert.equal(enviados.length, 0);
  const entrante = await entranteConWamid(wamid);
  const [job] = await jobsDe(entrante.id);
  assert.equal(job.status, "PENDING");
  assert.equal(job.attempts, 0);
  assert.equal(job.phoneNumberId, fx.phoneNumberId);
  assert.equal(job.waId, waId);

  const resumen = await drenar();
  assert.equal(resumen.respondidos, 1);

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
  // B-02: la entrega quedó registrada en la fila; el entrante no tiene.
  assert.equal(mensajes[1].deliveryStatus, "SENT");
  assert.equal(mensajes[1].deliveryError, null);
  assert.equal(mensajes[0].deliveryStatus, null);

  assert.equal(llamadasAlLlm, 1);
  assert.deepEqual(enviados, [
    {
      phoneNumberId: fx.phoneNumberId,
      to: waId,
      body: RESPUESTA_DEL_AGENTE,
      accessToken: ACCESS_TOKEN,
    },
  ]);

  const [terminado] = await jobsDe(entrante.id);
  assert.equal(terminado.status, "DONE");
  assert.equal(terminado.attempts, 1);
  assert.equal(terminado.responseMessageId, mensajes[1].id);
  assert.equal(terminado.lockedUntil, null);
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

// ---------------------------------------------------------------------------
// POST — ítem 83: qué calla al agente en el canal WhatsApp
//
// El paso 6 de procesarMensaje manda la respuesta por la Graph API solo si
// `respuesta !== null`, y quién decide ese null cambió con el ítem 83: antes
// era el status derivado, ahora es que una PERSONA haya escrito en el hilo.
// Los dos tests de acá abajo fijan esa diferencia a nivel canal, que es donde
// se ve el síntoma real que reportó Rocco (el cliente escribiendo por WhatsApp
// sin que nadie le conteste nunca más).
//
// La conversación se arma a mano y no derivando de verdad: el doble del LLM de
// este archivo es uno solo y fijo para todos los tests, y guionarlo para que
// derive acá no probaría nada que agentOrchestration.integration-test.ts no
// pruebe mejor. Lo que importa acá es el estado de la conversación que el
// webhook se encuentra.
// ---------------------------------------------------------------------------

// Un Contact con su Conversation de WhatsApp ya abierta en el estado que pida
// el test. El waId se usa como teléfono y como externalThreadId, igual que
// hace el flujo real.
async function conversacionPreexistente(waId: string, status: "ACTIVE" | "TRANSFERRED_TO_HUMAN") {
  const contact = await prisma.contact.create({
    data: {
      organizationId: fx.orgId,
      firstName: "Cliente",
      lastName: "Con hilo",
      phone: `+${waId}`,
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      organizationId: fx.orgId,
      branchId: fx.branchId,
      agentId: fx.agentId,
      contactId: contact.id,
      channel: "WHATSAPP",
      status,
      externalThreadId: waId,
      ...(status === "TRANSFERRED_TO_HUMAN" ? { assignedUserId: fx.userId } : {}),
    },
  });
  return { contact, conversation };
}

test("conversación DERIVADA pero que nadie tomó todavía -> el agente contesta igual y la respuesta sale por la Graph API", async () => {
  const waId = waIdAlAzar();
  const { conversation } = await conversacionPreexistente(waId, "TRANSFERRED_TO_HUMAN");

  const res = await enviar(payloadDeTexto({ waId, body: "¿Hola? ¿Hay alguien?" }));
  assert.equal(res.status, 200);
  await drenar();

  assert.equal(llamadasAlLlm, 1, "el turno corrió");
  assert.deepEqual(enviados, [
    {
      phoneNumberId: fx.phoneNumberId,
      to: waId,
      body: RESPUESTA_DEL_AGENTE,
      accessToken: ACCESS_TOKEN,
    },
  ]);

  const mensajes = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
  });
  assert.deepEqual(
    mensajes.map((m) => [m.senderType, m.content]),
    [
      ["CONTACT", "¿Hola? ¿Hay alguien?"],
      ["AGENT", RESPUESTA_DEL_AGENTE],
    ],
  );

  // El aviso al vendedor sigue en pie: contestar no deshace la derivación.
  const despues = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
  assert.equal(despues.status, "TRANSFERRED_TO_HUMAN");
  assert.equal(despues.assignedUserId, fx.userId);
});

test("con un mensaje HUMAN en el hilo -> el entrante se registra, el agente NO contesta y no se manda nada por la Graph API", async () => {
  const waId = waIdAlAzar();
  const { conversation } = await conversacionPreexistente(waId, "TRANSFERRED_TO_HUMAN");
  await prisma.message.create({
    data: {
      organizationId: fx.orgId,
      conversationId: conversation.id,
      direction: "OUTBOUND",
      senderType: "HUMAN",
      senderUserId: fx.userId,
      content: "Hola, soy Rocco, sigo yo por acá.",
    },
  });

  const res = await enviar(payloadDeTexto({ waId, body: "Dale, gracias" }));
  assert.equal(res.status, 200);
  const resumen = await drenar();
  // El job se cierra igual: no hay nada que reintentar.
  assert.equal(resumen.respondidos, 1);
  assert.equal(resumen.pospuestos + resumen.fallidos, 0);

  assert.equal(llamadasAlLlm, 0, "no se llamó al modelo");
  assert.equal(enviados.length, 0, "el agente no le habla encima a la persona");

  const mensajes = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
  });
  assert.deepEqual(
    mensajes.map((m) => [m.senderType, m.content]),
    [
      ["HUMAN", "Hola, soy Rocco, sigo yo por acá."],
      ["CONTACT", "Dale, gracias"],
    ],
    "el entrante queda en el hilo para que la persona lo vea",
  );
});

test("el mismo wamid dos veces -> un solo entrante, un solo turno, una sola respuesta", async () => {
  const waId = waIdAlAzar();
  const payload = payloadDeTexto({ waId, wamid: `wamid.${randomUUID()}` });

  assert.equal((await enviar(payload)).status, 200);
  await drenar();
  // La reentrega de Meta DESPUÉS de que el turno ya corrió: sigue siendo
  // "duplicado", y ya no importa — el trabajo no depende de ella (ítem 125).
  assert.equal((await enviar(payload)).status, 200);
  await drenar();

  const entrantes = await prisma.message.findMany({
    where: {
      organizationId: fx.orgId,
      externalMessageId: payload.entry[0].changes[0].value.messages[0].id,
    },
  });
  assert.equal(entrantes.length, 1);
  assert.equal((await jobsDe(entrantes[0].id)).length, 1);
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
  await drenar();

  const entrantes = await prisma.message.findMany({
    where: { organizationId: fx.orgId, externalMessageId: wamid },
  });
  assert.equal(entrantes.length, 1);
  // El INSERT que perdió contra el UNIQUE se revirtió con su job adentro.
  assert.equal((await jobsDe(entrantes[0].id)).length, 1);
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
  await drenar();
  assert.equal((await contactosConTelefono(`+${waIdSinAgente}`)).length, 0);
  assert.equal((await contactosConTelefono(`+${waIdSinCanal}`)).length, 0);
  assert.equal((await contactosConTelefono(`+${waIdValido}`)).length, 1);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].to, waIdValido);
});

// ---------------------------------------------------------------------------
// La cola (ítem 125 de docs/auditoria-2026-09-24-punta-a-punta.md: D-01, B-02)
//
// Antes, todo lo de acá abajo terminaba igual: el entrante persistido, la
// reentrega de Meta descartada como duplicado y el cliente sin respuesta para
// siempre. Ahora cada fallo deja el job en un estado que alguien retoma.
// ---------------------------------------------------------------------------

test("la Graph API falla con un 5xx -> Meta recibe 200, la respuesta queda FAILED en la fila y el reintento la REENVÍA sin correr otro turno", async () => {
  fallarEnvio = 503;
  const waId = waIdAlAzar();
  const wamid = `wamid.${randomUUID()}`;

  const res = await enviar(payloadDeTexto({ waId, wamid }));
  assert.equal(res.status, 200);

  const primera = await drenar();
  assert.equal(primera.pospuestos, 1);
  assert.equal(llamadasAlLlm, 1);
  assert.equal(enviados.length, 0);

  const entrante = await entranteConWamid(wamid);
  const [job] = await jobsDe(entrante.id);
  assert.equal(job.status, "PENDING");
  assert.equal(job.attempts, 1);
  assert.ok(job.nextAttemptAt && job.nextAttemptAt.getTime() > Date.now(), "backoff programado");
  assert.match(job.lastError ?? "", /503/);
  assert.ok(job.responseMessageId, "la respuesta ya escrita queda atada al job");

  // B-02: el fallo está en la fila del Message, no solo en el log.
  const saliente = await prisma.message.findUniqueOrThrow({
    where: { id: job.responseMessageId },
  });
  assert.equal(saliente.deliveryStatus, "FAILED");
  assert.match(saliente.deliveryError ?? "", /503/);

  // Meta vuelve a aceptar; el reintento llega.
  fallarEnvio = null;
  await adelantarReintentos();
  const segunda = await drenar();
  assert.equal(segunda.respondidos, 1);

  assert.equal(llamadasAlLlm, 1, "el reintento NO corrió otro turno");
  assert.deepEqual(
    enviados.map((e) => e.body),
    [RESPUESTA_DEL_AGENTE],
  );
  const salientes = await prisma.message.findMany({
    where: { conversationId: entrante.conversationId, direction: "OUTBOUND" },
  });
  assert.equal(salientes.length, 1, "una sola respuesta en el hilo");
  assert.equal(salientes[0].deliveryStatus, "SENT");
  assert.equal(salientes[0].deliveryError, null, "SENT limpia el error del intento anterior");

  const [terminado] = await jobsDe(entrante.id);
  assert.equal(terminado.status, "DONE");
  assert.equal(terminado.attempts, 2);
});

test("la Graph API rechaza con un 4xx -> FAILED de una, sin gastar reintentos", async () => {
  fallarEnvio = 400;
  const waId = waIdAlAzar();
  const wamid = `wamid.${randomUUID()}`;

  assert.equal((await enviar(payloadDeTexto({ waId, wamid }))).status, 200);
  const resumen = await drenar();
  assert.equal(resumen.fallidos, 1);

  const entrante = await entranteConWamid(wamid);
  const [job] = await jobsDe(entrante.id);
  assert.equal(job.status, "FAILED");
  assert.equal(job.attempts, 1);
  assert.match(job.lastError ?? "", /400/);
  const saliente = await prisma.message.findUniqueOrThrow({
    where: { id: job.responseMessageId ?? "" },
  });
  assert.equal(saliente.deliveryStatus, "FAILED");
});

test("un turno que explota con un error que no es del proveedor -> reintento con backoff, y el segundo intento responde", async () => {
  fallosDelLlm = 1;
  const waId = waIdAlAzar();
  const wamid = `wamid.${randomUUID()}`;

  assert.equal((await enviar(payloadDeTexto({ waId, wamid }))).status, 200);
  const primera = await drenar();
  assert.equal(primera.pospuestos, 1);

  const entrante = await entranteConWamid(wamid);
  const [job] = await jobsDe(entrante.id);
  assert.equal(job.status, "PENDING");
  assert.equal(job.responseMessageId, null, "el turno no llegó a escribir respuesta");
  assert.match(job.lastError ?? "", /no es del proveedor/);

  await adelantarReintentos();
  const segunda = await drenar();
  assert.equal(segunda.respondidos, 1);
  assert.deepEqual(
    enviados.map((e) => e.body),
    [RESPUESTA_DEL_AGENTE],
  );
  const [terminado] = await jobsDe(entrante.id);
  assert.equal(terminado.status, "DONE");
  assert.equal(terminado.attempts, 2);
});

test("un job en PROCESSING con el lease vencido (el proceso murió a mitad) se retoma y se responde", async () => {
  const waId = waIdAlAzar();
  const wamid = `wamid.${randomUUID()}`;
  assert.equal((await enviar(payloadDeTexto({ waId, wamid }))).status, 200);

  // Lo que deja un SIGTERM a mitad del turno: reclamado, sin latido, con el
  // lease ya vencido.
  const entrante = await entranteConWamid(wamid);
  await prisma.agentInboundJob.updateMany({
    where: { organizationId: fx.orgId, messageId: entrante.id },
    data: { status: "PROCESSING", attempts: 1, lockedUntil: new Date(Date.now() - 1000) },
  });

  const resumen = await drenar();
  assert.equal(resumen.respondidos, 1);
  assert.equal(enviados.length, 1);
  const [job] = await jobsDe(entrante.id);
  assert.equal(job.status, "DONE");
  assert.equal(job.attempts, 2, "el reclamo que lo retomó contó su intento");
});

test("un job en PROCESSING con el lease VIGENTE no se toca: su dueño sigue vivo", async () => {
  const waId = waIdAlAzar();
  const wamid = `wamid.${randomUUID()}`;
  assert.equal((await enviar(payloadDeTexto({ waId, wamid }))).status, 200);

  const entrante = await entranteConWamid(wamid);
  await prisma.agentInboundJob.updateMany({
    where: { organizationId: fx.orgId, messageId: entrante.id },
    data: { status: "PROCESSING", attempts: 1, lockedUntil: new Date(Date.now() + 60_000) },
  });

  const resumen = await drenar();
  assert.deepEqual(resumen, { respondidos: 0, omitidos: 0, pospuestos: 0, fallidos: 0 });
  assert.equal(llamadasAlLlm, 0);
});

// ---------------------------------------------------------------------------
// Ráfagas (ítems 125 y 126): el caso normal de WhatsApp es el cliente que
// manda tres mensajes cortos seguidos.
// ---------------------------------------------------------------------------

test("tres mensajes seguidos antes de que el worker pase -> UN turno que los ve a los tres, una sola respuesta, y los tres jobs DONE", async () => {
  const waId = waIdAlAzar();
  const cuerpos = ["hola", "quiero un auto", "un Gol 2020"];
  for (const body of cuerpos) {
    assert.equal((await enviar(payloadDeTexto({ waId, body }))).status, 200);
  }

  const resumen = await drenar();
  assert.equal(llamadasAlLlm, 1, "un solo turno para la ráfaga");
  assert.equal(enviados.length, 1);
  assert.equal(resumen.respondidos, 1);

  // El modelo vio los tres, en orden, al final del historial.
  const vistos = requestsAlLlm[0].messages.filter((m) => m.role === "user").map((m) => m.content);
  assert.equal(vistos.length, 3);
  cuerpos.forEach((body, i) => assert.ok(vistos[i].includes(body)));

  const [contacto] = await contactosConTelefono(`+${waId}`);
  const jobs = await prisma.agentInboundJob.findMany({
    where: { organizationId: fx.orgId, message: { conversation: { contactId: contacto.id } } },
  });
  assert.equal(jobs.length, 3);
  assert.ok(jobs.every((j) => j.status === "DONE"));
  assert.equal(
    jobs.filter((j) => j.responseMessageId !== null).length,
    1,
    "solo el job que corrió el turno tiene respuesta propia",
  );
});

test("un mensaje que llega A MITAD de un turno -> el turno siguiente lo ve DESPUÉS de la respuesta anterior, no antes", async () => {
  const waId = waIdAlAzar();
  assert.equal((await enviar(payloadDeTexto({ waId, body: "hola" }))).status, 200);

  // Mientras el modelo "piensa" la respuesta al hola, entra el segundo
  // mensaje. Se persiste ANTES que esa respuesta.
  alLlamarAlLlm = async () => {
    assert.equal((await enviar(payloadDeTexto({ waId, body: "quiero un auto" }))).status, 200);
  };

  await drenar();
  assert.equal(llamadasAlLlm, 2, "el segundo mensaje tuvo su propio turno");
  assert.equal(enviados.length, 2);

  // Por createdAt el hilo es [hola, quiero un auto, respuesta al hola]; el
  // segundo turno tiene que verlo como pasó: la respuesta se escribió sin ver
  // el segundo mensaje, y ese mensaje es lo último que hay que contestar.
  const cola = requestsAlLlm[1].messages.slice(-3);
  assert.deepEqual(
    cola.map((m) => m.role),
    ["user", "assistant", "user"],
  );
  assert.ok(cola[0].content?.includes("hola"));
  assert.equal(cola[1].content, RESPUESTA_DEL_AGENTE);
  assert.ok(cola[2].content?.includes("quiero un auto"));
});

test("dos mensajes DISTINTOS de un contacto nuevo en webhooks paralelos -> una sola conversación abierta con los dos entrantes", async () => {
  const waId = waIdAlAzar();
  const [a, b] = await Promise.all([
    enviar(payloadDeTexto({ waId, body: "hola" })),
    enviar(payloadDeTexto({ waId, body: "quiero un auto" })),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);

  const contactos = await contactosConTelefono(`+${waId}`);
  assert.equal(contactos.length, 1);
  const conversaciones = await prisma.conversation.findMany({
    where: { organizationId: fx.orgId, contactId: contactos[0].id },
    include: { messages: true },
  });
  assert.equal(conversaciones.length, 1, "C-01: sin conversación duplicada ni vacía");
  assert.equal(conversaciones[0].messages.length, 2);

  await drenar();
  assert.equal(llamadasAlLlm, 1);
  assert.equal(enviados.length, 1);
});

test("un cuerpo firmado sin la forma de un webhook de Meta -> 400", async () => {
  const res = await enviar({ object: "whatsapp_business_account" });
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// message_template_status_update (ítem 160)
// ---------------------------------------------------------------------------

function cambioDePlantilla(value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-id",
        time: Math.floor(Date.now() / 1000),
        changes: [{ field: "message_template_status_update", value }],
      },
    ],
  };
}

test("message_template_status_update: Meta aprueba y después rechaza -> la fila con ese id cambia de estado", async () => {
  // Meta manda el id como NÚMERO; se guarda como string.
  const metaId = randomInt(10 ** 9, 10 ** 10 - 1);
  const plantilla = await prisma.whatsappTemplate.create({
    data: {
      organizationId: fx.orgId,
      name: `webhook_${String(metaId)}`,
      language: "es_AR",
      bodyText: "Hola {nombre}, gracias. Tu opinión: {link} ¡Gracias!",
      metaTemplateId: String(metaId),
    },
  });

  const aprobada = await enviar(
    cambioDePlantilla({
      event: "APPROVED",
      message_template_id: metaId,
      message_template_name: plantilla.name,
      message_template_language: "es_AR",
      reason: "NONE",
    }),
  );
  assert.equal(aprobada.status, 200);
  let fila = await prisma.whatsappTemplate.findUniqueOrThrow({ where: { id: plantilla.id } });
  assert.equal(fila.status, "APPROVED");
  assert.equal(fila.rejectedReason, null);

  await enviar(
    cambioDePlantilla({ event: "REJECTED", message_template_id: metaId, reason: "INVALID_FORMAT" }),
  );
  fila = await prisma.whatsappTemplate.findUniqueOrThrow({ where: { id: plantilla.id } });
  assert.equal(fila.status, "REJECTED");
  assert.equal(fila.rejectedReason, "INVALID_FORMAT");

  // Una BORRADA no se toca: el estado que importa es el de la activa.
  await prisma.whatsappTemplate.update({
    where: { id: plantilla.id },
    data: { deletedAt: new Date() },
  });
  await enviar(cambioDePlantilla({ event: "APPROVED", message_template_id: metaId }));
  fila = await prisma.whatsappTemplate.findUniqueOrThrow({ where: { id: plantilla.id } });
  assert.equal(fila.status, "REJECTED");
});

test("message_template_status_update de una plantilla que no es de este CRM, o sin la forma esperada -> 200 sin romper nada", async () => {
  const ajena = await enviar(
    cambioDePlantilla({ event: "APPROVED", message_template_id: 1, reason: "NONE" }),
  );
  assert.equal(ajena.status, 200);

  const rota = await enviar(cambioDePlantilla({ event: 42 }));
  assert.equal(rota.status, 200);
});
