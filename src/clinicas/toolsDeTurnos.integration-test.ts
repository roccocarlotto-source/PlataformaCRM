import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import type { AgentParticipation, ConversationChannel, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { findRoleByName } from "../repositories/role.repository";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { runAgentTurn } from "../services/agentOrchestration.service";
import type { ContextoDeEjecucionDeTool, ResultadoDeTool } from "../services/agentTools.service";
import { relojDeReservas } from "../services/booking.service";
import { createBranch } from "../services/branch.service";
import {
  resetLlmProviderParaTests,
  setLlmProviderForTests,
  type LlmCompletionRequest,
  type LlmCompletionResult,
  type LlmProvider,
} from "../services/llmProvider.service";
import { createResource } from "../services/resource.service";
import { createServiceType } from "../services/serviceType.service";
import { replaceWorkingHoursForResource } from "../services/workingHours.service";
import { mensajeDeConsultaClinica, mensajeDeUrgencia } from "./config/mensajesDeSalud";
import { definirProfesionales } from "./services/agendaClinica.service";
import { MARCA_DEL_ASISTENTE, PREFIJO_NOTA_REPROGRAMADO } from "./services/reprogramar.service";
import {
  CUERPO_DE_LA_TAREA_FUERA_DE_PLAZO,
  INSTRUCCION_DE_TONO_DE_CLINICA,
  MENSAJE_AFIRMACION_SIN_ACCION,
  mensajeDeCambioFueraDePlazo,
} from "./config/textosDelAgente";
import { CUERPO_DE_LA_TAREA_CLINICA } from "./config/mensajesDeSalud";
import {
  AUDITORIA_DE_CORRECCION_DEL_RUBRO,
  AUDITORIA_DE_REGLA_DEL_RUBRO,
} from "../services/reglasDelRubro";
import {
  CODIGO_FUERA_DE_PLAZO,
  MENSAJE_TURNO_NO_CONFIRMADO,
  MENSAJE_TURNO_NO_ENCONTRADO,
  MENSAJE_TURNO_YA_EMPEZO,
  PREFIJO_NOTA_CANCELADO,
  TOOLS_DE_TURNOS_DE_CLINICA,
  mensajeFueraDePlazo,
} from "./toolsDeTurnos";

// ---------------------------------------------------------------------------
// Las tools de turnos del agente de una clínica (docs/rubros.md §5.1, R11),
// contra Postgres. Sin modelo real: las tools se ejecutan directo y, en el
// loop, con un proveedor guionado. Ninguna evaluación paga.
//
// Sede Centro (con una Recepción): Ana y Bruno atienden la "Consulta". Sede
// Norte (sin Recepción): Carla. El paciente de la conversación y otra persona.
// Lunes 1/3/2027, 9 a 13 en Buenos Aires, con el reloj fijado el domingo.
// ---------------------------------------------------------------------------

const TZ = "America/Argentina/Buenos_Aires";
const LUNES = (hora: number) =>
  new Date(`2027-03-01T${String(hora + 3).padStart(2, "0")}:00:00.000Z`);
const AHORA_FIJO = new Date("2027-02-28T12:00:00Z");
const LUNES_9_A_13 = [{ weekday: "MONDAY" as const, startMinute: 540, endMinute: 780 }];

const ADMIN = 0;
const RECEPCION_CENTRO = 1;
const OTRO_ADMIN = 2;

class ElModeloNoSeLlama extends Error {}
const proveedorQueFalla: LlmProvider = {
  name: "falla-si-lo-llaman",
  complete() {
    throw new ElModeloNoSeLlama("Se llamó al modelo y no tenía que llamarse");
  },
};

function proveedorGuionado(respuestas: LlmCompletionResult[]) {
  const requests: LlmCompletionRequest[] = [];
  const proveedor: LlmProvider = {
    name: "guionado",
    complete(request) {
      requests.push(request);
      const r = respuestas[Math.min(requests.length - 1, respuestas.length - 1)];
      return Promise.resolve(r);
    },
  };
  return { proveedor, requests };
}

let clinica: OrgDePrueba;
const ids = {} as {
  centro: string;
  norte: string;
  ana: string;
  bruno: string;
  carla: string;
  consulta: string;
  controlNorte: string;
  paciente: string;
  otro: string;
  sinApellido: string;
  agenteCentro: string;
  agenteNorte: string;
};

const TODAS = Object.keys(TOOLS_DE_TURNOS_DE_CLINICA);

async function profesional(branchId: string, name: string) {
  const r = await createResource(clinica.id, { branchId, name, type: "PERSON" });
  await replaceWorkingHoursForResource(clinica.id, r.id, LUNES_9_A_13);
  return r.id;
}

async function agente(branchId: string, nivel: AgentParticipation = "AUTONOMA") {
  const a = await prisma.agent.create({
    data: {
      organizationId: clinica.id,
      branchId,
      name: "Asistente",
      instructions: "Sos el asistente de la clínica.",
      modelProvider: "openrouter",
      modelName: "doble/modelo",
      enabledTools: ["get_service_types", "get_availability", "create_booking", ...TODAS],
      channels: ["WHATSAPP"],
      guardrails: {} as Prisma.InputJsonValue,
      participation: nivel,
      participationChosenAt: new Date(),
    },
  });
  return a.id;
}

before(async () => {
  mock.method(relojDeReservas, "ahora", () => AHORA_FIJO);
  setLlmProviderForTests(proveedorQueFalla);
  clinica = await crearOrgDePrueba("tools-de-turnos", "COMPLETA", "CLINICA", 3);
  const centro = await createBranch(clinica.id, { name: "Centro", timezone: TZ }, "CLINICA");
  const norte = await createBranch(clinica.id, { name: "Norte", timezone: TZ }, "CLINICA");
  ids.centro = centro.id;
  ids.norte = norte.id;
  ids.ana = await profesional(centro.id, "Ana");
  ids.bruno = await profesional(centro.id, "Bruno");
  ids.carla = await profesional(norte.id, "Carla");
  ids.consulta = (
    await createServiceType(clinica.id, {
      branchId: centro.id,
      resourceId: ids.ana,
      name: "Consulta",
      durationMin: 60,
    })
  ).id;
  await definirProfesionales(clinica.id, ids.consulta, [ids.ana, ids.bruno]);
  ids.controlNorte = (
    await createServiceType(clinica.id, {
      branchId: norte.id,
      resourceId: ids.carla,
      name: "Control",
      durationMin: 60,
    })
  ).id;
  const contacto = (firstName: string, lastName: string, phone: string) =>
    prisma.contact.create({
      data: { organizationId: clinica.id, firstName, lastName, phone },
    });
  ids.paciente = (await contacto("Paciente", "Ejemplo", "+59899000001")).id;
  ids.otro = (await contacto("Otra", "Persona", "+59899000002")).id;
  ids.sinApellido = (await contacto("Messenger", "", "+59899000003")).id;

  const recepcion = await findRoleByName("RECEPCION");
  if (!recepcion) throw new Error("Falta el rol RECEPCION");
  const userId = clinica.authIds[RECEPCION_CENTRO];
  await prisma.user.update({ where: { id: userId }, data: { roleId: recepcion.id } });
  await prisma.userBranch.create({
    data: { organizationId: clinica.id, userId, branchId: centro.id },
  });
  ids.agenteCentro = await agente(centro.id);
  ids.agenteNorte = await agente(norte.id);
});

after(async () => {
  mock.restoreAll();
  resetLlmProviderParaTests();
  if (!clinica) return;
  const where = { organizationId: clinica.id };
  await prisma.message.deleteMany({ where });
  await prisma.conversation.deleteMany({ where });
  await prisma.activity.deleteMany({ where });
  await prisma.outboxEvent.deleteMany({ where });
  await prisma.booking.deleteMany({ where });
  await prisma.resourceTimeOff.deleteMany({ where });
  await prisma.agent.deleteMany({ where });
  await prisma.userBranch.deleteMany({ where });
  await prisma.serviceTypeResource.deleteMany({ where });
  await prisma.serviceType.deleteMany({ where });
  await prisma.workingHours.deleteMany({ where });
  await prisma.resource.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await prisma.clinicBranchSettings.deleteMany({ where });
  await borrarOrgDePrueba(clinica);
});

beforeEach(async () => {
  const where = { organizationId: clinica.id };
  await prisma.message.deleteMany({ where });
  await prisma.conversation.deleteMany({ where });
  await prisma.activity.deleteMany({ where });
  await prisma.outboxEvent.deleteMany({ where });
  await prisma.booking.deleteMany({ where });
  await prisma.resourceTimeOff.deleteMany({ where });
  await prisma.clinicBranchSettings.updateMany({ where, data: { minHoursToChangeBooking: null } });
});

function turno(
  contactId: string,
  inicio: Date,
  extra: { resourceId?: string; status?: "CONFIRMED" | "CANCELLED"; branch?: "norte" } = {},
) {
  const norte = extra.branch === "norte";
  return prisma.booking.create({
    data: {
      organizationId: clinica.id,
      branchId: norte ? ids.norte : ids.centro,
      serviceTypeId: norte ? ids.controlNorte : ids.consulta,
      resourceId: extra.resourceId ?? (norte ? ids.carla : ids.ana),
      contactId,
      startsAt: inicio,
      endsAt: new Date(inicio.getTime() + 60 * 60 * 1000),
      status: extra.status ?? "CONFIRMED",
    },
  });
}

async function conversacion(
  contactId: string,
  opciones: { sede?: "norte"; asignado?: string; channel?: ConversationChannel } = {},
): Promise<ContextoDeEjecucionDeTool> {
  const norte = opciones.sede === "norte";
  const c = await prisma.conversation.create({
    data: {
      organizationId: clinica.id,
      branchId: norte ? ids.norte : ids.centro,
      agentId: norte ? ids.agenteNorte : ids.agenteCentro,
      contactId,
      channel: opciones.channel ?? "WHATSAPP",
      assignedUserId: opciones.asignado ?? null,
    },
  });
  return {
    organizationId: clinica.id,
    conversation: {
      id: c.id,
      contactId,
      branchId: c.branchId,
      agentId: c.agentId,
      channel: c.channel,
    },
  };
}

function ejecutar(
  nombre: string,
  args: Record<string, unknown>,
  contexto: ContextoDeEjecucionDeTool,
): Promise<ResultadoDeTool> {
  return TOOLS_DE_TURNOS_DE_CLINICA[nombre].ejecutar(args, contexto);
}

function error(r: ResultadoDeTool): string | undefined {
  return r.ok ? undefined : r.error;
}

const notas = () =>
  prisma.activity.findMany({
    where: { organizationId: clinica.id },
    orderBy: { createdAt: "asc" },
  });
const eventos = (eventType: string) =>
  prisma.outboxEvent.findMany({ where: { organizationId: clinica.id, eventType } });

async function plazoDeCentro(horas: number) {
  await prisma.clinicBranchSettings.upsert({
    where: { branchId: ids.centro },
    create: { organizationId: clinica.id, branchId: ids.centro, minHoursToChangeBooking: horas },
    update: { minHoursToChangeBooking: horas },
  });
}

// ---------------------------------------------------------------------------
// get_contact_bookings
// ---------------------------------------------------------------------------

test("get_contact_bookings: solo los turnos futuros y confirmados del paciente, en la sede de la conversación", async () => {
  const propio = await turno(ids.paciente, LUNES(9));
  await turno(ids.paciente, LUNES(10), { status: "CANCELLED" });
  await turno(ids.paciente, new Date("2027-02-27T13:00:00Z"));
  await turno(ids.paciente, LUNES(9), { branch: "norte" });
  await turno(ids.otro, LUNES(11));

  const r = await ejecutar("get_contact_bookings", {}, await conversacion(ids.paciente));
  assert.equal(r.ok, true);
  const data = (r as { data: { turnos: { bookingId: string; prestacion: string }[] } }).data;
  assert.deepEqual(
    data.turnos.map((t) => t.bookingId),
    [propio.id],
  );
  assert.equal(data.turnos[0].prestacion, "Consulta");
  // El día ya escrito, en la zona de la sede (prueba de la Clínica Demo).
  assert.equal((data.turnos[0] as { cuando?: string }).cuando, "lunes 1 de marzo, 09:00");
});

test("get_contact_bookings: sin turnos, lo dice; sin nombre completo, el candado de identidad", async () => {
  const vacio = await ejecutar("get_contact_bookings", {}, await conversacion(ids.otro));
  assert.equal(vacio.ok, true);
  assert.deepEqual((vacio as { data: { turnos: unknown[] } }).data.turnos, []);

  await turno(ids.sinApellido, LUNES(9));
  const r = await ejecutar("get_contact_bookings", {}, await conversacion(ids.sinApellido));
  assert.equal(r.ok, false);
  assert.match(error(r)!, /apellido/i);
});

// ---------------------------------------------------------------------------
// reschedule_booking
// ---------------------------------------------------------------------------

test("reschedule_booking: mismo turno con otro horario y profesional; nota como el asistente, evento, y no consume el tope", async () => {
  // Dos turnos futuros: el tope de 2 no frena una reprogramación.
  const t = await turno(ids.paciente, LUNES(9));
  await turno(ids.paciente, LUNES(12), { resourceId: ids.bruno });
  const asignado = clinica.authIds[OTRO_ADMIN];
  const contexto = await conversacion(ids.paciente, { asignado });

  const r = await ejecutar(
    "reschedule_booking",
    { bookingId: t.id, startsAt: LUNES(11).toISOString(), resourceId: ids.bruno },
    contexto,
  );
  assert.equal(r.ok, true, error(r));
  assert.equal((r as { data: { cuando?: string } }).data.cuando, "lunes 1 de marzo, 11:00");
  const movido = await prisma.booking.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(movido.startsAt.toISOString(), LUNES(11).toISOString());
  assert.equal(movido.resourceId, ids.bruno);
  assert.equal(movido.isOverbooking, false);

  const [nota] = await notas();
  assert.ok(
    nota.subject.startsWith(`${MARCA_DEL_ASISTENTE}${PREFIJO_NOTA_REPROGRAMADO}`),
    nota.subject,
  );
  assert.match(nota.body ?? "", /Reprogramó: el asistente\./);
  assert.equal(nota.authorId, asignado, "la firma el responsable de la conversación");
  assert.equal((await eventos("booking.rescheduled")).length, 1);
});

test("reschedule_booking: turno de otro paciente, de otra sede o inexistente dan el mismo error, sin tocar nada", async () => {
  const ajeno = await turno(ids.otro, LUNES(9));
  const deNorte = await turno(ids.paciente, LUNES(9), { branch: "norte" });
  const contexto = await conversacion(ids.paciente);
  for (const bookingId of [ajeno.id, deNorte.id, "11111111-1111-4111-8111-111111111111"]) {
    const r = await ejecutar(
      "reschedule_booking",
      { bookingId, startsAt: LUNES(11).toISOString() },
      contexto,
    );
    assert.equal(error(r), MENSAJE_TURNO_NO_ENCONTRADO, bookingId);
  }
  const sinCambios = await prisma.booking.findUniqueOrThrow({ where: { id: ajeno.id } });
  assert.equal(sinCambios.startsAt.toISOString(), LUNES(9).toISOString());
  assert.equal((await notas()).length, 0);
  assert.equal((await eventos("booking.rescheduled")).length, 0);
});

test("reschedule_booking: un turno pasado o cancelado no se mueve", async () => {
  const pasado = await turno(ids.paciente, new Date("2027-02-27T13:00:00Z"));
  const cancelado = await turno(ids.paciente, LUNES(9), { status: "CANCELLED" });
  const contexto = await conversacion(ids.paciente);
  const args = (bookingId: string) => ({ bookingId, startsAt: LUNES(11).toISOString() });
  assert.equal(
    error(await ejecutar("reschedule_booking", args(pasado.id), contexto)),
    MENSAJE_TURNO_YA_EMPEZO,
  );
  assert.equal(
    error(await ejecutar("reschedule_booking", args(cancelado.id), contexto)),
    MENSAJE_TURNO_NO_CONFIRMADO,
  );
});

test("reschedule_booking: dentro de minHoursToChangeBooking devuelve ok: false y no mueve nada", async () => {
  // El turno es el lunes 9 (12:00Z): faltan 24 h.
  const t = await turno(ids.paciente, LUNES(9));
  await plazoDeCentro(48);
  const contexto = await conversacion(ids.paciente);
  const r = await ejecutar(
    "reschedule_booking",
    { bookingId: t.id, startsAt: LUNES(11).toISOString() },
    contexto,
  );
  assert.equal(error(r), mensajeFueraDePlazo(48));
  // El motivo legible por el código: con él deriva la regla del rubro.
  assert.equal((r as { codigo?: string }).codigo, CODIGO_FUERA_DE_PLAZO);
  const igual = await prisma.booking.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(igual.startsAt.toISOString(), LUNES(9).toISOString());

  // Con un plazo menor que lo que falta, se puede.
  await plazoDeCentro(12);
  const ok = await ejecutar(
    "reschedule_booking",
    { bookingId: t.id, startsAt: LUNES(11).toISOString() },
    contexto,
  );
  assert.equal(ok.ok, true, error(ok));
});

test("reschedule_booking: un horario ocupado o bloqueado no se toma, y nunca como sobreturno", async () => {
  const t = await turno(ids.paciente, LUNES(9));
  await turno(ids.otro, LUNES(10));
  await prisma.resource.update({ where: { id: ids.ana }, data: { allowsOverbooking: true } });
  await prisma.resourceTimeOff.create({
    data: {
      organizationId: clinica.id,
      resourceId: ids.bruno,
      startsAt: LUNES(12),
      endsAt: LUNES(13),
    },
  });
  const contexto = await conversacion(ids.paciente);
  try {
    const ocupado = await ejecutar(
      "reschedule_booking",
      // isOverbooking no es un argumento de la tool: se descarta.
      { bookingId: t.id, startsAt: LUNES(10).toISOString(), isOverbooking: true },
      contexto,
    );
    assert.equal(ocupado.ok, false);
    const bloqueado = await ejecutar(
      "reschedule_booking",
      { bookingId: t.id, startsAt: LUNES(12).toISOString(), resourceId: ids.bruno },
      contexto,
    );
    assert.match(error(bloqueado)!, /bloqueo/);
    const fueraDeHorario = await ejecutar(
      "reschedule_booking",
      { bookingId: t.id, startsAt: LUNES(15).toISOString() },
      contexto,
    );
    assert.match(error(fueraDeHorario)!, /fuera del horario/);
  } finally {
    await prisma.resource.update({ where: { id: ids.ana }, data: { allowsOverbooking: false } });
  }
  const igual = await prisma.booking.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(igual.startsAt.toISOString(), LUNES(9).toISOString());
  assert.equal(
    await prisma.booking.count({ where: { organizationId: clinica.id, isOverbooking: true } }),
    0,
  );
});

test("reschedule_booking y cancel_booking: el candado de identidad va antes de mirar el turno", async () => {
  const t = await turno(ids.sinApellido, LUNES(9));
  const contexto = await conversacion(ids.sinApellido);
  for (const [nombre, args] of [
    ["reschedule_booking", { bookingId: t.id, startsAt: LUNES(11).toISOString() }],
    ["cancel_booking", { bookingId: t.id }],
    // Un id ajeno también: no se llega a decir si existe.
    ["cancel_booking", { bookingId: "11111111-1111-4111-8111-111111111111" }],
  ] as const) {
    const r = await ejecutar(nombre, args, contexto);
    assert.equal(r.ok, false);
    assert.match(error(r)!, /apellido/i, nombre);
  }
  const igual = await prisma.booking.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(igual.status, "CONFIRMED");
  assert.equal(igual.startsAt.toISOString(), LUNES(9).toISOString());
});

// ---------------------------------------------------------------------------
// cancel_booking
// ---------------------------------------------------------------------------

/** El paso 1 de cancelar como si hubiera salido en un turno anterior: el
 *  último mensaje del agente lleva el resumen (en toolCalls, como lo guarda el
 *  loop) y el paciente contestó después. `contesto: false`, sin la respuesta. */
async function resumenMostrado(
  contexto: ContextoDeEjecucionDeTool,
  bookingId: string,
  opciones: { contesto?: boolean } = {},
) {
  const paso1 = await ejecutar("cancel_booking", { bookingId }, contexto);
  assert.equal(paso1.ok, true, error(paso1));
  const base = { organizationId: clinica.id, conversationId: contexto.conversation.id };
  const ahora = Date.now();
  await prisma.message.create({
    data: {
      ...base,
      direction: "OUTBOUND",
      senderType: "AGENT",
      content: "¿Confirmás que querés cancelar ese turno?",
      toolCalls: [
        {
          id: "c0",
          name: "cancel_booking",
          arguments: { bookingId },
          allowed: true,
          result: paso1,
        },
      ] as unknown as Prisma.InputJsonValue,
      createdAt: new Date(ahora - 2000),
    },
  });
  if (opciones.contesto !== false) {
    await prisma.message.create({
      data: {
        ...base,
        direction: "INBOUND",
        senderType: "CONTACT",
        content: "Sí, cancelalo",
        createdAt: new Date(ahora - 1000),
      },
    });
  }
}

const cancelados = () =>
  prisma.booking.count({ where: { organizationId: clinica.id, status: "CANCELLED" } });

test("cancel_booking paso 1: devuelve el resumen con el día escrito y no cancela nada", async () => {
  const t = await turno(ids.paciente, LUNES(9));
  const r = await ejecutar("cancel_booking", { bookingId: t.id }, await conversacion(ids.paciente));
  assert.equal(r.ok, true, error(r));
  const data = (r as { data: Record<string, unknown> }).data;
  assert.equal(data.requiereConfirmacion, true);
  assert.equal(data.cancelado, false);
  assert.deepEqual(data.turno, {
    cuando: "lunes 1 de marzo, 09:00",
    prestacion: "Consulta",
    profesional: "Ana",
  });
  assert.equal(await cancelados(), 0);
  assert.equal((await notas()).length, 0);
  assert.equal((await eventos("booking.cancelled")).length, 0);
});

test("cancel_booking: confirmado: true no alcanza sin el resumen en el mensaje anterior y la respuesta del paciente", async () => {
  const t = await turno(ids.paciente, LUNES(9));
  const otro = await turno(ids.paciente, LUNES(11));
  const confirmar = (contexto: ContextoDeEjecucionDeTool) =>
    ejecutar("cancel_booking", { bookingId: t.id, confirmado: true }, contexto);
  // Una conversación abierta por contacto y agente: cada caso, con la suya.
  const otraConversacion = async () => {
    await prisma.message.deleteMany({ where: { organizationId: clinica.id } });
    await prisma.conversation.deleteMany({ where: { organizationId: clinica.id } });
    return conversacion(ids.paciente);
  };

  // Sin ningún resumen antes: vuelve a dar el resumen.
  const sinResumen = await confirmar(await conversacion(ids.paciente));
  assert.equal(
    (sinResumen as { data: { requiereConfirmacion?: boolean } }).data.requiereConfirmacion,
    true,
  );

  // El resumen salió, pero el paciente todavía no contestó.
  const sinRespuesta = await otraConversacion();
  await resumenMostrado(sinRespuesta, t.id, { contesto: false });
  const r1 = await confirmar(sinRespuesta);
  assert.equal((r1 as { data: { cancelado?: boolean } }).data.cancelado, false);

  // El resumen que salió es de otro turno.
  const deOtro = await otraConversacion();
  await resumenMostrado(deOtro, otro.id);
  const r2 = await confirmar(deOtro);
  assert.equal((r2 as { data: { cancelado?: boolean } }).data.cancelado, false);

  assert.equal(await cancelados(), 0);
});

test("cancel_booking: cancela, deja la nota como el asistente (firmada por la Recepción de la sede) y emite booking.cancelled", async () => {
  const t = await turno(ids.paciente, LUNES(9));
  const contexto = await conversacion(ids.paciente);
  await resumenMostrado(contexto, t.id);
  const r = await ejecutar("cancel_booking", { bookingId: t.id, confirmado: true }, contexto);
  assert.equal(r.ok, true, error(r));
  assert.equal((r as { data: { cancelado?: boolean } }).data.cancelado, true);
  assert.equal(
    (await prisma.booking.findUniqueOrThrow({ where: { id: t.id } })).status,
    "CANCELLED",
  );
  const [nota] = await notas();
  assert.ok(
    nota.subject.startsWith(`${MARCA_DEL_ASISTENTE}${PREFIJO_NOTA_CANCELADO}`),
    nota.subject,
  );
  assert.match(nota.body ?? "", /Canceló: el asistente/);
  assert.equal(nota.authorId, clinica.authIds[RECEPCION_CENTRO]);
  assert.equal(nota.branchId, ids.centro);
  assert.equal((await eventos("booking.cancelled")).length, 1);
});

test("cancel_booking: sin responsable ni Recepción en la sede, la nota la firma un ADMIN", async () => {
  const t = await turno(ids.paciente, LUNES(9), { branch: "norte" });
  const contexto = await conversacion(ids.paciente, { sede: "norte" });
  await resumenMostrado(contexto, t.id);
  const r = await ejecutar("cancel_booking", { bookingId: t.id, confirmado: true }, contexto);
  assert.equal(r.ok, true, error(r));
  const [nota] = await notas();
  const autor = await prisma.user.findUniqueOrThrow({
    where: { id: nota.authorId },
    include: { role: true },
  });
  assert.equal(autor.role.name, "ADMIN");
  assert.equal(nota.authorId, clinica.authIds[ADMIN], "el ADMIN más antiguo");
});

test("cancel_booking: las mismas reglas que reprogramar (ajeno, otra sede, pasado, cancelado, fuera de plazo)", async () => {
  const ajeno = await turno(ids.otro, LUNES(9));
  const deNorte = await turno(ids.paciente, LUNES(9), { branch: "norte" });
  const pasado = await turno(ids.paciente, new Date("2027-02-27T13:00:00Z"));
  const cancelado = await turno(ids.paciente, LUNES(10), { status: "CANCELLED" });
  const propio = await turno(ids.paciente, LUNES(11));
  const contexto = await conversacion(ids.paciente);
  const cancelar = (bookingId: string) => ejecutar("cancel_booking", { bookingId }, contexto);

  assert.equal(error(await cancelar(ajeno.id)), MENSAJE_TURNO_NO_ENCONTRADO);
  assert.equal(error(await cancelar(deNorte.id)), MENSAJE_TURNO_NO_ENCONTRADO);
  assert.equal(error(await cancelar(pasado.id)), MENSAJE_TURNO_YA_EMPEZO);
  assert.equal(error(await cancelar(cancelado.id)), MENSAJE_TURNO_NO_CONFIRMADO);
  await plazoDeCentro(48);
  assert.equal(error(await cancelar(propio.id)), mensajeFueraDePlazo(48));

  assert.equal(
    await prisma.booking.count({
      where: { organizationId: clinica.id, status: "CANCELLED" },
    }),
    1,
    "solo el que ya estaba cancelado",
  );
  assert.equal((await notas()).length, 0);
  assert.equal((await eventos("booking.cancelled")).length, 0);
});

// ---------------------------------------------------------------------------
// En el loop real
// ---------------------------------------------------------------------------

function mensaje(
  contactId: string,
  texto: string,
  proveedor: LlmProvider,
  agentId = ids.agenteCentro,
) {
  return runAgentTurn(
    {
      organizationId: clinica.id,
      agentId,
      contactId,
      channel: "WHATSAPP",
      texto,
      externalThreadId: `hilo-${contactId}`,
    },
    { llmProvider: proveedor },
  );
}

test("en el loop: AUTONOMA ofrece las tres tools y el texto de gestión de turnos, y el turno se reprograma", async () => {
  const t = await turno(ids.paciente, LUNES(9));
  const doble = proveedorGuionado([
    {
      text: null,
      toolCalls: [
        {
          id: "c1",
          name: "reschedule_booking",
          arguments: { bookingId: t.id, startsAt: LUNES(11).toISOString() },
        },
      ],
    },
    { text: "Listo, quedó para el lunes a las 11.", toolCalls: [] },
  ]);
  const r = await mensaje(ids.paciente, "Sí, pasalo al lunes a las 11 por favor", doble.proveedor);
  assert.equal(r.respuesta, "Listo, quedó para el lunes a las 11.");
  const ofrecidas = doble.requests[0].tools.map((d) => d.name);
  for (const nombre of TODAS) assert.ok(ofrecidas.includes(nombre), nombre);
  assert.match(doble.requests[0].systemPrompt, /get_contact_bookings/);
  const movido = await prisma.booking.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(movido.startsAt.toISOString(), LUNES(11).toISOString());
});

test("en el loop: PRIMER_CONTACTO no ofrece las tools de turnos ni su texto", async () => {
  const agentId = await agente(ids.centro, "PRIMER_CONTACTO");
  try {
    const doble = proveedorGuionado([{ text: "Te paso con recepción.", toolCalls: [] }]);
    await mensaje(ids.otro, "quiero cambiar mi turno", doble.proveedor, agentId);
    const ofrecidas = doble.requests[0].tools.map((d) => d.name);
    for (const nombre of TODAS) assert.ok(!ofrecidas.includes(nombre), nombre);
    assert.doesNotMatch(doble.requests[0].systemPrompt, /get_contact_bookings/);
  } finally {
    await prisma.message.deleteMany({ where: { organizationId: clinica.id } });
    await prisma.conversation.deleteMany({ where: { agentId } });
    await prisma.agent.delete({ where: { id: agentId } });
  }
});

test("en el loop: una urgencia o una consulta clínica en medio de un pedido de reprogramar gana el guardrail, sin modelo", async () => {
  const t = await turno(ids.paciente, LUNES(9));
  const urgencia = await mensaje(
    ids.paciente,
    "Quiero reprogramar mi turno del lunes, se me hinchó la cara y no puedo respirar bien",
    proveedorQueFalla,
  );
  const nombre = (await prisma.organization.findUniqueOrThrow({ where: { id: clinica.id } })).name;
  assert.equal(urgencia.respuesta, mensajeDeUrgencia(nombre));

  await prisma.message.deleteMany({ where: { organizationId: clinica.id } });
  await prisma.conversation.deleteMany({ where: { organizationId: clinica.id } });
  const clinicaR = await mensaje(
    ids.paciente,
    "Necesito cambiar el turno, me arde mucho la zona después del láser, ¿es normal?",
    proveedorQueFalla,
  );
  assert.equal(clinicaR.respuesta, mensajeDeConsultaClinica(nombre));

  const igual = await prisma.booking.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(igual.startsAt.toISOString(), LUNES(9).toISOString());
  assert.equal(igual.status, "CONFIRMED");
  assert.equal((await eventos("booking.rescheduled")).length, 0);
});

// ---------------------------------------------------------------------------
// Hallazgos de la prueba de la Clínica Demo (2026-10-11), en el loop real
// ---------------------------------------------------------------------------

async function nombreDeLaClinica() {
  return (await prisma.organization.findUniqueOrThrow({ where: { id: clinica.id } })).name;
}

function salientesDelAgente() {
  return prisma.message.findMany({
    where: { organizationId: clinica.id, senderType: "AGENT" },
    orderBy: { createdAt: "asc" },
  });
}

const tareas = () =>
  prisma.activity.findMany({
    where: { organizationId: clinica.id, type: "TASK" },
    orderBy: { createdAt: "asc" },
  });

test("en el loop: un reprogramar fuera de plazo deriva desde el código, sin volver al modelo, con la tarea para la Recepción de la sede", async () => {
  const t = await turno(ids.paciente, LUNES(9));
  await plazoDeCentro(48);
  const doble = proveedorGuionado([
    {
      text: null,
      toolCalls: [
        {
          id: "c1",
          name: "reschedule_booking",
          arguments: { bookingId: t.id, startsAt: LUNES(11).toISOString() },
        },
      ],
    },
    // Lo que hizo el modelo de la demo: no deriva. No se le tiene que preguntar.
    { text: "Comunicate con la clínica para cambiarlo.", toolCalls: [] },
  ]);
  const r = await mensaje(ids.paciente, "Pasame el turno del lunes a las 11", doble.proveedor);
  assert.equal(doble.requests.length, 1, "no se vuelve al modelo");
  assert.equal(r.respuesta, mensajeDeCambioFueraDePlazo(await nombreDeLaClinica()));
  assert.equal(r.handoff, true);

  const conversacionDerivada = await prisma.conversation.findUniqueOrThrow({
    where: { id: r.conversationId },
  });
  assert.equal(conversacionDerivada.status, "TRANSFERRED_TO_HUMAN");
  const [tarea] = await tareas();
  assert.equal(tarea.body, CUERPO_DE_LA_TAREA_FUERA_DE_PLAZO);
  assert.equal(tarea.assigneeId, clinica.authIds[RECEPCION_CENTRO]);
  assert.equal(tarea.branchId, ids.centro);
  const [saliente] = await salientesDelAgente();
  const marcas = (saliente.toolCalls as { name: string }[]).map((x) => x.name);
  assert.ok(marcas.includes(AUDITORIA_DE_REGLA_DEL_RUBRO), marcas.join(","));

  // Como una consulta clínica: el agente calla hasta que lo devuelvan.
  const despues = await mensaje(ids.paciente, "¿Y entonces?", proveedorQueFalla);
  assert.equal(despues.respuesta, null);
  const igual = await prisma.booking.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(igual.startsAt.toISOString(), LUNES(9).toISOString());
});

test("en el loop: sin Recepción en la sede ni dueño del contacto, la derivación va al ADMIN más antiguo (conversación y tarea)", async () => {
  // Norte no tiene Recepción, y el paciente no tiene dueño.
  const clinicaR = await mensaje(
    ids.paciente,
    "me arde la piel",
    proveedorQueFalla,
    ids.agenteNorte,
  );
  assert.equal(clinicaR.handoff, true);
  const conv = await prisma.conversation.findUniqueOrThrow({
    where: { id: clinicaR.conversationId },
  });
  assert.equal(conv.assignedUserId, clinica.authIds[ADMIN]);
  const [tarea] = await tareas();
  assert.equal(tarea.body, CUERPO_DE_LA_TAREA_CLINICA);
  assert.equal(tarea.assigneeId, clinica.authIds[ADMIN]);
  assert.equal(tarea.branchId, ids.norte);

  // La urgencia en una conversación ya derivada, también.
  await mensaje(ids.paciente, "no puedo respirar", proveedorQueFalla, ids.agenteNorte);
  const todas = await tareas();
  assert.equal(todas.length, 2);
  assert.ok(todas[1].subject.startsWith("URGENTE · "), todas[1].subject);
  assert.equal(todas[1].assigneeId, clinica.authIds[ADMIN]);
});

test("en el loop: afirmar un turno que no se agendó en este turno no sale; va el mensaje fijo y la conversación sigue", async () => {
  const afirmacion =
    "He reservado para vos un turno con Ana el lunes a las 9. ¿Querés que te lo confirme?";
  const doble = proveedorGuionado([{ text: afirmacion, toolCalls: [] }]);
  const r = await mensaje(ids.paciente, "quiero un turno el lunes a las 9", doble.proveedor);
  assert.equal(r.respuesta, MENSAJE_AFIRMACION_SIN_ACCION);
  assert.equal(r.handoff, false);
  assert.equal(
    await prisma.booking.count({ where: { organizationId: clinica.id, contactId: ids.paciente } }),
    0,
  );
  const correccion = r.toolCalls.find((x) => x.name === AUDITORIA_DE_CORRECCION_DEL_RUBRO);
  assert.equal(correccion?.arguments.respuestaBloqueada, afirmacion);
  const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: r.conversationId } });
  assert.equal(conv.status, "ACTIVE");

  // No calla al agente, y con la reserva hecha en el mismo turno la
  // confirmación sale tal cual.
  const conReserva = proveedorGuionado([
    {
      text: null,
      toolCalls: [
        {
          id: "c1",
          name: "create_booking",
          arguments: { servicio: "Consulta", startsAt: LUNES(9).toISOString() },
        },
      ],
    },
    { text: "Listo, te reservé el lunes 1 de marzo a las 09:00.", toolCalls: [] },
  ]);
  const ok = await mensaje(ids.paciente, "dale, el lunes a las 9", conReserva.proveedor);
  assert.equal(ok.respuesta, "Listo, te reservé el lunes 1 de marzo a las 09:00.");
  const reserva = ok.toolCalls.find((x) => x.name === "create_booking");
  assert.equal(reserva?.result?.ok, true, JSON.stringify(reserva?.result));
  assert.equal(
    (reserva?.result as { data: { cuando?: string } }).data.cuando,
    "lunes 1 de marzo, 09:00",
  );
});

test("en el loop: cancelar en dos pasos, en dos mensajes; en el mismo turno no cancela", async () => {
  const t = await turno(ids.paciente, LUNES(9));
  const cancelar = (confirmado: boolean) => ({
    id: confirmado ? "c2" : "c1",
    name: "cancel_booking",
    arguments: confirmado ? { bookingId: t.id, confirmado: true } : { bookingId: t.id },
  });

  // Mismo turno: el resumen y enseguida el confirmado. No cancela, y si el
  // modelo dice que canceló, eso no sale.
  const apurado = proveedorGuionado([
    { text: null, toolCalls: [cancelar(false)] },
    { text: null, toolCalls: [cancelar(true)] },
    { text: "Listo, cancelé tu turno.", toolCalls: [] },
  ]);
  const r0 = await mensaje(ids.paciente, "cancelá mi turno del lunes", apurado.proveedor);
  assert.equal(r0.respuesta, MENSAJE_AFIRMACION_SIN_ACCION);
  assert.equal(
    (await prisma.booking.findUniqueOrThrow({ where: { id: t.id } })).status,
    "CONFIRMED",
  );

  // Paso 1: el resumen.
  const paso1 = proveedorGuionado([
    { text: null, toolCalls: [cancelar(false)] },
    {
      text: "Tu turno es el lunes 1 de marzo a las 09:00 con Ana (Consulta). ¿Confirmás que lo querés cancelar?",
      toolCalls: [],
    },
  ]);
  const r1 = await mensaje(ids.paciente, "quiero cancelar mi turno", paso1.proveedor);
  assert.match(r1.respuesta ?? "", /¿Confirmás que lo querés cancelar\?/);
  assert.equal(
    (await prisma.booking.findUniqueOrThrow({ where: { id: t.id } })).status,
    "CONFIRMED",
  );

  // Paso 2: el paciente confirma en su mensaje siguiente.
  const paso2 = proveedorGuionado([
    { text: null, toolCalls: [cancelar(true)] },
    { text: "Listo, cancelé tu turno del lunes 1 de marzo.", toolCalls: [] },
  ]);
  const r2 = await mensaje(ids.paciente, "sí, cancelalo", paso2.proveedor);
  assert.equal(r2.respuesta, "Listo, cancelé tu turno del lunes 1 de marzo.");
  assert.equal(
    (await prisma.booking.findUniqueOrThrow({ where: { id: t.id } })).status,
    "CANCELLED",
  );
  assert.equal((await eventos("booking.cancelled")).length, 1);
});

test("en el loop: el prompt pide voseo, y «de ejemplo» no sale en la respuesta", async () => {
  const doble = proveedorGuionado([
    { text: "Los precios de ejemplo son: Consulta $1.500.", toolCalls: [] },
  ]);
  const r = await mensaje(ids.otro, "¿cuánto sale la consulta?", doble.proveedor);
  assert.equal(r.respuesta, "Los precios son: Consulta $1.500.");
  assert.ok(doble.requests[0].systemPrompt.includes(INSTRUCCION_DE_TONO_DE_CLINICA));
});
