import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { ConversationChannel } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { barrerConsultasSinAvance } from "../workers/inquiryStalledWorker";
import {
  depsDelSeguimientoDeConsultaReales,
  drenarSeguimientosDeConsultas,
  type DepsDelSeguimientoDeConsulta,
} from "../workers/inquiryFollowUpWorker";
import { drenarOutbox } from "../workers/outboxWorker";
import {
  actividadesDe,
  crearRegla,
  desmontar,
  eventosDe,
  montar,
  type Escenario,
} from "./automation.test-helper";
import { crearRegistroDeAcciones, type RegistroDeAcciones } from "./automationActions";
import { ACTION_INQUIRY_FOLLOW_UP, TEXTO_POR_DEFECTO } from "./automationActions/inquiryFollowUp";
import { registrarAutomatizaciones } from "./automationRegistrations";
import { TRIGGER_CONTACT_INQUIRY_STALLED } from "./automationTriggers";
import { marcarSinInteres } from "./contact.service";
import { createOpportunity } from "./opportunity.service";
import { crearRegistroDeHandlers, type RegistroDeHandlers } from "./outboxHandlers";

// ---------------------------------------------------------------------------
// El seguimiento automático de consultas estancadas (ítem 185) de punta a
// punta y contra Postgres real: el barrido emite contact.inquiry_stalled ->
// el outbox lo entrega -> inquiry.follow_up agenda (WhatsApp) o crea la tarea
// (otros canales) -> el worker manda el WhatsApp con la plantilla y lo anota
// en la conversación como Automatización.
//
// Lo doblado: el envío a Meta (sendTemplate/sendText), el número de la
// sucursal, el horario (proximaApertura) y el texto libre del modelo. Todo lo
// demás es real: la consulta del barrido, la cola, el despacho, la fila, la
// tarea, el mensaje en la conversación.
//
// CADA TEST TRAE SU PROPIA ORGANIZACIÓN (automation.test-helper): un barrido
// emite para toda la organización.
// ---------------------------------------------------------------------------

const DIA = 24 * 60 * 60 * 1000;
const HORA = 60 * 60 * 1000;
// El reloj simulado tiene que quedar pegado al reloj REAL: el reclamo de la
// cola compara next_attempt_at y last_inbound_at con now() de Postgres, no con
// `ahora`. Con una fecha fija, a las pocas horas la "próxima apertura" del test
// de fuera de horario (AHORA + 16 h) ya era pasado para la base y la fila se
// volvía a reclamar en el mismo drenaje. El comienzo de la hora en curso
// cumple las dos cosas que los tests necesitan: no es futuro para la base y
// AHORA + 16 h todavía no llegó. El barrido mide intervalos (ahora - días),
// no la hora del día, así que no importa cuál sea.
const AHORA = new Date(Math.floor(Date.now() / HORA) * HORA);

let acciones: RegistroDeAcciones;
let handlers: RegistroDeHandlers;
const escenarios: Escenario[] = [];

before(() => {
  acciones = crearRegistroDeAcciones();
  handlers = crearRegistroDeHandlers();
  registrarAutomatizaciones({ acciones, handlers });
});

after(async () => {
  await desmontar(...escenarios);
});

interface Montado extends Escenario {
  branchId: string;
  agentId: string;
  phoneNumberId: string;
}

async function escenario(etiqueta: string): Promise<Montado> {
  const e = await montar(etiqueta);
  escenarios.push(e);
  const phoneNumberId = `pn-${randomUUID().slice(0, 12)}`;
  const branch = await prisma.branch.create({
    data: { organizationId: e.organizationId, name: "Centro", timezone: "America/Montevideo" },
  });
  const agent = await prisma.agent.create({
    data: {
      organizationId: e.organizationId,
      branchId: branch.id,
      name: "Vera",
      instructions: "Atendé consultas.",
      modelProvider: "openrouter",
      modelName: "test/model",
      enabledTools: [],
      guardrails: {},
      channels: ["WHATSAPP"],
      whatsappPhoneNumberId: phoneNumberId,
    },
  });
  return { ...e, branchId: branch.id, agentId: agent.id, phoneNumberId };
}

async function reglaDeConsultas(e: Montado, config: { dias?: number; max?: number } = {}) {
  const regla = await crearRegla(e, {
    name: "Seguimiento de consultas",
    triggerType: TRIGGER_CONTACT_INQUIRY_STALLED,
    triggerConfig: { daysSinceLastMessage: config.dias ?? 3, maxFollowUps: config.max ?? 1 },
    actionType: ACTION_INQUIRY_FOLLOW_UP,
    actionConfig: { messageText: TEXTO_POR_DEFECTO },
  });
  // La plantilla aprobada de la regla, como la deja el alta en Meta: el texto
  // del negocio con sus tokens.
  await prisma.whatsappTemplate.create({
    data: {
      organizationId: e.organizationId,
      automationId: regla.id,
      name: `seguimiento_consulta_${randomUUID().slice(0, 8)}`,
      language: "es_AR",
      bodyText: TEXTO_POR_DEFECTO,
      metaTemplateId: randomUUID().slice(0, 16),
      status: "APPROVED",
    },
  });
  return regla;
}

// Un contacto que consultó por `channel` y cuyo último mensaje fue hace
// `diasCallado` días.
async function consulta(
  e: Montado,
  opciones: {
    channel?: ConversationChannel;
    diasCallado?: number;
    nombre?: [string, string];
    status?: "ACTIVE" | "TRANSFERRED_TO_HUMAN";
    phone?: string;
  } = {},
) {
  const [firstName, lastName] = opciones.nombre ?? ["Martín", "Pérez"];
  const contacto = await prisma.contact.create({
    data: {
      organizationId: e.organizationId,
      firstName,
      lastName,
      phone: opciones.phone ?? `+5989${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`,
      ownerId: e.userId,
      source: "WhatsApp",
    },
  });
  const escribio = new Date(AHORA.getTime() - (opciones.diasCallado ?? 4) * DIA);
  const conversation = await prisma.conversation.create({
    data: {
      organizationId: e.organizationId,
      branchId: e.branchId,
      agentId: e.agentId,
      contactId: contacto.id,
      channel: opciones.channel ?? "WHATSAPP",
      status: opciones.status ?? "ACTIVE",
      externalThreadId: (contacto.phone ?? "").replace(/\D/g, ""),
      lastMessageAt: escribio,
    },
  });
  await prisma.message.createMany({
    data: [
      {
        organizationId: e.organizationId,
        conversationId: conversation.id,
        direction: "INBOUND",
        senderType: "CONTACT",
        content: "¿Cuánto sale la Hilux SRV 2022?",
        createdAt: new Date(escribio.getTime() - 60_000),
      },
      {
        organizationId: e.organizationId,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        senderType: "AGENT",
        content: "Está a consultar con un vendedor. ¿Querés que te contacten?",
        createdAt: new Date(escribio.getTime() - 30_000),
      },
      {
        organizationId: e.organizationId,
        conversationId: conversation.id,
        direction: "INBOUND",
        senderType: "CONTACT",
        content: "Dale, cuánto sale?",
        createdAt: escribio,
      },
    ],
  });
  return { contacto, conversation, escribio };
}

function barrer(e: Escenario, ahora: Date = AHORA) {
  return barrerConsultasSinAvance({ organizationId: e.organizationId, ahora });
}

function drenar(e: Escenario) {
  return drenarOutbox({ organizationId: e.organizationId, registro: handlers });
}

// La fila nace con el reloj real de la base; los tests que miden días desde
// el último seguimiento la ponen en el reloj simulado.
function fecharFilas(e: Escenario, cuando: Date) {
  return prisma.inquiryFollowUp.updateMany({
    where: { organizationId: e.organizationId },
    data: { createdAt: cuando },
  });
}

function filasDe(e: Escenario) {
  return prisma.inquiryFollowUp.findMany({
    where: { organizationId: e.organizationId },
    orderBy: { createdAt: "asc" },
  });
}

interface Envios {
  plantillas: { to: string; templateName: string; bodyParameters: string[] }[];
  textos: { to: string; body: string }[];
}

// Las dependencias del worker de envío, con Meta doblada. `cerrada` deja la
// sucursal cerrada hasta `abre`.
function depsDeEnvio(e: Montado, opciones: { cerradaHasta?: Date; ahora?: Date } = {}) {
  const envios: Envios = { plantillas: [], textos: [] };
  const deps: DepsDelSeguimientoDeConsulta = {
    accessToken: () => "token-de-prueba",
    plantillaDeLaRegla: async (organizationId, automationId) => {
      const plantilla = await prisma.whatsappTemplate.findFirst({
        where: { organizationId, automationId, status: "APPROVED", deletedAt: null },
      });
      return plantilla
        ? { name: plantilla.name, languageCode: plantilla.language, bodyText: plantilla.bodyText }
        : null;
    },
    numeroDeLaSucursal: async () => e.phoneNumberId,
    proximaApertura: async (_org, _branch, ahora) =>
      opciones.cerradaHasta && opciones.cerradaHasta.getTime() > ahora.getTime()
        ? opciones.cerradaHasta
        : ahora,
    respondioDespues: async (organizationId, contactId, desde) =>
      (await prisma.message.count({
        where: {
          organizationId,
          direction: "INBOUND",
          createdAt: { gt: desde },
          conversation: { contactId },
        },
      })) > 0,
    hayOportunidadAbierta: async (contactId, organizationId) =>
      (await prisma.opportunity.count({
        where: { contactId, organizationId, deletedAt: null, status: "OPEN" },
      })) > 0,
    sendTemplate: async (input) => {
      envios.plantillas.push({
        to: input.to,
        templateName: input.templateName,
        bodyParameters: input.bodyParameters,
      });
      return { wamid: `wamid.${randomUUID().slice(0, 8)}` };
    },
    sendText: async (input) => {
      envios.textos.push({ to: input.to, body: input.body });
      return { wamid: `wamid.${randomUUID().slice(0, 8)}` };
    },
    generarTexto: async () => "¡Hola! Vi que preguntaste por la Hilux. ¿Seguís interesado?",
    // D9: la decisión real, contra la base (el agente de la conversación).
    agenteRespondeSolo: depsDelSeguimientoDeConsultaReales.agenteRespondeSolo,
    ahora: () => opciones.ahora ?? AHORA,
  };
  return { deps, envios };
}

function enviar(e: Montado, opciones: { cerradaHasta?: Date; ahora?: Date } = {}) {
  const { deps, envios } = depsDeEnvio(e, opciones);
  return drenarSeguimientosDeConsultas({ organizationId: e.organizationId, deps }).then(
    (resumen) => ({ resumen, envios }),
  );
}

test("consulta de precio por WhatsApp y silencio de X días: se manda la plantilla con el saludo y el vehículo, y queda en la conversación como Automatización", async () => {
  const e = await escenario("consulta-wa");
  await reglaDeConsultas(e, { dias: 3 });
  const vehiculo = await prisma.vehicle.create({
    data: {
      organizationId: e.organizationId,
      branchId: e.branchId,
      internalCode: "H-1",
      condition: "USED",
      make: "Toyota",
      model: "Hilux",
      trim: "SRV",
      year: 2022,
    },
  });
  const { contacto, conversation } = await consulta(e, { diasCallado: 4 });
  await prisma.contact.update({
    where: { id: contacto.id },
    data: { vehicleOfInterestId: vehiculo.id, vehicleOfInterestSetBy: "AGENT" },
  });

  // Dos días callado todavía no califica.
  assert.equal((await barrer(e, new Date(AHORA.getTime() - 2 * DIA))).emitidos, 0);

  const barrido = await barrer(e);
  assert.equal(barrido.emitidos, 1);
  const [evento] = await eventosDe(e, TRIGGER_CONTACT_INQUIRY_STALLED);
  assert.equal(evento.payload && (evento.payload as { contactId: string }).contactId, contacto.id);

  const entrega = await drenar(e);
  assert.equal(entrega.entregados, 1);
  assert.equal(entrega.reprogramados + entrega.muertos, 0);

  let [fila] = await filasDe(e);
  assert.equal(fila.kind, "WHATSAPP");
  assert.equal(fila.status, "PENDING");
  assert.equal(fila.conversationId, conversation.id);

  const { resumen, envios } = await enviar(e);
  assert.equal(resumen.enviados, 1);
  assert.equal(envios.plantillas.length, 1);
  assert.deepEqual(envios.plantillas[0].bodyParameters, ["Hola Martín", "Toyota Hilux SRV 2022"]);
  assert.equal(envios.plantillas[0].to, (contacto.phone ?? "").replace(/\D/g, ""));
  assert.equal(envios.textos.length, 0, "fuera de las 24 h no sale texto libre");

  [fila] = await filasDe(e);
  assert.equal(fila.status, "SENT");
  const anotado = await prisma.message.findFirst({
    where: { conversationId: conversation.id, senderType: "AUTOMATION" },
  });
  assert.ok(anotado, "el WhatsApp queda en la conversación como Automatización");
  assert.match(
    anotado.content,
    /¡Hola Martín! Te escribimos por tu consulta sobre Toyota Hilux SRV 2022/,
  );

  // Al día siguiente sigue callado, pero el tope es 1: no se emite otro.
  assert.equal((await barrer(e, new Date(AHORA.getTime() + DIA))).emitidos, 0);
  // Un segundo barrido en la misma pasada tampoco duplica (ventana del outbox).
  assert.equal((await barrer(e)).emitidos, 0);
});

test("sin nombre real: el saludo va sin nombre; el texto libre sale solo dentro de las 24 h", async () => {
  const e = await escenario("consulta-anonima");
  await reglaDeConsultas(e, { dias: 0 });
  const { contacto } = await consulta(e, {
    nombre: ["WhatsApp", "+59891234567"],
    phone: "+59891234567",
    diasCallado: 0,
  });
  // Escribió hace 0 días (= AHORA): dentro de la ventana de 24 h.
  assert.equal((await barrer(e)).emitidos, 1);
  await drenar(e);

  const { envios } = await enviar(e, { ahora: new Date(AHORA.getTime() + 3_600_000) });
  assert.equal(envios.textos.length, 1, "dentro de las 24 h, texto libre del agente");
  assert.equal(envios.plantillas.length, 0);
  assert.equal(envios.textos[0].to, "59891234567");

  // El mismo contacto dos días después, con la ventana cerrada: la
  // plantilla, con "Hola" a secas.
  await prisma.inquiryFollowUp.updateMany({
    where: { organizationId: e.organizationId, contactId: contacto.id },
    // Reclamable ya: el lease del primer reclamo la había corrido al futuro.
    data: { status: "PENDING", sentAt: null, nextAttemptAt: new Date(0) },
  });
  const segundo = await enviar(e, { ahora: new Date(AHORA.getTime() + 2 * DIA) });
  assert.equal(segundo.envios.plantillas.length, 1);
  assert.deepEqual(segundo.envios.plantillas[0].bodyParameters, [
    "Hola",
    "el vehículo que consultaste",
  ]);
});

test("marcado sin interés: el barrido no lo toma, y uno ya agendado se cancela", async () => {
  const e = await escenario("sin-interes");
  await reglaDeConsultas(e);
  const { contacto } = await consulta(e);
  await marcarSinInteres(e.organizationId, contacto.id, "ya compró en otro lado");

  assert.equal((await barrer(e)).emitidos, 0);

  // Y si ya estaba agendado cuando se marcó: cancelado por la marca.
  const otro = await consulta(e, { phone: "+59897000001" });
  assert.equal((await barrer(e)).emitidos, 1);
  await drenar(e);
  await marcarSinInteres(e.organizationId, otro.contacto.id, "no me escribas más");
  const fila = await prisma.inquiryFollowUp.findFirstOrThrow({
    where: { organizationId: e.organizationId, contactId: otro.contacto.id },
  });
  assert.equal(fila.status, "CANCELLED");
  const marcado = await prisma.contact.findUniqueOrThrow({ where: { id: otro.contacto.id } });
  assert.notEqual(marcado.noInterestAt, null);
  assert.equal(marcado.noInterestNote, "no me escribas más");
  const { envios } = await enviar(e);
  assert.equal(envios.plantillas.length + envios.textos.length, 0);
});

test("con una oportunidad abierta no se hace nada; cerrada, sí", async () => {
  const e = await escenario("con-oportunidad");
  await reglaDeConsultas(e);
  const { contacto } = await consulta(e);
  const opp = await createOpportunity(e.organizationId, e.userId, {
    title: "Hilux",
    pipelineId: e.pipelineId,
    stageId: e.stageId,
    companyId: e.companyId,
    contactId: contacto.id,
    amount: 1,
  });
  assert.equal((await barrer(e)).emitidos, 0);

  await prisma.opportunity.update({ where: { id: opp.id }, data: { status: "LOST" } });
  assert.equal((await barrer(e)).emitidos, 1);
});

test("tope de N: con maxFollowUps 2 sale el segundo recién X días después del primero, y nunca un tercero", async () => {
  const e = await escenario("tope");
  await reglaDeConsultas(e, { dias: 3, max: 2 });
  const { contacto } = await consulta(e, { diasCallado: 4 });

  assert.equal((await barrer(e)).emitidos, 1);
  await drenar(e);
  await enviar(e);
  await fecharFilas(e, AHORA);

  // Al día siguiente: hay un seguimiento de hace menos de 3 días, no sale otro.
  assert.equal((await barrer(e, new Date(AHORA.getTime() + DIA))).emitidos, 0);
  // Tres días después del primero: el segundo.
  assert.equal((await barrer(e, new Date(AHORA.getTime() + 3 * DIA))).emitidos, 1);
  await drenar(e);
  await enviar(e, { ahora: new Date(AHORA.getTime() + 3 * DIA) });
  await prisma.inquiryFollowUp.updateMany({
    where: { organizationId: e.organizationId, createdAt: { gt: AHORA } },
    data: { createdAt: new Date(AHORA.getTime() + 3 * DIA) },
  });
  const filas = await filasDe(e);
  assert.equal(filas.filter((f) => f.status === "SENT").length, 2);
  // Y nunca un tercero.
  assert.equal((await barrer(e, new Date(AHORA.getTime() + 10 * DIA))).emitidos, 0);

  // Si el cliente vuelve a escribir, la cuenta arranca de cero.
  const conv = await prisma.conversation.findFirstOrThrow({ where: { contactId: contacto.id } });
  const vuelve = new Date(AHORA.getTime() + 11 * DIA);
  await prisma.message.create({
    data: {
      organizationId: e.organizationId,
      conversationId: conv.id,
      direction: "INBOUND",
      senderType: "CONTACT",
      content: "Perdón, me colgué. ¿Sigue?",
      createdAt: vuelve,
    },
  });
  await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: vuelve } });
  assert.equal((await barrer(e, new Date(vuelve.getTime() + 4 * DIA))).emitidos, 1);
});

test("Messenger: una tarea para el vendedor asignado con el resumen, y la fila nace SENT", async () => {
  const e = await escenario("messenger");
  await reglaDeConsultas(e);
  const { contacto } = await consulta(e, { channel: "MESSENGER" });

  assert.equal((await barrer(e)).emitidos, 1);
  const entrega = await drenar(e);
  assert.equal(entrega.entregados, 1);

  const [fila] = await filasDe(e);
  assert.equal(fila.kind, "TASK");
  assert.equal(fila.status, "SENT");
  const [tarea] = await actividadesDe(e);
  assert.equal(tarea.type, "TASK");
  assert.equal(tarea.assigneeId, e.userId);
  assert.equal(tarea.contactId, contacto.id);
  assert.equal(tarea.subject, "Seguimiento de consulta: Martín Pérez");
  assert.match(tarea.body ?? "", /Consultó por Messenger y hace 4 días que no responde/);
  assert.match(tarea.body ?? "", /«Dale, cuánto sale\?»/);

  // No hay nada que mandar por WhatsApp.
  const { envios } = await enviar(e);
  assert.equal(envios.plantillas.length + envios.textos.length, 0);
});

test("WhatsApp atendido por una persona: tarea para esa persona en lugar del mensaje", async () => {
  const e = await escenario("atendida");
  await reglaDeConsultas(e);
  const { contacto, conversation, escribio } = await consulta(e, {
    status: "TRANSFERRED_TO_HUMAN",
  });
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { assignedUserId: e.userId },
  });
  // Un humano le escribió después del agente (y antes del último del cliente).
  await prisma.message.create({
    data: {
      organizationId: e.organizationId,
      conversationId: conversation.id,
      direction: "OUTBOUND",
      senderType: "HUMAN",
      senderUserId: e.userId,
      content: "Hola, soy Ana del equipo. Sale 35.000.",
      createdAt: new Date(escribio.getTime() - 10_000),
    },
  });

  assert.equal((await barrer(e)).emitidos, 1);
  await drenar(e);
  const [fila] = await filasDe(e);
  assert.equal(fila.kind, "TASK");
  const [tarea] = await actividadesDe(e);
  assert.equal(tarea.assigneeId, e.userId);
  assert.equal(tarea.contactId, contacto.id);
});

test("fuera del horario de la sucursal: espera a la próxima apertura sin gastar el intento", async () => {
  const e = await escenario("horario");
  await reglaDeConsultas(e);
  await consulta(e);
  assert.equal((await barrer(e)).emitidos, 1);
  await drenar(e);

  const abre = new Date(AHORA.getTime() + 16 * 3_600_000);
  const cerrada = await enviar(e, { cerradaHasta: abre });
  assert.equal(cerrada.resumen.fueraDeHorario, 1);
  assert.equal(cerrada.envios.plantillas.length, 0);
  let [fila] = await filasDe(e);
  assert.equal(fila.status, "PENDING");
  assert.equal(fila.attempts, 0, "el intento se devuelve");
  assert.equal(fila.nextAttemptAt.getTime(), abre.getTime());

  // Vencido el plazo (la fila ya está reclamable), abierta: sale.
  await prisma.inquiryFollowUp.update({ where: { id: fila.id }, data: { nextAttemptAt: AHORA } });
  const abierta = await enviar(e, { ahora: abre });
  assert.equal(abierta.resumen.enviados, 1);
  [fila] = await filasDe(e);
  assert.equal(fila.status, "SENT");
});

test("otra organización no se toca: su consulta estancada no entra en el barrido ni en el envío de esta", async () => {
  const e = await escenario("org-a");
  const otra = await escenario("org-b");
  await reglaDeConsultas(e);
  // La otra organización tiene una consulta igual de estancada, pero sin
  // regla: no emite nada, y el barrido de A no la ve.
  const { contacto: ajeno } = await consulta(otra, { phone: "+59896000002" });
  await consulta(e, { phone: "+59896000001" });

  assert.equal((await barrer(e)).emitidos, 1);
  assert.equal((await eventosDe(otra, TRIGGER_CONTACT_INQUIRY_STALLED)).length, 0);
  await drenar(e);
  assert.equal((await filasDe(otra)).length, 0);
  assert.equal((await filasDe(e)).length, 1);
  assert.equal((await filasDe(e))[0].contactId !== ajeno.id, true);

  const { envios } = await enviar(e);
  assert.equal(envios.plantillas.length, 1);
  assert.equal((await filasDe(otra)).length, 0);
  assert.equal((await actividadesDe(otra)).length, 0);
});

// ---------------------------------------------------------------------------
// D9 (docs/ediciones.md §4.5): el texto libre de la IA sale SOLO si el agente
// de la conversación responde solo (AUTONOMA, activo y no borrado). Con otro
// nivel, inactivo, o ESENCIAL sin que un ADMIN haya elegido el nivel, la
// plantilla aprobada aunque la ventana de 24 h esté abierta.
// ---------------------------------------------------------------------------

async function dentroDeLaVentana(
  etiqueta: string,
  agente: Record<string, unknown>,
  edition: "COMPLETA" | "ESENCIAL" = "COMPLETA",
) {
  const e = await escenario(etiqueta);
  if (edition !== "COMPLETA") {
    await prisma.organization.update({ where: { id: e.organizationId }, data: { edition } });
  }
  await prisma.agent.update({ where: { id: e.agentId }, data: agente });
  await reglaDeConsultas(e, { dias: 0 });
  await consulta(e, { diasCallado: 0 });
  assert.equal((await barrer(e)).emitidos, 1);
  await drenar(e);
  return (await enviar(e, { ahora: new Date(AHORA.getTime() + 3_600_000) })).envios;
}

test("D9: con un agente AUTONOMA (el de siempre), texto libre dentro de las 24 h", async () => {
  const envios = await dentroDeLaVentana("d9-autonoma", { participation: "AUTONOMA" });
  assert.equal(envios.textos.length, 1);
  assert.equal(envios.plantillas.length, 0);
});

test("D9: con PRIMER_CONTACTO o SOLO_SEGUIMIENTO, la plantilla aunque la ventana esté abierta", async () => {
  for (const participation of ["PRIMER_CONTACTO", "SOLO_SEGUIMIENTO"]) {
    const envios = await dentroDeLaVentana(`d9-${participation.toLowerCase()}`, { participation });
    assert.equal(envios.textos.length, 0, participation);
    assert.equal(envios.plantillas.length, 1, participation);
  }
});

test("D9: con el agente inactivo, la plantilla", async () => {
  const envios = await dentroDeLaVentana("d9-inactivo", { isActive: false });
  assert.equal(envios.textos.length, 0);
  assert.equal(envios.plantillas.length, 1);
});

test("D9: en ESENCIAL, un AUTONOMA que nadie eligió va con plantilla; elegido, con texto libre", async () => {
  const sinElegir = await dentroDeLaVentana(
    "d9-esencial-sin-elegir",
    { participation: "AUTONOMA", participationChosenAt: null },
    "ESENCIAL",
  );
  assert.equal(sinElegir.textos.length, 0);
  assert.equal(sinElegir.plantillas.length, 1);

  const elegido = await dentroDeLaVentana(
    "d9-esencial-elegido",
    { participation: "AUTONOMA", participationChosenAt: AHORA },
    "ESENCIAL",
  );
  assert.equal(elegido.textos.length, 1);
  assert.equal(elegido.plantillas.length, 0);
});
