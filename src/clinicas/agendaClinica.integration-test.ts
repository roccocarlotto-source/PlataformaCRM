import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { runAgentTurn } from "../services/agentOrchestration.service";
import type { ContextoDeEjecucionDeTool } from "../services/agentTools.service";
import { relojDeReservas } from "../services/booking.service";
import { createBranch } from "../services/branch.service";
import type { LlmCompletionRequest, LlmProvider } from "../services/llmProvider.service";
import { createResource } from "../services/resource.service";
import { createServiceType } from "../services/serviceType.service";
import { replaceWorkingHoursForResource } from "../services/workingHours.service";
import { MENSAJE_NINGUN_PROFESIONAL_LIBRE } from "./services/agendaClinica.service";
import { TOOLS_DE_AGENDA_DE_CLINICA } from "./toolsDeAgenda";

// ---------------------------------------------------------------------------
// Agenda de clínica contra la app real y Postgres (docs/rubros.md §4.3, R5).
// La organización CLINICA se crea directo en la base: hasta que se active
// CLINICA_HABILITADA no hay ruta que la cree.
//
// Escenario: una sede, dos profesionales (Ana y Bruno) que trabajan los lunes
// de 9 a 13, y "Limpieza facial" (60 min) con Ana de principal. El lunes 7 de
// septiembre de 2026, con el reloj de reservas fijado el domingo anterior.
//
// Y los casos de la suite "automotora sin cambios" de R5: el gate, y que un
// recurso que no provee el servicio sigue dando el mismo 400 en
// /api/availability y en POST /api/bookings.
// ---------------------------------------------------------------------------

const TZ = "America/Argentina/Buenos_Aires";
// Lunes 7/9/2026, 9:00 en Buenos Aires = 12:00Z.
const A_LAS = (hora: number) => `2026-09-07T${String(hora + 3).padStart(2, "0")}:00:00Z`;
const AHORA_FIJO = new Date("2026-09-06T12:00:00Z");
const LUNES_9_A_13 = [{ weekday: "MONDAY" as const, startMinute: 540, endMinute: 780 }];

let clinica: OrgDePrueba;
let automotora: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);

interface Agenda {
  branchId: string;
  ana: string;
  bruno: string;
  sala: string;
  deOtraSede: string;
  limpieza: string;
  contactId: string;
}
let agenda: Agenda;

async function montarAgenda(organizationId: string): Promise<Agenda> {
  const sede = await createBranch(organizationId, { name: "Sede Centro", timezone: TZ }, "CLINICA");
  const otraSede = await createBranch(
    organizationId,
    { name: "Sede Norte", timezone: TZ },
    "CLINICA",
  );
  const ana = await createResource(organizationId, {
    branchId: sede.id,
    name: "Ana Profesional",
    type: "PERSON",
  });
  const bruno = await createResource(organizationId, {
    branchId: sede.id,
    name: "Bruno Profesional",
    type: "PERSON",
  });
  const sala = await createResource(organizationId, {
    branchId: sede.id,
    name: "Sala 1",
    type: "ROOM",
  });
  const deOtraSede = await createResource(organizationId, {
    branchId: otraSede.id,
    name: "Carla Profesional",
    type: "PERSON",
  });
  for (const r of [ana, bruno]) {
    await replaceWorkingHoursForResource(organizationId, r.id, LUNES_9_A_13);
  }
  const limpieza = await createServiceType(organizationId, {
    branchId: sede.id,
    resourceId: ana.id,
    name: "Limpieza facial",
    durationMin: 60,
  });
  const contacto = await prisma.contact.create({
    data: {
      organizationId,
      firstName: "Paciente",
      lastName: "Ejemplo",
      email: "paciente@example.com",
    },
  });
  return {
    branchId: sede.id,
    ana: ana.id,
    bruno: bruno.id,
    sala: sala.id,
    deOtraSede: deOtraSede.id,
    limpieza: limpieza.id,
    contactId: contacto.id,
  };
}

async function borrarAgenda(org: OrgDePrueba | undefined) {
  if (!org) return;
  const where = { organizationId: org.id };
  await prisma.message.deleteMany({ where });
  await prisma.conversation.deleteMany({ where });
  await prisma.agent.deleteMany({ where });
  await prisma.booking.deleteMany({ where });
  await prisma.serviceTypeResource.deleteMany({ where });
  await prisma.serviceType.deleteMany({ where });
  await prisma.workingHours.deleteMany({ where });
  await prisma.resource.deleteMany({ where });
  await prisma.clinicBranchSettings.deleteMany({ where });
}

before(async () => {
  mock.method(relojDeReservas, "ahora", () => AHORA_FIJO);
  ({ baseUrl, cerrar } = await levantarApp());
  clinica = await crearOrgDePrueba("agenda-clinica", "COMPLETA", "CLINICA", 2);
  automotora = await crearOrgDePrueba("agenda-clinica", "COMPLETA", "AUTOMOTORA", 1);
  agenda = await montarAgenda(clinica.id);
});

after(async () => {
  if (cerrar) await cerrar();
  for (const org of [clinica, automotora]) {
    await borrarAgenda(org);
    await borrarOrgDePrueba(org);
  }
});

// ---------------------------------------------------------------------------
// Quién atiende una prestación
// ---------------------------------------------------------------------------

test("definir los profesionales de una prestación: el principal queda siempre; otra sede o una sala dan 400", async () => {
  const ruta = `/api/clinica/prestaciones/${agenda.limpieza}/profesionales`;
  const definidos = await pedir(clinica, "PUT", ruta, { resourceIds: [agenda.bruno] });
  assert.equal(definidos.status, 200, JSON.stringify(definidos.json));
  assert.deepEqual(
    (definidos.json.profesionales as { id: string }[]).map((p) => p.id),
    [agenda.ana, agenda.bruno],
    "el principal (Ana) queda aunque no venga en el pedido",
  );

  for (const ajeno of [agenda.deOtraSede, agenda.sala, randomUUID()]) {
    const r = await pedir(clinica, "PUT", ruta, { resourceIds: [agenda.bruno, ajeno] });
    assert.equal(r.status, 400, ajeno);
  }
  // Los rechazos no cambiaron nada.
  const leidos = await pedir(clinica, "GET", ruta);
  assert.deepEqual(
    (leidos.json.profesionales as { id: string }[]).map((p) => p.id),
    [agenda.ana, agenda.bruno],
  );

  const listado = await pedir(
    clinica,
    "GET",
    `/api/clinica/prestaciones?branchId=${agenda.branchId}`,
  );
  const limpieza = (listado.json.prestaciones as { id: string; profesionales: unknown[] }[]).find(
    (p) => p.id === agenda.limpieza,
  );
  assert.equal(limpieza?.profesionales.length, 2);
});

// ---------------------------------------------------------------------------
// Disponibilidad: la unión, o la de un profesional
// ---------------------------------------------------------------------------

test("disponibilidad de la prestación: la unión de los dos profesionales, o la del elegido", async () => {
  const consulta = (extra: string) =>
    pedir(
      clinica,
      "GET",
      `/api/clinica/disponibilidad?serviceTypeId=${agenda.limpieza}&from=${A_LAS(9)}&to=${A_LAS(13)}${extra}`,
    );
  type Turno = { startsAt: string; resource: { id: string; name: string } };

  const todos = await consulta("");
  assert.equal(todos.status, 200, JSON.stringify(todos.json));
  const turnos = todos.json.availability as Turno[];
  assert.equal(turnos.length, 8, "4 turnos de una hora por cada uno de los dos");
  assert.deepEqual(
    turnos.slice(0, 2).map((t) => [t.startsAt, t.resource.name]),
    [
      [new Date(A_LAS(9)).toISOString(), "Ana Profesional"],
      [new Date(A_LAS(9)).toISOString(), "Bruno Profesional"],
    ],
  );

  const deBruno = await consulta(`&resourceId=${agenda.bruno}`);
  assert.deepEqual(
    [...new Set((deBruno.json.availability as Turno[]).map((t) => t.resource.id))],
    [agenda.bruno],
  );

  const deOtra = await consulta(`&resourceId=${agenda.deOtraSede}`);
  assert.equal(deOtra.status, 400, "un profesional que no atiende la prestación");
});

// ---------------------------------------------------------------------------
// Turno: con profesional o el primero libre
// ---------------------------------------------------------------------------

test("turno sin profesional: el primero libre (el de menos turnos ese día); con profesional, ese; sin nadie libre, 409", async () => {
  const turno = (hora: number, resourceId?: string) =>
    pedir(clinica, "POST", "/api/clinica/turnos", {
      serviceTypeId: agenda.limpieza,
      contactId: agenda.contactId,
      startsAt: A_LAS(hora),
      ...(resourceId ? { resourceId } : {}),
    });

  const primero = await turno(9);
  assert.equal(primero.status, 201, JSON.stringify(primero.json));
  assert.equal(primero.json.resourceId, agenda.ana, "empatados en cero: por nombre, Ana");

  const segundo = await turno(9);
  assert.equal(segundo.json.resourceId, agenda.bruno, "Ana ya está ocupada a las 9");

  const tercero = await turno(9);
  assert.equal(tercero.status, 409);
  assert.equal(tercero.json.error?.message, MENSAJE_NINGUN_PROFESIONAL_LIBRE);

  const elegido = await turno(10, agenda.ana);
  assert.equal(elegido.json.resourceId, agenda.ana);

  // Ana tiene 2 ese día y Bruno 1: el primero libre a las 11 es Bruno.
  const menosCargado = await turno(11);
  assert.equal(menosCargado.json.resourceId, agenda.bruno);

  const ajeno = await turno(12, agenda.deOtraSede);
  assert.equal(ajeno.status, 400);
});

// ---------------------------------------------------------------------------
// Las tools del agente de una clínica
// ---------------------------------------------------------------------------

function contextoDeTool(contactId: string): ContextoDeEjecucionDeTool {
  return {
    organizationId: clinica.id,
    conversation: {
      id: randomUUID(),
      contactId,
      branchId: agenda.branchId,
      agentId: randomUUID(),
      channel: "WEB",
    },
  };
}

test("tools de clínica: get_service_types con profesionales; get_availability con el profesional de cada turno; create_booking sin profesional", async () => {
  // Un paciente propio: el del escenario ya tiene turnos y el tope de
  // reservas futuras de la tool no lo dejaría reservar.
  const paciente = await prisma.contact.create({
    data: {
      organizationId: clinica.id,
      firstName: "Otro",
      lastName: "Paciente",
      email: "otro.paciente@example.com",
    },
  });
  const contexto = contextoDeTool(paciente.id);
  const tipos = await TOOLS_DE_AGENDA_DE_CLINICA.get_service_types.ejecutar({}, contexto);
  assert.equal(tipos.ok, true);
  const limpieza = (
    tipos as { data: { serviceTypes: { id: string; profesionales: { name: string }[] }[] } }
  ).data.serviceTypes.find((t) => t.id === agenda.limpieza);
  assert.deepEqual(
    limpieza?.profesionales.map((p) => p.name),
    ["Ana Profesional", "Bruno Profesional"],
  );

  const disponibilidad = await TOOLS_DE_AGENDA_DE_CLINICA.get_availability.ejecutar(
    { servicio: "Limpieza facial", desde: A_LAS(12), hasta: A_LAS(13) },
    contexto,
  );
  assert.equal(disponibilidad.ok, true, JSON.stringify(disponibilidad));
  const turnos = (disponibilidad as { data: { turnos: { profesional: { name: string } }[] } }).data
    .turnos;
  assert.deepEqual(
    turnos.map((t) => t.profesional.name),
    ["Ana Profesional", "Bruno Profesional"],
  );

  const reserva = await TOOLS_DE_AGENDA_DE_CLINICA.create_booking.ejecutar(
    { servicio: "Limpieza facial", startsAt: A_LAS(12) },
    contexto,
  );
  assert.equal(reserva.ok, true, JSON.stringify(reserva));
  assert.ok(
    [agenda.ana, agenda.bruno].includes(
      (reserva as { data: { profesionalId: string } }).data.profesionalId,
    ),
  );
});

test("el loop de un agente de clínica usa las tools con profesionales", async () => {
  const agente = await prisma.agent.create({
    data: {
      organizationId: clinica.id,
      branchId: agenda.branchId,
      name: "Asistente",
      instructions: "Sos el asistente de la clínica.",
      modelProvider: "openrouter",
      modelName: "doble/modelo",
      enabledTools: ["get_service_types"],
      channels: ["WEB"],
      guardrails: {} as Prisma.InputJsonValue,
    },
  });
  const requests: LlmCompletionRequest[] = [];
  const proveedor: LlmProvider = {
    name: "guion",
    complete(request) {
      requests.push(request);
      return Promise.resolve(
        requests.length === 1
          ? { text: null, toolCalls: [{ id: "t1", name: "get_service_types", arguments: {} }] }
          : { text: "Tenemos limpieza facial.", toolCalls: [] },
      );
    },
  };
  const r = await runAgentTurn(
    {
      organizationId: clinica.id,
      agentId: agente.id,
      contactId: agenda.contactId,
      channel: "WEB",
      texto: "¿qué prestaciones tienen?",
    },
    { llmProvider: proveedor },
  );
  const resultado = r.toolCalls.find((t) => t.name === "get_service_types")?.result as {
    data: { serviceTypes: { profesionales?: unknown[] }[] };
  };
  assert.ok(resultado.data.serviceTypes.every((t) => Array.isArray(t.profesionales)));
});

// ---------------------------------------------------------------------------
// Suite "automotora sin cambios" (casos de R5, docs/rubros.md §14.1)
// ---------------------------------------------------------------------------

test("automotora sin cambios: las rutas de la agenda de clínica dan 403 con motivo RUBRO", async () => {
  const r = await pedir(automotora, "GET", "/api/clinica/prestaciones");
  assert.equal(r.status, 403);
  assert.equal(r.json.error?.code, "MODULO_NO_INCLUIDO");
  assert.equal(r.json.error?.modulo, "agenda_clinica");
  assert.equal(r.json.error?.motivo, "RUBRO");
});

test("automotora sin cambios: un recurso que no provee el servicio sigue dando el mismo 400 en /availability y en /bookings", async () => {
  const sucursal = await createBranch(automotora.id, { name: "Centro", timezone: TZ });
  const vendedor = await createResource(automotora.id, {
    branchId: sucursal.id,
    name: "Vendedor",
    type: "PERSON",
  });
  const otro = await createResource(automotora.id, {
    branchId: sucursal.id,
    name: "Otro vendedor",
    type: "PERSON",
  });
  for (const r of [vendedor, otro]) {
    await replaceWorkingHoursForResource(automotora.id, r.id, LUNES_9_A_13);
  }
  const testDrive = await createServiceType(automotora.id, {
    branchId: sucursal.id,
    resourceId: vendedor.id,
    name: "Test drive",
    durationMin: 60,
  });
  const contacto = await prisma.contact.create({
    data: { organizationId: automotora.id, firstName: "Ana", lastName: "Pérez" },
  });

  const conElSuyo = await pedir(
    automotora,
    "GET",
    `/api/availability?resourceId=${vendedor.id}&serviceTypeId=${testDrive.id}&from=${A_LAS(9)}&to=${A_LAS(13)}`,
  );
  assert.equal(conElSuyo.status, 200);
  assert.equal((conElSuyo.json.availability as unknown[]).length, 4);

  const conOtro = await pedir(
    automotora,
    "GET",
    `/api/availability?resourceId=${otro.id}&serviceTypeId=${testDrive.id}&from=${A_LAS(9)}&to=${A_LAS(13)}`,
  );
  assert.equal(conOtro.status, 400);
  assert.equal(conOtro.json.error?.message, "El servicio indicado no lo provee ese recurso");

  const reserva = await pedir(automotora, "POST", "/api/bookings", {
    resourceId: otro.id,
    serviceTypeId: testDrive.id,
    contactId: contacto.id,
    startsAt: A_LAS(9),
  });
  assert.equal(reserva.status, 400);
  assert.equal(reserva.json.error?.message, "El servicio indicado no lo provee ese recurso");
  assert.equal(
    await prisma.serviceTypeResource.count({ where: { organizationId: automotora.id } }),
    0,
  );
});
