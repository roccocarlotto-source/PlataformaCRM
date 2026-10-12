import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { OrganizationIndustry, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getCifrador } from "../utils/encryption";
import {
  MARCADOR_DE_DATO_BORRADO,
  MOTIVO_SEGUIMIENTO_CANCELADO_POR_BORRADO,
} from "../repositories/contact.repository";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { createBranch } from "./branch.service";
import { erasePersonalData } from "./contact.service";
import type { ClienteGoogleCalendar, EventoARenombrar } from "./googleCalendar.service";
import {
  MOTIVO_GOOGLE_RECHAZO,
  MOTIVO_SIN_CONEXION_DE_GOOGLE,
} from "./googleCalendarConnection.service";

// ---------------------------------------------------------------------------
// Borrado COMPLETO a pedido del titular (data-classification.md §5.2,
// 2026-10-12), contra Postgres, en los dos rubros: lo que el contacto dejó
// fuera de su fila (mensajes, conversaciones, cola del webhook, tareas,
// identidades de canal, seguimientos), quién y cuándo, y el nombre en los
// eventos de Google Calendar de sus turnos — con un doble de Google: ninguna
// llamada real. Los turnos quedan.
//
// Se lee de vuelta de la base, nunca de la respuesta, y al final se busca el
// nombre, el email y el teléfono en TODAS las filas tocadas: no puede quedar
// ninguno.
// ---------------------------------------------------------------------------

const NOMBRE = "Anabela";
const APELLIDO = "Ejemplar";
const TELEFONO = "+59899000111";

interface Escenario {
  org: OrgDePrueba;
  adminId: string;
  branchId: string;
  contactId: string;
  email: string;
  bookingId: string;
  conversationId: string;
}

const orgs: OrgDePrueba[] = [];
let clinica: Escenario;
let automotora: Escenario;
let otra: Escenario;

function dobleDeGoogle(opciones: { renombrarFalla?: boolean } = {}) {
  const renombrados: EventoARenombrar[] = [];
  const cliente: ClienteGoogleCalendar = {
    construirUrlDeAutorizacion: () => "https://accounts.google.com/fake",
    intercambiarCodigo: () =>
      Promise.resolve({
        refreshToken: "1//r",
        accessToken: "a",
        expiraEnSegundos: 3599,
        scope: "",
      }),
    renovarAccessToken: () =>
      Promise.resolve({ accessToken: "a", expiraEnSegundos: 3599, scope: "" }),
    revocarToken: () => Promise.resolve(),
    consultarFreeBusy: () => Promise.resolve([]),
    crearEvento: () => Promise.resolve("evt-nuevo"),
    eliminarEvento: () => Promise.resolve(),
    renombrarEvento: (e) => {
      if (opciones.renombrarFalla) return Promise.reject(new Error("Google caído"));
      renombrados.push(e);
      return Promise.resolve();
    },
    crearCanalDeNotificaciones: (c) =>
      Promise.resolve({
        channelId: c.channelId,
        resourceId: "res",
        expiration: new Date(Date.now() + 86400000),
      }),
    detenerCanal: () => Promise.resolve(),
    listarCambios: () => Promise.resolve({ eventos: [], nextSyncToken: "t" }),
  };
  return { cliente, renombrados };
}

async function montar(
  industry: OrganizationIndustry,
  opciones: { conGoogle: boolean },
): Promise<Escenario> {
  const org = await crearOrgDePrueba("borrado-completo", "COMPLETA", industry, 1);
  orgs.push(org);
  const organizationId = org.id;
  const adminId = org.authIds[0];
  const branch = await createBranch(
    organizationId,
    { name: "Sede Centro", timezone: "America/Montevideo" },
    industry,
  );
  const email = `anabela-${randomUUID().slice(0, 8)}@example.test`;
  const contact = await prisma.contact.create({
    data: {
      organizationId,
      firstName: NOMBRE,
      lastName: APELLIDO,
      email,
      phone: TELEFONO,
      jobTitle: "Gerenta",
      leadScore: 70,
      leadIntent: `${NOMBRE} quiere un turno`,
      leadServiceOfInterest: "Limpieza facial",
      leadUrgency: "HIGH",
      leadBudgetAmount: 100,
      leadBudgetCurrency: "USD",
      leadLocation: "Barrio Centro",
      leadNotes: `Habló ${NOMBRE} ${APELLIDO}`,
      leadAiData: { dijo: `Soy ${NOMBRE}` } as Prisma.InputJsonValue,
      customFields: { apodo: NOMBRE } as Prisma.InputJsonValue,
      noInterestNote: `${NOMBRE} no quiere`,
    },
  });
  const agent = await prisma.agent.create({
    data: {
      organizationId,
      branchId: branch.id,
      name: "Asistente",
      instructions: "Sos el asistente.",
      modelProvider: "openrouter",
      modelName: "doble/modelo",
      enabledTools: [],
      channels: ["WHATSAPP"],
      guardrails: {} as Prisma.InputJsonValue,
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      organizationId,
      branchId: branch.id,
      agentId: agent.id,
      contactId: contact.id,
      channel: "WHATSAPP",
      externalThreadId: TELEFONO.slice(1),
      brief: `${NOMBRE} pidió un turno`,
    },
  });
  const entrante = await prisma.message.create({
    data: {
      organizationId,
      conversationId: conversation.id,
      direction: "INBOUND",
      senderType: "CONTACT",
      content: `Hola, soy ${NOMBRE} ${APELLIDO}, mi mail es ${email}`,
      externalMessageId: `wamid.${randomUUID()}`,
    },
  });
  const respuesta = await prisma.message.create({
    data: {
      organizationId,
      conversationId: conversation.id,
      direction: "OUTBOUND",
      senderType: "AGENT",
      content: `Hola ${NOMBRE}, te ayudo`,
      toolCalls: [
        { name: "update_lead", arguments: { firstName: NOMBRE } },
      ] as Prisma.InputJsonValue,
      deliveryError: `No se pudo mandar a ${TELEFONO}`,
    },
  });
  await prisma.agentInboundJob.create({
    data: {
      organizationId,
      messageId: entrante.id,
      channelAccountId: "100000000000001",
      externalUserId: TELEFONO.slice(1),
      status: "DONE",
      responseMessageId: respuesta.id,
      lastError: `Error con ${TELEFONO}`,
    },
  });
  await prisma.activity.create({
    data: {
      organizationId,
      authorId: adminId,
      type: "TASK",
      contactId: contact.id,
      subject: `Llamar a ${NOMBRE} ${APELLIDO}`,
      body: `Su teléfono es ${TELEFONO}`,
    },
  });
  await prisma.contactChannelIdentity.createMany({
    data: [
      {
        organizationId,
        channel: "INSTAGRAM",
        externalId: `ig-${randomUUID()}`,
        contactId: contact.id,
      },
      {
        organizationId,
        channel: "MESSENGER",
        externalId: `fb-${randomUUID()}`,
        contactId: contact.id,
      },
      { organizationId, channel: "WHATSAPP", externalId: TELEFONO.slice(1), contactId: contact.id },
    ],
  });
  const automation = await prisma.automation.create({
    data: {
      organizationId,
      name: "Seguimiento",
      triggerType: "conversation.inquiry_stalled",
      actionType: "inquiry.follow_up",
      actionConfig: {} as Prisma.InputJsonValue,
    },
  });
  const outbox = await prisma.outboxEvent.create({
    data: { organizationId, eventType: "conversation.inquiry_stalled", payload: {} },
  });
  const ahora = new Date();
  await prisma.inquiryFollowUp.create({
    data: {
      organizationId,
      automationId: automation.id,
      contactId: contact.id,
      conversationId: conversation.id,
      branchId: branch.id,
      channel: "WHATSAPP",
      outboxEventId: outbox.id,
      kind: "WHATSAPP",
      lastInboundAt: ahora,
      scheduledFor: new Date(ahora.getTime() + 3600_000),
      nextAttemptAt: new Date(ahora.getTime() + 3600_000),
    },
  });
  const resource = await prisma.resource.create({
    data: { organizationId, branchId: branch.id, name: "Profesional", type: "PERSON" },
  });
  const serviceType = await prisma.serviceType.create({
    data: {
      organizationId,
      branchId: branch.id,
      resourceId: resource.id,
      name: "Limpieza facial",
      durationMin: 60,
    },
  });
  const inicio = new Date(ahora.getTime() + 3 * 86400_000);
  const booking = await prisma.booking.create({
    data: {
      organizationId,
      branchId: branch.id,
      serviceTypeId: serviceType.id,
      resourceId: resource.id,
      contactId: contact.id,
      startsAt: inicio,
      endsAt: new Date(inicio.getTime() + 3600_000),
      googleEventId: `evt-${randomUUID().slice(0, 8)}`,
    },
  });
  if (opciones.conGoogle) {
    await prisma.googleCalendarConnection.create({
      data: {
        organizationId,
        branchId: branch.id,
        refreshToken: getCifrador().encrypt("1//refresh"),
        calendarId: "primary",
        status: "ACTIVE",
      },
    });
  }
  return {
    org,
    adminId,
    branchId: branch.id,
    contactId: contact.id,
    email,
    bookingId: booking.id,
    conversationId: conversation.id,
  };
}

before(async () => {
  clinica = await montar("CLINICA", { conGoogle: true });
  automotora = await montar("AUTOMOTORA", { conGoogle: true });
  otra = await montar("AUTOMOTORA", { conGoogle: false });
});

after(async () => {
  for (const org of orgs) {
    const where = { organizationId: org.id };
    await prisma.booking.deleteMany({ where });
    await prisma.serviceType.deleteMany({ where });
    await prisma.resource.deleteMany({ where });
    await prisma.googleCalendarConnection.deleteMany({ where });
    await prisma.inquiryFollowUp.deleteMany({ where });
    await prisma.outboxEvent.deleteMany({ where });
    await prisma.automation.deleteMany({ where });
    await prisma.agentInboundJob.deleteMany({ where });
    await prisma.message.deleteMany({ where });
    await prisma.conversation.deleteMany({ where });
    await prisma.contactChannelIdentity.deleteMany({ where });
    await prisma.agent.deleteMany({ where });
    await prisma.clinicSettings.deleteMany({ where });
    await borrarOrgDePrueba(org);
  }
});

/** Todo lo de la organización que el borrado toca, como texto: ahí no puede
 *  quedar ni el nombre, ni el apellido, ni el email, ni el teléfono. */
async function todoLoDeLaOrganizacion(e: Escenario): Promise<string> {
  const where = { organizationId: e.org.id };
  const filas = await Promise.all([
    prisma.contact.findMany({ where }),
    prisma.message.findMany({ where }),
    prisma.conversation.findMany({ where }),
    prisma.agentInboundJob.findMany({ where }),
    prisma.activity.findMany({ where }),
    prisma.contactChannelIdentity.findMany({ where }),
    prisma.inquiryFollowUp.findMany({ where }),
  ]);
  return JSON.stringify(filas);
}

function assertSinRastro(texto: string, e: Escenario) {
  for (const dato of [NOMBRE, APELLIDO, e.email, TELEFONO, TELEFONO.slice(1)]) {
    assert.ok(!texto.includes(dato), `quedó "${dato}" en la base`);
  }
}

async function verificarBorradoCompleto(e: Escenario, renombrados: EventoARenombrar[]) {
  const contacto = await prisma.contact.findUniqueOrThrow({ where: { id: e.contactId } });
  assert.equal(contacto.firstName, MARCADOR_DE_DATO_BORRADO);
  assert.equal(contacto.lastName, MARCADOR_DE_DATO_BORRADO);
  for (const campo of [
    "email",
    "phone",
    "jobTitle",
    "leadScore",
    "leadIntent",
    "leadServiceOfInterest",
    "leadUrgency",
    "leadBudgetAmount",
    "leadBudgetCurrency",
    "leadLocation",
    "leadNotes",
    "leadAiData",
    "customFields",
    "noInterestNote",
    "vehicleOfInterestId",
    "vehicleOfInterestSetBy",
  ] as const) {
    assert.equal(contacto[campo], null, `${campo} quedó con datos`);
  }
  assert.ok(contacto.personalDataErasedAt, "quedó cuándo");
  assert.equal(contacto.personalDataErasedById, e.adminId, "quedó quién");
  assert.equal(contacto.personalDataErasePending, null, "nada pendiente");

  const mensajes = await prisma.message.findMany({ where: { conversationId: e.conversationId } });
  assert.equal(mensajes.length, 2);
  for (const m of mensajes) {
    assert.equal(m.content, MARCADOR_DE_DATO_BORRADO);
    assert.equal(m.toolCalls, null);
    assert.equal(m.deliveryError, null);
    assert.equal(m.externalMessageId, null);
  }
  const conversacion = await prisma.conversation.findUniqueOrThrow({
    where: { id: e.conversationId },
  });
  assert.equal(conversacion.brief, null);
  assert.equal(conversacion.externalThreadId, null);
  assert.equal(conversacion.status, "CLOSED");

  const [trabajo] = await prisma.agentInboundJob.findMany({ where: { organizationId: e.org.id } });
  assert.equal(trabajo.externalUserId, MARCADOR_DE_DATO_BORRADO);
  assert.equal(trabajo.lastError, null);

  const [tarea] = await prisma.activity.findMany({ where: { contactId: e.contactId } });
  assert.equal(tarea.subject, MARCADOR_DE_DATO_BORRADO);
  assert.equal(tarea.body, null);

  assert.equal(
    await prisma.contactChannelIdentity.count({ where: { contactId: e.contactId } }),
    0,
    "las identidades de todos los canales",
  );
  const [seguimiento] = await prisma.inquiryFollowUp.findMany({
    where: { contactId: e.contactId },
  });
  assert.equal(seguimiento.status, "CANCELLED");
  assert.equal(seguimiento.lastError, MOTIVO_SEGUIMIENTO_CANCELADO_POR_BORRADO);

  // El turno queda, como registro.
  const turno = await prisma.booking.findUniqueOrThrow({ where: { id: e.bookingId } });
  assert.equal(turno.contactId, e.contactId);
  assert.equal(turno.status, "CONFIRMED");

  // Google: el título del evento, sin el nombre.
  assert.equal(renombrados.length, 1);
  assert.equal(renombrados[0].eventId, turno.googleEventId);
  assert.equal(renombrados[0].titulo, `Limpieza facial — ${MARCADOR_DE_DATO_BORRADO}`);

  assertSinRastro(await todoLoDeLaOrganizacion(e), e);
}

test("clínica: borra todo el rastro del paciente, deja el turno y saca su nombre del evento de Google", async () => {
  const google = dobleDeGoogle();
  const r = await erasePersonalData(
    clinica.org.id,
    clinica.contactId,
    clinica.adminId,
    google.cliente,
  );
  assert.equal(r.mensajesBorrados, 2);
  assert.equal(r.conversacionesCerradas, 1);
  assert.equal(r.trabajosDeEntradaAnonimizados, 1);
  assert.equal(r.actividadesBorradas, 1);
  assert.equal(r.identidadesBorradas, 3);
  assert.equal(r.seguimientosCancelados, 1);
  assert.equal(r.eventosDeGoogleLimpiados, 1);
  assert.deepEqual(r.pendientes, []);
  await verificarBorradoCompleto(clinica, google.renombrados);
});

test("automotora: el mismo borrado completo", async () => {
  const google = dobleDeGoogle();
  const r = await erasePersonalData(
    automotora.org.id,
    automotora.contactId,
    automotora.adminId,
    google.cliente,
  );
  assert.equal(r.eventosDeGoogleLimpiados, 1);
  assert.deepEqual(r.pendientes, []);
  await verificarBorradoCompleto(automotora, google.renombrados);
});

test("aislamiento: los borrados de las otras organizaciones no tocaron nada de esta", async () => {
  const contacto = await prisma.contact.findUniqueOrThrow({ where: { id: otra.contactId } });
  assert.equal(contacto.firstName, NOMBRE);
  assert.equal(contacto.leadNotes, `Habló ${NOMBRE} ${APELLIDO}`);
  assert.equal(contacto.personalDataErasedAt, null);
  const conversacion = await prisma.conversation.findUniqueOrThrow({
    where: { id: otra.conversationId },
  });
  assert.equal(conversacion.status, "ACTIVE");
  assert.ok(conversacion.brief);
  assert.equal(
    await prisma.contactChannelIdentity.count({ where: { contactId: otra.contactId } }),
    3,
  );
});

test("sin Google conectado en la sede: el borrado se hace igual y el evento queda pendiente, en la respuesta y en el contacto", async () => {
  const google = dobleDeGoogle();
  const r = await erasePersonalData(otra.org.id, otra.contactId, otra.adminId, google.cliente);
  assert.deepEqual(r.pendientes, [
    { bookingId: otra.bookingId, motivo: MOTIVO_SIN_CONEXION_DE_GOOGLE },
  ]);
  assert.equal(r.eventosDeGoogleLimpiados, 0);
  assert.equal(google.renombrados.length, 0);
  const contacto = await prisma.contact.findUniqueOrThrow({ where: { id: otra.contactId } });
  assert.equal(contacto.firstName, MARCADOR_DE_DATO_BORRADO, "el borrado no esperó a Google");
  assert.deepEqual(contacto.personalDataErasePending, [
    { bookingId: otra.bookingId, motivo: MOTIVO_SIN_CONEXION_DE_GOOGLE },
  ]);
  assertSinRastro(await todoLoDeLaOrganizacion(otra), otra);
});

test("si Google falla: no frena el borrado y queda pendiente; repetirlo con Google sano lo limpia", async () => {
  const e = await montar("CLINICA", { conGoogle: true });
  const caido = dobleDeGoogle({ renombrarFalla: true });
  const r = await erasePersonalData(e.org.id, e.contactId, e.adminId, caido.cliente);
  assert.deepEqual(r.pendientes, [{ bookingId: e.bookingId, motivo: MOTIVO_GOOGLE_RECHAZO }]);
  const contacto = await prisma.contact.findUniqueOrThrow({ where: { id: e.contactId } });
  assert.equal(contacto.firstName, MARCADOR_DE_DATO_BORRADO);
  assert.deepEqual(contacto.personalDataErasePending, [
    { bookingId: e.bookingId, motivo: MOTIVO_GOOGLE_RECHAZO },
  ]);

  // Idempotente: repetirlo con Google sano limpia el evento y lo pendiente.
  const sano = dobleDeGoogle();
  const otraVez = await erasePersonalData(e.org.id, e.contactId, e.adminId, sano.cliente);
  assert.deepEqual(otraVez.pendientes, []);
  assert.equal(sano.renombrados.length, 1);
  const despues = await prisma.contact.findUniqueOrThrow({ where: { id: e.contactId } });
  assert.equal(despues.personalDataErasePending, null);
});
