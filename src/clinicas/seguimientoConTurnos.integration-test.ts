import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { BookingStatus, OrganizationIndustry } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { createAutomation, updateAutomation } from "../services/automation.service";
import { crearRegistroDeAcciones, type RegistroDeAcciones } from "../services/automationActions";
import {
  ACTION_INQUIRY_FOLLOW_UP,
  TEXTO_POR_DEFECTO,
} from "../services/automationActions/inquiryFollowUp";
import { registrarAutomatizaciones } from "../services/automationRegistrations";
import { TRIGGER_CONTACT_INQUIRY_STALLED } from "../services/automationTriggers";
import { crearRegla, desmontar, montar, type Escenario } from "../services/automation.test-helper";
import { crearRegistroDeHandlers, type RegistroDeHandlers } from "../services/outboxHandlers";
import {
  depsDelSeguimientoDeConsultaReales,
  procesarSeguimientoDeConsulta,
  type DepsDelSeguimientoDeConsulta,
} from "../workers/inquiryFollowUpWorker";
import { barrerConsultasSinAvance } from "../workers/inquiryStalledWorker";
import { drenarOutbox } from "../workers/outboxWorker";
import { claimNextInquiryFollowUp } from "../repositories/inquiryFollowUp.repository";
import {
  MOTIVO_TURNO_DEL_PACIENTE,
  TEXTO_POR_DEFECTO_DE_CLINICA,
  tieneTurnoQueFrena,
} from "./seguimientoDeConsultas";

// ---------------------------------------------------------------------------
// R15 (docs/rubros.md §9.1): el seguimiento de consultas en una clínica,
// contra Postgres. El barrido, la acción y el worker no le escriben a un
// contacto con un turno CONFIRMED futuro ni a uno atendido en los últimos
// `daysSinceLastMessage` días; el texto lleva {prestacion}; y siempre sale la
// plantilla (D7). Y lo mismo en una automotora: todo como antes.
//
// Sin modelo ni Meta: el envío está doblado y el texto libre falla si se pide.
// ---------------------------------------------------------------------------

const DIA = 24 * 60 * 60 * 1000;
const HORA = 60 * 60 * 1000;
// Pegado al reloj real (ver automationInquiryStalled.integration-test.ts).
const AHORA = new Date(Math.floor(Date.now() / HORA) * HORA);
const DIAS = 3;

let acciones: RegistroDeAcciones;
let handlers: RegistroDeHandlers;
const escenarios: Montado[] = [];

before(() => {
  acciones = crearRegistroDeAcciones();
  handlers = crearRegistroDeHandlers();
  registrarAutomatizaciones({ acciones, handlers });
});

after(async () => {
  for (const e of escenarios) {
    const where = { organizationId: e.organizationId };
    await prisma.booking.deleteMany({ where });
    await prisma.serviceType.deleteMany({ where });
    await prisma.resource.deleteMany({ where });
  }
  await desmontar(...escenarios);
});

interface Montado extends Escenario {
  branchId: string;
  agentId: string;
  resourceId: string;
  serviceTypeId: string;
  automationId: string;
}

async function escenario(etiqueta: string, industry: OrganizationIndustry): Promise<Montado> {
  const e = await montar(etiqueta);
  await prisma.organization.update({ where: { id: e.organizationId }, data: { industry } });
  const branch = await prisma.branch.create({
    data: { organizationId: e.organizationId, name: "Centro", timezone: "America/Montevideo" },
  });
  const agent = await prisma.agent.create({
    data: {
      organizationId: e.organizationId,
      branchId: branch.id,
      name: "Asistente",
      instructions: "Atendé consultas.",
      modelProvider: "openrouter",
      modelName: "test/model",
      enabledTools: [],
      guardrails: {},
      channels: ["WHATSAPP"],
      participation: "AUTONOMA",
      participationChosenAt: new Date(),
      whatsappPhoneNumberId: `pn-${randomUUID().slice(0, 12)}`,
    },
  });
  const resource = await prisma.resource.create({
    data: { organizationId: e.organizationId, branchId: branch.id, name: "Ana", type: "PERSON" },
  });
  const serviceType = await prisma.serviceType.create({
    data: {
      organizationId: e.organizationId,
      branchId: branch.id,
      resourceId: resource.id,
      name: "Consulta",
      durationMin: 60,
    },
  });
  const texto = industry === "CLINICA" ? TEXTO_POR_DEFECTO_DE_CLINICA : TEXTO_POR_DEFECTO;
  const regla = await crearRegla(e, {
    name: "Seguimiento de consultas",
    triggerType: TRIGGER_CONTACT_INQUIRY_STALLED,
    triggerConfig: { daysSinceLastMessage: DIAS, maxFollowUps: 1 },
    actionType: ACTION_INQUIRY_FOLLOW_UP,
    actionConfig: { messageText: texto },
  });
  await prisma.whatsappTemplate.create({
    data: {
      organizationId: e.organizationId,
      automationId: regla.id,
      name: `seguimiento_consulta_${randomUUID().slice(0, 8)}`,
      language: "es_AR",
      bodyText: texto,
      metaTemplateId: randomUUID().slice(0, 16),
      status: "APPROVED",
    },
  });
  const montado = {
    ...e,
    branchId: branch.id,
    agentId: agent.id,
    resourceId: resource.id,
    serviceTypeId: serviceType.id,
    automationId: regla.id,
  };
  escenarios.push(montado);
  return montado;
}

// Un contacto que escribió por WhatsApp hace `diasCallado` días, con su
// prestación de interés.
async function consulta(e: Montado, nombre: string, diasCallado = 4) {
  const contacto = await prisma.contact.create({
    data: {
      organizationId: e.organizationId,
      firstName: nombre,
      lastName: "Ejemplo",
      phone: `+5989${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`,
      ownerId: e.userId,
      source: "WhatsApp",
      leadServiceOfInterest: "Limpieza facial",
    },
  });
  const escribio = new Date(AHORA.getTime() - diasCallado * DIA);
  const conversation = await prisma.conversation.create({
    data: {
      organizationId: e.organizationId,
      branchId: e.branchId,
      agentId: e.agentId,
      contactId: contacto.id,
      channel: "WHATSAPP",
      externalThreadId: (contacto.phone ?? "").replace(/\D/g, ""),
      lastMessageAt: escribio,
    },
  });
  await prisma.message.create({
    data: {
      organizationId: e.organizationId,
      conversationId: conversation.id,
      direction: "INBOUND",
      senderType: "CONTACT",
      content: "¿Cuánto sale la limpieza facial?",
      createdAt: escribio,
    },
  });
  return contacto;
}

function turno(e: Montado, contactId: string, inicio: Date, status: BookingStatus) {
  return prisma.booking.create({
    data: {
      organizationId: e.organizationId,
      branchId: e.branchId,
      serviceTypeId: e.serviceTypeId,
      resourceId: e.resourceId,
      contactId,
      startsAt: inicio,
      endsAt: new Date(inicio.getTime() + HORA),
      status,
      ...(status === "COMPLETED" || status === "NO_SHOW"
        ? { completedAt: new Date(inicio.getTime() + HORA), completedBy: "PERSONA" as const }
        : {}),
    },
  });
}

async function emitidosA(e: Montado): Promise<string[]> {
  const eventos = await prisma.outboxEvent.findMany({
    where: { organizationId: e.organizationId, eventType: TRIGGER_CONTACT_INQUIRY_STALLED },
  });
  return eventos.map((ev) => (ev.payload as { contactId: string }).contactId);
}

// ---------------------------------------------------------------------------
// El barrido
// ---------------------------------------------------------------------------

test("barrido en una clínica: sin turno futuro ni atendido reciente se le escribe; con uno, no", async () => {
  const e = await escenario("r15-barrido", "CLINICA");
  const sinTurno = await consulta(e, "Sinturno");
  const conFuturo = await consulta(e, "Confuturo");
  await turno(e, conFuturo.id, new Date(AHORA.getTime() + 2 * DIA), "CONFIRMED");
  const atendidoReciente = await consulta(e, "Atendido");
  await turno(e, atendidoReciente.id, new Date(AHORA.getTime() - 2 * DIA), "COMPLETED");
  const atendidoViejo = await consulta(e, "Atendidoviejo");
  await turno(e, atendidoViejo.id, new Date(AHORA.getTime() - 10 * DIA), "COMPLETED");
  const noVino = await consulta(e, "Novino");
  await turno(e, noVino.id, new Date(AHORA.getTime() - 2 * DIA), "NO_SHOW");
  const cancelado = await consulta(e, "Cancelado");
  await turno(e, cancelado.id, new Date(AHORA.getTime() + 2 * DIA), "CANCELLED");

  await barrerConsultasSinAvance({ organizationId: e.organizationId, ahora: AHORA });
  const emitidos = await emitidosA(e);
  assert.deepEqual(
    new Set(emitidos),
    new Set([sinTurno.id, atendidoViejo.id, noVino.id, cancelado.id]),
  );
});

test("tieneTurnoQueFrena: CONFIRMED futuro y atendido dentro de los días, nada más", async () => {
  const e = await escenario("r15-frena", "CLINICA");
  const c = await consulta(e, "Frena");
  assert.equal(await tieneTurnoQueFrena(e.organizationId, c.id, DIAS, AHORA), false);
  const pasado = await turno(e, c.id, new Date(AHORA.getTime() - DIA), "CONFIRMED");
  assert.equal(await tieneTurnoQueFrena(e.organizationId, c.id, DIAS, AHORA), false);
  await prisma.booking.update({
    where: { id: pasado.id },
    data: { status: "COMPLETED", completedAt: AHORA, completedBy: "AUTO" },
  });
  assert.equal(await tieneTurnoQueFrena(e.organizationId, c.id, DIAS, AHORA), true);
  assert.equal(await tieneTurnoQueFrena(e.organizationId, c.id, 0, AHORA), false);
});

// ---------------------------------------------------------------------------
// La acción y el worker
// ---------------------------------------------------------------------------

function depsDeEnvio(textoLibre: string[], plantillas: string[][]): DepsDelSeguimientoDeConsulta {
  return {
    ...depsDelSeguimientoDeConsultaReales,
    accessToken: () => "token-de-prueba",
    numeroDeLaSucursal: async () => "pn-prueba",
    proximaApertura: async (_o, _b, ahora) => ahora,
    sendTemplate: async (envio) => {
      plantillas.push(envio.bodyParameters);
      return { wamid: `wamid.${randomUUID()}` };
    },
    sendText: async (envio) => {
      textoLibre.push(envio.body);
      return { wamid: `wamid.${randomUUID()}` };
    },
    generarTexto: async () => "texto libre de la IA",
    // La ventana abierta y el agente en AUTONOMA: en una automotora saldría
    // texto libre; en una clínica, la plantilla igual (D7).
    agenteRespondeSolo: async () => true,
    ahora: () => AHORA,
  };
}

async function agendarUno(e: Montado, contactId: string, horasCallado: number) {
  const conversation = await prisma.conversation.findFirstOrThrow({
    where: { organizationId: e.organizationId, contactId },
  });
  return prisma.inquiryFollowUp.create({
    data: {
      organizationId: e.organizationId,
      automationId: e.automationId,
      contactId,
      conversationId: conversation.id,
      branchId: e.branchId,
      channel: "WHATSAPP",
      outboxEventId: randomUUID(),
      kind: "WHATSAPP",
      lastInboundAt: new Date(Date.now() - horasCallado * HORA),
      scheduledFor: new Date(Date.now() - 60_000),
      nextAttemptAt: new Date(Date.now() - 60_000),
    },
  });
}

async function procesar(e: Montado, deps: DepsDelSeguimientoDeConsulta) {
  const reclamo = await claimNextInquiryFollowUp(60_000, { organizationId: e.organizationId });
  assert.ok(reclamo, "hay un seguimiento para reclamar");
  return procesarSeguimientoDeConsulta(reclamo, { accessToken: "token-de-prueba" }, deps);
}

test("worker en una clínica: siempre la plantilla con {prestacion}, aunque la ventana esté abierta y el agente sea AUTONOMA", async () => {
  const e = await escenario("r15-plantilla", "CLINICA");
  const c = await consulta(e, "Plantilla");
  await agendarUno(e, c.id, 2);
  const textoLibre: string[] = [];
  const plantillas: string[][] = [];
  const r = await procesar(e, depsDeEnvio(textoLibre, plantillas));
  assert.equal(r.resultado, "ENVIADO");
  assert.deepEqual(textoLibre, []);
  assert.deepEqual(plantillas, [["Hola Plantilla", "Limpieza facial"]]);
});

test("worker en una clínica: un turno agendado después del barrido cancela el envío", async () => {
  const e = await escenario("r15-cancela", "CLINICA");
  const c = await consulta(e, "Cancela");
  await agendarUno(e, c.id, 30);
  await turno(e, c.id, new Date(AHORA.getTime() + DIA), "CONFIRMED");
  const plantillas: string[][] = [];
  const r = await procesar(e, depsDeEnvio([], plantillas));
  assert.deepEqual(r, { resultado: "CANCELADO", motivo: MOTIVO_TURNO_DEL_PACIENTE });
  assert.deepEqual(plantillas, []);
});

test("acción en una clínica: con un turno futuro no agenda nada", async () => {
  const e = await escenario("r15-accion", "CLINICA");
  const c = await consulta(e, "Accion");
  await turno(e, c.id, new Date(AHORA.getTime() + DIA), "CONFIRMED");
  // El evento como lo emite el barrido (que ya no lo emitiría: acá se fuerza
  // para probar la segunda barrera, la acción).
  const conversation = await prisma.conversation.findFirstOrThrow({
    where: { organizationId: e.organizationId, contactId: c.id },
  });
  await prisma.outboxEvent.create({
    data: {
      organizationId: e.organizationId,
      eventType: TRIGGER_CONTACT_INQUIRY_STALLED,
      payload: {
        contactId: c.id,
        conversationId: conversation.id,
        channel: "WHATSAPP",
        branchId: e.branchId,
        ownerId: e.userId,
        lastInboundAt: new Date(AHORA.getTime() - 4 * DIA).toISOString(),
      },
    },
  });
  await drenarOutbox({ organizationId: e.organizationId, registro: handlers });
  assert.equal(
    await prisma.inquiryFollowUp.count({ where: { organizationId: e.organizationId } }),
    0,
  );
  // La acción corrió y terminó sin efecto (no falló).
  const [ejecucion] = await prisma.automationExecution.findMany({
    where: { organizationId: e.organizationId, automationId: e.automationId },
  });
  assert.equal(ejecucion?.status, "SUCCESS", ejecucion?.error ?? "sin ejecución");
});

// ---------------------------------------------------------------------------
// Texto y variables
// ---------------------------------------------------------------------------

test("el texto de una clínica acepta {prestacion} y no {vehiculo}; el de una automotora, al revés", async () => {
  const clinica = await escenario("r15-texto-c", "CLINICA");
  const automotora = await escenario("r15-texto-a", "AUTOMOTORA");
  const opciones = { registro: acciones };
  const regla = (texto: string) => ({
    name: "Otra regla",
    triggerType: TRIGGER_CONTACT_INQUIRY_STALLED,
    triggerConfig: { daysSinceLastMessage: DIAS, maxFollowUps: 1 },
    actionType: ACTION_INQUIRY_FOLLOW_UP,
    actionConfig: { messageText: texto },
    // Inactiva: ya hay una activa (regla única).
    isActive: false,
  });
  const conPrestacion = await createAutomation(
    clinica.organizationId,
    regla(TEXTO_POR_DEFECTO_DE_CLINICA),
    opciones,
  );
  assert.ok(conPrestacion.id);
  await assert.rejects(
    createAutomation(clinica.organizationId, regla(TEXTO_POR_DEFECTO), opciones),
    /no es una variable válida/,
  );
  await assert.rejects(
    createAutomation(automotora.organizationId, regla(TEXTO_POR_DEFECTO_DE_CLINICA), opciones),
    /no es una variable válida/,
  );
  // Editar en una clínica también valida con su schema.
  const editada = await updateAutomation(
    clinica.organizationId,
    conPrestacion.id,
    { actionConfig: { messageText: "¡{saludo}! ¿Te ayudamos con {prestacion}? Escribinos." } },
    opciones,
  );
  assert.match(JSON.stringify(editada.actionConfig), /\{prestacion\}/);
});

// ---------------------------------------------------------------------------
// Automotora sin cambios (también en la suite automotoraSinCambios)
// ---------------------------------------------------------------------------

test("automotora: con un test drive agendado, el seguimiento sale igual que antes, y por texto libre en la ventana", async () => {
  const e = await escenario("r15-automotora", "AUTOMOTORA");
  const c = await consulta(e, "Automotora");
  await turno(e, c.id, new Date(AHORA.getTime() + DIA), "CONFIRMED");
  await barrerConsultasSinAvance({ organizationId: e.organizationId, ahora: AHORA });
  assert.deepEqual(await emitidosA(e), [c.id]);

  await prisma.outboxEvent.deleteMany({ where: { organizationId: e.organizationId } });
  const otro = await consulta(e, "Ventana");
  await turno(e, otro.id, new Date(AHORA.getTime() + DIA), "CONFIRMED");
  await agendarUno(e, otro.id, 2);
  const textoLibre: string[] = [];
  const r = await procesar(e, depsDeEnvio(textoLibre, []));
  assert.equal(r.resultado, "ENVIADO");
  assert.deepEqual(textoLibre, ["texto libre de la IA"]);
});
