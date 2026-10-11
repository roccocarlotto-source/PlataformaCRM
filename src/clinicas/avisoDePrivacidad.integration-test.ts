import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { OrganizationIndustry, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { createAgentInboundJob } from "../repositories/agentInboundJob.repository";
import { findRoleByName } from "../repositories/role.repository";
import { createAgent, updateAgent } from "../services/agent.service";
import { registrarEntrante, runAgentTurn } from "../services/agentOrchestration.service";
import { createBranch } from "../services/branch.service";
import {
  resetLlmProviderParaTests,
  setLlmProviderForTests,
  type LlmProvider,
} from "../services/llmProvider.service";
import {
  AVISO_SOLO_EN_CLINICAS,
  updateOrganizationSettings,
} from "../services/organization.service";
import type { SendWhatsappTextInput } from "../services/whatsappGraph.service";
import { AppError } from "../utils/AppError";
import { drenarTurnosPendientes, type DepsDeEnvio } from "../workers/agentInboundWorker";
import {
  AVISO_DE_PRIVACIDAD_INCOMPLETO,
  AVISO_EN_USO,
  registrarAvisoDePrivacidad,
  textoDelAvisoDePrivacidad,
} from "./avisoDePrivacidad";
import { mensajeDeUrgencia } from "./config/mensajesDeSalud";

// ---------------------------------------------------------------------------
// R16 (docs/rubros.md §8.1), contra Postgres: el aviso de privacidad de una
// clínica, una vez por contacto, antes de la primera respuesta del agente.
//
// El modelo es un doble que contesta siempre lo mismo: ninguna evaluación
// paga. Las organizaciones CLINICA se crean directo en la base.
// ---------------------------------------------------------------------------

const RESPUESTA = "¡Hola! ¿En qué te ayudo?";
const TEXTO = "Usamos tus datos solo para gestionar tus turnos.";
const LINK = "https://example.com/privacidad";
const AVISO = textoDelAvisoDePrivacidad(TEXTO, LINK);

const proveedor: LlmProvider = {
  name: "guionado",
  complete: () => Promise.resolve({ text: RESPUESTA, toolCalls: [] }),
};

before(() => setLlmProviderForTests(proveedor));
after(() => resetLlmProviderParaTests());

interface Escenario {
  organizationId: string;
  nombre: string;
  branchId: string;
  agentId: string;
  contactId: string;
  phoneNumberId: string;
  authIds: string[];
}

const escenarios: Escenario[] = [];

async function montar(
  etiqueta: string,
  industry: OrganizationIndustry,
  opciones: { conAviso?: boolean } = {},
): Promise<Escenario> {
  const adminRole = await findRoleByName("ADMIN");
  if (!adminRole) throw new Error("No está sembrado el rol ADMIN");
  const nombre = `Clínica Ejemplo ${randomUUID().slice(0, 8)}`;
  const org = await prisma.organization.create({
    data: {
      name: nombre,
      slug: `aviso-privacidad-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
      industry,
    },
  });
  if (opciones.conAviso) {
    await prisma.clinicSettings.create({
      data: { organizationId: org.id, privacyNoticeText: TEXTO, privacyPolicyUrl: LINK },
    });
  }
  const email = `aviso-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const owner = await prisma.user.create({
    data: {
      id: data.user.id,
      organizationId: org.id,
      roleId: adminRole.id,
      email,
      fullName: `Recepción ${etiqueta}`,
    },
  });
  const branch = await createBranch(org.id, {
    name: "Sede Centro",
    timezone: "America/Montevideo",
  });
  const contact = await prisma.contact.create({
    data: {
      organizationId: org.id,
      firstName: "Paciente",
      lastName: "Ejemplo",
      phone: `+5989${randomInt(1_000_000, 9_999_999)}`,
      ownerId: owner.id,
    },
  });
  const phoneNumberId = `9${randomInt(100_000_000, 999_999_999)}`;
  // Directo en la base: el agente activo existe aunque la clínica no tenga
  // aviso (el requisito de activación se prueba aparte, por el service).
  const agent = await prisma.agent.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      name: "Asistente",
      instructions: "Sos el asistente.",
      modelProvider: "openrouter",
      modelName: "doble/modelo",
      enabledTools: [],
      channels: ["WEB", "WHATSAPP"],
      whatsappPhoneNumberId: phoneNumberId,
      guardrails: {} as Prisma.InputJsonValue,
    },
  });
  const e = {
    organizationId: org.id,
    nombre,
    branchId: branch.id,
    agentId: agent.id,
    contactId: contact.id,
    phoneNumberId,
    authIds: [data.user.id],
  };
  escenarios.push(e);
  return e;
}

after(async () => {
  for (const e of escenarios) {
    const where = { organizationId: e.organizationId };
    await prisma.agentInboundJob.deleteMany({ where });
    await prisma.message.deleteMany({ where });
    await prisma.conversation.deleteMany({ where });
    await prisma.activity.deleteMany({ where });
    await prisma.agent.deleteMany({ where });
    await prisma.contact.deleteMany({ where });
    await prisma.branch.deleteMany({ where });
    await prisma.user.deleteMany({ where });
    await prisma.clinicSettings.deleteMany({ where });
    await prisma.organization.delete({ where: { id: e.organizationId } });
    for (const id of e.authIds) await getSupabaseAdmin().auth.admin.deleteUser(id);
  }
});

function turnoWeb(e: Escenario, texto: string) {
  return runAgentTurn(
    {
      organizationId: e.organizationId,
      agentId: e.agentId,
      contactId: e.contactId,
      channel: "WEB",
      texto,
      externalThreadId: `sesion-${e.contactId}`,
    },
    { llmProvider: proveedor },
  );
}

function salientes(conversationId: string) {
  return prisma.message.findMany({
    where: { conversationId, direction: "OUTBOUND" },
    orderBy: { createdAt: "asc" },
  });
}

async function enviadoEl(e: Escenario) {
  const c = await prisma.contact.findUniqueOrThrow({ where: { id: e.contactId } });
  return c.privacyNoticeSentAt;
}

test("primera respuesta: el aviso va antes, como mensaje aparte, y se registra cuándo; el segundo turno no lo repite", async () => {
  const e = await montar("primera", "CLINICA", { conAviso: true });

  const r = await turnoWeb(e, "hola, ¿qué días atienden?");
  assert.equal(r.respuesta, RESPUESTA);
  assert.equal(r.avisoDePrivacidad, AVISO);
  const [aviso, respuesta] = await salientes(r.conversationId);
  assert.equal(aviso.senderType, "AUTOMATION");
  assert.equal(aviso.noticeType, "PRIVACY_NOTICE");
  assert.equal(aviso.content, AVISO);
  assert.equal(respuesta.content, RESPUESTA);
  assert.ok(aviso.createdAt <= respuesta.createdAt);
  assert.ok(await enviadoEl(e));

  const segundo = await turnoWeb(e, "¿y los sábados?");
  assert.equal(segundo.avisoDePrivacidad, undefined);
  const mensajes = await salientes(r.conversationId);
  assert.equal(mensajes.filter((m) => m.noticeType === "PRIVACY_NOTICE").length, 1);
});

test("si el primer mensaje es una urgencia, sale la urgencia sola y el aviso queda para después", async () => {
  const e = await montar("urgencia", "CLINICA", { conAviso: true });

  const r = await turnoWeb(e, "Se me hinchó la cara y no puedo respirar bien");
  assert.equal(r.respuesta, mensajeDeUrgencia(e.nombre));
  assert.equal(r.avisoDePrivacidad, undefined);
  const mensajes = await salientes(r.conversationId);
  assert.deepEqual(
    mensajes.map((m) => m.content),
    [mensajeDeUrgencia(e.nombre)],
  );
  assert.equal(await enviadoEl(e), null);
});

test("una vez por contacto: dos registros a la vez crean un solo aviso", async () => {
  const e = await montar("cas", "CLINICA", { conAviso: true });
  const { conversation } = await registrarEntrante({
    organizationId: e.organizationId,
    agentId: e.agentId,
    branchId: e.branchId,
    contactId: e.contactId,
    channel: "WEB",
    texto: "hola",
    externalThreadId: `sesion-${e.contactId}`,
  });
  const args = {
    organizationId: e.organizationId,
    industry: "CLINICA" as const,
    conversationId: conversation.id,
    contactId: e.contactId,
  };
  const resultados = await Promise.all([
    registrarAvisoDePrivacidad(args),
    registrarAvisoDePrivacidad(args),
  ]);
  assert.equal(resultados.filter((x) => x !== null).length, 1);
  const avisos = await prisma.message.count({
    where: { organizationId: e.organizationId, noticeType: "PRIVACY_NOTICE" },
  });
  assert.equal(avisos, 1);
});

test("sin el aviso cargado no se manda nada; y el aviso de una clínica no se filtra a otra", async () => {
  const conAviso = await montar("aislamiento-a", "CLINICA", { conAviso: true });
  const sinAviso = await montar("aislamiento-b", "CLINICA");

  const r = await turnoWeb(sinAviso, "hola");
  assert.equal(r.avisoDePrivacidad, undefined);
  assert.equal(await enviadoEl(sinAviso), null);

  const otro = await turnoWeb(conAviso, "hola");
  assert.equal(otro.avisoDePrivacidad, AVISO);
});

test("WhatsApp: el worker manda el aviso antes de la respuesta, y un reintento no lo repite", async () => {
  const e = await montar("whatsapp", "CLINICA", { conAviso: true });
  const enviados: SendWhatsappTextInput[] = [];
  let fallar = true;
  const deps: DepsDeEnvio = {
    accessToken: () => "token-de-prueba",
    sendText: (input) => {
      // El primer envío de la RESPUESTA falla: el aviso ya salió.
      if (fallar && input.body === RESPUESTA) {
        fallar = false;
        return Promise.reject(new Error("falla de red (doble)"));
      }
      enviados.push(input);
      return Promise.resolve({ wamid: `wamid.${randomUUID()}` });
    },
    downloadMedia: () => Promise.reject(new Error("sin adjuntos")),
    pageAccessToken: () => Promise.reject(new Error("no es Meta")),
    sendMetaText: () => Promise.reject(new Error("no es Meta")),
  };
  const contacto = await prisma.contact.findUniqueOrThrow({ where: { id: e.contactId } });
  const { entrante } = await registrarEntrante({
    organizationId: e.organizationId,
    agentId: e.agentId,
    branchId: e.branchId,
    contactId: e.contactId,
    channel: "WHATSAPP",
    texto: "hola",
    externalMessageId: `wamid.entrante.${randomUUID()}`,
  });
  const job = await createAgentInboundJob({
    organizationId: e.organizationId,
    messageId: entrante.id,
    channelAccountId: e.phoneNumberId,
    externalUserId: (contacto.phone ?? "").replace("+", ""),
  });

  await drenarTurnosPendientes({ organizationId: e.organizationId, deps });
  assert.deepEqual(
    enviados.map((x) => x.body),
    [AVISO],
    "el aviso salió; la respuesta falló",
  );
  // El reintento: vuelve a PENDING con backoff; se adelanta para drenarlo ya.
  await prisma.agentInboundJob.update({
    where: { id: job.id },
    data: { nextAttemptAt: new Date(Date.now() - 1000) },
  });
  await drenarTurnosPendientes({ organizationId: e.organizationId, deps });
  assert.deepEqual(
    enviados.map((x) => x.body),
    [AVISO, RESPUESTA],
  );
});

test("activar un agente de clínica exige el aviso y el link; una automotora no", async () => {
  const clinica = await montar("activar", "CLINICA");
  const auto = await montar("activar-auto", "AUTOMOTORA");
  const base = {
    name: "Nuevo",
    instructions: "Sos el asistente.",
    enabledTools: [],
    channels: ["WEB" as const],
    allowedOrigins: [],
    guardrails: {},
    guardrailsText: "",
    participation: "AUTONOMA" as const,
  };

  await assert.rejects(
    createAgent(clinica.organizationId, { ...base, branchId: clinica.branchId, isActive: true }),
    (err: unknown) => err instanceof AppError && err.message === AVISO_DE_PRIVACIDAD_INCOMPLETO,
  );
  // Inactivo se puede crear, pero no activar.
  const inactivo = await createAgent(clinica.organizationId, {
    ...base,
    branchId: clinica.branchId,
    isActive: false,
  });
  await assert.rejects(
    updateAgent(clinica.organizationId, inactivo.id, { isActive: true }),
    (err: unknown) => err instanceof AppError && err.message === AVISO_DE_PRIVACIDAD_INCOMPLETO,
  );
  await updateOrganizationSettings(clinica.organizationId, {
    privacyNoticeText: TEXTO,
    privacyPolicyUrl: LINK,
  });
  const activado = await updateAgent(clinica.organizationId, inactivo.id, { isActive: true });
  assert.equal(activado.isActive, true);

  const deAuto = await createAgent(auto.organizationId, {
    ...base,
    branchId: auto.branchId,
    isActive: true,
  });
  assert.equal(deAuto.isActive, true);
});

test("configuración: una automotora no puede cargar el aviso; una clínica no lo borra con agentes activos", async () => {
  const auto = await montar("config-auto", "AUTOMOTORA");
  await assert.rejects(
    updateOrganizationSettings(auto.organizationId, { privacyNoticeText: TEXTO }),
    (err: unknown) => err instanceof AppError && err.message === AVISO_SOLO_EN_CLINICAS,
  );

  const clinica = await montar("config-clinica", "CLINICA", { conAviso: true });
  await assert.rejects(
    updateOrganizationSettings(clinica.organizationId, { privacyPolicyUrl: null }),
    (err: unknown) => err instanceof AppError && err.message === AVISO_EN_USO,
  );
  await prisma.agent.updateMany({
    where: { organizationId: clinica.organizationId },
    data: { isActive: false },
  });
  await updateOrganizationSettings(clinica.organizationId, {
    privacyNoticeText: null,
    privacyPolicyUrl: null,
  });
  const fila = await prisma.clinicSettings.findUniqueOrThrow({
    where: { organizationId: clinica.organizationId },
  });
  assert.equal(fila.privacyNoticeText, null);
  assert.equal(fila.privacyPolicyUrl, null);
});

test("automotora sin cambios: el turno no manda aviso y la respuesta del turno no trae la clave", async () => {
  const e = await montar("auto", "AUTOMOTORA");
  const r = await turnoWeb(e, "hola");
  assert.equal(r.respuesta, RESPUESTA);
  assert.ok(!("avisoDePrivacidad" in r));
  const mensajes = await salientes(r.conversationId);
  assert.deepEqual(
    mensajes.map((m) => m.content),
    [RESPUESTA],
  );
});
