import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { transferConversationToHuman } from "../repositories/conversation.repository";
import { findRoleByName } from "../repositories/role.repository";
import {
  AVISO_SIN_RESPUESTA,
  MOTIVO_VENTANA_CERRADA,
  conversacionesConPedidoSinResponder,
} from "../services/avisoSinRespuesta.service";
import {
  avisarSiNadieRespondio,
  type DepsDeRespuestaHumana,
} from "../services/conversationReply.service";
import type { SendWhatsappTextInput } from "../services/whatsappGraph.service";
import { drenarAvisosSinRespuesta } from "./avisoSinRespuestaWorker";

// ---------------------------------------------------------------------------
// El aviso automático si nadie responde a una derivación
// (avisoSinRespuestaWorker.ts), contra Postgres real. El envío por la Graph
// API es un doble: nunca se manda un WhatsApp.
//
// Lo que se prueba:
//   1. Derivada hace más de los minutos del agente y sin respuesta: sale el
//      aviso por WhatsApp, la conversación vuelve al agente, queda la tarea y
//      la marca "sin responder".
//   2. Si una persona respondió a tiempo, no pasa nada.
//   3. Todavía no se cumplieron los minutos: no pasa nada.
//   4. Dos pasadas: un solo aviso.
//   5. El agente con el aviso desactivado (NULL o 0): no pasa nada.
//   6. La ventana de 24 h de WhatsApp cerrada: el aviso no sale (FAILED con el
//      motivo), igual que en "Devolver al agente".
//   7. Las derivadas antes de la columna (transferredToHumanAt NULL): no.
//   8. La derivación del agente escribe transferredToHumanAt.
// ---------------------------------------------------------------------------

const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;

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
let branchId: string;
let adminAuthId: string;
let adminId: string;

// Un agente por test: los minutos son del agente.
async function crearAgente(minutos: number | null = 15) {
  return prisma.agent.create({
    data: {
      organizationId: orgId,
      branchId,
      name: `Vera ${randomUUID().slice(0, 6)}`,
      instructions: "Atendé consultas.",
      modelProvider: "openrouter",
      modelName: "test/model",
      enabledTools: [],
      guardrails: {},
      channels: ["WHATSAPP"],
      whatsappPhoneNumberId: `9${Date.now()}${Math.floor(Math.random() * 1e6)}`.slice(0, 18),
      unansweredHandoffNoticeMinutes: minutos,
    },
  });
}

interface OpcionesDeDerivada {
  agentId: string;
  // Hace cuánto la derivó el agente; null = derivada antes de la columna.
  derivadaHace?: number | null;
  // Hace cuánto escribió el cliente por última vez.
  ultimoEntranteHace?: number;
}

async function crearDerivada(opciones: OpcionesDeDerivada) {
  const contacto = await prisma.contact.create({
    data: { organizationId: orgId, firstName: "Cliente", lastName: randomUUID().slice(0, 6) },
  });
  const derivadaHace = opciones.derivadaHace === undefined ? 20 * MINUTO : opciones.derivadaHace;
  const conversation = await prisma.conversation.create({
    data: {
      organizationId: orgId,
      branchId,
      agentId: opciones.agentId,
      contactId: contacto.id,
      channel: "WHATSAPP",
      status: "TRANSFERRED_TO_HUMAN",
      externalThreadId: `598${Math.floor(Math.random() * 1e8)}`,
      transferredToHumanAt: derivadaHace === null ? null : new Date(Date.now() - derivadaHace),
    },
  });
  await prisma.message.create({
    data: {
      organizationId: orgId,
      conversationId: conversation.id,
      direction: "INBOUND",
      senderType: "CONTACT",
      content: "Quiero hablar con una persona",
      createdAt: new Date(Date.now() - (opciones.ultimoEntranteHace ?? 21 * MINUTO)),
    },
  });
  return { id: conversation.id, contactId: contacto.id };
}

function drenar() {
  return drenarAvisosSinRespuesta({
    organizationId: orgId,
    avisar: (organizationId, conversationId, ahora) =>
      avisarSiNadieRespondio(organizationId, conversationId, ahora, deps),
  });
}

function avisosDe(conversationId: string) {
  return prisma.message.findMany({
    where: { organizationId: orgId, conversationId, senderType: "AUTOMATION" },
  });
}

async function estadoDe(conversationId: string) {
  return (await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).status;
}

before(async () => {
  process.env.LOG_LEVEL = "fatal";
  const org = await prisma.organization.create({
    data: {
      name: `Aviso ${randomUUID()}`,
      slug: `aviso-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  orgId = org.id;
  branchId = (
    await prisma.branch.create({
      data: { organizationId: orgId, name: "Centro", timezone: "America/Montevideo" },
    })
  ).id;

  // Un ADMIN: la tarea de "contactar al cliente" va a él cuando la derivación
  // no dejó ninguna.
  const email = `aviso-admin-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password: "Aviso-test-password-123!",
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear el usuario de Supabase Auth: ${error?.message}`);
  }
  adminAuthId = data.user.id;
  const rol = await findRoleByName("ADMIN");
  if (!rol) throw new Error("No está sembrado el rol ADMIN. Abortando.");
  adminId = (
    await prisma.user.create({
      data: { id: data.user.id, organizationId: orgId, roleId: rol.id, email, fullName: "Admin" },
    })
  ).id;
});

beforeEach(() => {
  envios.length = 0;
});

after(async () => {
  if (orgId) {
    await prisma.activity.deleteMany({ where: { organizationId: orgId } });
    await prisma.message.deleteMany({ where: { organizationId: orgId } });
    await prisma.conversation.deleteMany({ where: { organizationId: orgId } });
    await prisma.agent.deleteMany({ where: { organizationId: orgId } });
    await prisma.contact.deleteMany({ where: { organizationId: orgId } });
    await prisma.branch.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  }
  if (adminAuthId) await getSupabaseAdmin().auth.admin.deleteUser(adminAuthId);
});

test("1. nadie respondió en los minutos del agente: sale el aviso, vuelve al agente, queda la tarea y la marca", async () => {
  const agente = await crearAgente(15);
  const conv = await crearDerivada({ agentId: agente.id });

  const resumen = await drenar();

  assert.equal(resumen.avisados, 1);
  assert.equal(envios.length, 1);
  assert.equal(envios[0].body, AVISO_SIN_RESPUESTA, "el mismo aviso que #381");
  assert.equal(envios[0].phoneNumberId, agente.whatsappPhoneNumberId);
  assert.equal(await estadoDe(conv.id), "ACTIVE", "la conversación vuelve al agente");
  const [aviso] = await avisosDe(conv.id);
  assert.equal(aviso.deliveryStatus, "SENT");
  assert.match(aviso.externalMessageId ?? "", /^wamid\./);

  const tareas = await prisma.activity.findMany({
    where: { organizationId: orgId, contactId: conv.contactId },
  });
  assert.equal(tareas.length, 1);
  assert.equal(tareas[0].assigneeId, adminId);
  assert.equal(tareas[0].authorId, adminId, "sin actor: el autor es el mismo ADMIN");

  const marcadas = await conversacionesConPedidoSinResponder(orgId, [conv]);
  assert.equal(marcadas.has(conv.id), true);
});

test("2. una persona respondió antes de los minutos: no pasa nada", async () => {
  const agente = await crearAgente(15);
  const conv = await crearDerivada({ agentId: agente.id });
  await prisma.message.create({
    data: {
      organizationId: orgId,
      conversationId: conv.id,
      direction: "OUTBOUND",
      senderType: "HUMAN",
      senderUserId: adminId,
      content: "Hola, te escribo yo",
      createdAt: new Date(Date.now() - 10 * MINUTO),
    },
  });

  const resumen = await drenar();

  assert.equal(resumen.avisados, 0);
  assert.equal(envios.length, 0);
  assert.equal(await estadoDe(conv.id), "TRANSFERRED_TO_HUMAN");
  assert.equal((await avisosDe(conv.id)).length, 0);
});

test("3. todavía no se cumplieron los minutos: no pasa nada", async () => {
  const agente = await crearAgente(15);
  const conv = await crearDerivada({ agentId: agente.id, derivadaHace: 5 * MINUTO });

  await drenar();

  assert.equal(envios.length, 0);
  assert.equal(await estadoDe(conv.id), "TRANSFERRED_TO_HUMAN");
});

test("4. dos pasadas del worker: un solo aviso", async () => {
  const agente = await crearAgente(15);
  const conv = await crearDerivada({ agentId: agente.id });

  await drenar();
  const segunda = await drenar();

  assert.equal(segunda.avisados, 0);
  assert.equal(envios.length, 1);
  assert.equal((await avisosDe(conv.id)).length, 1);
  // Y la llamada directa, como la de otra instancia que la eligió en la misma
  // pasada, tampoco avisa de nuevo: ya está ACTIVE.
  assert.equal(await avisarSiNadieRespondio(orgId, conv.id, new Date(), deps), "no-corresponde");
  assert.equal(envios.length, 1);
});

test("5. agente con el aviso desactivado (vacío o 0): no pasa nada", async () => {
  for (const minutos of [null, 0]) {
    const agente = await crearAgente(minutos);
    const conv = await crearDerivada({ agentId: agente.id, derivadaHace: 2 * HORA });

    await drenar();

    assert.equal(envios.length, 0, `con ${String(minutos)}`);
    assert.equal(await estadoDe(conv.id), "TRANSFERRED_TO_HUMAN");
    assert.equal(
      await avisarSiNadieRespondio(orgId, conv.id, new Date(), deps),
      "no-corresponde",
      "la decisión bajo el lock también lo respeta",
    );
  }
});

test("6. ventana de 24 h cerrada: el aviso no sale (FAILED con el motivo), igual que #381", async () => {
  const agente = await crearAgente(15);
  const conv = await crearDerivada({
    agentId: agente.id,
    derivadaHace: 25 * HORA,
    ultimoEntranteHace: 25 * HORA,
  });

  const resumen = await drenar();

  assert.equal(resumen.avisados, 1);
  assert.equal(envios.length, 0, "no se manda nada por WhatsApp");
  const [aviso] = await avisosDe(conv.id);
  assert.equal(aviso.deliveryStatus, "FAILED");
  assert.equal(aviso.deliveryError, MOTIVO_VENTANA_CERRADA);
  assert.equal(await estadoDe(conv.id), "ACTIVE");
});

test("7. derivada antes de la columna (sin transferredToHumanAt): no recibe el aviso automático", async () => {
  const agente = await crearAgente(15);
  const conv = await crearDerivada({ agentId: agente.id, derivadaHace: null });

  await drenar();

  assert.equal(envios.length, 0);
  assert.equal(await estadoDe(conv.id), "TRANSFERRED_TO_HUMAN");
});

test("8. la derivación del agente anota desde cuándo cuentan los minutos", async () => {
  const agente = await crearAgente(15);
  const conv = await crearDerivada({ agentId: agente.id, derivadaHace: null });
  await prisma.conversation.update({ where: { id: conv.id }, data: { status: "ACTIVE" } });
  const antes = Date.now();

  const transicion = await transferConversationToHuman(conv.id, orgId, null);

  assert.equal(transicion.count, 1);
  const fila = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
  assert.equal(fila.status, "TRANSFERRED_TO_HUMAN");
  assert.ok(fila.transferredToHumanAt);
  assert.ok(fila.transferredToHumanAt.getTime() >= antes - 1000);
});
