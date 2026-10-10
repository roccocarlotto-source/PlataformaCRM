import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { DateTime } from "luxon";
import type { AgentParticipation, OrganizationEdition, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";
import {
  MOTIVO_DENTRO_DE_HORARIO,
  MOTIVO_NIVEL_SIN_ELEGIR,
  MOTIVO_SOLO_SEGUIMIENTO,
  MOTIVO_TOPE_DE_PRIMER_CONTACTO,
  TEXTO_DEL_WIDGET_SIN_IA,
} from "./agentNivelDeIa";
import { runAgentTurn } from "./agentOrchestration.service";
import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from "./llmProvider.service";

// ---------------------------------------------------------------------------
// Paso D (docs/ediciones.md §4, §10): el loop del agente respeta el nivel de
// IA. Contra Postgres real y con el proveedor doblado, para saber cuándo se
// llama al modelo y cuándo no.
//
// Lo de siempre (AUTONOMA en COMPLETA) lo cubren, sin tocarlos,
// agentOrchestration.integration-test.ts y automotoraSinCambios.
// ---------------------------------------------------------------------------

const TZ = "America/Montevideo";

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
        return Promise.resolve(guion[Math.min(requests.length - 1, guion.length - 1)]);
      },
    },
  };
}

const respuesta = (text: string): LlmCompletionResult => ({ text, toolCalls: [] });

interface Escenario {
  organizationId: string;
  branchId: string;
  agentId: string;
  contactId: string;
  ownerId: string;
}

const escenarios: Escenario[] = [];

async function montar(
  etiqueta: string,
  opciones: {
    edition?: OrganizationEdition;
    participation: AgentParticipation;
    elegido?: boolean;
    onlyOutsideBusinessHours?: boolean;
    enabledTools?: string[];
    channels?: ("WEB" | "WHATSAPP")[];
  },
): Promise<Escenario> {
  const rol = await findRoleByName("ADMIN");
  if (!rol) throw new Error("No está sembrado el rol ADMIN");
  const org = await prisma.organization.create({
    data: {
      name: `Nivel loop ${etiqueta} ${randomUUID()}`,
      slug: `nivel-loop-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
      edition: opciones.edition ?? "COMPLETA",
    },
  });
  const email = `nivel-loop-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const owner = await prisma.user.create({
    data: { id: data.user.id, organizationId: org.id, roleId: rol.id, email, fullName: "Vendedor" },
  });
  const branch = await prisma.branch.create({
    data: { organizationId: org.id, name: "Centro", timezone: TZ },
  });
  const contact = await prisma.contact.create({
    data: {
      organizationId: org.id,
      firstName: "Ana",
      lastName: "Pérez",
      email: "ana@example.com",
      ownerId: owner.id,
    },
  });
  const agent = await prisma.agent.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      name: "Agente",
      instructions: "Sos el agente de la sucursal.",
      modelProvider: "openrouter",
      modelName: "doble/modelo",
      enabledTools: opciones.enabledTools ?? [],
      channels: opciones.channels ?? ["WEB"],
      guardrails: {} as Prisma.InputJsonValue,
      participation: opciones.participation,
      participationChosenAt: opciones.elegido === false ? null : new Date(),
      onlyOutsideBusinessHours: opciones.onlyOutsideBusinessHours ?? false,
    },
  });
  const e = {
    organizationId: org.id,
    branchId: branch.id,
    agentId: agent.id,
    contactId: contact.id,
    ownerId: owner.id,
  };
  escenarios.push(e);
  return e;
}

after(async () => {
  for (const e of escenarios) {
    const where = { organizationId: e.organizationId };
    await prisma.message.deleteMany({ where });
    await prisma.conversation.deleteMany({ where });
    await prisma.activity.deleteMany({ where });
    await prisma.opportunity.deleteMany({ where });
    await prisma.branchBusinessHours.deleteMany({ where });
    await prisma.agent.deleteMany({ where });
    await prisma.contact.deleteMany({ where });
    await prisma.branch.deleteMany({ where });
    await prisma.user.deleteMany({ where });
    await prisma.organization.delete({ where: { id: e.organizationId } });
    await getSupabaseAdmin().auth.admin.deleteUser(e.ownerId);
  }
});

function turno(e: Escenario, texto: string, doble: Doble, channel: "WEB" | "WHATSAPP" = "WEB") {
  return runAgentTurn(
    {
      organizationId: e.organizationId,
      agentId: e.agentId,
      contactId: e.contactId,
      channel,
      texto,
    },
    { llmProvider: doble.proveedor },
  );
}

function tareas(e: Escenario) {
  return prisma.activity.findMany({ where: { organizationId: e.organizationId, type: "TASK" } });
}

async function contieneMotivo(e: Escenario, motivo: string) {
  const todas = await tareas(e);
  return todas.some((t) => (t.body ?? "").includes(motivo) || t.subject.includes(motivo));
}

test("SOLO_SEGUIMIENTO: no llama al modelo, deriva una sola vez y el widget recibe el texto fijo", async () => {
  const e = await montar("solo-seguimiento", { participation: "SOLO_SEGUIMIENTO" });
  const doble = doblarProveedor([respuesta("no debería salir")]);

  const primero = await turno(e, "Hola, ¿tienen la Hilux?", doble);
  assert.equal(doble.requests.length, 0, "no se llamó al modelo");
  assert.equal(primero.handoff, true);
  assert.equal(primero.status, "TRANSFERRED_TO_HUMAN");
  assert.equal(primero.respuesta, TEXTO_DEL_WIDGET_SIN_IA);
  assert.equal((await tareas(e)).length, 1);
  assert.ok(await contieneMotivo(e, MOTIVO_SOLO_SEGUIMIENTO));

  // El segundo mensaje: silencio, sin otra tarea.
  const segundo = await turno(e, "¿Hola?", doble);
  assert.equal(doble.requests.length, 0);
  assert.equal(segundo.respuesta, null);
  assert.equal((await tareas(e)).length, 1);
});

test("SOLO_SEGUIMIENTO por WhatsApp: deriva sin mandar ningún mensaje", async () => {
  const e = await montar("solo-seguimiento-wa", {
    participation: "SOLO_SEGUIMIENTO",
    channels: ["WHATSAPP"],
  });
  const doble = doblarProveedor([respuesta("no debería salir")]);
  const r = await turno(e, "Hola", doble, "WHATSAPP");
  assert.equal(doble.requests.length, 0);
  assert.equal(r.handoff, true);
  assert.equal(r.respuesta, null);
  const salientes = await prisma.message.count({
    where: { organizationId: e.organizationId, direction: "OUTBOUND" },
  });
  assert.equal(salientes, 0);
});

test("PRIMER_CONTACTO: responde 2 veces, la tercera deriva sin modelo y después calla; devolverla reinicia el tope", async () => {
  const e = await montar("primer-contacto", { participation: "PRIMER_CONTACTO" });
  const doble = doblarProveedor([respuesta("Hola, ¿en qué te ayudo?")]);

  assert.equal((await turno(e, "Hola", doble)).respuesta, "Hola, ¿en qué te ayudo?");
  assert.equal((await turno(e, "¿Tienen la Hilux?", doble)).respuesta, "Hola, ¿en qué te ayudo?");
  assert.equal(doble.requests.length, 2);

  const tercero = await turno(e, "¿Y el precio?", doble);
  assert.equal(doble.requests.length, 2, "la tercera no llama al modelo");
  assert.equal(tercero.handoff, true);
  assert.equal(tercero.respuesta, TEXTO_DEL_WIDGET_SIN_IA);
  assert.ok(await contieneMotivo(e, MOTIVO_TOPE_DE_PRIMER_CONTACTO));

  const cuarto = await turno(e, "¿Hola?", doble);
  assert.equal(doble.requests.length, 2);
  assert.equal(cuarto.respuesta, null);

  // Una persona escribe y la devuelve al agente: el conteo vuelve a empezar.
  const conversation = await prisma.conversation.findFirstOrThrow({
    where: { organizationId: e.organizationId },
  });
  await prisma.message.create({
    data: {
      organizationId: e.organizationId,
      conversationId: conversation.id,
      direction: "OUTBOUND",
      senderType: "HUMAN",
      senderUserId: e.ownerId,
      content: "Te escribo yo.",
    },
  });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { status: "ACTIVE" } });
  const devuelta = await turno(e, "Gracias, una cosa más", doble);
  assert.equal(doble.requests.length, 3);
  assert.equal(devuelta.respuesta, "Hola, ¿en qué te ayudo?");
});

test("PRIMER_CONTACTO: las acciones que comprometen algo no se ofrecen, y si el modelo las pide, no se ejecutan", async () => {
  const e = await montar("primer-contacto-tools", {
    participation: "PRIMER_CONTACTO",
    enabledTools: ["create_opportunity", "create_lead", "search_vehicles"],
  });
  const doble = doblarProveedor([
    {
      text: null,
      toolCalls: [
        { id: "t1", name: "create_opportunity", arguments: { title: "Hilux", motivo: "VISITA" } },
      ],
    },
    respuesta("Listo, te paso con alguien."),
  ]);
  const r = await turno(e, "Quiero ir a verla mañana", doble);

  const ofrecidas = (doble.requests[0].tools ?? []).map((t) => t.name).sort();
  assert.ok(!ofrecidas.includes("create_opportunity"), JSON.stringify(ofrecidas));
  assert.ok(ofrecidas.includes("create_lead"));
  assert.ok(ofrecidas.includes("search_vehicles"));
  const llamada = r.toolCalls.find((t) => t.name === "create_opportunity");
  assert.equal(llamada?.allowed, false);
  assert.equal(await prisma.opportunity.count({ where: { organizationId: e.organizationId } }), 0);
});

test("PRIMER_CONTACTO solo fuera de horario: dentro del horario deriva sin modelo; fuera, responde", async () => {
  const dentro = await montar("fuera-de-horario-dentro", {
    participation: "PRIMER_CONTACTO",
    onlyOutsideBusinessHours: true,
  });
  // Abierta todo el día, todos los días: ahora está dentro.
  for (const weekday of [
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
    "SUNDAY",
  ] as const) {
    await prisma.branchBusinessHours.create({
      data: {
        organizationId: dentro.organizationId,
        branchId: dentro.branchId,
        weekday,
        startMinute: 0,
        endMinute: 1440,
      },
    });
  }
  const dobleDentro = doblarProveedor([respuesta("no debería salir")]);
  const r1 = await turno(dentro, "Hola", dobleDentro);
  assert.equal(dobleDentro.requests.length, 0);
  assert.equal(r1.handoff, true);
  assert.ok(await contieneMotivo(dentro, MOTIVO_DENTRO_DE_HORARIO));

  const fuera = await montar("fuera-de-horario-fuera", {
    participation: "PRIMER_CONTACTO",
    onlyOutsideBusinessHours: true,
  });
  // Una hora abierta, doce horas lejos de ahora (en la zona de la sucursal).
  const hora = (DateTime.now().setZone(TZ).hour + 12) % 24;
  for (const weekday of [
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
    "SUNDAY",
  ] as const) {
    await prisma.branchBusinessHours.create({
      data: {
        organizationId: fuera.organizationId,
        branchId: fuera.branchId,
        weekday,
        startMinute: hora * 60,
        endMinute: hora * 60 + 60,
      },
    });
  }
  const dobleFuera = doblarProveedor([respuesta("Hola, te atiendo yo.")]);
  const r2 = await turno(fuera, "Hola", dobleFuera);
  assert.equal(dobleFuera.requests.length, 1);
  assert.equal(r2.respuesta, "Hola, te atiendo yo.");
});

test("ESENCIAL: un nivel que nadie eligió no responde y deriva; elegido, responde", async () => {
  const sinElegir = await montar("esencial-sin-elegir", {
    edition: "ESENCIAL",
    participation: "AUTONOMA",
    elegido: false,
  });
  const doble1 = doblarProveedor([respuesta("no debería salir")]);
  const r1 = await turno(sinElegir, "Hola", doble1);
  assert.equal(doble1.requests.length, 0);
  assert.equal(r1.handoff, true);
  assert.ok(await contieneMotivo(sinElegir, MOTIVO_NIVEL_SIN_ELEGIR));

  const elegido = await montar("esencial-elegido", {
    edition: "ESENCIAL",
    participation: "AUTONOMA",
  });
  const doble2 = doblarProveedor([respuesta("Hola, ¿en qué te ayudo?")]);
  const r2 = await turno(elegido, "Hola", doble2);
  assert.equal(doble2.requests.length, 1);
  assert.equal(r2.respuesta, "Hola, ¿en qué te ayudo?");
  assert.equal(r2.handoff, false);
});

test("COMPLETA: un AUTONOMA sin participation_chosen_at responde como hoy, sin derivar ni crear tareas", async () => {
  const e = await montar("completa-sin-fecha", { participation: "AUTONOMA", elegido: false });
  const doble = doblarProveedor([respuesta("Hola, ¿en qué te ayudo?")]);
  const r = await turno(e, "Hola", doble);
  assert.equal(doble.requests.length, 1);
  assert.equal(r.respuesta, "Hola, ¿en qué te ayudo?");
  assert.equal(r.handoff, false);
  assert.equal((await tareas(e)).length, 0);
});

test("agente borrado no responde: con deleted_at e is_active = true, no corre el turno ni deriva", async () => {
  const e = await montar("borrado", { participation: "AUTONOMA" });
  await prisma.agent.update({ where: { id: e.agentId }, data: { deletedAt: new Date() } });
  const doble = doblarProveedor([respuesta("no debería salir")]);
  await assert.rejects(() => turno(e, "Hola", doble));
  assert.equal(doble.requests.length, 0);
  assert.equal((await tareas(e)).length, 0, "no aparece ninguna derivación nueva");
});
