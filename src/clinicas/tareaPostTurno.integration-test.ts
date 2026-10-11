import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { prisma } from "../lib/prisma";
import { findRoleByName } from "../repositories/role.repository";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { crearRegistroDeAcciones } from "../services/automationActions";
import { registrarAutomatizaciones } from "../services/automationRegistrations";
import { createBranch } from "../services/branch.service";
import { crearRegistroDeHandlers, type RegistroDeHandlers } from "../services/outboxHandlers";
import { createResource } from "../services/resource.service";
import { createServiceType } from "../services/serviceType.service";
import { drenarOutbox } from "../workers/outboxWorker";
import { NOTA_CERRADA_POR_NO_VINO, NOTA_REABIERTA } from "./postTurno/tarea";
import { cerrarTurnosVencidos, marcarTurno } from "./services/atendido.service";
import { registrarEventosDeTurno } from "./services/eventosDeTurno";

// ---------------------------------------------------------------------------
// La tarea después del turno (docs/rubros.md §7.3), contra Postgres: la acción
// activity.create_follow_up colgada de booking.completed en una clínica.
//
// - Atendido crea UNA tarea para la recepción de la sede del turno, con el
//   paciente, la sede, el turno y la regla de origen, y vence a N días desde
//   que se marcó atendido. Una reentrega del evento no duplica.
// - "No vino" (corrección) la cierra con una nota; volver a "Atendido" la
//   reabre (el índice único no deja crear otra).
// - Cierre automático: vence a N días desde el cierre.
// - Límite por sede: un turno de otra sede va a la recepción de esa sede.
// - Aislamiento: no toca otra organización, y la FK compuesta no deja apuntar
//   a un turno ajeno.
// ---------------------------------------------------------------------------

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const TZ = "America/Montevideo";
const ASUNTO = "Llamar para ver cómo siguió";

interface Clinica {
  org: OrgDePrueba;
  centro: string;
  norte: string;
  servicioCentro: string;
  servicioNorte: string;
  recursoCentro: string;
  recursoNorte: string;
  paciente: string;
  regla: string;
}

let a: Clinica;
let b: Clinica;
let handlers: RegistroDeHandlers;

async function montar(): Promise<Clinica> {
  // ADMIN (0), Recepción del Centro (1), Recepción del Norte (2).
  const org = await crearOrgDePrueba("tarea-post-turno", "COMPLETA", "CLINICA", 3);
  const centro = (await createBranch(org.id, { name: "Centro", timezone: TZ }, "CLINICA")).id;
  const norte = (await createBranch(org.id, { name: "Norte", timezone: TZ }, "CLINICA")).id;
  const recursoCentro = (
    await createResource(org.id, { branchId: centro, name: "Ana", type: "PERSON" })
  ).id;
  const recursoNorte = (
    await createResource(org.id, { branchId: norte, name: "Bea", type: "PERSON" })
  ).id;
  const servicioCentro = (
    await createServiceType(org.id, {
      branchId: centro,
      resourceId: recursoCentro,
      name: "Consulta",
      durationMin: 60,
    })
  ).id;
  const servicioNorte = (
    await createServiceType(org.id, {
      branchId: norte,
      resourceId: recursoNorte,
      name: "Consulta",
      durationMin: 60,
    })
  ).id;
  const paciente = (
    await prisma.contact.create({
      data: { organizationId: org.id, firstName: "Paciente", lastName: "Ejemplo" },
    })
  ).id;
  const recepcion = await findRoleByName("RECEPCION");
  if (!recepcion) throw new Error("Falta el rol RECEPCION");
  for (const [i, sede] of [
    [1, centro],
    [2, norte],
  ] as const) {
    await prisma.user.update({ where: { id: org.authIds[i] }, data: { roleId: recepcion.id } });
    await prisma.userBranch.create({
      data: { organizationId: org.id, userId: org.authIds[i], branchId: sede },
    });
  }
  const regla = (
    await prisma.automation.create({
      data: {
        organizationId: org.id,
        name: "Tarea después del turno",
        triggerType: "booking.completed",
        actionType: "activity.create_follow_up",
        triggerConfig: {},
        actionConfig: { subject: ASUNTO, daysUntilDue: 3, notes: "Preguntar si quiere agendar." },
      },
    })
  ).id;
  return {
    org,
    centro,
    norte,
    servicioCentro,
    servicioNorte,
    recursoCentro,
    recursoNorte,
    paciente,
    regla,
  };
}

before(async () => {
  handlers = crearRegistroDeHandlers();
  registrarAutomatizaciones({ acciones: crearRegistroDeAcciones(), handlers });
  registrarEventosDeTurno(handlers);
  a = await montar();
  b = await montar();
});

after(async () => {
  for (const c of [a, b]) {
    if (!c) continue;
    const where = { organizationId: c.org.id };
    await prisma.activity.deleteMany({ where });
    await prisma.bookingMessage.deleteMany({ where });
    await prisma.automationExecution.deleteMany({ where });
    await prisma.automation.deleteMany({ where });
    await prisma.booking.deleteMany({ where });
    await prisma.userBranch.deleteMany({ where });
    await prisma.serviceType.deleteMany({ where });
    await prisma.workingHours.deleteMany({ where });
    await prisma.resource.deleteMany({ where });
    await borrarOrgDePrueba(c.org);
  }
});

beforeEach(async () => {
  for (const c of [a, b]) {
    const where = { organizationId: c.org.id };
    await prisma.activity.deleteMany({ where });
    await prisma.automationExecution.deleteMany({ where });
    await prisma.outboxEvent.deleteMany({ where });
    await prisma.booking.deleteMany({ where });
  }
});

/** Un turno que ya pasó (empezó hace `horasAtras` horas). */
function turnoPasado(c: Clinica, sede: "centro" | "norte" = "centro", horasAtras = 5) {
  const inicio = new Date(Date.now() - horasAtras * HORA);
  return prisma.booking.create({
    data: {
      organizationId: c.org.id,
      branchId: sede === "centro" ? c.centro : c.norte,
      serviceTypeId: sede === "centro" ? c.servicioCentro : c.servicioNorte,
      resourceId: sede === "centro" ? c.recursoCentro : c.recursoNorte,
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

const tareasDelTurno = (bookingId: string) =>
  prisma.activity.findMany({ where: { sourceBookingId: bookingId } });

test("Atendido crea una tarea para la recepción de la sede, con el turno y la regla de origen; una reentrega no duplica", async () => {
  const t = await turnoPasado(a);
  await marcar(a, t.id, "COMPLETED");
  const turno = await prisma.booking.findUniqueOrThrow({ where: { id: t.id } });
  const [tarea, ...resto] = await tareasDelTurno(t.id);
  assert.equal(resto.length, 0);
  assert.equal(tarea.type, "TASK");
  assert.equal(tarea.subject, ASUNTO);
  assert.equal(tarea.body, "Preguntar si quiere agendar.");
  assert.equal(tarea.assigneeId, a.org.authIds[1], "la recepción del Centro");
  assert.equal(tarea.authorId, a.org.authIds[1]);
  assert.equal(tarea.branchId, a.centro);
  assert.equal(tarea.contactId, a.paciente);
  assert.equal(tarea.opportunityId, null);
  assert.equal(tarea.sourceAutomationId, a.regla);
  assert.equal(tarea.dueDate?.getTime(), turno.completedAt!.getTime() + 3 * DIA);

  // El mismo evento otra vez (reentrega): nada nuevo.
  await prisma.outboxEvent.updateMany({
    where: { organizationId: a.org.id, eventType: "booking.completed" },
    data: { status: "PENDING", attempts: 0, nextAttemptAt: null },
  });
  await prisma.automationExecution.deleteMany({ where: { organizationId: a.org.id } });
  await drenarOutbox({ organizationId: a.org.id, registro: handlers });
  assert.equal((await tareasDelTurno(t.id)).length, 1);
});

test("No vino (corrección) cierra la tarea con una nota; volver a Atendido la reabre, sin crear otra", async () => {
  const t = await turnoPasado(a);
  await marcar(a, t.id, "COMPLETED");
  await marcar(a, t.id, "NO_SHOW");
  const [cerrada] = await tareasDelTurno(t.id);
  assert.ok(cerrada.completedAt, "cerrada");
  assert.ok(cerrada.body?.endsWith(NOTA_CERRADA_POR_NO_VINO), cerrada.body ?? "");

  await marcar(a, t.id, "COMPLETED");
  const tareas = await tareasDelTurno(t.id);
  assert.equal(tareas.length, 1);
  assert.equal(tareas[0].completedAt, null, "reabierta");
  assert.ok(tareas[0].body?.endsWith(NOTA_REABIERTA), tareas[0].body ?? "");
});

test("No vino directo (sin Atendido antes) no crea ninguna tarea", async () => {
  const t = await turnoPasado(a);
  await marcar(a, t.id, "NO_SHOW");
  assert.equal((await tareasDelTurno(t.id)).length, 0);
});

test("cierre automático: la tarea vence a N días desde el cierre", async () => {
  const t = await turnoPasado(a, "centro", 6);
  await cerrarTurnosVencidos({ organizationId: a.org.id });
  await drenarOutbox({ organizationId: a.org.id, registro: handlers });
  const turno = await prisma.booking.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(turno.completedBy, "AUTO");
  const [tarea] = await tareasDelTurno(t.id);
  assert.equal(tarea.dueDate?.getTime(), turno.completedAt!.getTime() + 3 * DIA);
});

test("límite por sede: un turno del Norte va a la recepción del Norte", async () => {
  const t = await turnoPasado(a, "norte");
  await marcar(a, t.id, "COMPLETED");
  const [tarea] = await tareasDelTurno(t.id);
  assert.equal(tarea.assigneeId, a.org.authIds[2]);
  assert.equal(tarea.branchId, a.norte);
});

test("aislamiento: la tarea de una clínica no toca a otra, y la FK no deja apuntar a un turno ajeno", async () => {
  const t = await turnoPasado(a);
  const deB = await turnoPasado(b);
  await marcar(a, t.id, "COMPLETED");
  assert.equal((await tareasDelTurno(deB.id)).length, 0);
  assert.equal(await prisma.activity.count({ where: { organizationId: b.org.id } }), 0);

  await assert.rejects(
    prisma.activity.create({
      data: {
        organizationId: a.org.id,
        type: "TASK",
        authorId: a.org.authIds[0],
        subject: "Ajena",
        contactId: a.paciente,
        sourceBookingId: deB.id,
        sourceAutomationId: a.regla,
      },
    }),
    /foreign key/i,
  );
});
