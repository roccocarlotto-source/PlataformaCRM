import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import { prisma } from "../lib/prisma";
import { errorHandler } from "../middlewares/errorHandler";
import { notFound } from "../middlewares/notFound";
import { createMetaWebhookRouter } from "../routes/metaWebhook.routes";
import { resetLlmProviderParaTests, setLlmProviderForTests } from "../services/llmProvider.service";
import { obtenerTokenParaEnviar } from "../services/metaPageConnection.service";
import { MetaSendError, type SendMetaTextInput } from "../services/metaSend.service";
import { getCifrador } from "../utils/encryption";
import { hmacSha256Hex } from "../utils/hmac";
import { drenarTurnosPendientes, type DepsDeEnvio } from "../workers/agentInboundWorker";
import type { MetaWebhookDeps } from "./metaWebhook.controller";

// ---------------------------------------------------------------------------
// GET y POST /webhooks/meta (ítem 171) por HTTP real, contra Postgres real,
// con LA MISMA cadena de routes/metaWebhook.routes.ts (vía su factory) y
// secretos conocidos. El webhook solo ENCOLA. Desde el ítem 172 la cola se
// drena a mano (drenarTurnosPendientes acotado a la organización del negocio
// C, que es el único con un Page token cifrado de verdad) con un doble del
// Send API y un doble del LLM: nunca se habla con Meta ni con OpenRouter.
//
// Lo que este archivo fija:
//   - GET: handshake correcto -> 200 con el challenge crudo; token incorrecto
//     -> 403; sin META_WEBHOOK_VERIFY_TOKEN -> 500.
//   - POST: firma inválida o ausente -> 401 SIN tocar la base; sin
//     META_APP_SECRET -> 500.
//   - Messenger de punta a punta: Contact nuevo con nombre genérico, su
//     ContactChannelIdentity (PSID), Message entrante con el mid, y un
//     AgentInboundJob con MESSENGER / Page ID / PSID. El segundo
//     mensaje del mismo PSID reusa el contacto.
//   - Instagram de punta a punta: entry.id es el IGID, la página sale de la
//     MetaPageConnection, y el job lleva el PAGE ID.
//   - echo, adjunto sin texto y el mismo mid dos veces -> nada nuevo.
//   - dos organizaciones: cada webhook resuelve la suya y no mezcla.
//   - el envío (ítem 172): Messenger e Instagram de punta a punta (turno,
//     Send API con el token DESCIFRADO al PSID/IGSID, SENT, DONE); rate limit
//     con 400 -> reintento que reenvía sin otro turno; token rechazado (190)
//     -> FAILED y la conexión en ERROR, y el siguiente falla sin turno;
//     página reconectada -> FAILED sin turno ni envío.
// ---------------------------------------------------------------------------

const VERIFY_TOKEN = "test_meta_verify_token";
const APP_SECRET = "test_meta_app_secret";

let verifyTokenConfigurado: string | undefined = VERIFY_TOKEN;
let appSecretConfigurado: string | undefined = APP_SECRET;

const deps: MetaWebhookDeps = {
  verifyToken: () => verifyTokenConfigurado,
  appSecret: () => appSecretConfigurado,
};

// Dígitos al azar: facebook_page_id y page_id son UNIQUE GLOBAL, y un id fijo
// chocaría con los restos de una corrida anterior que no llegó a limpiar.
function idAlAzar(prefijo: string): string {
  return `${prefijo}${randomUUID().replace(/\D/g, "").padEnd(15, "7").slice(0, 15)}`;
}

interface Negocio {
  orgId: string;
  agentId: string;
  pageId: string;
  igId: string;
}

let negocioA: Negocio;
let negocioB: Negocio;
// El del envío (ítem 172): su conexión guarda TOKEN_DE_PAGINA cifrado.
let negocioC: Negocio;

const TOKEN_DE_PAGINA = "page-token-en-claro-de-prueba";
const RESPUESTA_DEL_AGENTE = "¡Hola! ¿En qué te ayudo?";

// Los dobles del Send API y del LLM. `falloDelEnvio` hace que el próximo
// envío lo rechace Meta con ese error (y se consume).
let enviadosAMeta: SendMetaTextInput[] = [];
let falloDelEnvio: MetaSendError | null = null;
let llamadasAlLlm = 0;

const depsDeEnvio: DepsDeEnvio = {
  accessToken: () => undefined,
  sendText: () => Promise.reject(new Error("un job de Meta no manda por WhatsApp")),
  downloadMedia: () => Promise.reject(new Error("solo texto")),
  // El REAL: lee la MetaPageConnection y descifra.
  pageAccessToken: obtenerTokenParaEnviar,
  sendMetaText: async (input) => {
    if (falloDelEnvio) {
      const err = falloDelEnvio;
      falloDelEnvio = null;
      throw err;
    }
    enviadosAMeta.push(input);
  },
};
let baseUrl: string;
let closeApp: () => Promise<void>;

// `tokenEnClaro`: el Page token que el worker va a descifrar (ítem 172). Sin
// él, un valor cualquiera que solo satisface el CHECK de "ACTIVE exige token".
async function crearNegocio(nombre: string, tokenEnClaro?: string): Promise<Negocio> {
  const org = await prisma.organization.create({
    data: {
      name: `Meta webhook ${nombre} ${randomUUID()}`,
      slug: `meta-webhook-${nombre.toLowerCase()}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  const branch = await prisma.branch.create({
    data: { organizationId: org.id, name: "Centro", timezone: "America/Montevideo" },
  });
  const pageId = idAlAzar("1");
  const igId = idAlAzar("17841");
  const agent = await prisma.agent.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      name: `Agente ${nombre}`,
      instructions: "Sos el agente de Messenger e Instagram.",
      modelProvider: "openrouter",
      modelName: "doble/modelo",
      enabledTools: [],
      channels: ["MESSENGER", "INSTAGRAM"],
      guardrails: {},
      facebookPageId: pageId,
    },
  });
  await prisma.metaPageConnection.create({
    data: {
      organizationId: org.id,
      pageId,
      pageAccessToken:
        tokenEnClaro !== undefined ? getCifrador().encrypt(tokenEnClaro) : "v1.cifrado-de-prueba",
      instagramBusinessAccountId: igId,
      status: "ACTIVE",
    },
  });
  return { orgId: org.id, agentId: agent.id, pageId, igId };
}

before(async () => {
  process.env.LOG_LEVEL = "fatal";

  const app = express();
  app.use(createMetaWebhookRouter(deps));
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

  negocioA = await crearNegocio("A");
  negocioB = await crearNegocio("B");
  negocioC = await crearNegocio("C", TOKEN_DE_PAGINA);

  setLlmProviderForTests({
    name: "doble",
    async complete() {
      llamadasAlLlm++;
      return { text: RESPUESTA_DEL_AGENTE, toolCalls: [] };
    },
  });
});

after(async () => {
  resetLlmProviderParaTests();
  if (closeApp) await closeApp();
  const ids = [negocioA?.orgId, negocioB?.orgId, negocioC?.orgId].filter(Boolean) as string[];
  if (ids.length === 0) return;
  const where = { organizationId: { in: ids } };
  // Antes que messages: las dos FKs de la cola apuntan ahí.
  await prisma.agentInboundJob.deleteMany({ where });
  await prisma.message.deleteMany({ where });
  await prisma.conversation.deleteMany({ where });
  await prisma.activity.deleteMany({ where });
  await prisma.contactChannelIdentity.deleteMany({ where });
  await prisma.metaPageConnection.deleteMany({ where });
  await prisma.agent.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await prisma.branch.deleteMany({ where });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// La forma verificada contra la doc de Meta (ver metaWebhook.service.ts):
// object "page" o "instagram", entry.id = Page ID o IGID, messaging[].
function payload(opts: {
  object: "page" | "instagram";
  cuentaId: string;
  senderId: string;
  mid?: string;
  text?: string;
  isEcho?: boolean;
  soloAdjunto?: boolean;
}) {
  const message: Record<string, unknown> = { mid: opts.mid ?? `m_${randomUUID()}` };
  if (!opts.soloAdjunto) message.text = opts.text ?? "Hola, quiero info";
  if (opts.soloAdjunto) {
    message.attachments = [{ type: "image", payload: { url: "https://ejemplo.test/foto.jpg" } }];
  }
  if (opts.isEcho) message.is_echo = true;
  const [sender, recipient] = opts.isEcho
    ? [opts.cuentaId, opts.senderId]
    : [opts.senderId, opts.cuentaId];
  return {
    object: opts.object,
    entry: [
      {
        id: opts.cuentaId,
        time: Date.now(),
        messaging: [
          { sender: { id: sender }, recipient: { id: recipient }, timestamp: Date.now(), message },
        ],
      },
    ],
  };
}

// Un POST firmado como lo firma Meta: HMAC-SHA256 del cuerpo crudo con el App
// Secret, en X-Hub-Signature-256 con el prefijo "sha256=".
function enviar(
  body: unknown,
  opts: { firma?: "valida" | "invalida" | "ausente" } = {},
): Promise<Response> {
  const crudo = JSON.stringify(body);
  const secreto = opts.firma === "invalida" ? "otro_secreto" : APP_SECRET;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.firma !== "ausente") {
    headers["x-hub-signature-256"] = `sha256=${hmacSha256Hex(secreto, Buffer.from(crudo, "utf8"))}`;
  }
  return fetch(`${baseUrl}/webhooks/meta`, { method: "POST", headers, body: crudo });
}

function mensajesCon(mid: string) {
  return prisma.message.findMany({ where: { externalMessageId: mid } });
}

// ---------------------------------------------------------------------------
// GET — handshake
// ---------------------------------------------------------------------------

test("GET con modo subscribe y verify token correcto -> 200 con el challenge crudo en text/plain", async () => {
  const res = await fetch(
    `${baseUrl}/webhooks/meta?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=987654`,
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/plain/);
  assert.equal(await res.text(), "987654");
});

test("GET con verify token incorrecto -> 403", async () => {
  const res = await fetch(
    `${baseUrl}/webhooks/meta?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=123`,
  );
  assert.equal(res.status, 403);
  assert.notEqual(await res.text(), "123");
});

test("GET sin META_WEBHOOK_VERIFY_TOKEN configurado -> 500, nunca un handshake que acepte cualquiera", async () => {
  verifyTokenConfigurado = undefined;
  try {
    const res = await fetch(
      `${baseUrl}/webhooks/meta?hub.mode=subscribe&hub.verify_token=cualquiera&hub.challenge=1`,
    );
    assert.equal(res.status, 500);
  } finally {
    verifyTokenConfigurado = VERIFY_TOKEN;
  }
});

// ---------------------------------------------------------------------------
// POST — firma
// ---------------------------------------------------------------------------

test("POST con firma inválida o ausente -> 401 sin tocar la base", async () => {
  for (const firma of ["invalida", "ausente"] as const) {
    const mid = `m_${randomUUID()}`;
    const res = await enviar(
      payload({ object: "page", cuentaId: negocioA.pageId, senderId: idAlAzar("9"), mid }),
      { firma },
    );
    assert.equal(res.status, 401, firma);
    assert.equal((await mensajesCon(mid)).length, 0, firma);
  }
});

test("POST sin META_APP_SECRET configurado -> 500", async () => {
  appSecretConfigurado = undefined;
  try {
    const res = await enviar(
      payload({ object: "page", cuentaId: negocioA.pageId, senderId: idAlAzar("9") }),
    );
    assert.equal(res.status, 500);
  } finally {
    appSecretConfigurado = APP_SECRET;
  }
});

// ---------------------------------------------------------------------------
// POST — de punta a punta
// ---------------------------------------------------------------------------

test("Messenger: Contact + identidad + Message + job con MESSENGER / Page ID / PSID; el segundo mensaje reusa el contacto", async () => {
  const psid = idAlAzar("2");
  const mid = `m_${randomUUID()}`;
  const res = await enviar(
    payload({ object: "page", cuentaId: negocioA.pageId, senderId: psid, mid, text: " Hola " }),
  );
  assert.equal(res.status, 200);

  const identidad = await prisma.contactChannelIdentity.findUniqueOrThrow({
    where: {
      organizationId_channel_externalId: {
        organizationId: negocioA.orgId,
        channel: "MESSENGER",
        externalId: psid,
      },
    },
  });
  const contacto = await prisma.contact.findUniqueOrThrow({ where: { id: identidad.contactId } });
  assert.equal(contacto.organizationId, negocioA.orgId);
  assert.equal(contacto.firstName, "Messenger");
  assert.equal(contacto.lastName, `…${psid.slice(-8)}`);
  assert.equal(contacto.source, "Messenger");
  assert.equal(contacto.phone, null);

  const [entrante] = await mensajesCon(mid);
  assert.ok(entrante);
  assert.equal(entrante.organizationId, negocioA.orgId);
  assert.equal(entrante.direction, "INBOUND");
  assert.equal(entrante.content, "Hola");
  const conversacion = await prisma.conversation.findUniqueOrThrow({
    where: { id: entrante.conversationId },
  });
  assert.equal(conversacion.channel, "MESSENGER");
  assert.equal(conversacion.contactId, contacto.id);
  assert.equal(conversacion.agentId, negocioA.agentId);

  const jobs = await prisma.agentInboundJob.findMany({ where: { messageId: entrante.id } });
  // Sin afirmar el status: otros archivos de integración corren workers de
  // la cola sin acotar por organización y pueden haberlo reclamado ya.
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].channel, "MESSENGER");
  assert.equal(jobs[0].channelAccountId, negocioA.pageId);
  assert.equal(jobs[0].externalUserId, psid);

  // Segundo mensaje del mismo PSID: mismo contacto, sin otra identidad.
  const mid2 = `m_${randomUUID()}`;
  assert.equal(
    (
      await enviar(
        payload({ object: "page", cuentaId: negocioA.pageId, senderId: psid, mid: mid2 }),
      )
    ).status,
    200,
  );
  const [segundo] = await mensajesCon(mid2);
  const conversacion2 = await prisma.conversation.findUniqueOrThrow({
    where: { id: segundo.conversationId },
  });
  assert.equal(conversacion2.contactId, contacto.id);
  assert.equal(
    await prisma.contactChannelIdentity.count({
      where: { organizationId: negocioA.orgId, externalId: psid },
    }),
    1,
  );
});

test("Instagram: entry.id es el IGID, la página sale de la conexión, y el job lleva el PAGE ID", async () => {
  const igsid = idAlAzar("3");
  const mid = `ig_${randomUUID()}`;
  const res = await enviar(
    payload({ object: "instagram", cuentaId: negocioA.igId, senderId: igsid, mid }),
  );
  assert.equal(res.status, 200);

  const [entrante] = await mensajesCon(mid);
  assert.ok(entrante, "el mensaje de Instagram se registró");
  assert.equal(entrante.organizationId, negocioA.orgId);

  const identidad = await prisma.contactChannelIdentity.findFirstOrThrow({
    where: { organizationId: negocioA.orgId, channel: "INSTAGRAM", externalId: igsid },
  });
  const contacto = await prisma.contact.findUniqueOrThrow({ where: { id: identidad.contactId } });
  assert.equal(contacto.firstName, "Instagram");
  assert.equal(contacto.source, "Instagram");

  const [job] = await prisma.agentInboundJob.findMany({ where: { messageId: entrante.id } });
  assert.equal(job.channel, "INSTAGRAM");
  assert.equal(job.channelAccountId, negocioA.pageId, "el Page ID, no el IGID");
  assert.equal(job.externalUserId, igsid);
});

test("echo, adjunto sin texto y el mismo mid dos veces -> nada nuevo", async () => {
  const psid = idAlAzar("4");

  const echo = `m_${randomUUID()}`;
  await enviar(
    payload({ object: "page", cuentaId: negocioA.pageId, senderId: psid, mid: echo, isEcho: true }),
  );
  assert.equal((await mensajesCon(echo)).length, 0, "el echo no es un entrante");

  const adjunto = `m_${randomUUID()}`;
  const resAdjunto = await enviar(
    payload({
      object: "instagram",
      cuentaId: negocioA.igId,
      senderId: psid,
      mid: adjunto,
      soloAdjunto: true,
    }),
  );
  assert.equal(resAdjunto.status, 200, "un adjunto no rompe el lote");
  assert.equal((await mensajesCon(adjunto)).length, 0);
  assert.equal(
    await prisma.contactChannelIdentity.count({ where: { externalId: psid } }),
    0,
    "ni echo ni adjunto crean contacto",
  );

  const repetido = `m_${randomUUID()}`;
  const cuerpo = payload({
    object: "page",
    cuentaId: negocioA.pageId,
    senderId: psid,
    mid: repetido,
  });
  await Promise.all([enviar(cuerpo), enviar(cuerpo)]);
  await enviar(cuerpo);
  const entrantes = await mensajesCon(repetido);
  assert.equal(entrantes.length, 1);
  assert.equal(await prisma.agentInboundJob.count({ where: { messageId: entrantes[0].id } }), 1);
  assert.equal(
    await prisma.contactChannelIdentity.count({ where: { externalId: psid } }),
    1,
    "las entregas paralelas no duplican el contacto",
  );
});

test("dos organizaciones: cada webhook resuelve la suya y no mezcla", async () => {
  // El MISMO PSID en las dos: Meta no lo repite entre páginas, pero si lo
  // hiciera, cada organización tiene que tener su propio contacto.
  const psid = idAlAzar("5");
  const midA = `m_${randomUUID()}`;
  const midB = `ig_${randomUUID()}`;
  await enviar(payload({ object: "page", cuentaId: negocioA.pageId, senderId: psid, mid: midA }));
  await enviar(
    payload({ object: "instagram", cuentaId: negocioB.igId, senderId: psid, mid: midB }),
  );

  const [a] = await mensajesCon(midA);
  const [b] = await mensajesCon(midB);
  assert.equal(a.organizationId, negocioA.orgId);
  assert.equal(b.organizationId, negocioB.orgId);

  const [jobA] = await prisma.agentInboundJob.findMany({ where: { messageId: a.id } });
  const [jobB] = await prisma.agentInboundJob.findMany({ where: { messageId: b.id } });
  assert.equal(jobA.organizationId, negocioA.orgId);
  assert.equal(jobA.channelAccountId, negocioA.pageId);
  assert.equal(jobB.organizationId, negocioB.orgId);
  assert.equal(jobB.channelAccountId, negocioB.pageId);

  const identidades = await prisma.contactChannelIdentity.findMany({
    where: { externalId: psid },
  });
  assert.deepEqual(
    identidades.map((i) => i.organizationId).sort(),
    [negocioA.orgId, negocioB.orgId].sort(),
  );
  const contactos = await prisma.contact.findMany({
    where: { id: { in: identidades.map((i) => i.contactId) } },
  });
  for (const identidad of identidades) {
    const contacto = contactos.find((c) => c.id === identidad.contactId);
    assert.equal(contacto?.organizationId, identidad.organizationId, "el contacto es de la suya");
  }
});

test("un contacto borrado que vuelve a escribir: contacto nuevo, la identidad apunta al nuevo", async () => {
  const psid = idAlAzar("6");
  await enviar(payload({ object: "page", cuentaId: negocioA.pageId, senderId: psid }));
  const clave = {
    organizationId_channel_externalId: {
      organizationId: negocioA.orgId,
      channel: "MESSENGER" as const,
      externalId: psid,
    },
  };
  const antes = await prisma.contactChannelIdentity.findUniqueOrThrow({ where: clave });
  // Se cierra la conversación para que el próximo mensaje no quede colgado
  // de la abierta del contacto borrado.
  await prisma.conversation.updateMany({
    where: { organizationId: negocioA.orgId, contactId: antes.contactId },
    data: { status: "CLOSED" },
  });
  await prisma.contact.update({ where: { id: antes.contactId }, data: { deletedAt: new Date() } });

  const mid = `m_${randomUUID()}`;
  await enviar(payload({ object: "page", cuentaId: negocioA.pageId, senderId: psid, mid }));

  const despues = await prisma.contactChannelIdentity.findUniqueOrThrow({ where: clave });
  assert.notEqual(despues.contactId, antes.contactId);
  const nuevo = await prisma.contact.findUniqueOrThrow({ where: { id: despues.contactId } });
  assert.equal(nuevo.deletedAt, null);
  const [entrante] = await mensajesCon(mid);
  const conversacion = await prisma.conversation.findUniqueOrThrow({
    where: { id: entrante.conversationId },
  });
  assert.equal(conversacion.contactId, nuevo.id);
});

// ---------------------------------------------------------------------------
// El envío (ítem 172). Todo sobre el negocio C, y el drenado acotado a su
// organización: los demás casos dejan jobs en A y B que nadie drena.
// ---------------------------------------------------------------------------

function drenarC() {
  return drenarTurnosPendientes({ organizationId: negocioC.orgId, deps: depsDeEnvio });
}

async function jobDe(mid: string) {
  const [entrante] = await mensajesCon(mid);
  assert.ok(entrante, `el entrante ${mid} se registró`);
  const [job] = await prisma.agentInboundJob.findMany({ where: { messageId: entrante.id } });
  return { entrante, job };
}

function reiniciarDobles() {
  enviadosAMeta = [];
  falloDelEnvio = null;
  llamadasAlLlm = 0;
}

async function restaurarConexionC() {
  await prisma.metaPageConnection.update({
    where: { organizationId: negocioC.orgId },
    data: {
      pageId: negocioC.pageId,
      status: "ACTIVE",
      pageAccessToken: getCifrador().encrypt(TOKEN_DE_PAGINA),
      lastErrorAt: null,
      lastErrorMessage: null,
    },
  });
}

for (const canal of ["MESSENGER", "INSTAGRAM"] as const) {
  test(`${canal} de punta a punta: turno, respuesta por el Send API con el token DESCIFRADO al ${canal === "MESSENGER" ? "PSID" : "IGSID"}, SENT y DONE`, async () => {
    reiniciarDobles();
    const remitente = idAlAzar(canal === "MESSENGER" ? "2" : "3");
    const mid = `m_${randomUUID()}`;
    const res = await enviar(
      payload({
        object: canal === "MESSENGER" ? "page" : "instagram",
        cuentaId: canal === "MESSENGER" ? negocioC.pageId : negocioC.igId,
        senderId: remitente,
        mid,
      }),
    );
    assert.equal(res.status, 200);

    const resumen = await drenarC();
    assert.equal(resumen.respondidos, 1);
    assert.equal(resumen.fallidos, 0);
    assert.equal(llamadasAlLlm, 1);
    assert.deepEqual(enviadosAMeta, [
      { pageAccessToken: TOKEN_DE_PAGINA, recipientId: remitente, text: RESPUESTA_DEL_AGENTE },
    ]);

    const { entrante, job } = await jobDe(mid);
    assert.equal(job.status, "DONE");
    const [saliente] = await prisma.message.findMany({
      where: { conversationId: entrante.conversationId, direction: "OUTBOUND" },
    });
    assert.equal(saliente.content, RESPUESTA_DEL_AGENTE);
    assert.equal(saliente.deliveryStatus, "SENT");
  });
}

test("rate limit de Meta con HTTP 400 (código 613) -> reintento con backoff que REENVÍA sin otro turno", async () => {
  reiniciarDobles();
  falloDelEnvio = new MetaSendError(400, '{"error":{"code":613}}', 613, null);
  const mid = `m_${randomUUID()}`;
  await enviar(
    payload({ object: "page", cuentaId: negocioC.pageId, senderId: idAlAzar("4"), mid }),
  );

  const primera = await drenarC();
  assert.equal(primera.pospuestos, 1);
  const { job } = await jobDe(mid);
  assert.equal(job.status, "PENDING");
  const saliente = await prisma.message.findUniqueOrThrow({
    where: { id: job.responseMessageId ?? "" },
  });
  assert.equal(saliente.deliveryStatus, "FAILED");

  await prisma.agentInboundJob.updateMany({
    where: { organizationId: negocioC.orgId, status: "PENDING" },
    data: { nextAttemptAt: new Date(Date.now() - 1000) },
  });
  const segunda = await drenarC();
  assert.equal(segunda.respondidos, 1);
  assert.equal(llamadasAlLlm, 1, "el reintento no corrió otro turno");
  assert.equal(enviadosAMeta.length, 1);
  assert.equal((await jobDe(mid)).job.status, "DONE");
});

test("Meta rechaza el token (190) -> FAILED sin reintentos, la conexión pasa a ERROR, y el siguiente mensaje falla SIN turno", async () => {
  reiniciarDobles();
  try {
    falloDelEnvio = new MetaSendError(
      401,
      '{"error":{"message":"Error validating access token","code":190}}',
      190,
      null,
    );
    const psid = idAlAzar("5");
    const mid = `m_${randomUUID()}`;
    await enviar(payload({ object: "page", cuentaId: negocioC.pageId, senderId: psid, mid }));

    const resumen = await drenarC();
    assert.equal(resumen.fallidos, 1);
    const { job } = await jobDe(mid);
    assert.equal(job.status, "FAILED");
    assert.equal(job.attempts, 1);

    const conexion = await prisma.metaPageConnection.findUniqueOrThrow({
      where: { organizationId: negocioC.orgId },
    });
    assert.equal(conexion.status, "ERROR");
    assert.match(conexion.lastErrorMessage ?? "", /Error validating access token/);
    assert.ok(conexion.pageAccessToken, "el ERROR conserva el token");

    // El próximo mensaje ya no gasta un turno: falla en obtenerTokenParaEnviar.
    llamadasAlLlm = 0;
    const mid2 = `m_${randomUUID()}`;
    await enviar(payload({ object: "page", cuentaId: negocioC.pageId, senderId: psid, mid: mid2 }));
    const siguiente = await drenarC();
    assert.equal(siguiente.fallidos, 1);
    assert.equal(llamadasAlLlm, 0, "sin turno del LLM");
    const { job: job2 } = await jobDe(mid2);
    assert.equal(job2.status, "FAILED");
    assert.match(job2.lastError ?? "", /reconectarla/);
    assert.equal(job2.responseMessageId, null, "no se escribió ninguna respuesta");
  } finally {
    await restaurarConexionC();
  }
});

test("la organización reconectó OTRA página después de que llegó el mensaje -> FAILED sin turno ni envío", async () => {
  reiniciarDobles();
  try {
    const mid = `m_${randomUUID()}`;
    await enviar(
      payload({ object: "page", cuentaId: negocioC.pageId, senderId: idAlAzar("6"), mid }),
    );
    // El job ya está encolado con la página vieja; la conexión cambia de página.
    await prisma.metaPageConnection.update({
      where: { organizationId: negocioC.orgId },
      data: { pageId: idAlAzar("1") },
    });

    const resumen = await drenarC();
    assert.equal(resumen.fallidos, 1);
    assert.equal(llamadasAlLlm, 0);
    assert.equal(enviadosAMeta.length, 0);
    const { job } = await jobDe(mid);
    assert.equal(job.status, "FAILED");
    assert.equal(job.attempts, 1, "permanente: sin reintentos");
    assert.match(job.lastError ?? "", /OTRA página/);
  } finally {
    await restaurarConexionC();
  }
});
