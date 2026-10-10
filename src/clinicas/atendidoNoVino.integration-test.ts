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
import { crearRegistroDeHandlers } from "../services/outboxHandlers";
import { createResource } from "../services/resource.service";
import { createServiceType } from "../services/serviceType.service";
import { replaceWorkingHoursForResource } from "../services/workingHours.service";
import {
  PREFIJO_NOTA_CIERRE_AUTOMATICO,
  PREFIJO_NOTA_CORRECCION,
  cerrarTurnosVencidos,
} from "./services/atendido.service";
import { EVENTOS_DE_TURNO, registrarEventosDeTurno } from "./services/eventosDeTurno";

// ---------------------------------------------------------------------------
// Atendido, no vino, eventos del turno y cierre automático (docs/rubros.md
// §4.8, D6, R10), contra la app real y Postgres.
//
// Clínica con dos sedes: Centro (Ana, "Consulta" de 60 min, lunes de 9 a 13) y
// Norte. Un ADMIN, una Recepción de Centro y una de Norte. "Ahora" es el lunes
// 1/3/2027 a las 12:00 de Buenos Aires (15:00Z).
// ---------------------------------------------------------------------------

const TZ = "America/Argentina/Buenos_Aires";
const LUNES = (hora: number) =>
  new Date(`2027-03-01T${String(hora + 3).padStart(2, "0")}:00:00.000Z`);
const AHORA = LUNES(12);
const LUNES_9_A_13 = [{ weekday: "MONDAY" as const, startMinute: 540, endMinute: 780 }];

const ADMIN = 0;
const RECEPCION_CENTRO = 1;
const RECEPCION_NORTE = 2;

let clinica: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);
const ids = {} as { centro: string; ana: string; consulta: string; contactId: string };
const como = (persona: number) => clinica.tokens[persona];

before(async () => {
  mock.method(relojDeReservas, "ahora", () => AHORA);
  ({ baseUrl, cerrar } = await levantarApp());
  clinica = await crearOrgDePrueba("atendido-no-vino", "COMPLETA", "CLINICA", 3);
  const centro = await createBranch(clinica.id, { name: "Centro", timezone: TZ }, "CLINICA");
  const norte = await createBranch(clinica.id, { name: "Norte", timezone: TZ }, "CLINICA");
  const ana = await createResource(clinica.id, {
    branchId: centro.id,
    name: "Ana",
    type: "PERSON",
  });
  await replaceWorkingHoursForResource(clinica.id, ana.id, LUNES_9_A_13);
  const consulta = await createServiceType(clinica.id, {
    branchId: centro.id,
    resourceId: ana.id,
    name: "Consulta",
    durationMin: 60,
  });
  const contacto = await prisma.contact.create({
    data: { organizationId: clinica.id, firstName: "Paciente", lastName: "Ejemplo" },
  });
  Object.assign(ids, {
    centro: centro.id,
    ana: ana.id,
    consulta: consulta.id,
    contactId: contacto.id,
  });
  const recepcion = await findRoleByName("RECEPCION");
  if (!recepcion) throw new Error("Falta el rol RECEPCION");
  const sedes: [number, string][] = [
    [RECEPCION_CENTRO, centro.id],
    [RECEPCION_NORTE, norte.id],
  ];
  for (const [persona, branchId] of sedes) {
    const userId = clinica.authIds[persona];
    await prisma.user.update({ where: { id: userId }, data: { roleId: recepcion.id } });
    await prisma.userBranch.create({ data: { organizationId: clinica.id, userId, branchId } });
  }
});

after(async () => {
  mock.restoreAll();
  if (cerrar) await cerrar();
  if (!clinica) return;
  const where = { organizationId: clinica.id };
  await prisma.activity.deleteMany({ where });
  await prisma.outboxEvent.deleteMany({ where });
  await prisma.booking.deleteMany({ where });
  await prisma.userBranch.deleteMany({ where });
  await prisma.serviceType.deleteMany({ where });
  await prisma.workingHours.deleteMany({ where });
  await prisma.resource.deleteMany({ where });
  await prisma.clinicBranchSettings.deleteMany({ where });
  await borrarOrgDePrueba(clinica);
});

async function limpiar() {
  const where = { organizationId: clinica.id };
  await prisma.activity.deleteMany({ where });
  await prisma.outboxEvent.deleteMany({ where });
  await prisma.booking.deleteMany({ where });
}

async function turno(
  hora: number,
  status: "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW" = "CONFIRMED",
) {
  return prisma.booking.create({
    data: {
      organizationId: clinica.id,
      branchId: ids.centro,
      serviceTypeId: ids.consulta,
      resourceId: ids.ana,
      contactId: ids.contactId,
      startsAt: LUNES(hora),
      endsAt: LUNES(hora + 1),
      status,
      ...(status === "COMPLETED" || status === "NO_SHOW"
        ? { completedAt: LUNES(hora + 1), completedBy: "PERSONA" as const }
        : {}),
    },
  });
}

const eventos = (eventType?: string) =>
  prisma.outboxEvent.findMany({
    where: { organizationId: clinica.id, ...(eventType ? { eventType } : {}) },
    orderBy: { createdAt: "asc" },
  });

const marcar = (persona: number, id: string, que: "attended" | "no-show", body: unknown = {}) =>
  pedir(clinica, "PATCH", `/api/bookings/${id}/${que}`, body, como(persona));

// ---------------------------------------------------------------------------
// Marcar
// ---------------------------------------------------------------------------

test("Recepción marca atendido un turno de su sede que ya empezó: nota, evento y marcar otra vez no repite nada", async () => {
  await limpiar();
  const t = await turno(9);
  const r = await marcar(RECEPCION_CENTRO, t.id, "attended", { nota: "Llegó puntual" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, "COMPLETED");
  assert.equal(r.json.completedBy, "PERSONA");

  const notas = await prisma.activity.findMany({
    where: { organizationId: clinica.id, type: "NOTE" },
  });
  assert.equal(notas.length, 1);
  assert.match(notas[0].body ?? "", /Atendido: .*Marcó: .*Nota: Llegó puntual/);
  assert.equal(notas[0].authorId, clinica.authIds[RECEPCION_CENTRO]);

  const [evento] = await eventos("booking.completed");
  assert.ok(evento);
  const payload = evento.payload as Record<string, unknown>;
  assert.equal(payload.bookingId, t.id);
  assert.equal(payload.esCorreccion, false);
  assert.equal(payload.automatico, false);
  assert.ok(typeof payload.eventoId === "string");

  // Idempotente: marcar lo mismo otra vez no deja otra nota ni otro evento.
  const otraVez = await marcar(RECEPCION_CENTRO, t.id, "attended");
  assert.equal(otraVez.status, 200);
  assert.equal((await eventos()).length, 1);
  assert.equal(await prisma.activity.count({ where: { organizationId: clinica.id } }), 1);
});

test("la corrección en los dos sentidos queda registrada y emite el evento del estado nuevo marcado como corrección", async () => {
  await limpiar();
  const t = await turno(9);
  await marcar(ADMIN, t.id, "attended");
  const aNoVino = await marcar(RECEPCION_CENTRO, t.id, "no-show");
  assert.equal(aNoVino.status, 200, JSON.stringify(aNoVino.json));
  assert.equal(aNoVino.json.status, "NO_SHOW");
  const deVuelta = await marcar(RECEPCION_CENTRO, t.id, "attended");
  assert.equal(deVuelta.json.status, "COMPLETED");

  const correcciones = await prisma.activity.findMany({
    where: { organizationId: clinica.id, subject: { startsWith: PREFIJO_NOTA_CORRECCION } },
    orderBy: { createdAt: "asc" },
  });
  assert.deepEqual(
    correcciones.map((c) => c.subject),
    ["Corrección del turno: de Atendido a No vino", "Corrección del turno: de No vino a Atendido"],
  );
  const todos = await eventos();
  assert.deepEqual(
    todos.map((e) => [e.eventType, (e.payload as { esCorreccion: boolean }).esCorreccion]),
    [
      ["booking.completed", false],
      ["booking.no_show", true],
      ["booking.completed", true],
    ],
  );
  assert.equal((todos[1].payload as { estadoAnterior: string }).estadoAnterior, "COMPLETED");
});

test("otra sede da 404; un turno futuro o cancelado se rechaza; una nota larga da 400", async () => {
  await limpiar();
  const pasado = await turno(9);
  assert.equal((await marcar(RECEPCION_NORTE, pasado.id, "attended")).status, 404);
  const futuro = await turno(13);
  assert.equal((await marcar(RECEPCION_CENTRO, futuro.id, "no-show")).status, 400);
  const cancelado = await turno(10, "CANCELLED");
  assert.equal((await marcar(RECEPCION_CENTRO, cancelado.id, "attended")).status, 409);
  const larga = await marcar(RECEPCION_CENTRO, pasado.id, "attended", { nota: "x".repeat(201) });
  assert.equal(larga.status, 400);
  assert.equal((await eventos()).length, 0);
  assert.equal(
    (await prisma.booking.findUniqueOrThrow({ where: { id: pasado.id } })).status,
    "CONFIRMED",
  );
});

// ---------------------------------------------------------------------------
// Eventos de agendar, cancelar y reprogramar (los servicios únicos de turnos)
// ---------------------------------------------------------------------------

test("agendar, reprogramar y cancelar en una clínica emiten un evento cada uno", async () => {
  await limpiar();
  const creado = await pedir(
    clinica,
    "POST",
    "/api/clinica/turnos",
    {
      serviceTypeId: ids.consulta,
      contactId: ids.contactId,
      resourceId: ids.ana,
      startsAt: new Date("2027-03-08T12:00:00.000Z").toISOString(),
    },
    como(RECEPCION_CENTRO),
  );
  assert.equal(creado.status, 201, JSON.stringify(creado.json));
  const id = creado.json.id as string;
  const reprogramado = await pedir(
    clinica,
    "PATCH",
    `/api/bookings/${id}/reschedule`,
    { startsAt: new Date("2027-03-08T14:00:00.000Z").toISOString() },
    como(RECEPCION_CENTRO),
  );
  assert.equal(reprogramado.status, 200, JSON.stringify(reprogramado.json));
  const cancelado = await pedir(
    clinica,
    "PATCH",
    `/api/bookings/${id}/cancel`,
    {},
    como(RECEPCION_CENTRO),
  );
  assert.equal(cancelado.status, 200, JSON.stringify(cancelado.json));

  const todos = await eventos();
  assert.deepEqual(
    todos.map((e) => e.eventType),
    ["booking.created", "booking.rescheduled", "booking.cancelled"],
  );
  assert.ok(todos.every((e) => (e.payload as { bookingId: string }).bookingId === id));
  const ids_ = new Set(todos.map((e) => (e.payload as { eventoId: string }).eventoId));
  assert.equal(ids_.size, 3, "cada evento con su id");
  assert.equal(
    (todos[1].payload as { anterior: { startsAt: string } }).anterior.startsAt,
    "2027-03-08T12:00:00.000Z",
  );
});

test("los eventos de turno tienen un handler que los consume (no van a DEAD_LETTER)", () => {
  const handlers = crearRegistroDeHandlers();
  registrarEventosDeTurno(handlers);
  assert.deepEqual(handlers.tiposRegistrados().sort(), [...EVENTOS_DE_TURNO].sort());
});

// ---------------------------------------------------------------------------
// Cierre automático (D6)
// ---------------------------------------------------------------------------

test("cierre automático: cierra lo que terminó hace más de 3 h, una sola vez, y no toca lo demás", async () => {
  await limpiar();
  // A las 12:00: terminó a las 9:00 (3 h) → no; terminó a las 8:00 → sí.
  const viejo = await turno(7);
  const justo = await turno(8);
  const reciente = await turno(10);
  const cancelado = await turno(6, "CANCELLED");
  const yaNoVino = await turno(5, "NO_SHOW");

  const primera = await cerrarTurnosVencidos({ organizationId: clinica.id });
  assert.equal(primera.cerrados, 1);
  const segunda = await cerrarTurnosVencidos({ organizationId: clinica.id });
  assert.equal(segunda.cerrados, 0, "idempotente");

  const estado = async (id: string) =>
    (await prisma.booking.findUniqueOrThrow({ where: { id } })).status;
  assert.equal(await estado(viejo.id), "COMPLETED");
  assert.equal(await estado(justo.id), "CONFIRMED", "exactamente 3 h: todavía no");
  assert.equal(await estado(reciente.id), "CONFIRMED");
  assert.equal(await estado(cancelado.id), "CANCELLED");
  assert.equal(await estado(yaNoVino.id), "NO_SHOW");

  const cerrado = await prisma.booking.findUniqueOrThrow({ where: { id: viejo.id } });
  assert.equal(cerrado.completedBy, "AUTO");
  const ev = await eventos("booking.completed");
  assert.equal(ev.length, 1);
  assert.equal((ev[0].payload as { automatico: boolean }).automatico, true);
  assert.equal(
    await prisma.activity.count({
      where: {
        organizationId: clinica.id,
        subject: { startsWith: PREFIJO_NOTA_CIERRE_AUTOMATICO },
      },
    }),
    1,
  );

  // Recepción corrige después a No vino: es una corrección.
  const corregido = await marcar(RECEPCION_CENTRO, viejo.id, "no-show");
  assert.equal(corregido.json.status, "NO_SHOW");
  const [noVino] = await eventos("booking.no_show");
  assert.equal((noVino.payload as { esCorreccion: boolean }).esCorreccion, true);
});
