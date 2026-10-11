import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import type { BookingMessageKind, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { findRoleByName } from "../repositories/role.repository";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { crearRegistroDeAcciones } from "../services/automationActions";
import { registrarAutomatizaciones } from "../services/automationRegistrations";
import { createBranch } from "../services/branch.service";
import { crearRegistroDeHandlers, type RegistroDeHandlers } from "../services/outboxHandlers";
import { createResource } from "../services/resource.service";
import { createServiceType } from "../services/serviceType.service";
import type { SendWhatsappTemplateInput } from "../services/whatsappGraph.service";
import { drenarOutbox } from "../workers/outboxWorker";
import {
  ESPERA_TRAS_CIERRE_AUTOMATICO_MS,
  MOTIVO_NO_VINO,
  MOTIVO_SIN_INTERES,
  MOTIVO_TURNO_FUTURO_DE_LA_PRESTACION,
  TEXTO_POR_DEFECTO_DEL_CONTROL,
  TEXTO_POR_DEFECTO_DEL_QR_DE_RESENA,
} from "./postTurno/config";
import { drenarRecordatorios, type DepsDelRecordatorio } from "./recordatorios/recordatorioWorker";
import { cerrarTurnosVencidos, marcarTurno } from "./services/atendido.service";
import { registrarEventosDeTurno } from "./services/eventosDeTurno";

// ---------------------------------------------------------------------------
// Después del turno (docs/rubros.md §7, R14), contra la app real y Postgres:
// marcar Atendido (o el cierre automático) emite booking.completed, el motor
// despacha las acciones de post_turno, que agendan el QR de reseña y el
// control en booking_messages, y el worker de R13 los manda. Doblados: Meta.
// Ninguna evaluación paga.
// ---------------------------------------------------------------------------

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const TZ = "America/Montevideo";

interface Clinica {
  org: OrgDePrueba;
  centro: string;
  ana: string;
  consulta: string;
  paciente: string;
  qr: string;
  reglaQr: string;
  reglaControl: string;
}

let a: Clinica;
let b: Clinica;
let handlers: RegistroDeHandlers;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);
const plantillas: SendWhatsappTemplateInput[] = [];
let sedeAbierta = true;

const deps = (): DepsDelRecordatorio => ({
  accessToken: () => "token-de-prueba",
  plantillaDeLaRegla: async (organizationId, automationId) => {
    const p = await prisma.whatsappTemplate.findFirst({
      where: { organizationId, automationId, status: "APPROVED", deletedAt: null },
    });
    return p
      ? {
          name: p.name,
          languageCode: p.language,
          bodyText: p.bodyText,
          headerFormat: p.headerFormat,
        }
      : null;
  },
  numeroDeLaSede: async () => "pn-prueba",
  sedesDeLaClinica: (organizationId) =>
    prisma.branch.count({ where: { organizationId, deletedAt: null } }),
  sendTemplate: async (input) => {
    plantillas.push(input);
    return { wamid: `wamid.post.${randomUUID()}` };
  },
  registrarEnConversacion: async () => undefined,
  proximaApertura: async (_o, _b, ahora) =>
    sedeAbierta ? ahora : new Date(ahora.getTime() + 10 * HORA),
  baseDeLaApi: () => "https://api.example.test",
});

async function regla(
  org: OrgDePrueba,
  actionType: string,
  actionConfig: Prisma.InputJsonValue,
  texto: string,
) {
  const r = await prisma.automation.create({
    data: {
      organizationId: org.id,
      name: actionType,
      triggerType: "booking.completed",
      actionType,
      triggerConfig: {},
      actionConfig,
    },
  });
  await prisma.whatsappTemplate.create({
    data: {
      organizationId: org.id,
      automationId: r.id,
      name: `post_${randomUUID().slice(0, 8)}`,
      language: "es_AR",
      bodyText: texto,
      metaTemplateId: randomUUID().slice(0, 16),
      status: "APPROVED",
    },
  });
  return r.id;
}

async function montar(): Promise<Clinica> {
  const org = await crearOrgDePrueba("post-turno", "COMPLETA", "CLINICA", 2);
  const centro = (await createBranch(org.id, { name: "Centro", timezone: TZ }, "CLINICA")).id;
  const ana = (await createResource(org.id, { branchId: centro, name: "Ana", type: "PERSON" })).id;
  const consulta = (
    await createServiceType(org.id, {
      branchId: centro,
      resourceId: ana,
      name: "Consulta",
      durationMin: 60,
    })
  ).id;
  await prisma.serviceType.update({ where: { id: consulta }, data: { followUpAfterDays: 28 } });
  const paciente = (
    await prisma.contact.create({
      data: {
        organizationId: org.id,
        firstName: "Paciente",
        lastName: "Ejemplo",
        phone: "+59899000777",
      },
    })
  ).id;
  const qr = (
    await prisma.qrCode.create({
      data: {
        organizationId: org.id,
        branchId: centro,
        name: "Reseñas",
        destinationUrl: "https://example.com/r",
      },
    })
  ).id;
  const reglaQr = await regla(
    org,
    "booking.send_qr_review",
    {
      qrCodeId: qr,
      delayMinutes: 180,
      whatsappFormat: "LINK",
      messageText: TEXTO_POR_DEFECTO_DEL_QR_DE_RESENA,
    },
    TEXTO_POR_DEFECTO_DEL_QR_DE_RESENA,
  );
  const reglaControl = await regla(
    org,
    "booking.schedule_control",
    { messageText: TEXTO_POR_DEFECTO_DEL_CONTROL },
    TEXTO_POR_DEFECTO_DEL_CONTROL,
  );
  const recepcion = await findRoleByName("RECEPCION");
  if (!recepcion) throw new Error("Falta el rol RECEPCION");
  await prisma.user.update({ where: { id: org.authIds[1] }, data: { roleId: recepcion.id } });
  await prisma.userBranch.create({
    data: { organizationId: org.id, userId: org.authIds[1], branchId: centro },
  });
  return { org, centro, ana, consulta, paciente, qr, reglaQr, reglaControl };
}

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
  handlers = crearRegistroDeHandlers();
  registrarAutomatizaciones({ acciones: crearRegistroDeAcciones(), handlers });
  registrarEventosDeTurno(handlers);
  a = await montar();
  b = await montar();
});

after(async () => {
  if (cerrar) await cerrar();
  for (const c of [a, b]) {
    if (!c) continue;
    const where = { organizationId: c.org.id };
    await prisma.bookingMessage.deleteMany({ where });
    await prisma.automationExecution.deleteMany({ where });
    await prisma.whatsappTemplate.deleteMany({ where });
    await prisma.automation.deleteMany({ where });
    await prisma.activity.deleteMany({ where });
    await prisma.booking.deleteMany({ where });
    await prisma.qrCode.deleteMany({ where });
    await prisma.userBranch.deleteMany({ where });
    await prisma.serviceType.deleteMany({ where });
    await prisma.workingHours.deleteMany({ where });
    await prisma.resource.deleteMany({ where });
    await borrarOrgDePrueba(c.org);
  }
});

beforeEach(async () => {
  plantillas.length = 0;
  sedeAbierta = true;
  for (const c of [a, b]) {
    const where = { organizationId: c.org.id };
    await prisma.bookingMessage.deleteMany({ where });
    await prisma.automationExecution.deleteMany({ where });
    await prisma.activity.deleteMany({ where });
    await prisma.outboxEvent.deleteMany({ where });
    await prisma.booking.deleteMany({ where });
    await prisma.contact.update({ where: { id: c.paciente }, data: { noInterestAt: null } });
  }
});

/** Un turno que ya pasó (empezó hace 5 h). */
function turnoPasado(c: Clinica, horasAtras = 5) {
  const inicio = new Date(Date.now() - horasAtras * HORA);
  return prisma.booking.create({
    data: {
      organizationId: c.org.id,
      branchId: c.centro,
      serviceTypeId: c.consulta,
      resourceId: c.ana,
      contactId: c.paciente,
      startsAt: inicio,
      endsAt: new Date(inicio.getTime() + HORA),
    },
  });
}

const quien = (c: Clinica) => ({
  userId: c.org.authIds[0],
  role: "ADMIN" as const,
  industry: "CLINICA" as const,
  descripcion: "Admin",
});

async function marcar(c: Clinica, bookingId: string, estado: "COMPLETED" | "NO_SHOW") {
  await marcarTurno(c.org.id, bookingId, estado, quien(c));
  await drenarOutbox({ organizationId: c.org.id, registro: handlers });
}

const mensajes = (bookingId: string, kind?: BookingMessageKind) =>
  prisma.bookingMessage.findMany({
    where: { bookingId, ...(kind ? { kind } : {}) },
    orderBy: { createdAt: "asc" },
  });

async function drenar(c: Clinica, ahora: Date) {
  return drenarRecordatorios({ ahora, organizationId: c.org.id, deps: deps() });
}

// ---------------------------------------------------------------------------

test("Atendido agenda el QR 3 h después y el control a los 28 días; una reentrega no duplica", async () => {
  const t = await turnoPasado(a);
  await marcar(a, t.id, "COMPLETED");
  const turno = await prisma.booking.findUniqueOrThrow({ where: { id: t.id } });
  const [qr] = await mensajes(t.id, "REVIEW_QR");
  const [control] = await mensajes(t.id, "CONTROL");
  assert.equal(qr.scheduledFor.getTime(), turno.completedAt!.getTime() + 3 * HORA);
  assert.equal(control.scheduledFor.getTime(), turno.completedAt!.getTime() + 28 * DIA);
  // El evento otra vez (reentrega): nada nuevo.
  await prisma.outboxEvent.updateMany({
    where: { organizationId: a.org.id, eventType: "booking.completed" },
    data: { status: "PENDING", attempts: 0, nextAttemptAt: null },
  });
  await prisma.automationExecution.deleteMany({ where: { organizationId: a.org.id } });
  await drenarOutbox({ organizationId: a.org.id, registro: handlers });
  assert.equal((await mensajes(t.id)).length, 2);
});

test("cierre automático: el QR sale 24 h después del cierre", async () => {
  const t = await turnoPasado(a, 6);
  await cerrarTurnosVencidos({ organizationId: a.org.id });
  await drenarOutbox({ organizationId: a.org.id, registro: handlers });
  const turno = await prisma.booking.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(turno.completedBy, "AUTO");
  const [qr] = await mensajes(t.id, "REVIEW_QR");
  assert.equal(
    qr.scheduledFor.getTime(),
    turno.completedAt!.getTime() + ESPERA_TRAS_CIERRE_AUTOMATICO_MS,
  );
});

test("No vino (una corrección) cancela lo pendiente; volver a Atendido agenda de nuevo lo que no salió", async () => {
  const t = await turnoPasado(a);
  await marcar(a, t.id, "COMPLETED");
  await marcar(a, t.id, "NO_SHOW");
  const cancelados = await mensajes(t.id);
  assert.deepEqual(
    cancelados.map((m) => m.status),
    ["CANCELLED", "CANCELLED"],
  );
  assert.ok(cancelados.every((m) => m.lastError === MOTIVO_NO_VINO));
  await marcar(a, t.id, "COMPLETED");
  const vigentes = (await mensajes(t.id)).filter((m) => m.status === "PENDING");
  assert.equal(vigentes.length, 2);
});

test("lo enviado nunca se reenvía: una corrección después del envío no agenda otro QR", async () => {
  const t = await turnoPasado(a);
  await marcar(a, t.id, "COMPLETED");
  const [qr] = await mensajes(t.id, "REVIEW_QR");
  await drenar(a, qr.scheduledFor);
  assert.equal(plantillas.length, 1);
  await marcar(a, t.id, "NO_SHOW");
  await marcar(a, t.id, "COMPLETED");
  const qrs = await mensajes(t.id, "REVIEW_QR");
  assert.deepEqual(
    qrs.map((m) => m.status),
    ["SENT"],
  );
});

test("el worker manda el QR con su link y el control con sus variables; dos pasadas no duplican", async () => {
  const t = await turnoPasado(a);
  await marcar(a, t.id, "COMPLETED");
  const [qr] = await mensajes(t.id, "REVIEW_QR");
  const [control] = await mensajes(t.id, "CONTROL");
  await drenar(a, qr.scheduledFor);
  await drenar(a, qr.scheduledFor);
  assert.equal(plantillas.length, 1);
  assert.deepEqual(plantillas[0].bodyParameters, ["Paciente", "https://example.com/r"]);
  assert.equal(plantillas[0].quickReplyPayloads, undefined);
  await drenar(a, control.scheduledFor);
  assert.equal(plantillas.length, 2);
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: a.org.id } });
  assert.deepEqual(plantillas[1].bodyParameters, ["Paciente", "4", org.name]);
});

test("fuera del horario de la sede se pospone sin gastar el intento", async () => {
  const t = await turnoPasado(a);
  await marcar(a, t.id, "COMPLETED");
  const [qr] = await mensajes(t.id, "REVIEW_QR");
  sedeAbierta = false;
  const r = await drenar(a, qr.scheduledFor);
  assert.equal(r.pospuestos, 1);
  const despues = await prisma.bookingMessage.findUniqueOrThrow({ where: { id: qr.id } });
  assert.equal(despues.status, "PENDING");
  assert.equal(despues.attempts, 0);
  assert.ok(despues.nextAttemptAt.getTime() > qr.scheduledFor.getTime());
  assert.equal(plantillas.length, 0);
});

test("el control se cancela con un turno futuro de la prestación o con el paciente sin interés", async () => {
  const t = await turnoPasado(a);
  await marcar(a, t.id, "COMPLETED");
  const [control] = await mensajes(t.id, "CONTROL");
  const futuro = new Date(control.scheduledFor.getTime() + DIA);
  await prisma.booking.create({
    data: {
      organizationId: a.org.id,
      branchId: a.centro,
      serviceTypeId: a.consulta,
      resourceId: a.ana,
      contactId: a.paciente,
      startsAt: futuro,
      endsAt: new Date(futuro.getTime() + HORA),
    },
  });
  await prisma.bookingMessage.updateMany({
    where: { kind: "REVIEW_QR", bookingId: t.id },
    data: { status: "CANCELLED" },
  });
  await drenar(a, control.scheduledFor);
  const cancelado = await prisma.bookingMessage.findUniqueOrThrow({ where: { id: control.id } });
  assert.equal(cancelado.status, "CANCELLED");
  assert.equal(cancelado.lastError, MOTIVO_TURNO_FUTURO_DE_LA_PRESTACION);

  const t2 = await turnoPasado(a, 7);
  await marcar(a, t2.id, "COMPLETED");
  const [control2] = await mensajes(t2.id, "CONTROL");
  await prisma.bookingMessage.updateMany({
    where: { kind: "REVIEW_QR", bookingId: t2.id },
    data: { status: "CANCELLED" },
  });
  await prisma.booking.deleteMany({ where: { organizationId: a.org.id, startsAt: futuro } });
  await prisma.contact.update({ where: { id: a.paciente }, data: { noInterestAt: new Date() } });
  await drenar(a, control2.scheduledFor);
  assert.equal(
    (await prisma.bookingMessage.findUniqueOrThrow({ where: { id: control2.id } })).lastError,
    MOTIVO_SIN_INTERES,
  );
  assert.equal(plantillas.length, 0);
});

test("una prestación sin control no agenda el control", async () => {
  await prisma.serviceType.update({ where: { id: a.consulta }, data: { followUpAfterDays: null } });
  try {
    const t = await turnoPasado(a);
    await marcar(a, t.id, "COMPLETED");
    assert.equal((await mensajes(t.id, "CONTROL")).length, 0);
    assert.equal((await mensajes(t.id, "REVIEW_QR")).length, 1);
  } finally {
    await prisma.serviceType.update({ where: { id: a.consulta }, data: { followUpAfterDays: 28 } });
  }
});

test("aislamiento: el worker de B no manda lo de A", async () => {
  const t = await turnoPasado(a);
  await marcar(a, t.id, "COMPLETED");
  const [qr] = await mensajes(t.id, "REVIEW_QR");
  await drenar(b, qr.scheduledFor);
  assert.equal(plantillas.length, 0);
  assert.equal(
    (await prisma.bookingMessage.findUniqueOrThrow({ where: { id: qr.id } })).status,
    "PENDING",
  );
});

test("PUT del control: el ADMIN lo guarda; Recepción 403; otra organización 404; validación 1 a 730", async () => {
  const ruta = (id: string) => `/api/clinica/prestaciones/${id}/control`;
  const ok = await pedir(
    a.org,
    "PUT",
    ruta(a.consulta),
    { followUpAfterDays: 30 },
    a.org.tokens[0],
  );
  assert.equal(ok.status, 200);
  assert.equal(
    (await prisma.serviceType.findUniqueOrThrow({ where: { id: a.consulta } })).followUpAfterDays,
    30,
  );
  assert.equal(
    (await pedir(a.org, "PUT", ruta(a.consulta), { followUpAfterDays: 3 }, a.org.tokens[1])).status,
    403,
  );
  assert.equal(
    (await pedir(a.org, "PUT", ruta(b.consulta), { followUpAfterDays: 3 }, a.org.tokens[0])).status,
    404,
  );
  for (const v of [0, 731, 1.5, "30"]) {
    assert.equal(
      (await pedir(a.org, "PUT", ruta(a.consulta), { followUpAfterDays: v }, a.org.tokens[0]))
        .status,
      400,
    );
  }
  await pedir(a.org, "PUT", ruta(a.consulta), { followUpAfterDays: 28 }, a.org.tokens[0]);
});
