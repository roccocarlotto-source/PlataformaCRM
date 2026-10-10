import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import { prisma } from "../lib/prisma";
import { findRoleByName } from "../repositories/role.repository";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { relojDeReservas } from "../services/booking.service";
import { createBranch } from "../services/branch.service";
import { createResource } from "../services/resource.service";
import { createServiceType } from "../services/serviceType.service";
import { replaceWorkingHoursForResource } from "../services/workingHours.service";
import { PREFIJO_TAREA_DE_BLOQUEO } from "./services/bloqueos.service";

// ---------------------------------------------------------------------------
// Bloqueos y sobreturnos de un profesional de clínica contra la app real
// (docs/rubros.md §4.4, §4.5, R6).
//
// Una clínica con dos sedes. En Centro está Ana, que atiende los lunes de 9 a
// 13 la "Consulta" (60 min, capacidad 1); en Norte, Carla. Personas: un ADMIN,
// una Recepción de Centro y una de Norte. Y otra clínica, para el aislamiento.
// Lunes 1/3/2027 en Buenos Aires, con el reloj de reservas fijado el día antes.
// ---------------------------------------------------------------------------

const TZ = "America/Argentina/Buenos_Aires";
// 9:00 en Buenos Aires = 12:00Z.
const LUNES = (hora: number, dia = "2027-03-01") =>
  `${dia}T${String(hora + 3).padStart(2, "0")}:00:00.000Z`;
const OTRO_LUNES = "2027-03-08";
const AHORA_FIJO = new Date("2027-02-28T12:00:00Z");
const LUNES_9_A_13 = [{ weekday: "MONDAY" as const, startMinute: 540, endMinute: 780 }];

const ADMIN = 0;
const RECEPCION_CENTRO = 1;
const RECEPCION_NORTE = 2;

let clinica: OrgDePrueba;
let otraClinica: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);

interface Agenda {
  centro: string;
  norte: string;
  ana: string;
  carla: string;
  consulta: string;
  contactId: string;
}
let agenda: Agenda;
let ajena: Agenda;

const como = (org: OrgDePrueba, persona: number) => org.tokens[persona];

async function montarAgenda(organizationId: string): Promise<Agenda> {
  const centro = await createBranch(organizationId, { name: "Centro", timezone: TZ }, "CLINICA");
  const norte = await createBranch(organizationId, { name: "Norte", timezone: TZ }, "CLINICA");
  const ana = await createResource(organizationId, {
    branchId: centro.id,
    name: "Ana Profesional",
    type: "PERSON",
  });
  const carla = await createResource(organizationId, {
    branchId: norte.id,
    name: "Carla Profesional",
    type: "PERSON",
  });
  for (const r of [ana, carla]) {
    await replaceWorkingHoursForResource(organizationId, r.id, LUNES_9_A_13);
  }
  const consulta = await createServiceType(organizationId, {
    branchId: centro.id,
    resourceId: ana.id,
    name: "Consulta",
    durationMin: 60,
  });
  const contacto = await prisma.contact.create({
    data: { organizationId, firstName: "Paciente", lastName: "Ejemplo" },
  });
  return {
    centro: centro.id,
    norte: norte.id,
    ana: ana.id,
    carla: carla.id,
    consulta: consulta.id,
    contactId: contacto.id,
  };
}

async function limpiarTurnosYBloqueos() {
  const where = { organizationId: clinica.id };
  await prisma.activity.deleteMany({ where });
  await prisma.booking.deleteMany({ where });
  await prisma.resourceTimeOff.deleteMany({ where });
  await prisma.resource.updateMany({
    where,
    data: { allowsOverbooking: false, maxOverbookingsPerDay: 1 },
  });
}

/** Los inicios (en horas de Buenos Aires) que ofrece la disponibilidad de la
 *  Consulta con Ana ese lunes. */
async function horasLibres(
  persona: number,
  opciones: { sobreturnos?: boolean; dia?: string } = {},
): Promise<{ libres: number[]; sobreturnos: number[] }> {
  const dia = opciones.dia ?? "2027-03-01";
  const r = await pedir(
    clinica,
    "GET",
    `/api/clinica/disponibilidad?serviceTypeId=${agenda.consulta}&resourceId=${agenda.ana}` +
      `&from=${LUNES(0, dia)}&to=${LUNES(20, dia)}` +
      (opciones.sobreturnos ? "&sobreturnos=true" : ""),
    undefined,
    como(clinica, persona),
  );
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const filas = r.json.availability as { startsAt: string; overbooking?: boolean }[];
  const hora = (iso: string) => new Date(iso).getUTCHours() - 3;
  return {
    libres: filas.filter((f) => !f.overbooking).map((f) => hora(f.startsAt)),
    sobreturnos: filas.filter((f) => f.overbooking).map((f) => hora(f.startsAt)),
  };
}

async function turno(
  persona: number,
  hora: number,
  extra: { isOverbooking?: boolean; dia?: string } = {},
) {
  return pedir(
    clinica,
    "POST",
    "/api/clinica/turnos",
    {
      serviceTypeId: agenda.consulta,
      contactId: agenda.contactId,
      resourceId: agenda.ana,
      startsAt: LUNES(hora, extra.dia),
      ...(extra.isOverbooking ? { isOverbooking: true } : {}),
    },
    como(clinica, persona),
  );
}

async function sobreturnosDeAna(allowsOverbooking: boolean, maxOverbookingsPerDay: number) {
  const r = await pedir(
    clinica,
    "PUT",
    `/api/clinica/profesionales/${agenda.ana}/sobreturnos`,
    { allowsOverbooking, maxOverbookingsPerDay },
    como(clinica, ADMIN),
  );
  assert.equal(r.status, 200, JSON.stringify(r.json));
}

before(async () => {
  mock.method(relojDeReservas, "ahora", () => AHORA_FIJO);
  ({ baseUrl, cerrar } = await levantarApp());
  clinica = await crearOrgDePrueba("bloqueos-sobreturnos", "COMPLETA", "CLINICA", 3);
  otraClinica = await crearOrgDePrueba("bloqueos-sobreturnos", "COMPLETA", "CLINICA", 1);
  agenda = await montarAgenda(clinica.id);
  ajena = await montarAgenda(otraClinica.id);
  const recepcion = await findRoleByName("RECEPCION");
  if (!recepcion) throw new Error("Falta el rol RECEPCION");
  const sedes: [number, string][] = [
    [RECEPCION_CENTRO, agenda.centro],
    [RECEPCION_NORTE, agenda.norte],
  ];
  for (const [persona, branchId] of sedes) {
    const userId = clinica.authIds[persona];
    await prisma.user.update({ where: { id: userId }, data: { roleId: recepcion.id } });
    await prisma.userBranch.create({
      data: { organizationId: clinica.id, userId, branchId },
    });
  }
});

after(async () => {
  mock.restoreAll();
  if (cerrar) await cerrar();
  for (const org of [clinica, otraClinica]) {
    if (!org) continue;
    const where = { organizationId: org.id };
    await prisma.activity.deleteMany({ where });
    await prisma.booking.deleteMany({ where });
    await prisma.resourceTimeOff.deleteMany({ where });
    await prisma.userBranch.deleteMany({ where });
    await prisma.serviceTypeResource.deleteMany({ where });
    await prisma.serviceType.deleteMany({ where });
    await prisma.workingHours.deleteMany({ where });
    await prisma.resource.deleteMany({ where });
    await prisma.clinicBranchSettings.deleteMany({ where });
    await borrarOrgDePrueba(org);
  }
});

// ---------------------------------------------------------------------------
// Bloqueos
// ---------------------------------------------------------------------------

test("un bloqueo quita sus horarios de la disponibilidad (clínica y genérica) y de la reserva", async () => {
  await limpiarTurnosYBloqueos();
  assert.deepEqual((await horasLibres(RECEPCION_CENTRO)).libres, [9, 10, 11, 12]);

  const creado = await pedir(
    clinica,
    "POST",
    `/api/clinica/profesionales/${agenda.ana}/bloqueos`,
    { startsAt: LUNES(10), endsAt: LUNES(12), reason: "Reunión" },
    como(clinica, RECEPCION_CENTRO),
  );
  assert.equal(creado.status, 201, JSON.stringify(creado.json));
  assert.deepEqual(creado.json.turnosAfectados, []);

  assert.deepEqual((await horasLibres(RECEPCION_CENTRO)).libres, [9, 12]);
  const generica = await pedir(
    clinica,
    "GET",
    `/api/availability?resourceId=${agenda.ana}&serviceTypeId=${agenda.consulta}&from=${LUNES(0)}&to=${LUNES(20)}`,
    undefined,
    como(clinica, ADMIN),
  );
  assert.equal((generica.json.availability as unknown[]).length, 2);

  const enElBloqueo = await turno(RECEPCION_CENTRO, 10);
  assert.equal(enElBloqueo.status, 409, JSON.stringify(enElBloqueo.json));

  const lista = await pedir(
    clinica,
    "GET",
    `/api/clinica/profesionales/${agenda.ana}/bloqueos?from=${LUNES(0)}&to=${LUNES(20)}`,
    undefined,
    como(clinica, RECEPCION_CENTRO),
  );
  assert.equal(lista.status, 200);
  assert.equal((lista.json.bloqueos as unknown[]).length, 1);

  const bloqueoId = (creado.json.bloqueo as { id: string }).id;
  const borrado = await pedir(
    clinica,
    "DELETE",
    `/api/clinica/bloqueos/${bloqueoId}`,
    undefined,
    como(clinica, RECEPCION_CENTRO),
  );
  assert.equal(borrado.status, 204);
  assert.deepEqual((await horasLibres(RECEPCION_CENTRO)).libres, [9, 10, 11, 12]);
});

test("un bloqueo encima de turnos ya dados no los cancela: los lista y crea una tarea por turno para la Recepción de la sede", async () => {
  await limpiarTurnosYBloqueos();
  const dado = await turno(RECEPCION_CENTRO, 11);
  assert.equal(dado.status, 201, JSON.stringify(dado.json));

  const creado = await pedir(
    clinica,
    "POST",
    `/api/clinica/profesionales/${agenda.ana}/bloqueos`,
    { startsAt: LUNES(11), endsAt: LUNES(13) },
    como(clinica, ADMIN),
  );
  assert.equal(creado.status, 201, JSON.stringify(creado.json));
  const afectados = creado.json.turnosAfectados as { bookingId: string; tareaId: string }[];
  assert.deepEqual(
    afectados.map((a) => a.bookingId),
    [dado.json.id],
  );

  const reserva = await prisma.booking.findUniqueOrThrow({ where: { id: dado.json.id as string } });
  assert.equal(reserva.status, "CONFIRMED", "el turno sigue en pie");

  const tarea = await prisma.activity.findUniqueOrThrow({ where: { id: afectados[0].tareaId } });
  assert.ok(tarea.subject.startsWith(PREFIJO_TAREA_DE_BLOQUEO));
  assert.equal(tarea.branchId, agenda.centro);
  assert.equal(tarea.contactId, agenda.contactId);
  assert.equal(tarea.assigneeId, clinica.authIds[RECEPCION_CENTRO], "a la Recepción de la sede");

  // La Recepción de la sede la ve; la de otra sede no.
  const deCentro = await pedir(
    clinica,
    "GET",
    `/api/activities/${tarea.id}`,
    undefined,
    como(clinica, RECEPCION_CENTRO),
  );
  assert.equal(deCentro.status, 200);
  const deNorte = await pedir(
    clinica,
    "GET",
    `/api/activities/${tarea.id}`,
    undefined,
    como(clinica, RECEPCION_NORTE),
  );
  assert.equal(deNorte.status, 404);
});

// ---------------------------------------------------------------------------
// Sobreturnos
// ---------------------------------------------------------------------------

test("sobreturno apagado (el default): la disponibilidad y la reserva son las de hoy", async () => {
  await limpiarTurnosYBloqueos();
  assert.equal((await turno(RECEPCION_CENTRO, 9)).status, 201);

  const sin = await horasLibres(RECEPCION_CENTRO);
  const pidiendoSobreturnos = await horasLibres(RECEPCION_CENTRO, { sobreturnos: true });
  assert.deepEqual(sin.libres, [10, 11, 12]);
  assert.deepEqual(pidiendoSobreturnos, { libres: [10, 11, 12], sobreturnos: [] });

  const sobreturno = await turno(RECEPCION_CENTRO, 9, { isOverbooking: true });
  assert.equal(sobreturno.status, 400, JSON.stringify(sobreturno.json));
  const normal = await turno(RECEPCION_CENTRO, 9);
  assert.equal(normal.status, 409, "el horario completo sigue completo");
});

test("sobreturno prendido: se ofrece encima de un horario completo, respeta el tope, cancelar libera y otro día tiene su propio cupo", async () => {
  await limpiarTurnosYBloqueos();
  // El permiso es configuración: Recepción no lo cambia.
  const deRecepcion = await pedir(
    clinica,
    "PUT",
    `/api/clinica/profesionales/${agenda.ana}/sobreturnos`,
    { allowsOverbooking: true, maxOverbookingsPerDay: 1 },
    como(clinica, RECEPCION_CENTRO),
  );
  assert.equal(deRecepcion.status, 403);
  await sobreturnosDeAna(true, 1);

  assert.equal((await turno(RECEPCION_CENTRO, 9)).status, 201);
  // Con lugar, no hay sobreturno: es un turno normal.
  const conLugar = await turno(RECEPCION_CENTRO, 10, { isOverbooking: true });
  assert.equal(conLugar.status, 400, JSON.stringify(conLugar.json));

  const ofrecidos = await horasLibres(RECEPCION_CENTRO, { sobreturnos: true });
  assert.deepEqual(ofrecidos, { libres: [10, 11, 12], sobreturnos: [9] });
  // El agente (sin el parámetro) nunca los ve.
  assert.deepEqual((await horasLibres(RECEPCION_CENTRO)).sobreturnos, []);

  const primero = await turno(RECEPCION_CENTRO, 9, { isOverbooking: true });
  assert.equal(primero.status, 201, JSON.stringify(primero.json));
  assert.equal(primero.json.isOverbooking, true);
  // No le quita lugar a los turnos normales.
  assert.deepEqual((await horasLibres(RECEPCION_CENTRO)).libres, [10, 11, 12]);

  // Tope alcanzado: no se ofrecen más ni se aceptan.
  assert.equal((await turno(RECEPCION_CENTRO, 10)).status, 201);
  assert.deepEqual((await horasLibres(RECEPCION_CENTRO, { sobreturnos: true })).sobreturnos, []);
  const segundo = await turno(RECEPCION_CENTRO, 10, { isOverbooking: true });
  assert.equal(segundo.status, 409, JSON.stringify(segundo.json));

  // Otro día, su propio cupo.
  assert.equal((await turno(RECEPCION_CENTRO, 9, { dia: OTRO_LUNES })).status, 201);
  assert.deepEqual(
    (await horasLibres(RECEPCION_CENTRO, { sobreturnos: true, dia: OTRO_LUNES })).sobreturnos,
    [9],
  );

  // Cancelar el sobreturno libera el cupo del día.
  const cancelado = await pedir(
    clinica,
    "PATCH",
    `/api/bookings/${primero.json.id as string}/cancel`,
    {},
    como(clinica, RECEPCION_CENTRO),
  );
  assert.equal(cancelado.status, 200, JSON.stringify(cancelado.json));
  const deNuevo = await turno(RECEPCION_CENTRO, 10, { isOverbooking: true });
  assert.equal(deNuevo.status, 201, JSON.stringify(deNuevo.json));
});

test("bajar el tope por debajo de los ya cargados no los toca: solo frena los próximos", async () => {
  await limpiarTurnosYBloqueos();
  await sobreturnosDeAna(true, 2);
  for (const hora of [9, 10]) {
    assert.equal((await turno(RECEPCION_CENTRO, hora)).status, 201);
    assert.equal((await turno(RECEPCION_CENTRO, hora, { isOverbooking: true })).status, 201);
  }
  await sobreturnosDeAna(true, 1);
  const cargados = await prisma.booking.count({
    where: { organizationId: clinica.id, isOverbooking: true, status: "CONFIRMED" },
  });
  assert.equal(cargados, 2);
  assert.equal((await turno(RECEPCION_CENTRO, 11)).status, 201);
  assert.equal((await turno(RECEPCION_CENTRO, 11, { isOverbooking: true })).status, 409);
});

test("un sobreturno tampoco entra en un bloqueo", async () => {
  await limpiarTurnosYBloqueos();
  await sobreturnosDeAna(true, 3);
  assert.equal((await turno(RECEPCION_CENTRO, 9)).status, 201);
  const bloqueo = await pedir(
    clinica,
    "POST",
    `/api/clinica/profesionales/${agenda.ana}/bloqueos`,
    { startsAt: LUNES(9), endsAt: LUNES(10) },
    como(clinica, ADMIN),
  );
  assert.equal(bloqueo.status, 201);
  assert.deepEqual((await horasLibres(RECEPCION_CENTRO, { sobreturnos: true })).sobreturnos, []);
  assert.equal((await turno(RECEPCION_CENTRO, 9, { isOverbooking: true })).status, 409);
});

// ---------------------------------------------------------------------------
// Límite por sede y aislamiento
// ---------------------------------------------------------------------------

test("límite por sede: la Recepción de Norte no ve ni toca los bloqueos ni la disponibilidad de Ana (Centro)", async () => {
  await limpiarTurnosYBloqueos();
  const deAna = await pedir(
    clinica,
    "POST",
    `/api/clinica/profesionales/${agenda.ana}/bloqueos`,
    { startsAt: LUNES(9), endsAt: LUNES(10) },
    como(clinica, ADMIN),
  );
  const bloqueoId = (deAna.json.bloqueo as { id: string }).id;
  const norte = como(clinica, RECEPCION_NORTE);
  const pedidos: [string, string, unknown][] = [
    [
      "GET",
      `/api/clinica/profesionales/${agenda.ana}/bloqueos?from=${LUNES(0)}&to=${LUNES(20)}`,
      undefined,
    ],
    [
      "POST",
      `/api/clinica/profesionales/${agenda.ana}/bloqueos`,
      { startsAt: LUNES(11), endsAt: LUNES(12) },
    ],
    ["DELETE", `/api/clinica/bloqueos/${bloqueoId}`, undefined],
  ];
  for (const [metodo, path, body] of pedidos) {
    const r = await pedir(clinica, metodo, path, body, norte);
    assert.equal(r.status, 404, `${metodo} ${path}: ${JSON.stringify(r.json)}`);
  }
  // La disponibilidad genérica: el mismo 400 que un recurso inexistente.
  const generica = await pedir(
    clinica,
    "GET",
    `/api/availability?resourceId=${agenda.ana}&serviceTypeId=${agenda.consulta}&from=${LUNES(0)}&to=${LUNES(20)}`,
    undefined,
    norte,
  );
  assert.equal(generica.status, 400, JSON.stringify(generica.json));
  // Con Carla (su sede) sí.
  const conCarla = await pedir(
    clinica,
    "GET",
    `/api/clinica/profesionales/${agenda.carla}/bloqueos?from=${LUNES(0)}&to=${LUNES(20)}`,
    undefined,
    norte,
  );
  assert.equal(conCarla.status, 200);
  assert.equal(await prisma.resourceTimeOff.count({ where: { id: bloqueoId } }), 1);
});

test("aislamiento: una clínica no ve ni toca los bloqueos ni los sobreturnos de otra", async () => {
  const bloqueoAjeno = await prisma.resourceTimeOff.create({
    data: {
      organizationId: otraClinica.id,
      resourceId: ajena.ana,
      startsAt: new Date(LUNES(9)),
      endsAt: new Date(LUNES(10)),
    },
  });
  const admin = como(clinica, ADMIN);
  const pedidos: [string, string, unknown][] = [
    [
      "GET",
      `/api/clinica/profesionales/${ajena.ana}/bloqueos?from=${LUNES(0)}&to=${LUNES(20)}`,
      undefined,
    ],
    [
      "POST",
      `/api/clinica/profesionales/${ajena.ana}/bloqueos`,
      { startsAt: LUNES(11), endsAt: LUNES(12) },
    ],
    ["DELETE", `/api/clinica/bloqueos/${bloqueoAjeno.id}`, undefined],
    [
      "PUT",
      `/api/clinica/profesionales/${ajena.ana}/sobreturnos`,
      { allowsOverbooking: true, maxOverbookingsPerDay: 5 },
    ],
  ];
  for (const [metodo, path, body] of pedidos) {
    const r = await pedir(clinica, metodo, path, body, admin);
    assert.equal(r.status, 404, `${metodo} ${path}: ${JSON.stringify(r.json)}`);
  }
  assert.equal(await prisma.resourceTimeOff.count({ where: { id: bloqueoAjeno.id } }), 1);
  const anaAjena = await prisma.resource.findUniqueOrThrow({ where: { id: ajena.ana } });
  assert.equal(anaAjena.allowsOverbooking, false);
});
