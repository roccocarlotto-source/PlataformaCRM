import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { createBranch } from "../services/branch.service";
import { activarModulo } from "../services/organizationModules.service";
import { findOrderById, findOrderByIdConPrisma } from "./repositories/serviceOrder.repository";
import { TURNO_CON_ORDEN } from "./services/ordenes.service";

// ---------------------------------------------------------------------------
// S4b de docs/servicios.md (§4.4): el turno de la agenda y la orden.
//
//   - Crear la orden desde un turno: queda Agendada para su horario.
//   - Solo un turno de la organización, CONFIRMED, del mismo cliente y sin
//     otra orden abierta (también con dos altas a la vez).
//   - Vincular y desvincular desde la ficha.
//   - Sin sincronización: cancelar el turno no toca la orden (la ficha lo
//     muestra), y cancelar la orden no toca el turno.
// ---------------------------------------------------------------------------

let taller: OrgDePrueba;
let otra: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);
const ORDENES = "/api/servicios/ordenes";

interface Agenda {
  sucursal: string;
  recurso: string;
  servicio: string;
}
let agenda: Agenda;
let agendaDeOtra: Agenda;
let duena: string;
let otroCliente: string;

async function armarAgenda(org: OrgDePrueba): Promise<Agenda> {
  const sucursal = (
    await createBranch(org.id, { name: "Taller Centro", timezone: "America/Montevideo" })
  ).id;
  const recurso = (
    await prisma.resource.create({
      data: { organizationId: org.id, branchId: sucursal, name: "Elevador 1", type: "ROOM" },
    })
  ).id;
  const servicio = (
    await prisma.serviceType.create({
      data: {
        organizationId: org.id,
        branchId: sucursal,
        resourceId: recurso,
        name: "Service",
        durationMin: 60,
      },
    })
  ).id;
  return { sucursal, recurso, servicio };
}

/** Un turno CONFIRMED dentro de `dias` días, a las 13:00 UTC. */
async function turno(
  org: OrgDePrueba,
  a: Agenda,
  contactId: string,
  dias = 3,
  status: "CONFIRMED" | "CANCELLED" = "CONFIRMED",
) {
  const startsAt = new Date(Date.UTC(2030, 0, 1 + dias, 13));
  return prisma.booking.create({
    data: {
      organizationId: org.id,
      branchId: a.sucursal,
      serviceTypeId: a.servicio,
      resourceId: a.recurso,
      contactId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      status,
    },
  });
}

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
  taller = await crearOrgDePrueba("servicios-ordenes", "COMPLETA", "AUTOMOTORA", 1);
  otra = await crearOrgDePrueba("servicios-ordenes", "COMPLETA", "AUTOMOTORA", 1);
  for (const org of [taller, otra]) await activarModulo(org.id, "servicios", org.authIds[0]);
  agenda = await armarAgenda(taller);
  agendaDeOtra = await armarAgenda(otra);
  duena = (
    await prisma.contact.create({
      data: { organizationId: taller.id, firstName: "Duena", lastName: "Turno" },
    })
  ).id;
  otroCliente = (
    await prisma.contact.create({
      data: { organizationId: taller.id, firstName: "Otro", lastName: "Cliente" },
    })
  ).id;
});

after(async () => {
  if (cerrar) await cerrar();
  for (const org of [taller, otra]) if (org) await borrarOrgDePrueba(org);
});

function admin(metodo: string, path: string, body?: unknown) {
  return pedir(taller, metodo, path, body, taller.tokens[0]);
}

test("crear la orden desde un turno: Agendada para su horario, con el turno en la ficha", async () => {
  const t = await turno(taller, agenda, duena);
  const r = await admin("POST", ORDENES, {
    customerVehicleId: await vehiculoDe(duena),
    estado: "AGENDADO",
    bookingId: t.id,
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.status, "AGENDADO");
  assert.equal(r.json.bookingId, t.id);
  assert.equal(r.json.scheduledFor, t.startsAt.toISOString());
  assert.deepEqual(r.json.turno, {
    id: t.id,
    startsAt: t.startsAt.toISOString(),
    endsAt: t.endsAt.toISOString(),
    status: "CONFIRMED",
    servicio: "Service",
    recurso: "Elevador 1",
  });

  // La ficha en una consulta (SQL) es la misma que la de Prisma, con turno.
  await fichaIgualAPrisma(r.json.id as string);

  // El detalle del turno en la agenda la encuentra por bookingId.
  const lista = await admin("GET", `${ORDENES}?bookingId=${t.id}`);
  assert.equal(lista.status, 200);
  assert.deepEqual(
    (lista.json.data as { id: string }[]).map((o) => o.id),
    [r.json.id],
  );
});

test("el turno tiene que ser de la organización, estar confirmado, ser del cliente y estar libre", async () => {
  const v = await vehiculoDe(duena);
  const ajeno = await turno(otra, agendaDeOtra, (await contactoDe(otra)).id);
  assert.equal((await agendadaComo(v, ajeno.id)).status, 404);

  const cancelado = await turno(taller, agenda, duena, 4, "CANCELLED");
  assert.equal((await agendadaComo(v, cancelado.id)).status, 409);

  const deOtro = await turno(taller, agenda, otroCliente, 5);
  assert.equal((await agendadaComo(v, deOtro.id)).status, 400);

  const t = await turno(taller, agenda, duena, 6);
  const primera = await agendadaComo(v, t.id);
  assert.equal(primera.status, 201, JSON.stringify(primera.json));
  const segunda = await agendadaComo(await vehiculoDe(duena), t.id);
  assert.equal(segunda.status, 409);
  const error = (segunda.json as { error: Record<string, unknown> }).error;
  assert.equal(error.code, TURNO_CON_ORDEN);
  assert.equal(error.ordenId, primera.json.id);

  // Cancelada la orden, el turno queda libre otra vez.
  const cancelar = await admin("POST", `${ORDENES}/${primera.json.id}/estado`, {
    desde: "AGENDADO",
    hacia: "CANCELADO",
    cancelReason: "Se equivocó de día",
  });
  assert.equal(cancelar.status, 200);
  assert.equal((await agendadaComo(await vehiculoDe(duena), t.id)).status, 201);
});

test("dos altas a la vez con el mismo turno: una sola orden", async () => {
  const t = await turno(taller, agenda, duena, 7);
  const [a, b] = await Promise.all([vehiculoDe(duena), vehiculoDe(duena)]);
  const respuestas = await Promise.all([agendadaComo(a, t.id), agendadaComo(b, t.id)]);
  assert.deepEqual(respuestas.map((r) => r.status).sort(), [201, 409]);
  assert.equal(await prisma.serviceOrder.count({ where: { bookingId: t.id } }), 1);
});

test("vincular y desvincular desde la ficha; los turnos que se ofrecen", async () => {
  const futuro = await turno(taller, agenda, duena, 8);
  await turno(taller, agenda, duena, 9, "CANCELLED");
  await turno(taller, agenda, otroCliente, 10);
  const r = await admin("POST", ORDENES, {
    customerVehicleId: await vehiculoDe(duena),
    estado: "AGENDADO",
    scheduledFor: "2030-03-01T12:00:00.000Z",
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const id = r.json.id as string;

  // Solo los CONFIRMED futuros del cliente.
  const ofrecidos = await admin("GET", `/api/servicios/turnos?contactId=${duena}`);
  assert.equal(ofrecidos.status, 200);
  const ids = (ofrecidos.json as unknown as { id: string; servicio: string }[]).map((x) => x.id);
  assert.ok(ids.includes(futuro.id));
  for (const x of ofrecidos.json as unknown as { servicio: string; recurso: string }[]) {
    assert.equal(x.servicio, "Service");
    assert.equal(x.recurso, "Elevador 1");
  }
  const todos = await prisma.booking.findMany({ where: { id: { in: ids } } });
  assert.ok(todos.every((x) => x.status === "CONFIRMED" && x.contactId === duena));

  const vinculada = await admin("PATCH", `${ORDENES}/${id}`, { bookingId: futuro.id });
  assert.equal(vinculada.status, 200, JSON.stringify(vinculada.json));
  assert.equal(vinculada.json.scheduledFor, futuro.startsAt.toISOString());
  assert.equal((vinculada.json.turno as { id: string }).id, futuro.id);

  const desvinculada = await admin("PATCH", `${ORDENES}/${id}`, { bookingId: null });
  assert.equal(desvinculada.status, 200);
  assert.equal(desvinculada.json.bookingId, null);
  assert.equal(desvinculada.json.turno, null);
  assert.equal(
    desvinculada.json.scheduledFor,
    futuro.startsAt.toISOString(),
    "desvincular no cambia la fecha",
  );
});

test("cancelar el turno no toca la orden: la ficha muestra el turno cancelado", async () => {
  const t = await turno(taller, agenda, duena, 11);
  const r = await agendadaComo(await vehiculoDe(duena), t.id);
  assert.equal(r.status, 201);
  const cancelar = await admin("PATCH", `/api/bookings/${t.id}/cancel`);
  assert.equal(cancelar.status, 200, JSON.stringify(cancelar.json));

  const ficha = await admin("GET", `${ORDENES}/${r.json.id}`);
  assert.equal(ficha.json.status, "AGENDADO", "la orden no se entera sola (§4.4)");
  assert.equal(ficha.json.scheduledFor, t.startsAt.toISOString());
  assert.equal((ficha.json.turno as { status: string }).status, "CANCELLED");
  await fichaIgualAPrisma(r.json.id as string);

  // Con el turno cancelado se puede vincular otro.
  const otro = await turno(taller, agenda, duena, 12);
  const vinculada = await admin("PATCH", `${ORDENES}/${r.json.id}`, { bookingId: otro.id });
  assert.equal(vinculada.status, 200);
  assert.equal((vinculada.json.turno as { status: string }).status, "CONFIRMED");
});

test("cancelar la orden no toca el turno: sigue confirmado en la agenda", async () => {
  const t = await turno(taller, agenda, duena, 13);
  const r = await agendadaComo(await vehiculoDe(duena), t.id);
  assert.equal(r.status, 201);
  const cancelar = await admin("POST", `${ORDENES}/${r.json.id}/estado`, {
    desde: "AGENDADO",
    hacia: "CANCELADO",
    cancelReason: "El cliente avisó que no viene",
  });
  assert.equal(cancelar.status, 200);
  const enLaAgenda = await prisma.booking.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(enLaAgenda.status, "CONFIRMED");
});

// --- ayudas que dependen de `taller` ya creado ------------------------------

async function vehiculoDe(contactId: string) {
  const r = await admin("POST", "/api/servicios/vehiculos", {
    contactId,
    make: "Toyota",
    model: "Hilux",
    branchId: agenda.sucursal,
    licensePlate: `TUR${randomUUID().slice(0, 6)}`,
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return (r.json as { id: string }).id;
}

function agendadaComo(customerVehicleId: string, bookingId: string) {
  return admin("POST", ORDENES, { customerVehicleId, estado: "AGENDADO", bookingId });
}

async function contactoDe(org: OrgDePrueba) {
  return prisma.contact.create({
    data: { organizationId: org.id, firstName: "Ajeno", lastName: "Turno" },
  });
}

async function fichaIgualAPrisma(id: string) {
  const [cruda, conPrisma] = await Promise.all([
    findOrderById(taller.id, id),
    findOrderByIdConPrisma(taller.id, id),
  ]);
  assert.ok(conPrisma?.booking, "la orden tiene turno");
  assert.deepStrictEqual(cruda, conPrisma);
}
