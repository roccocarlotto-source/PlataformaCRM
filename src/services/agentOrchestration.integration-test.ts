import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, mock, test } from "node:test";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";
import { AppError } from "../utils/AppError";
import {
  MAX_TOOL_ROUNDS_PER_TURN,
  MENSAJE_DE_HANDOFF,
  VENTANA_DE_MENSAJES,
  runAgentTurn,
} from "./agentOrchestration.service";
import {
  MENSAJE_CONTACTO_SIN_VENDEDOR,
  MENSAJE_RECURSO_DE_OTRA_SUCURSAL,
  MENSAJE_SIN_PIPELINE_POR_DEFECTO,
} from "./agentTools.service";
import { relojDeReservas } from "./booking.service";
import { createBranch } from "./branch.service";
import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from "./llmProvider.service";
import { createPipeline } from "./pipeline.service";
import { createResource } from "./resource.service";
import { createServiceType } from "./serviceType.service";
import { createStage } from "./stage.service";
import { replaceWorkingHoursForResource } from "./workingHours.service";

// ---------------------------------------------------------------------------
// El loop de orquestación (§4) contra Postgres real, con un LlmProvider FALSO
// guionado. Es la misma división que booking.integration-test.ts con Google:
// lo externo se dobla, todo lo demás es real — la conversación y los mensajes
// que se persisten, las tools que llaman a los services reales, la oportunidad
// y la reserva que quedan en la base, los guardrails que deciden.
//
// Lo que se prueba acá y no se puede probar sin base:
//
//   1. Texto directo: dos mensajes persistidos, lastMessageAt, sin tools.
//   2. Una tool permitida se ejecuta DE VERDAD: la oportunidad existe, con el
//      contacto de la conversación, el vendedor del contacto y la primera
//      etapa del pipeline por defecto — nada de eso lo eligió el modelo.
//   3. Una tool prohibida por guardrails NO se ejecuta y el modelo recibe el
//      motivo como resultado.
//   4. Agotar el tope de rondas deriva a humano con el cierre fijo; después,
//      el agente no responde más en esa conversación.
//   5. Los errores de negocio (sin vendedor, sin pipeline por defecto) llegan
//      al modelo como resultado de tool, no como excepción.
//   6. get_availability + create_booking en dos rondas, con el contacto de la
//      conversación y solo en la sucursal del agente.
//   7. La ventana de contexto corta en 20.
//
// CADA TEST TRAE SU PROPIA ORGANIZACIÓN: el runner corre los archivos en
// paralelo contra una base compartida.
// ---------------------------------------------------------------------------

const TZ = "America/Argentina/Buenos_Aires";
const UUID_INEXISTENTE = "99999999-9999-4999-8999-999999999999";

// Agenda: lunes 7 de septiembre de 2026, 9 a 13 local = 12:00Z a 16:00Z, con el
// reloj de reservas fijado el domingo anterior — mismo criterio que
// booking.integration-test.ts (V-2).
const LUNES_9_LOCAL = "2026-09-07T12:00:00Z";
const AHORA_FIJO = new Date("2026-09-06T12:00:00Z");
before(() => {
  mock.method(relojDeReservas, "ahora", () => AHORA_FIJO);
});

// ---------------------------------------------------------------------------
// El doble del proveedor: devuelve las respuestas del guion en orden y registra
// cada request. Si el guion se agota repite la última — es lo que hace posible
// el caso de "agotar el tope".
// ---------------------------------------------------------------------------

interface Doble {
  proveedor: LlmProvider;
  requests: LlmCompletionRequest[];
}

function doblarProveedor(guion: LlmCompletionResult[]): Doble {
  const requests: LlmCompletionRequest[] = [];
  return {
    requests,
    proveedor: {
      name: "doble",
      complete(request) {
        requests.push(request);
        const respuesta = guion[Math.min(requests.length - 1, guion.length - 1)];
        return Promise.resolve(respuesta);
      },
    },
  };
}

function texto(content: string): LlmCompletionResult {
  return { text: content, toolCalls: [] };
}

function pideTool(
  id: string,
  name: string,
  args: Record<string, unknown>,
  content: string | null = null,
): LlmCompletionResult {
  return { text: content, toolCalls: [{ id, name, arguments: args }] };
}

// ---------------------------------------------------------------------------
// Escenario
// ---------------------------------------------------------------------------

interface Escenario {
  organizationId: string;
  branchId: string;
  agentId: string;
  contactId: string;
  ownerId: string;
  authIds: string[];
  pipelineId?: string;
  stageId?: string;
}

interface OpcionesDeEscenario {
  enabledTools?: string[];
  guardrails?: Record<string, unknown>;
  channels?: ("WEB" | "WHATSAPP")[];
  conVendedor?: boolean;
  conPipeline?: boolean;
  tone?: string;
}

async function crearAuthUser(etiqueta: string) {
  const email = `agentloop-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(
      `No se pudo crear usuario real de Supabase Auth (${etiqueta}): ${error?.message}`,
    );
  }
  return data.user.id;
}

async function montar(etiqueta: string, opciones: OpcionesDeEscenario = {}): Promise<Escenario> {
  const adminRole = await findRoleByName("ADMIN");
  if (!adminRole) {
    throw new Error("No está sembrado el rol ADMIN. Abortando.");
  }

  const org = await prisma.organization.create({
    data: {
      name: `AgentLoop ${etiqueta} ${randomUUID()}`,
      slug: `agentloop-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });

  // Identidad real en Supabase Auth: el trigger trg_set_user_email_from_auth
  // lee auth.users para completar users.email.
  const authId = await crearAuthUser(etiqueta);
  const owner = await prisma.user.create({
    data: {
      id: authId,
      organizationId: org.id,
      roleId: adminRole.id,
      email: `placeholder-${authId}@example.test`,
      fullName: `Vendedor ${etiqueta}`,
    },
  });

  const branch = await createBranch(org.id, { name: "Centro", timezone: TZ });

  const contact = await prisma.contact.create({
    data: {
      organizationId: org.id,
      firstName: "Ana",
      lastName: "Pérez",
      ownerId: opciones.conVendedor === false ? null : owner.id,
    },
  });

  let pipelineId: string | undefined;
  let stageId: string | undefined;
  if (opciones.conPipeline !== false) {
    const pipeline = await createPipeline(org.id, { name: "Ventas", isDefault: true });
    // Dos etapas, la segunda creada primero: lo que importa es `order`, no el
    // orden de creación.
    await createStage(org.id, { pipelineId: pipeline.id, name: "Propuesta", order: 2 });
    const primera = await createStage(org.id, {
      pipelineId: pipeline.id,
      name: "Nuevo",
      order: 1,
    });
    pipelineId = pipeline.id;
    stageId = primera.id;
  }

  const agent = await prisma.agent.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      name: "Agente comercial",
      instructions: "Sos el agente comercial de la sucursal Centro.",
      tone: opciones.tone ?? null,
      modelProvider: "openrouter",
      modelName: "doble/modelo",
      enabledTools: opciones.enabledTools ?? ["create_opportunity"],
      channels: opciones.channels ?? ["WEB"],
      guardrails: (opciones.guardrails ?? {}) as Prisma.InputJsonValue,
    },
  });

  return {
    organizationId: org.id,
    branchId: branch.id,
    agentId: agent.id,
    contactId: contact.id,
    ownerId: owner.id,
    authIds: [authId],
    pipelineId,
    stageId,
  };
}

async function desmontar(e: Escenario) {
  const where = { organizationId: e.organizationId };
  await prisma.message.deleteMany({ where });
  await prisma.conversation.deleteMany({ where });
  await prisma.booking.deleteMany({ where });
  await prisma.workingHours.deleteMany({ where });
  await prisma.serviceType.deleteMany({ where });
  await prisma.resource.deleteMany({ where });
  await prisma.opportunity.deleteMany({ where });
  await prisma.stage.deleteMany({ where });
  await prisma.pipeline.deleteMany({ where });
  await prisma.agent.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await prisma.branch.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.organization.delete({ where: { id: e.organizationId } });
  for (const authId of e.authIds) {
    await getSupabaseAdmin().auth.admin.deleteUser(authId);
  }
}

function turno(e: Escenario, texto: string, proveedor: LlmProvider) {
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

function resultadoDeTool(mensajeDeTool: { content: string }): { ok: boolean; error?: string } {
  return JSON.parse(mensajeDeTool.content);
}

// ---------------------------------------------------------------------------
// 1. Texto directo
// ---------------------------------------------------------------------------

test("texto directo: crea la conversación, persiste entrante y saliente, sin tools", async () => {
  const e = await montar("texto", { tone: "cercano" });
  try {
    const doble = doblarProveedor([texto("¡Hola Ana! ¿En qué te ayudo?")]);

    const resultado = await turno(e, "Hola", doble.proveedor);

    assert.equal(resultado.respuesta, "¡Hola Ana! ¿En qué te ayudo?");
    assert.equal(resultado.status, "ACTIVE");
    assert.equal(resultado.handoff, false);
    assert.deepEqual(resultado.toolCalls, []);

    // El request al modelo: system prompt = instructions + tono; el historial
    // termina en el mensaje entrante; el catálogo es el habilitado.
    assert.equal(doble.requests.length, 1);
    const req = doble.requests[0];
    assert.match(req.systemPrompt, /agente comercial de la sucursal Centro/);
    assert.match(req.systemPrompt, /Tono de la conversación: cercano/);
    assert.deepEqual(req.messages, [{ role: "user", content: "Hola" }]);
    assert.deepEqual(
      req.tools.map((t) => t.name),
      ["create_opportunity"],
    );
    assert.equal(req.model, "doble/modelo");

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: resultado.conversationId },
    });
    assert.equal(conversation.contactId, e.contactId);
    assert.equal(conversation.branchId, e.branchId);
    assert.equal(conversation.channel, "WEB");
    assert.equal(conversation.status, "ACTIVE");

    const mensajes = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(
      mensajes.map((m) => [m.direction, m.senderType, m.content, m.toolCalls]),
      [
        ["INBOUND", "CONTACT", "Hola", null],
        ["OUTBOUND", "AGENT", "¡Hola Ana! ¿En qué te ayudo?", null],
      ],
    );
    assert.equal(conversation.lastMessageAt?.getTime(), mensajes[1].createdAt.getTime());
  } finally {
    await desmontar(e);
  }
});

test("un segundo turno reutiliza la conversación abierta y el modelo ve el historial completo", async () => {
  const e = await montar("historial");
  try {
    const primero = await turno(e, "Hola", doblarProveedor([texto("Buenas")]).proveedor);
    const doble = doblarProveedor([texto("Claro, contame")]);
    const segundo = await turno(e, "Quiero un presupuesto", doble.proveedor);

    assert.equal(segundo.conversationId, primero.conversationId);
    assert.deepEqual(doble.requests[0].messages, [
      { role: "user", content: "Hola" },
      { role: "assistant", content: "Buenas" },
      { role: "user", content: "Quiero un presupuesto" },
    ]);
  } finally {
    await desmontar(e);
  }
});

// ---------------------------------------------------------------------------
// 2. Una tool permitida se ejecuta de verdad
// ---------------------------------------------------------------------------

test("create_opportunity permitida: la oportunidad existe con contacto, vendedor y etapa resueltos por el wrapper", async () => {
  const e = await montar("crea-opp");
  try {
    const doble = doblarProveedor([
      pideTool("call_1", "create_opportunity", {
        title: "Corte de pelo",
        amount: 1500,
        currency: "uyu",
      }),
      texto("Listo, te creé la oportunidad."),
    ]);

    const resultado = await turno(e, "Quiero un corte", doble.proveedor);

    assert.equal(resultado.respuesta, "Listo, te creé la oportunidad.");
    assert.equal(resultado.toolCalls.length, 1);
    const [tc] = resultado.toolCalls;
    assert.equal(tc.name, "create_opportunity");
    assert.equal(tc.allowed, true);
    assert.equal(tc.result?.ok, true);

    // La fila real: nada de esto lo eligió el modelo.
    const opps = await prisma.opportunity.findMany({ where: { organizationId: e.organizationId } });
    assert.equal(opps.length, 1);
    assert.equal(opps[0].title, "Corte de pelo");
    assert.equal(opps[0].contactId, e.contactId);
    assert.equal(opps[0].ownerId, e.ownerId);
    assert.equal(opps[0].pipelineId, e.pipelineId);
    assert.equal(opps[0].stageId, e.stageId, "la etapa de menor order, no la primera creada");
    assert.equal(opps[0].currency, "UYU");
    assert.equal(Number(opps[0].amount), 1500);

    // Segunda ronda: el modelo recibió su pedido y el resultado de la tool.
    assert.equal(doble.requests.length, 2);
    const segunda = doble.requests[1].messages;
    assert.equal(segunda[1].role, "assistant");
    assert.equal(segunda[2].role, "tool");
    if (segunda[2].role === "tool") {
      assert.equal(segunda[2].toolCallId, "call_1");
      assert.equal(resultadoDeTool(segunda[2]).ok, true);
    }

    // Auditoría en Message.toolCalls del saliente.
    const saliente = await prisma.message.findFirstOrThrow({
      where: { conversationId: resultado.conversationId, direction: "OUTBOUND" },
    });
    const auditoria = saliente.toolCalls as { name: string; allowed: boolean }[];
    assert.equal(auditoria[0].name, "create_opportunity");
    assert.equal(auditoria[0].allowed, true);
  } finally {
    await desmontar(e);
  }
});

// ---------------------------------------------------------------------------
// 3. Guardrails: prohibida → no se ejecuta, y el modelo se entera por qué
// ---------------------------------------------------------------------------

test("una tool prohibida por accionesProhibidas NO se ejecuta y el modelo recibe el motivo", async () => {
  const e = await montar("prohibida", {
    guardrails: { accionesProhibidas: ["create_opportunity"] },
  });
  try {
    const doble = doblarProveedor([
      pideTool("call_1", "create_opportunity", { title: "x" }),
      texto("Entiendo, no puedo hacer eso ahora."),
    ]);

    const resultado = await turno(e, "Creame una oportunidad", doble.proveedor);

    assert.equal(resultado.toolCalls[0].allowed, false);
    assert.match(resultado.toolCalls[0].reason ?? "", /prohibida/);
    assert.equal(resultado.toolCalls[0].result, undefined, "no se ejecutó");

    const cuantas = await prisma.opportunity.count({ where: { organizationId: e.organizationId } });
    assert.equal(cuantas, 0);

    const mensajeDeTool = doble.requests[1].messages[2];
    assert.equal(mensajeDeTool.role, "tool");
    if (mensajeDeTool.role === "tool") {
      const r = resultadoDeTool(mensajeDeTool);
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /prohibida/);
    }
    assert.equal(resultado.respuesta, "Entiendo, no puedo hacer eso ahora.");
  } finally {
    await desmontar(e);
  }
});

test("una tool que no está en enabledTools se rechaza aunque exista en el catálogo", async () => {
  const e = await montar("no-habilitada", { enabledTools: ["get_availability"] });
  try {
    const doble = doblarProveedor([
      pideTool("call_1", "create_opportunity", { title: "x" }),
      texto("ok"),
    ]);
    const resultado = await turno(e, "hola", doble.proveedor);
    assert.equal(resultado.toolCalls[0].allowed, false);
    assert.match(resultado.toolCalls[0].reason ?? "", /no está habilitada/);
    // Y el catálogo ofrecido al modelo era solo lo habilitado.
    assert.deepEqual(
      doble.requests[0].tools.map((t) => t.name),
      ["get_availability"],
    );
  } finally {
    await desmontar(e);
  }
});

// ---------------------------------------------------------------------------
// 4. La red de seguridad: tope de rondas → handoff
// ---------------------------------------------------------------------------

test("agotar MAX_TOOL_ROUNDS_PER_TURN deriva a humano con el cierre fijo, y después el agente no responde", async () => {
  const e = await montar("handoff", { guardrails: { accionesProhibidas: ["create_opportunity"] } });
  try {
    // El modelo insiste con la misma acción prohibida, siempre.
    const doble = doblarProveedor([pideTool("call_x", "create_opportunity", { title: "x" })]);

    const resultado = await turno(e, "Dale, creala igual", doble.proveedor);

    assert.equal(doble.requests.length, MAX_TOOL_ROUNDS_PER_TURN);
    assert.equal(resultado.handoff, true);
    assert.equal(resultado.status, "TRANSFERRED_TO_HUMAN");
    assert.equal(resultado.respuesta, MENSAJE_DE_HANDOFF);
    assert.equal(resultado.toolCalls.length, MAX_TOOL_ROUNDS_PER_TURN);
    assert.ok(resultado.toolCalls.every((tc) => tc.allowed === false));

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: resultado.conversationId },
    });
    assert.equal(conversation.status, "TRANSFERRED_TO_HUMAN");

    const saliente = await prisma.message.findFirstOrThrow({
      where: { conversationId: conversation.id, direction: "OUTBOUND" },
    });
    assert.equal(saliente.content, MENSAJE_DE_HANDOFF);
    assert.equal(saliente.senderType, "AGENT");

    // El siguiente mensaje del contacto va al hilo, pero el agente ya no
    // interviene: sin llamada al modelo, sin respuesta.
    const dobleDespues = doblarProveedor([texto("no debería llegar")]);
    const despues = await turno(e, "¿Hola? ¿Hay alguien?", dobleDespues.proveedor);

    assert.equal(dobleDespues.requests.length, 0, "no se llamó al modelo");
    assert.equal(despues.respuesta, null);
    assert.equal(despues.conversationId, resultado.conversationId, "misma conversación");
    assert.equal(despues.status, "TRANSFERRED_TO_HUMAN");

    const entrantes = await prisma.message.count({
      where: { conversationId: conversation.id, direction: "INBOUND" },
    });
    assert.equal(entrantes, 2, "el segundo mensaje quedó registrado en el hilo");
  } finally {
    await desmontar(e);
  }
});

// ---------------------------------------------------------------------------
// 5. Errores de negocio como resultado, no como excepción
// ---------------------------------------------------------------------------

test("contacto sin vendedor: create_opportunity devuelve el error al modelo y no crea nada", async () => {
  const e = await montar("sin-vendedor", { conVendedor: false });
  try {
    const doble = doblarProveedor([
      pideTool("call_1", "create_opportunity", { title: "x" }),
      texto("Voy a pedir que un vendedor te contacte."),
    ]);

    const resultado = await turno(e, "Quiero comprar", doble.proveedor);

    assert.equal(resultado.toolCalls[0].allowed, true, "el permiso pasó; falló el negocio");
    assert.deepEqual(resultado.toolCalls[0].result, {
      ok: false,
      error: MENSAJE_CONTACTO_SIN_VENDEDOR,
    });
    assert.equal(
      await prisma.opportunity.count({ where: { organizationId: e.organizationId } }),
      0,
    );
    assert.equal(resultado.respuesta, "Voy a pedir que un vendedor te contacte.");
  } finally {
    await desmontar(e);
  }
});

test("sin pipeline por defecto: create_opportunity devuelve el error al modelo", async () => {
  const e = await montar("sin-pipeline", { conPipeline: false });
  try {
    const doble = doblarProveedor([
      pideTool("call_1", "create_opportunity", { title: "x" }),
      texto("ok"),
    ]);
    const resultado = await turno(e, "Quiero comprar", doble.proveedor);
    assert.deepEqual(resultado.toolCalls[0].result, {
      ok: false,
      error: MENSAJE_SIN_PIPELINE_POR_DEFECTO,
    });
  } finally {
    await desmontar(e);
  }
});

test("update_opportunity: solo sobre oportunidades del contacto de la conversación", async () => {
  const e = await montar("update-ajena", { enabledTools: ["update_opportunity"] });
  try {
    // Una oportunidad de OTRO contacto de la misma organización.
    const otro = await prisma.contact.create({
      data: { organizationId: e.organizationId, firstName: "Otro", lastName: "Cliente" },
    });
    const ajena = await prisma.opportunity.create({
      data: {
        organizationId: e.organizationId,
        title: "Ajena",
        contactId: otro.id,
        ownerId: e.ownerId,
        pipelineId: e.pipelineId!,
        stageId: e.stageId!,
      },
    });
    const propia = await prisma.opportunity.create({
      data: {
        organizationId: e.organizationId,
        title: "Propia",
        contactId: e.contactId,
        ownerId: e.ownerId,
        pipelineId: e.pipelineId!,
        stageId: e.stageId!,
      },
    });

    const doble = doblarProveedor([
      {
        text: null,
        toolCalls: [
          {
            id: "c1",
            name: "update_opportunity",
            arguments: { opportunityId: ajena.id, title: "hack" },
          },
          {
            id: "c2",
            name: "update_opportunity",
            arguments: { opportunityId: propia.id, status: "WON" },
          },
        ],
      },
      texto("Actualizada."),
    ]);

    const resultado = await turno(e, "Marcá como ganada", doble.proveedor);

    assert.equal(resultado.toolCalls[0].result?.ok, false);
    assert.equal(
      (resultado.toolCalls[0].result as { error: string }).error,
      "La oportunidad indicada no pertenece al contacto de esta conversación",
    );
    assert.equal(resultado.toolCalls[1].result?.ok, true);

    const ajenaDespues = await prisma.opportunity.findUniqueOrThrow({ where: { id: ajena.id } });
    assert.equal(ajenaDespues.title, "Ajena");
    const propiaDespues = await prisma.opportunity.findUniqueOrThrow({ where: { id: propia.id } });
    assert.equal(propiaDespues.status, "WON");
    assert.equal(propiaDespues.ownerId, e.ownerId, "el vendedor no cambia");
  } finally {
    await desmontar(e);
  }
});

// ---------------------------------------------------------------------------
// 6. Agenda: disponibilidad y reserva reales, en dos rondas
// ---------------------------------------------------------------------------

test("get_availability y create_booking en dos rondas: la reserva es del contacto de la conversación", async () => {
  const e = await montar("agenda", { enabledTools: ["get_availability", "create_booking"] });
  try {
    const resource = await createResource(e.organizationId, {
      branchId: e.branchId,
      name: "Juan (barbero)",
      type: "PERSON",
    });
    const serviceType = await createServiceType(e.organizationId, {
      branchId: e.branchId,
      resourceId: resource.id,
      name: "Corte",
      durationMin: 60,
    });
    await replaceWorkingHoursForResource(e.organizationId, resource.id, [
      { weekday: "MONDAY", startMinute: 540, endMinute: 780 },
    ]);

    const doble = doblarProveedor([
      pideTool("c1", "get_availability", {
        resourceId: resource.id,
        serviceTypeId: serviceType.id,
        desde: "2026-09-07T00:00:00-03:00",
        hasta: "2026-09-08T00:00:00-03:00",
      }),
      pideTool("c2", "create_booking", {
        resourceId: resource.id,
        serviceTypeId: serviceType.id,
        startsAt: LUNES_9_LOCAL,
      }),
      texto("Te reservé el lunes a las 9."),
    ]);

    const resultado = await turno(e, "Quiero un turno el lunes", doble.proveedor);

    assert.equal(doble.requests.length, 3);
    assert.equal(resultado.toolCalls.length, 2);

    const disponibilidad = resultado.toolCalls[0].result as {
      ok: true;
      data: { turnos: unknown[] };
    };
    assert.equal(disponibilidad.ok, true);
    assert.equal(
      disponibilidad.data.turnos.length,
      4,
      "9, 10, 11 y 12 — cuatro turnos de una hora",
    );

    assert.equal(resultado.toolCalls[1].result?.ok, true);
    const bookings = await prisma.booking.findMany({ where: { organizationId: e.organizationId } });
    assert.equal(bookings.length, 1);
    assert.equal(bookings[0].contactId, e.contactId, "el contacto sale de la conversación");
    assert.equal(bookings[0].startsAt.getTime(), new Date(LUNES_9_LOCAL).getTime());
    assert.equal(resultado.respuesta, "Te reservé el lunes a las 9.");
  } finally {
    await desmontar(e);
  }
});

test("el agente no reserva en un recurso de otra sucursal de la misma organización", async () => {
  const e = await montar("otra-sucursal", { enabledTools: ["create_booking"] });
  try {
    const norte = await createBranch(e.organizationId, { name: "Norte", timezone: TZ });
    const resource = await createResource(e.organizationId, {
      branchId: norte.id,
      name: "Pedro",
      type: "PERSON",
    });
    const serviceType = await createServiceType(e.organizationId, {
      branchId: norte.id,
      resourceId: resource.id,
      name: "Corte",
      durationMin: 60,
    });

    const doble = doblarProveedor([
      pideTool("c1", "create_booking", {
        resourceId: resource.id,
        serviceTypeId: serviceType.id,
        startsAt: LUNES_9_LOCAL,
      }),
      texto("ok"),
    ]);
    const resultado = await turno(e, "turno", doble.proveedor);

    assert.deepEqual(resultado.toolCalls[0].result, {
      ok: false,
      error: MENSAJE_RECURSO_DE_OTRA_SUCURSAL,
    });
    assert.equal(await prisma.booking.count({ where: { organizationId: e.organizationId } }), 0);
  } finally {
    await desmontar(e);
  }
});

// ---------------------------------------------------------------------------
// 7. Ventana de contexto y validaciones de entrada
// ---------------------------------------------------------------------------

test("la ventana de contexto son los últimos 20 mensajes, del más viejo al más nuevo", async () => {
  const e = await montar("ventana");
  try {
    // 15 turnos = 30 mensajes persistidos antes del que se mide.
    for (let i = 1; i <= 15; i++) {
      await turno(e, `pregunta ${i}`, doblarProveedor([texto(`respuesta ${i}`)]).proveedor);
    }
    const doble = doblarProveedor([texto("fin")]);
    await turno(e, "pregunta 16", doble.proveedor);

    const mensajes = doble.requests[0].messages;
    assert.equal(mensajes.length, VENTANA_DE_MENSAJES);
    // Los 31 mensajes son p1,r1,…,p15,r15,p16; los últimos 20 arrancan en r6.
    assert.deepEqual(mensajes[0], { role: "assistant", content: "respuesta 6" });
    assert.deepEqual(mensajes[VENTANA_DE_MENSAJES - 1], { role: "user", content: "pregunta 16" });
  } finally {
    await desmontar(e);
  }
});

test("un agente que no opera en el canal, uno desactivado, o un contacto ajeno son AppError sin persistir nada", async () => {
  const e = await montar("validaciones", { channels: ["WHATSAPP"] });
  try {
    const doble = doblarProveedor([texto("no")]);

    const sinCanal = await turno(e, "hola", doble.proveedor).catch((err: unknown) => err);
    assert.ok(sinCanal instanceof AppError && sinCanal.statusCode === 400);
    assert.match((sinCanal as AppError).message, /no opera en el canal WEB/);

    await prisma.agent.update({
      where: { id: e.agentId },
      data: { channels: ["WEB"], isActive: false },
    });
    const inactivo = await turno(e, "hola", doble.proveedor).catch((err: unknown) => err);
    assert.ok(inactivo instanceof AppError && inactivo.statusCode === 400);

    await prisma.agent.update({ where: { id: e.agentId }, data: { isActive: true } });
    const contactoAjeno = await runAgentTurn(
      {
        ...{ organizationId: e.organizationId, agentId: e.agentId, channel: "WEB", texto: "hola" },
        contactId: UUID_INEXISTENTE,
      },
      { llmProvider: doble.proveedor },
    ).catch((err: unknown) => err);
    assert.ok(contactoAjeno instanceof AppError && contactoAjeno.statusCode === 400);

    assert.equal(doble.requests.length, 0);
    assert.equal(
      await prisma.conversation.count({ where: { organizationId: e.organizationId } }),
      0,
    );
  } finally {
    await desmontar(e);
  }
});

// ---------------------------------------------------------------------------
// 8. Paso 3: create_lead / update_lead end-to-end, y el primer caso real de
// guardrails.infoNoModificable.
// ---------------------------------------------------------------------------

test("create_lead y después update_lead en la misma conversación: la calificación se acumula en el Contact", async () => {
  const e = await montar("lead", { enabledTools: ["create_lead", "update_lead"] });
  try {
    const primero = doblarProveedor([
      pideTool("c1", "create_lead", {
        score: 60,
        intent: "comprar un auto usado",
        urgency: "MEDIUM",
        notes: "Prefiere automático",
        aiData: { color: "rojo" },
      }),
      texto("Anotado. ¿Tenés un presupuesto en mente?"),
    ]);
    const turno1 = await turno(e, "Quiero un auto usado, automático", primero.proveedor);
    assert.equal(turno1.toolCalls[0].allowed, true);
    assert.equal(turno1.toolCalls[0].result?.ok, true);

    const segundo = doblarProveedor([
      pideTool("c2", "update_lead", {
        score: 80,
        budgetAmount: 15000,
        budgetCurrency: "USD",
        notes: "Hasta 15 mil dólares",
        aiData: { puertas: 4 },
      }),
      texto("Perfecto, con eso tenemos varias opciones."),
    ]);
    const turno2 = await turno(e, "Hasta 15 mil dólares", segundo.proveedor);
    assert.equal(turno2.conversationId, turno1.conversationId);
    assert.equal(turno2.toolCalls[0].result?.ok, true);

    // El resultado confirma lo escrito, para que el modelo pueda citarlo.
    const confirmado = turno2.toolCalls[0].result as { ok: true; data: Record<string, unknown> };
    assert.equal(confirmado.data.score, 80);
    assert.equal(confirmado.data.budgetAmount, 15000);
    assert.equal(confirmado.data.budgetCurrency, "USD");

    const contacto = await prisma.contact.findUniqueOrThrow({ where: { id: e.contactId } });
    assert.equal(contacto.leadScore, 80);
    assert.equal(contacto.leadIntent, "comprar un auto usado", "lo del primer turno sobrevive");
    assert.equal(contacto.leadUrgency, "MEDIUM");
    assert.equal(Number(contacto.leadBudgetAmount), 15000);
    assert.match(
      contacto.leadNotes ?? "",
      /Prefiere automático\n\[\d{4}-\d{2}-\d{2}\] Hasta 15 mil dólares$/,
    );
    assert.deepEqual(contacto.leadAiData, { color: "rojo", puertas: 4 });
    assert.equal(contacto.lifecycleStage, "LEAD", "no lo toca el agente");
  } finally {
    await desmontar(e);
  }
});

test("infoNoModificable = [Contact.budgetAmount] bloquea update_lead con presupuesto y deja pasar el resto", async () => {
  const e = await montar("lead-guardrail", {
    enabledTools: ["update_lead"],
    guardrails: { infoNoModificable: ["Contact.budgetAmount"] },
  });
  try {
    const doble = doblarProveedor([
      {
        text: null,
        toolCalls: [
          {
            id: "c1",
            name: "update_lead",
            arguments: { budgetAmount: 9999, budgetCurrency: "USD" },
          },
          { id: "c2", name: "update_lead", arguments: { score: 40 } },
        ],
      },
      texto("Tomo nota del interés; el presupuesto lo conversás con el vendedor."),
    ]);

    const resultado = await turno(e, "Tengo hasta 9999 dólares", doble.proveedor);

    assert.equal(resultado.toolCalls[0].allowed, false);
    assert.match(resultado.toolCalls[0].reason ?? "", /información protegida \(budgetAmount\)/);
    assert.equal(resultado.toolCalls[1].allowed, true);
    assert.equal(resultado.toolCalls[1].result?.ok, true);

    const contacto = await prisma.contact.findUniqueOrThrow({ where: { id: e.contactId } });
    assert.equal(contacto.leadBudgetAmount, null, "el presupuesto protegido no se escribió");
    assert.equal(contacto.leadScore, 40);
  } finally {
    await desmontar(e);
  }
});
