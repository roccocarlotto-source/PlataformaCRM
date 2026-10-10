import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, mock, test } from "node:test";
import type { LateBookingReminder, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { findRoleByName } from "../repositories/role.repository";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { updateAutomation } from "../services/automation.service";
import { cancelBooking, relojDeReservas } from "../services/booking.service";
import { createBranch } from "../services/branch.service";
import { erasePersonalData } from "../services/contact.service";
import {
  resetLlmProviderParaTests,
  setLlmProviderForTests,
  type LlmProvider,
} from "../services/llmProvider.service";
import { crearRegistroDeHandlers, type RegistroDeHandlers } from "../services/outboxHandlers";
import { createResource } from "../services/resource.service";
import { createServiceType } from "../services/serviceType.service";
import type {
  SendWhatsappTemplateInput,
  SendWhatsappTextInput,
} from "../services/whatsappGraph.service";
import {
  procesarWebhookDeWhatsapp,
  type WhatsappWebhookPayload,
} from "../services/whatsappWebhook.service";
import { replaceWorkingHoursForResource } from "../services/workingHours.service";
import { drenarTurnosPendientes, type DepsDeEnvio } from "../workers/agentInboundWorker";
import { drenarOutbox } from "../workers/outboxWorker";
import {
  BOTONES_DEL_RECORDATORIO,
  MOTIVO_DATOS_BORRADOS,
  PREFIJO_NOTA_CONFIRMADO,
  PREFIJO_TAREA_CANCELAR_FUERA_DE_PLAZO,
  PREFIJO_TAREA_CANCELO_POR_RECORDATORIO,
  PREFIJO_TAREA_SIN_RESPUESTA,
  TEXTO_CANCELADO,
  TEXTO_CANCELAR_FUERA_DE_PLAZO,
  TEXTO_CONFIRMADO,
  TEXTO_POR_DEFECTO_DEL_RECORDATORIO,
} from "./recordatorios/config";
import { programarRecordatorio } from "./recordatorios/programacion.service";
import {
  crearTareasSinRespuesta,
  drenarRecordatorios,
  type DepsDelRecordatorio,
} from "./recordatorios/recordatorioWorker";
import { definirProfesionales, crearTurnoDeClinica } from "./services/agendaClinica.service";
import { registrarEventosDeTurno } from "./services/eventosDeTurno";
import { reprogramarTurno } from "./services/reprogramar.service";

// ---------------------------------------------------------------------------
// El recordatorio de turno con confirmación (docs/rubros.md §6, R13), contra
// la app real y Postgres. Doblados: Meta (el envío de la plantilla y del texto)
// y el modelo (falla si lo llaman: los botones se resuelven sin él). Ninguna
// evaluación paga.
//
// Clínica con dos sedes (Centro con una Recepción, Norte), Ana atiende la
// "Consulta" en Centro el lunes 1/3/2027 de 9 a 13 (Buenos Aires). La regla
// "Recordatorio antes del turno" activa, con su plantilla aprobada.
// ---------------------------------------------------------------------------

const TZ = "America/Argentina/Buenos_Aires";
const HORA = 60 * 60 * 1000;
const LUNES = (hora: number) =>
  new Date(`2027-03-01T${String(hora + 3).padStart(2, "0")}:00:00.000Z`);
const AHORA_FIJO = new Date("2027-02-25T12:00:00Z");
const LUNES_9_A_13 = [{ weekday: "MONDAY" as const, startMinute: 540, endMinute: 780 }];

const ADMIN = 0;
const RECEPCION = 1;

class ElModeloNoSeLlama extends Error {}
const proveedorQueFalla: LlmProvider = {
  name: "falla-si-lo-llaman",
  complete() {
    throw new ElModeloNoSeLlama("Se llamó al modelo y no tenía que llamarse");
  },
};

interface Clinica {
  org: OrgDePrueba;
  centro: string;
  norte: string;
  ana: string;
  consulta: string;
  paciente: string;
  waId: string;
  phoneNumberId: string;
  regla: string;
  agente: string;
}

let a: Clinica;
let b: Clinica;
let handlers: RegistroDeHandlers;

const plantillas: SendWhatsappTemplateInput[] = [];
const textos: SendWhatsappTextInput[] = [];

const depsDelRecordatorio = (c: Clinica): DepsDelRecordatorio => ({
  accessToken: () => "token-de-prueba",
  plantillaDeLaRegla: async (organizationId, automationId) => {
    const p = await prisma.whatsappTemplate.findFirst({
      where: { organizationId, automationId, status: "APPROVED", deletedAt: null },
    });
    return p ? { name: p.name, languageCode: p.language, bodyText: p.bodyText } : null;
  },
  numeroDeLaSede: async () => c.phoneNumberId,
  sedesDeLaClinica: (organizationId) =>
    prisma.branch.count({ where: { organizationId, deletedAt: null } }),
  sendTemplate: async (input) => {
    plantillas.push(input);
    return { wamid: `wamid.recordatorio.${randomUUID()}` };
  },
});

const depsDeEnvio: DepsDeEnvio = {
  accessToken: () => "token-de-prueba",
  sendText: async (input) => {
    textos.push(input);
    return { wamid: `wamid.respuesta.${randomUUID()}` };
  },
  downloadMedia: () => Promise.reject(new Error("sin media en estos tests")),
  pageAccessToken: () => Promise.reject(new Error("no es un job de Meta")),
  sendMetaText: () => Promise.reject(new Error("no es un job de Meta")),
};

async function montarClinica(prefijo: string): Promise<Clinica> {
  const org = await crearOrgDePrueba(prefijo, "COMPLETA", "CLINICA", 2);
  const centro = (await createBranch(org.id, { name: "Centro", timezone: TZ }, "CLINICA")).id;
  const norte = (await createBranch(org.id, { name: "Norte", timezone: TZ }, "CLINICA")).id;
  const ana = (await createResource(org.id, { branchId: centro, name: "Ana", type: "PERSON" })).id;
  await replaceWorkingHoursForResource(org.id, ana, LUNES_9_A_13);
  const consulta = (
    await createServiceType(org.id, {
      branchId: centro,
      resourceId: ana,
      name: "Consulta",
      durationMin: 60,
    })
  ).id;
  await definirProfesionales(org.id, consulta, [ana]);
  const waId = `59899${String(Math.floor(Math.random() * 900000) + 100000)}`;
  const paciente = (
    await prisma.contact.create({
      data: {
        organizationId: org.id,
        firstName: "Paciente",
        lastName: "Ejemplo",
        phone: `+${waId}`,
      },
    })
  ).id;
  const phoneNumberId = `pn-${randomUUID().slice(0, 12)}`;
  const agente = (
    await prisma.agent.create({
      data: {
        organizationId: org.id,
        branchId: centro,
        name: "Asistente",
        instructions: "Sos el asistente de la clínica.",
        modelProvider: "openrouter",
        modelName: "doble/modelo",
        enabledTools: [],
        channels: ["WHATSAPP"],
        guardrails: {} as Prisma.InputJsonValue,
        participation: "AUTONOMA",
        participationChosenAt: new Date(),
        whatsappPhoneNumberId: phoneNumberId,
      },
    })
  ).id;
  const regla = (
    await prisma.automation.create({
      data: {
        organizationId: org.id,
        name: "Recordatorio antes del turno",
        triggerType: "booking.reminder_due",
        actionType: "booking.send_reminder",
        triggerConfig: {},
        actionConfig: { messageText: TEXTO_POR_DEFECTO_DEL_RECORDATORIO },
      },
    })
  ).id;
  await prisma.whatsappTemplate.create({
    data: {
      organizationId: org.id,
      automationId: regla,
      name: `recordatorio_turno_${randomUUID().slice(0, 8)}`,
      language: "es_AR",
      bodyText: TEXTO_POR_DEFECTO_DEL_RECORDATORIO,
      metaTemplateId: randomUUID().slice(0, 16),
      status: "APPROVED",
    },
  });
  const rolRecepcion = await findRoleByName("RECEPCION");
  if (!rolRecepcion) throw new Error("Falta el rol RECEPCION");
  await prisma.user.update({
    where: { id: org.authIds[RECEPCION] },
    data: { roleId: rolRecepcion.id },
  });
  await prisma.userBranch.create({
    data: { organizationId: org.id, userId: org.authIds[RECEPCION], branchId: centro },
  });
  return { org, centro, norte, ana, consulta, paciente, waId, phoneNumberId, regla, agente };
}

before(async () => {
  mock.method(relojDeReservas, "ahora", () => AHORA_FIJO);
  setLlmProviderForTests(proveedorQueFalla);
  handlers = crearRegistroDeHandlers();
  registrarEventosDeTurno(handlers);
  a = await montarClinica("recordatorios");
  b = await montarClinica("recordatorios");
});

after(async () => {
  mock.restoreAll();
  resetLlmProviderParaTests();
  for (const c of [a, b]) {
    if (!c) continue;
    const where = { organizationId: c.org.id };
    await prisma.agentInboundJob.deleteMany({ where });
    await prisma.message.deleteMany({ where });
    await prisma.conversation.deleteMany({ where });
    await prisma.bookingMessage.deleteMany({ where });
    await prisma.activity.deleteMany({ where });
    await prisma.booking.deleteMany({ where });
    await prisma.whatsappTemplate.deleteMany({ where });
    await prisma.automation.deleteMany({ where });
    await prisma.agent.deleteMany({ where });
    await prisma.userBranch.deleteMany({ where });
    await prisma.serviceTypeResource.deleteMany({ where });
    await prisma.serviceType.deleteMany({ where });
    await prisma.workingHours.deleteMany({ where });
    await prisma.resource.deleteMany({ where });
    await prisma.contactChannelIdentity.deleteMany({ where });
    await borrarOrgDePrueba(c.org);
  }
});

beforeEach(async () => {
  plantillas.length = 0;
  textos.length = 0;
  for (const c of [a, b]) {
    const where = { organizationId: c.org.id };
    await prisma.agentInboundJob.deleteMany({ where });
    await prisma.message.deleteMany({ where });
    await prisma.conversation.deleteMany({ where });
    await prisma.bookingMessage.deleteMany({ where });
    await prisma.activity.deleteMany({ where });
    await prisma.outboxEvent.deleteMany({ where });
    await prisma.booking.deleteMany({ where });
    await prisma.clinicBranchSettings.updateMany({
      where,
      data: {
        reminderHoursBefore: 24,
        lateBookingReminder: "NO_ENVIAR",
        lateBookingHoursBefore: 2,
        minHoursToChangeBooking: null,
      },
    });
    await prisma.automation.update({ where: { id: c.regla }, data: { isActive: true } });
  }
});

const drenarEventos = (c: Clinica) =>
  drenarOutbox({ organizationId: c.org.id, registro: handlers });

async function turno(c: Clinica, hora: number) {
  const t = await crearTurnoDeClinica(c.org.id, {
    serviceTypeId: c.consulta,
    contactId: c.paciente,
    startsAt: LUNES(hora),
    resourceId: c.ana,
  });
  await drenarEventos(c);
  return t;
}

const recordatoriosDe = (bookingId: string) =>
  prisma.bookingMessage.findMany({ where: { bookingId }, orderBy: { createdAt: "asc" } });

/** Agenda, manda el recordatorio y devuelve la fila SENT. */
async function enviado(c: Clinica, hora = 9) {
  const t = await turno(c, hora);
  const [r] = await recordatoriosDe(t.id);
  await drenarRecordatorios({
    ahora: r.scheduledFor,
    organizationId: c.org.id,
    deps: depsDelRecordatorio(c),
  });
  const fila = await prisma.bookingMessage.findUniqueOrThrow({ where: { id: r.id } });
  assert.equal(fila.status, "SENT");
  return { turno: t, fila };
}

function botonDelPaciente(c: Clinica, contextId: string, payload: string) {
  const texto = BOTONES_DEL_RECORDATORIO.find((x) => x.payload === payload)?.texto ?? payload;
  const wamid = `wamid.entrante.${randomUUID()}`;
  return {
    wamid,
    payload: {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: c.phoneNumberId, display_phone_number: "59820000000" },
                contacts: [{ profile: { name: "Paciente Ejemplo" }, wa_id: c.waId }],
                messages: [
                  {
                    from: c.waId,
                    id: wamid,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: "button",
                    button: { text: texto, payload },
                    context: { id: contextId },
                  },
                ],
              },
            },
          ],
        },
      ],
    } as unknown as WhatsappWebhookPayload,
  };
}

async function responder(c: Clinica, contextId: string, payload: string) {
  const { payload: p } = botonDelPaciente(c, contextId, payload);
  await procesarWebhookDeWhatsapp(p);
  await drenarTurnosPendientes({ organizationId: c.org.id, deps: depsDeEnvio });
  await drenarEventos(c);
}

async function configurar(
  c: Clinica,
  datos: {
    lateBookingReminder?: LateBookingReminder;
    lateBookingHoursBefore?: number;
    minHoursToChangeBooking?: number | null;
  },
) {
  await prisma.clinicBranchSettings.update({ where: { branchId: c.centro }, data: datos });
}

// ---------------------------------------------------------------------------
// Programar, reprogramar, cancelar
// ---------------------------------------------------------------------------

test("booking.created programa el recordatorio 24 h antes; una reentrega no agenda otro", async () => {
  const t = await turno(a, 9);
  const [r, ...resto] = await recordatoriosDe(t.id);
  assert.equal(resto.length, 0);
  assert.equal(r.status, "PENDING");
  assert.equal(r.automationId, a.regla);
  assert.equal(r.bookingStartsAt.toISOString(), LUNES(9).toISOString());
  assert.equal(
    r.scheduledFor.toISOString(),
    new Date(LUNES(9).getTime() - 24 * HORA).toISOString(),
  );
  assert.equal(await programarRecordatorio(a.org.id, t.id), "YA_ESTABA");
  assert.equal((await recordatoriosDe(t.id)).length, 1);
});

test("booking.rescheduled lo recalcula: el del horario viejo se cancela y se agenda el nuevo", async () => {
  const t = await turno(a, 9);
  await reprogramarTurno(
    a.org.id,
    t.id,
    { startsAt: LUNES(11) },
    { userId: a.org.authIds[ADMIN], role: "ADMIN", industry: "CLINICA", descripcion: "Admin" },
  );
  await drenarEventos(a);
  const [viejo, nuevo] = await recordatoriosDe(t.id);
  assert.equal(viejo.status, "CANCELLED");
  assert.equal(nuevo.status, "PENDING");
  assert.equal(nuevo.bookingStartsAt.toISOString(), LUNES(11).toISOString());
});

test("booking.cancelled lo anula", async () => {
  const t = await turno(a, 9);
  await cancelBooking(a.org.id, t.id);
  await drenarEventos(a);
  const [r] = await recordatoriosDe(t.id);
  assert.equal(r.status, "CANCELLED");
});

test("turno dado con menos anticipación: no mandar, en el momento u horas antes", async () => {
  const t = await turno(a, 9);
  await prisma.bookingMessage.deleteMany({ where: { bookingId: t.id } });
  const ahora = new Date(LUNES(9).getTime() - 5 * HORA);
  const probar = async () => {
    await prisma.bookingMessage.deleteMany({ where: { bookingId: t.id } });
    const resultado = await programarRecordatorio(a.org.id, t.id, ahora);
    const [r] = await recordatoriosDe(t.id);
    return { resultado, scheduledFor: r?.scheduledFor.toISOString() ?? null };
  };
  await configurar(a, { lateBookingReminder: "NO_ENVIAR" });
  assert.deepEqual(await probar(), { resultado: "NO_CORRESPONDE", scheduledFor: null });
  await configurar(a, { lateBookingReminder: "EN_EL_MOMENTO" });
  assert.deepEqual(await probar(), { resultado: "AGENDADO", scheduledFor: ahora.toISOString() });
  await configurar(a, { lateBookingReminder: "HORAS_ANTES", lateBookingHoursBefore: 2 });
  assert.deepEqual(await probar(), {
    resultado: "AGENDADO",
    scheduledFor: new Date(LUNES(9).getTime() - 2 * HORA).toISOString(),
  });
  await configurar(a, { lateBookingReminder: "HORAS_ANTES", lateBookingHoursBefore: 6 });
  assert.deepEqual(await probar(), { resultado: "NO_CORRESPONDE", scheduledFor: null });
});

// ---------------------------------------------------------------------------
// El envío
// ---------------------------------------------------------------------------

test("el worker manda la plantilla con los botones y sus variables; dos pasadas no duplican", async () => {
  const { fila } = await enviado(a);
  assert.equal(plantillas.length, 1);
  const [envio] = plantillas;
  assert.equal(envio.to, a.waId);
  assert.deepEqual(envio.quickReplyPayloads, ["CONFIRMAR", "CANCELAR"]);
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: a.org.id } });
  assert.deepEqual(envio.bodyParameters, [
    "Paciente",
    `${org.name} (sede Centro)`,
    "lunes 1 de marzo",
    "09:00",
    "Ana",
  ]);
  assert.ok(fila.externalMessageId);
  // La segunda pasada, aun mucho después, no manda nada.
  await drenarRecordatorios({
    ahora: new Date(fila.scheduledFor.getTime() + HORA),
    organizationId: a.org.id,
    deps: depsDelRecordatorio(a),
  });
  assert.equal(plantillas.length, 1);
  // Sale como plantilla aunque no haya ventana abierta: nunca texto libre.
  assert.equal(textos.length, 0);
  const saliente = await prisma.message.findFirst({
    where: { organizationId: a.org.id, senderType: "AUTOMATION" },
  });
  assert.ok(saliente, "el recordatorio queda en la conversación");
});

test("al mandar revalida: un turno cancelado sin procesar su evento y una regla desactivada cancelan", async () => {
  const t = await turno(a, 9);
  const [r] = await recordatoriosDe(t.id);
  await prisma.booking.update({ where: { id: t.id }, data: { status: "CANCELLED" } });
  await drenarRecordatorios({
    ahora: r.scheduledFor,
    organizationId: a.org.id,
    deps: depsDelRecordatorio(a),
  });
  assert.equal(
    (await prisma.bookingMessage.findUniqueOrThrow({ where: { id: r.id } })).status,
    "CANCELLED",
  );

  const t2 = await turno(a, 10);
  await updateAutomation(a.org.id, a.regla, { isActive: false });
  const [r2] = await recordatoriosDe(t2.id);
  assert.equal(r2.status, "CANCELLED", "desactivar la regla cancela sus pendientes");
  assert.equal(plantillas.length, 0);
});

test("borrar los datos del paciente cancela sus pendientes y limpia el last_error", async () => {
  const t = await turno(a, 9);
  const [r] = await recordatoriosDe(t.id);
  await prisma.bookingMessage.update({
    where: { id: r.id },
    data: { lastError: "Bearer abc.def" },
  });
  await erasePersonalData(a.org.id, a.paciente);
  const despues = await prisma.bookingMessage.findUniqueOrThrow({ where: { id: r.id } });
  assert.equal(despues.status, "CANCELLED");
  assert.equal(despues.lastError, null);
  // El paciente se vuelve a cargar para los demás tests.
  await prisma.contact.update({
    where: { id: a.paciente },
    data: { firstName: "Paciente", lastName: "Ejemplo", phone: `+${a.waId}` },
  });
  void MOTIVO_DATOS_BORRADOS;
});

// ---------------------------------------------------------------------------
// Las respuestas
// ---------------------------------------------------------------------------

test("Confirmo: patient_confirmed_at, nota, texto fijo y sin modelo", async () => {
  const { turno: t, fila } = await enviado(a);
  await responder(a, fila.externalMessageId!, "CONFIRMAR");
  const confirmado = await prisma.booking.findUniqueOrThrow({ where: { id: t.id } });
  assert.ok(confirmado.patientConfirmedAt);
  const notas = await prisma.activity.findMany({
    where: {
      organizationId: a.org.id,
      type: "NOTE",
      subject: { startsWith: PREFIJO_NOTA_CONFIRMADO },
    },
  });
  assert.equal(notas.length, 1);
  assert.deepEqual(
    textos.map((x) => x.body),
    [TEXTO_CONFIRMADO],
  );
  const respondida = await prisma.bookingMessage.findUniqueOrThrow({ where: { id: fila.id } });
  assert.equal(respondida.response, "CONFIRMAR");
});

test("Necesito cancelar: cancela con el servicio (booking.cancelled), tarea para Recepción y texto fijo", async () => {
  const { turno: t, fila } = await enviado(a);
  await responder(a, fila.externalMessageId!, "CANCELAR");
  assert.equal(
    (await prisma.booking.findUniqueOrThrow({ where: { id: t.id } })).status,
    "CANCELLED",
  );
  const eventos = await prisma.outboxEvent.findMany({
    where: { organizationId: a.org.id, eventType: "booking.cancelled" },
  });
  assert.equal(eventos.length, 1);
  const [tarea] = await prisma.activity.findMany({
    where: {
      organizationId: a.org.id,
      type: "TASK",
      subject: { startsWith: PREFIJO_TAREA_CANCELO_POR_RECORDATORIO },
    },
  });
  assert.ok(tarea);
  assert.equal(tarea.assigneeId, a.org.authIds[RECEPCION], "a la Recepción de la sede (R20)");
  assert.equal(tarea.branchId, a.centro);
  assert.deepEqual(
    textos.map((x) => x.body),
    [TEXTO_CANCELADO],
  );
});

test("Necesito cancelar dentro de minHoursToChangeBooking: no cancela y deriva con una tarea", async () => {
  // El reloj de turnos está fijo 96 h antes del turno.
  await configurar(a, { minHoursToChangeBooking: 120 });
  const { turno: t, fila } = await enviado(a);
  await responder(a, fila.externalMessageId!, "CANCELAR");
  assert.equal(
    (await prisma.booking.findUniqueOrThrow({ where: { id: t.id } })).status,
    "CONFIRMED",
  );
  const tareas = await prisma.activity.findMany({
    where: {
      organizationId: a.org.id,
      subject: { startsWith: PREFIJO_TAREA_CANCELAR_FUERA_DE_PLAZO },
    },
  });
  assert.equal(tareas.length, 1);
  assert.deepEqual(
    textos.map((x) => x.body),
    [TEXTO_CANCELAR_FUERA_DE_PLAZO],
  );
});

test("sin respuesta: una sola tarea para Recepción a las 4 h; si después confirma, se cierra sola", async () => {
  const { fila } = await enviado(a);
  const enviadoEn = fila.sentAt!;
  assert.equal(
    await crearTareasSinRespuesta(new Date(enviadoEn.getTime() + 3 * HORA), a.org.id),
    0,
  );
  assert.equal(
    await crearTareasSinRespuesta(new Date(enviadoEn.getTime() + 4 * HORA), a.org.id),
    1,
  );
  assert.equal(
    await crearTareasSinRespuesta(new Date(enviadoEn.getTime() + 5 * HORA), a.org.id),
    0,
  );
  const [tarea] = await prisma.activity.findMany({
    where: { organizationId: a.org.id, subject: { startsWith: PREFIJO_TAREA_SIN_RESPUESTA } },
  });
  assert.equal(tarea.assigneeId, a.org.authIds[RECEPCION]);
  assert.equal(tarea.completedAt, null);

  await responder(a, fila.externalMessageId!, "CONFIRMAR");
  const cerrada = await prisma.activity.findUniqueOrThrow({ where: { id: tarea.id } });
  assert.ok(cerrada.completedAt, "la tarea se cierra sola");
});

test("sin respuesta con el turno a menos de 2 h: no hay tarea", async () => {
  await configurar(a, { lateBookingReminder: "EN_EL_MOMENTO" });
  const t = await turno(a, 9);
  await prisma.bookingMessage.deleteMany({ where: { bookingId: t.id } });
  const ahora = new Date(LUNES(9).getTime() - HORA);
  await programarRecordatorio(a.org.id, t.id, ahora);
  await drenarRecordatorios({ ahora, organizationId: a.org.id, deps: depsDelRecordatorio(a) });
  assert.equal(await crearTareasSinRespuesta(new Date(ahora.getTime() + 5 * HORA), a.org.id), 0);
});

test("texto libre en vez del botón: lo atiende el agente y la tarea sin respuesta sigue su curso", async () => {
  const { fila } = await enviado(a);
  let llamadas = 0;
  setLlmProviderForTests({
    name: "guionado",
    complete() {
      llamadas++;
      return Promise.resolve({ text: "¡Hola! Te leo.", toolCalls: [] });
    },
  });
  try {
    const { payload } = botonDelPaciente(a, fila.externalMessageId!, "CONFIRMAR");
    const mensaje = (payload.entry[0].changes[0].value as { messages: Record<string, unknown>[] })
      .messages[0];
    delete mensaje.button;
    delete mensaje.context;
    mensaje.type = "text";
    mensaje.text = { body: "¿Puedo llevar a mi hija?" };
    await procesarWebhookDeWhatsapp(payload);
    await drenarTurnosPendientes({ organizationId: a.org.id, deps: depsDeEnvio });
  } finally {
    setLlmProviderForTests(proveedorQueFalla);
  }
  assert.ok(llamadas > 0, "lo atendió el agente");
  const igual = await prisma.bookingMessage.findUniqueOrThrow({ where: { id: fila.id } });
  assert.equal(igual.respondedAt, null);
  assert.equal(
    await crearTareasSinRespuesta(new Date(fila.sentAt!.getTime() + 4 * HORA), a.org.id),
    1,
  );
});

// ---------------------------------------------------------------------------
// Aislamiento
// ---------------------------------------------------------------------------

test("aislamiento: el worker de B no manda lo de A, y un botón que llega al número de B no resuelve el recordatorio de A", async () => {
  const t = await turno(a, 9);
  const [r] = await recordatoriosDe(t.id);
  await drenarRecordatorios({
    ahora: r.scheduledFor,
    organizationId: b.org.id,
    deps: depsDelRecordatorio(b),
  });
  assert.equal(plantillas.length, 0);
  assert.equal(
    (await prisma.bookingMessage.findUniqueOrThrow({ where: { id: r.id } })).status,
    "PENDING",
  );

  await drenarRecordatorios({
    ahora: r.scheduledFor,
    organizationId: a.org.id,
    deps: depsDelRecordatorio(a),
  });
  const deA = await prisma.bookingMessage.findUniqueOrThrow({ where: { id: r.id } });
  await responder(b, deA.externalMessageId!, "CONFIRMAR").catch(() => undefined);
  const igual = await prisma.bookingMessage.findUniqueOrThrow({ where: { id: r.id } });
  assert.equal(igual.respondedAt, null);
  assert.equal(
    (await prisma.booking.findUniqueOrThrow({ where: { id: t.id } })).patientConfirmedAt,
    null,
  );
});
