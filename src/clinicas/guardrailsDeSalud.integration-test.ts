import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { OrganizationIndustry, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";
import {
  PREFIJO_TAREA_URGENTE,
  derivarEntranteSinAgente,
  registrarEntrante,
  runAgentTurn,
} from "../services/agentOrchestration.service";
import { createBranch } from "../services/branch.service";
import {
  resetLlmProviderParaTests,
  setLlmProviderForTests,
  type LlmCompletionRequest,
  type LlmCompletionResult,
  type LlmProvider,
} from "../services/llmProvider.service";
import { AUDITORIA_DE_REGLA_DEL_RUBRO } from "../services/reglasDelRubro";
import {
  CUERPO_DE_LA_TAREA_CLINICA,
  CUERPO_DE_LA_TAREA_DE_URGENCIA,
  MOTIVO_CONSULTA_CLINICA,
  mensajeDeConsultaClinica,
  mensajeDeUrgencia,
} from "./config/mensajesDeSalud";
import { INSTRUCCION_SALUD } from "./guardrailsDeSalud";

// ---------------------------------------------------------------------------
// Guardrails de salud en el loop real (docs/rubros.md §5.3, PR R4), contra
// Postgres. Las organizaciones CLINICA se crean directo en la base: todavía no
// hay ruta que las cree.
//
// El proveedor del modelo es un doble que FALLA si lo llaman (también para el
// brief, que usa el proveedor global): una urgencia o una consulta clínica
// tienen que resolverse sin el modelo. El canal es WEB, que es el camino del
// widget (POST /api/public/agents/:agentId/web/messages corre runAgentTurn).
//
// Y el caso de la suite "automotora sin cambios" de R4: en una AUTOMOTORA,
// "me arde la garganta" llega al modelo como hoy, sin la instrucción de salud.
// ---------------------------------------------------------------------------

class ElModeloNoSeLlama extends Error {}

const proveedorQueFalla: LlmProvider = {
  name: "falla-si-lo-llaman",
  complete() {
    throw new ElModeloNoSeLlama("Se llamó al modelo y no tenía que llamarse");
  },
};

function proveedorGuionado(respuesta: LlmCompletionResult) {
  const requests: LlmCompletionRequest[] = [];
  const proveedor: LlmProvider = {
    name: "guionado",
    complete(request) {
      requests.push(request);
      return Promise.resolve(respuesta);
    },
  };
  return { proveedor, requests };
}

before(() => setLlmProviderForTests(proveedorQueFalla));
after(() => resetLlmProviderParaTests());

interface Escenario {
  organizationId: string;
  nombre: string;
  branchId: string;
  agentId: string;
  contactId: string;
  ownerId: string;
  authIds: string[];
}

const escenarios: Escenario[] = [];

async function montar(
  etiqueta: string,
  industry: OrganizationIndustry,
  opciones: { enabledTools?: string[]; channels?: ("WEB" | "WHATSAPP")[] } = {},
): Promise<Escenario> {
  const adminRole = await findRoleByName("ADMIN");
  if (!adminRole) throw new Error("No está sembrado el rol ADMIN");
  const nombre = `Clínica Ejemplo ${randomUUID().slice(0, 8)}`;
  const org = await prisma.organization.create({
    data: {
      name: nombre,
      slug: `guardrails-salud-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
      industry,
    },
  });
  const email = `guardrails-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
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
      email: "paciente@example.com",
      ownerId: owner.id,
    },
  });
  const agent = await prisma.agent.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      name: "Asistente",
      instructions: "Sos el asistente de la clínica.",
      modelProvider: "openrouter",
      modelName: "doble/modelo",
      enabledTools: opciones.enabledTools ?? [],
      channels: opciones.channels ?? ["WEB"],
      guardrails: {} as Prisma.InputJsonValue,
    },
  });
  const escenario = {
    organizationId: org.id,
    nombre,
    branchId: branch.id,
    agentId: agent.id,
    contactId: contact.id,
    ownerId: owner.id,
    authIds: [data.user.id],
  };
  escenarios.push(escenario);
  return escenario;
}

after(async () => {
  for (const e of escenarios) {
    const where = { organizationId: e.organizationId };
    await prisma.message.deleteMany({ where });
    await prisma.conversation.deleteMany({ where });
    await prisma.activity.deleteMany({ where });
    await prisma.agent.deleteMany({ where });
    await prisma.contact.deleteMany({ where });
    await prisma.branchBusinessHours.deleteMany({ where });
    await prisma.branch.deleteMany({ where });
    await prisma.user.deleteMany({ where });
    await prisma.organization.delete({ where: { id: e.organizationId } });
    for (const id of e.authIds) await getSupabaseAdmin().auth.admin.deleteUser(id);
  }
});

function turno(e: Escenario, texto: string, proveedor: LlmProvider = proveedorQueFalla) {
  return runAgentTurn(
    {
      organizationId: e.organizationId,
      agentId: e.agentId,
      contactId: e.contactId,
      channel: "WEB",
      texto,
    },
    { llmProvider: proveedor },
  );
}

async function tareasDe(e: Escenario) {
  return prisma.activity.findMany({
    where: { organizationId: e.organizationId },
    orderBy: { createdAt: "asc" },
  });
}

function marcaDe(toolCalls: unknown): Record<string, unknown> | undefined {
  return (toolCalls as { name: string; arguments: Record<string, unknown> }[] | null)?.find(
    (t) => t.name === AUDITORIA_DE_REGLA_DEL_RUBRO,
  )?.arguments;
}

// ---------------------------------------------------------------------------
// Capa 1
// ---------------------------------------------------------------------------

test("URGENCIA: sin modelo, manda exactamente la constante, deriva con tarea urgente y sin brief; el turno siguiente calla", async () => {
  const e = await montar("urgencia", "CLINICA");

  const r = await turno(e, "Se me hinchó la cara y no puedo respirar bien");
  assert.equal(r.respuesta, mensajeDeUrgencia(e.nombre));
  assert.equal(r.handoff, true);
  assert.equal(r.status, "TRANSFERRED_TO_HUMAN");

  const [tarea] = await tareasDe(e);
  assert.ok(tarea.subject.startsWith(PREFIJO_TAREA_URGENTE), tarea.subject);
  assert.equal(tarea.body, CUERPO_DE_LA_TAREA_DE_URGENCIA);
  assert.ok(tarea.dueDate, "la tarea urgente vence en el acto");
  assert.equal(tarea.assigneeId, e.ownerId);

  const conversacion = await prisma.conversation.findUniqueOrThrow({
    where: { id: r.conversationId },
  });
  assert.equal(conversacion.status, "TRANSFERRED_TO_HUMAN");
  assert.equal(conversacion.brief ?? null, null, "sin brief: resumiría el síntoma");

  const saliente = await prisma.message.findFirstOrThrow({
    where: { conversationId: r.conversationId, senderType: "AGENT" },
  });
  assert.equal(saliente.content, mensajeDeUrgencia(e.nombre));
  assert.equal(marcaDe(saliente.toolCalls)?.regla, "urgencia_de_salud");

  // El turno siguiente, aunque sea una pregunta común: calla, sin modelo.
  const siguiente = await turno(e, "¿y a qué hora atienden?");
  assert.equal(siguiente.respuesta, null);
});

test("CLINICA: sin modelo, mensaje fijo y tarea sin resumen; calla hasta que una persona la devuelva, y después el agente vuelve", async () => {
  const e = await montar("clinica", "CLINICA");

  const r = await turno(e, "Me arde mucho la zona después del láser, ¿es normal?");
  assert.equal(r.respuesta, mensajeDeConsultaClinica(e.nombre));
  assert.equal(r.handoff, true);
  const [tarea] = await tareasDe(e);
  assert.equal(tarea.body, CUERPO_DE_LA_TAREA_CLINICA);
  assert.ok(!tarea.subject.startsWith(PREFIJO_TAREA_URGENTE));
  assert.equal(tarea.dueDate, null);

  const callado = await turno(e, "quiero un turno para el martes");
  assert.equal(callado.respuesta, null, "después de la derivación clínica, el agente calla");

  // "Devolver al agente" (return-to-agent) deja la conversación en ACTIVE.
  await prisma.conversation.update({ where: { id: r.conversationId }, data: { status: "ACTIVE" } });
  const doble = proveedorGuionado({ text: "Tenemos lugar el martes a las 10.", toolCalls: [] });
  const devuelta = await turno(e, "quiero un turno para el martes", doble.proveedor);
  assert.equal(devuelta.respuesta, "Tenemos lugar el martes a las 10.");
  assert.equal(doble.requests.length, 1);
});

test("CLINICA en una ráfaga: el síntoma en un mensaje anterior del mismo turno también deriva", async () => {
  const e = await montar("rafaga", "CLINICA");
  // El primer mensaje queda registrado sin turno (como un entrante pendiente
  // de WhatsApp); el turno corre con el segundo.
  await registrarEntrante({
    organizationId: e.organizationId,
    agentId: e.agentId,
    branchId: e.branchId,
    contactId: e.contactId,
    channel: "WEB",
    texto: "me salieron ronchas",
  });
  const r = await turno(e, "¿tienen turno mañana?");
  assert.equal(r.respuesta, mensajeDeConsultaClinica(e.nombre));
});

// ---------------------------------------------------------------------------
// Composición de la urgencia
// ---------------------------------------------------------------------------

test("URGENCIA con una persona atendiendo: igual manda el mensaje de urgencia y una tarea urgente nueva", async () => {
  const e = await montar("urgencia-humano", "CLINICA");
  const doble = proveedorGuionado({ text: "Hola, ¿en qué te ayudo?", toolCalls: [] });
  const primero = await turno(e, "hola", doble.proveedor);
  // Una persona toma el hilo: derivada y con su mensaje último.
  await prisma.conversation.update({
    where: { id: primero.conversationId },
    data: { status: "TRANSFERRED_TO_HUMAN", assignedUserId: e.ownerId },
  });
  await prisma.message.create({
    data: {
      organizationId: e.organizationId,
      conversationId: primero.conversationId,
      direction: "OUTBOUND",
      senderType: "HUMAN",
      senderUserId: e.ownerId,
      content: "Hola, te atiende Recepción.",
    },
  });

  const r = await turno(e, "me desmayé recién");
  assert.equal(r.respuesta, mensajeDeUrgencia(e.nombre));
  const tareas = await tareasDe(e);
  assert.equal(tareas.length, 1, "la conversación ya estaba derivada: la urgencia avisa igual");
  assert.ok(tareas[0].subject.startsWith(PREFIJO_TAREA_URGENTE));
  assert.equal(tareas[0].assigneeId, e.ownerId);
});

test("URGENCIA con el agente inactivo: derivarEntranteSinAgente con responder manda el texto fijo; sin responder (webhook) solo deriva", async () => {
  const e = await montar("urgencia-apagado", "CLINICA", { channels: ["WHATSAPP"] });
  await prisma.agent.update({ where: { id: e.agentId }, data: { isActive: false } });
  const { conversation } = await registrarEntrante({
    organizationId: e.organizationId,
    agentId: e.agentId,
    branchId: e.branchId,
    contactId: e.contactId,
    channel: "WHATSAPP",
    texto: "no puedo respirar",
  });

  const { salienteId } = await derivarEntranteSinAgente({
    organizationId: e.organizationId,
    conversationId: conversation.id,
    responder: true,
  });
  assert.ok(salienteId, "el worker recibe el saliente para mandarlo");
  const saliente = await prisma.message.findUniqueOrThrow({ where: { id: salienteId } });
  assert.equal(saliente.content, mensajeDeUrgencia(e.nombre));
  assert.equal(saliente.senderType, "AGENT");
  const [tarea] = await tareasDe(e);
  assert.ok(tarea.subject.startsWith(PREFIJO_TAREA_URGENTE));

  // Un mensaje común con el agente apagado: deriva como siempre, sin texto.
  const otro = await montar("comun-apagado", "CLINICA", { channels: ["WHATSAPP"] });
  await prisma.agent.update({ where: { id: otro.agentId }, data: { isActive: false } });
  const { conversation: c2 } = await registrarEntrante({
    organizationId: otro.organizationId,
    agentId: otro.agentId,
    branchId: otro.branchId,
    contactId: otro.contactId,
    channel: "WHATSAPP",
    texto: "quiero un turno",
  });
  const sinTexto = await derivarEntranteSinAgente({
    organizationId: otro.organizationId,
    conversationId: c2.id,
    responder: true,
  });
  assert.equal(sinTexto.salienteId, null);
  const derivada = await prisma.conversation.findUniqueOrThrow({ where: { id: c2.id } });
  assert.equal(derivada.status, "TRANSFERRED_TO_HUMAN");
});

test("URGENCIA con SOLO_SEGUIMIENTO: el texto fijo sale igual, sin modelo", async () => {
  // El filtro por nivel es el PR 6 de docs/ediciones.md; la urgencia corre
  // antes de todo, así que vale con cualquier nivel.
  const e = await montar("urgencia-solo-seguimiento", "CLINICA");
  await prisma.agent.update({
    where: { id: e.agentId },
    data: { participation: "SOLO_SEGUIMIENTO" },
  });
  const r = await turno(e, "tengo dolor en el pecho");
  assert.equal(r.respuesta, mensajeDeUrgencia(e.nombre));
});

// ---------------------------------------------------------------------------
// Capa 3 y derivación del modelo
// ---------------------------------------------------------------------------

test("capa 3: una respuesta con dosis no sale; va el mensaje clínico, se deriva y queda auditada", async () => {
  const e = await montar("salida", "CLINICA");
  const indicacion = "Tomá 400 mg de ibuprofeno cada 8 horas y listo.";
  const doble = proveedorGuionado({ text: indicacion, toolCalls: [] });
  const r = await turno(e, "hola, una consulta por el turno", doble.proveedor);

  assert.equal(r.respuesta, mensajeDeConsultaClinica(e.nombre));
  assert.equal(r.handoff, true);
  const marca = marcaDe(r.toolCalls);
  assert.equal(marca?.capa, "salida");
  assert.equal(marca?.respuestaBloqueada, indicacion);
  const [tarea] = await tareasDe(e);
  assert.equal(tarea.body, CUERPO_DE_LA_TAREA_CLINICA);

  // La capa 2 estuvo en el prompt.
  assert.ok(doble.requests[0].systemPrompt.includes(INSTRUCCION_SALUD));
});

test("capa 3: una respuesta de turnos y precios pasa tal cual", async () => {
  const e = await montar("salida-ok", "CLINICA");
  const doble = proveedorGuionado({
    text: "La limpieza facial cuesta $2500 y tenemos lugar el jueves a las 15.",
    toolCalls: [],
  });
  const r = await turno(e, "¿cuánto sale la limpieza facial?", doble.proveedor);
  assert.equal(r.respuesta, "La limpieza facial cuesta $2500 y tenemos lugar el jueves a las 15.");
  assert.equal(r.handoff, false);
});

test("el modelo deriva con motivo clínico: la tarea lleva el aviso fijo, no su resumen", async () => {
  const e = await montar("motivo", "CLINICA");
  const doble = proveedorGuionado({
    text: null,
    toolCalls: [
      {
        id: "h1",
        name: "request_human_handoff",
        arguments: { reason: "Consulta clínica: le arde la piel después del peeling" },
      },
    ],
  });
  const r = await turno(e, "hola, ¿qué tal?", doble.proveedor);
  assert.equal(r.handoff, true);
  const [tarea] = await tareasDe(e);
  assert.equal(tarea.body, CUERPO_DE_LA_TAREA_CLINICA);
  assert.ok(!String(tarea.body).includes("peeling"));
  assert.equal(marcaDe(r.toolCalls)?.motivo, MOTIVO_CONSULTA_CLINICA);
});

test("update_lead en una clínica: sin notes ni aiData, ni en la definición ni en lo que guarda", async () => {
  const e = await montar("update-lead", "CLINICA", { enabledTools: ["update_lead"] });
  const requests: LlmCompletionRequest[] = [];
  const guion: LlmCompletionResult[] = [
    {
      text: null,
      toolCalls: [
        {
          id: "u1",
          name: "update_lead",
          arguments: { notes: "le arde la piel", aiData: { sintoma: "ardor" }, intent: "turno" },
        },
      ],
    },
    { text: "Listo, ¿qué día te queda bien?", toolCalls: [] },
  ];
  const proveedor: LlmProvider = {
    name: "guion",
    complete(request) {
      requests.push(request);
      return Promise.resolve(guion[Math.min(requests.length - 1, guion.length - 1)]);
    },
  };
  await turno(e, "quiero sacar un turno", proveedor);

  const definicion = requests[0].tools?.find((t) => t.name === "update_lead");
  const propiedades = Object.keys(
    (definicion?.parameters as { properties: Record<string, unknown> }).properties,
  );
  assert.ok(!propiedades.includes("notes"));
  assert.ok(!propiedades.includes("aiData"));
  const contacto = await prisma.contact.findUniqueOrThrow({ where: { id: e.contactId } });
  assert.equal(contacto.leadNotes, null);
  assert.equal(contacto.leadAiData, null);
});

// ---------------------------------------------------------------------------
// Suite "automotora sin cambios" (caso de R4, docs/rubros.md §14.1)
// ---------------------------------------------------------------------------

test("automotora sin cambios: 'me arde la garganta' llega al modelo como hoy, sin la instrucción de salud", async () => {
  const e = await montar("automotora", "AUTOMOTORA");
  const doble = proveedorGuionado({
    text: "Uh, que te mejores. ¿Te ayudo con algo?",
    toolCalls: [],
  });
  const r = await turno(e, "me arde la garganta", doble.proveedor);
  assert.equal(r.respuesta, "Uh, que te mejores. ¿Te ayudo con algo?");
  assert.equal(r.handoff, false);
  assert.equal(doble.requests.length, 1);
  assert.ok(!doble.requests[0].systemPrompt.includes(INSTRUCCION_SALUD));
  assert.deepEqual(r.toolCalls, []);
});
