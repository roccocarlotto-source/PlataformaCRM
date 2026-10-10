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

test("cancel_booking: cancela, deja la nota como el asistente (firmada por la Recepción de la sede) y emite booking.cancelled", async () => {
  const t = await turno(ids.paciente, LUNES(9));
  const r = await ejecutar("cancel_booking", { bookingId: t.id }, await conversacion(ids.paciente));
  assert.equal(r.ok, true, error(r));
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
  const r = await ejecutar(
    "cancel_booking",
    { bookingId: t.id },
    await conversacion(ids.paciente, { sede: "norte" }),
  );
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
