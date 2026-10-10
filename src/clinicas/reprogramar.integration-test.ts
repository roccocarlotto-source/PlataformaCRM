import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
import type { ClienteGoogleCalendar, EventoCambiado } from "../services/googleCalendar.service";
import { procesarNotificacion } from "../services/googleCalendarSync.service";
import { createResource } from "../services/resource.service";
import { createServiceType } from "../services/serviceType.service";
import { replaceWorkingHoursForResource } from "../services/workingHours.service";
import { getCifrador } from "../utils/encryption";
import { firmarWebhookToken } from "../utils/webhookToken";
import { definirProfesionales } from "./services/agendaClinica.service";
import {
  PREFIJO_TAREA_BORRADO_EN_GOOGLE,
  PREFIJO_TAREA_MOVIDO_EN_GOOGLE,
} from "./services/googlePorProfesional.service";
import {
  PREFIJO_NOTA_REPROGRAMADO,
  PREFIJO_TAREA_GOOGLE_DESINCRONIZADO,
  PREFIJO_TAREA_PROFESIONAL_ARCHIVADO,
  reprogramarTurno,
} from "./services/reprogramar.service";

// ---------------------------------------------------------------------------
// Reprogramar un turno de clínica (docs/rubros.md §4.7, R9), contra la app real
// y Postgres.
//
// Sede Centro (sin Google): Ana y Bruno atienden la "Consulta" (Ana principal).
// Sede Norte: Carla. Sede Sur (con Google conectado): Diego ("cal-diego") y Eva
// ("cal-eva") atienden el "Control". Un ADMIN, una Recepción de Centro y una de
// Norte. Lunes 1/3/2027, 9 a 13 en Buenos Aires, con el reloj fijado.
// ---------------------------------------------------------------------------

const TZ = "America/Argentina/Buenos_Aires";
const LUNES = (hora: number) =>
  new Date(`2027-03-01T${String(hora + 3).padStart(2, "0")}:00:00.000Z`);
const AHORA_FIJO = new Date("2027-02-28T12:00:00Z");
const LUNES_9_A_13 = [{ weekday: "MONDAY" as const, startMinute: 540, endMinute: 780 }];

const ADMIN = 0;
const RECEPCION_CENTRO = 1;
const RECEPCION_NORTE = 2;

let clinica: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);

const ids = {} as {
  centro: string;
  norte: string;
  sur: string;
  ana: string;
  bruno: string;
  diego: string;
  eva: string;
  consulta: string;
  control: string;
  contactId: string;
};

const como = (persona: number) => clinica.tokens[persona];

interface Doble {
  cliente: ClienteGoogleCalendar;
  actualizados: { calendarId: string; eventId: string; inicio: Date }[];
  creados: { calendarId: string; id: string }[];
  borrados: { calendarId: string; eventId: string }[];
}

function doblarGoogle(
  opciones: { actualizarFalla?: boolean; cambios?: EventoCambiado[] } = {},
): Doble {
  const d: Omit<Doble, "cliente"> = { actualizados: [], creados: [], borrados: [] };
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
    crearEvento: (e) => {
      const id = `evt-${randomUUID().slice(0, 8)}`;
      d.creados.push({ calendarId: e.calendarId, id });
      return Promise.resolve(id);
    },
    eliminarEvento: (e) => {
      d.borrados.push({ calendarId: e.calendarId, eventId: e.eventId });
      return Promise.resolve();
    },
    actualizarEvento: (e) => {
      if (opciones.actualizarFalla) return Promise.reject(new Error("Google caído"));
      d.actualizados.push({ calendarId: e.calendarId, eventId: e.eventId, inicio: e.inicio });
      return Promise.resolve();
    },
    crearCanalDeNotificaciones: (c) =>
      Promise.resolve({
        channelId: c.channelId,
        resourceId: "res",
        expiration: new Date(Date.now() + 86400000),
      }),
    detenerCanal: () => Promise.resolve(),
    listarCambios: () => Promise.resolve({ eventos: opciones.cambios ?? [], nextSyncToken: "t2" }),
  };
  return { cliente, ...d };
}

async function profesional(branchId: string, name: string, calendario?: string) {
  const r = await createResource(clinica.id, { branchId, name, type: "PERSON" });
  await replaceWorkingHoursForResource(clinica.id, r.id, LUNES_9_A_13);
  if (calendario) {
    await prisma.resource.update({ where: { id: r.id }, data: { googleCalendarId: calendario } });
  }
  return r.id;
}

before(async () => {
  mock.method(relojDeReservas, "ahora", () => AHORA_FIJO);
  ({ baseUrl, cerrar } = await levantarApp());
  clinica = await crearOrgDePrueba("reprogramar", "COMPLETA", "CLINICA", 3);
  const centro = await createBranch(clinica.id, { name: "Centro", timezone: TZ }, "CLINICA");
  const norte = await createBranch(clinica.id, { name: "Norte", timezone: TZ }, "CLINICA");
  const sur = await createBranch(clinica.id, { name: "Sur", timezone: TZ }, "CLINICA");
  ids.centro = centro.id;
  ids.norte = norte.id;
  ids.sur = sur.id;
  ids.ana = await profesional(centro.id, "Ana");
  ids.bruno = await profesional(centro.id, "Bruno");
  await profesional(norte.id, "Carla");
  ids.diego = await profesional(sur.id, "Diego", "cal-diego");
  ids.eva = await profesional(sur.id, "Eva", "cal-eva");
  ids.consulta = (
    await createServiceType(clinica.id, {
      branchId: centro.id,
      resourceId: ids.ana,
      name: "Consulta",
      durationMin: 60,
    })
  ).id;
  await definirProfesionales(clinica.id, ids.consulta, [ids.ana, ids.bruno]);
  ids.control = (
    await createServiceType(clinica.id, {
      branchId: sur.id,
      resourceId: ids.diego,
      name: "Control",
      durationMin: 60,
    })
  ).id;
  await definirProfesionales(clinica.id, ids.control, [ids.diego, ids.eva]);
  ids.contactId = (
    await prisma.contact.create({
      data: { organizationId: clinica.id, firstName: "Paciente", lastName: "Ejemplo" },
    })
  ).id;
  await prisma.googleCalendarConnection.create({
    data: {
      organizationId: clinica.id,
      branchId: sur.id,
      refreshToken: getCifrador().encrypt("1//refresh"),
      calendarId: "primary",
      status: "ACTIVE",
    },
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
  await prisma.booking.deleteMany({ where });
  await prisma.resourceTimeOff.deleteMany({ where });
  await prisma.googleCalendarChannel.deleteMany({ where });
  await prisma.googleCalendarConnection.deleteMany({ where });
  await prisma.userBranch.deleteMany({ where });
  await prisma.serviceTypeResource.deleteMany({ where });
  await prisma.serviceType.deleteMany({ where });
  await prisma.workingHours.deleteMany({ where });
  await prisma.resource.deleteMany({ where });
  await prisma.clinicBranchSettings.deleteMany({ where });
  await borrarOrgDePrueba(clinica);
});

async function limpiar() {
  const where = { organizationId: clinica.id };
  await prisma.activity.deleteMany({ where });
  await prisma.booking.deleteMany({ where });
  await prisma.resourceTimeOff.deleteMany({ where });
  await prisma.googleCalendarChannel.deleteMany({ where });
  await prisma.resource.updateMany({ where, data: { allowsOverbooking: false } });
}

async function turnoEnCentro(
  resourceId: string,
  hora: number,
  status: "CONFIRMED" | "CANCELLED" = "CONFIRMED",
) {
  return prisma.booking.create({
    data: {
      organizationId: clinica.id,
      branchId: ids.centro,
      serviceTypeId: ids.consulta,
      resourceId,
      contactId: ids.contactId,
      startsAt: LUNES(hora),
      endsAt: LUNES(hora + 1),
      status,
    },
  });
}

async function reprogramarPorHttp(
  persona: number,
  bookingId: string,
  body: Record<string, unknown>,
) {
  return pedir(clinica, "PATCH", `/api/bookings/${bookingId}/reschedule`, body, como(persona));
}

// ---------------------------------------------------------------------------
// Desde la plataforma
// ---------------------------------------------------------------------------

test("Recepción reprograma un turno de su sede: mismo id, horario nuevo y queda la nota con antes, ahora y quién", async () => {
  await limpiar();
  const turno = await turnoEnCentro(ids.ana, 9);
  const r = await reprogramarPorHttp(RECEPCION_CENTRO, turno.id, {
    startsAt: LUNES(11).toISOString(),
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.id, turno.id);
  assert.equal(r.json.startsAt, LUNES(11).toISOString());
  const nota = await prisma.activity.findFirstOrThrow({
    where: {
      organizationId: clinica.id,
      type: "NOTE",
      subject: { startsWith: PREFIJO_NOTA_REPROGRAMADO },
    },
  });
  assert.equal(nota.contactId, ids.contactId);
  assert.match(nota.body ?? "", /Antes: .*9:00 con Ana\. Ahora: .*11:00 con Ana\. Reprogramó: /);
  assert.equal(nota.authorId, clinica.authIds[RECEPCION_CENTRO]);
});

test("otra sede da 404; un horario bloqueado o pasado se rechaza; un turno cancelado no se reprograma", async () => {
  await limpiar();
  const turno = await turnoEnCentro(ids.ana, 9);
  const deNorte = await reprogramarPorHttp(RECEPCION_NORTE, turno.id, {
    startsAt: LUNES(11).toISOString(),
  });
  assert.equal(deNorte.status, 404);

  await prisma.resourceTimeOff.create({
    data: {
      organizationId: clinica.id,
      resourceId: ids.ana,
      startsAt: LUNES(11),
      endsAt: LUNES(12),
    },
  });
  const bloqueado = await reprogramarPorHttp(RECEPCION_CENTRO, turno.id, {
    startsAt: LUNES(11).toISOString(),
  });
  assert.equal(bloqueado.status, 409, JSON.stringify(bloqueado.json));

  const pasado = await reprogramarPorHttp(RECEPCION_CENTRO, turno.id, {
    startsAt: new Date("2027-02-22T12:00:00Z").toISOString(),
  });
  assert.equal(pasado.status, 400);

  const cancelado = await turnoEnCentro(ids.ana, 12, "CANCELLED");
  const r = await reprogramarPorHttp(RECEPCION_CENTRO, cancelado.id, {
    startsAt: LUNES(10).toISOString(),
  });
  assert.equal(r.status, 409);

  const sinCambios = await prisma.booking.findUniqueOrThrow({ where: { id: turno.id } });
  assert.deepEqual(sinCambios.startsAt, LUNES(9));
});

test("un horario ocupado se rechaza; como sobreturno solo si el profesional lo permite", async () => {
  await limpiar();
  await turnoEnCentro(ids.ana, 10);
  const turno = await turnoEnCentro(ids.ana, 9);
  const ocupado = await reprogramarPorHttp(RECEPCION_CENTRO, turno.id, {
    startsAt: LUNES(10).toISOString(),
  });
  assert.equal(ocupado.status, 409);
  const sinPermiso = await reprogramarPorHttp(RECEPCION_CENTRO, turno.id, {
    startsAt: LUNES(10).toISOString(),
    isOverbooking: true,
  });
  assert.equal(sinPermiso.status, 400, JSON.stringify(sinPermiso.json));

  await prisma.resource.update({
    where: { id: ids.ana },
    data: { allowsOverbooking: true, maxOverbookingsPerDay: 1 },
  });
  const conPermiso = await reprogramarPorHttp(RECEPCION_CENTRO, turno.id, {
    startsAt: LUNES(10).toISOString(),
    isOverbooking: true,
  });
  assert.equal(conPermiso.status, 200, JSON.stringify(conPermiso.json));
  assert.equal(conPermiso.json.isOverbooking, true);
});

test("cambiar de profesional dentro de la prestación; uno que no la atiende da 400", async () => {
  await limpiar();
  const turno = await turnoEnCentro(ids.ana, 9);
  const conBruno = await reprogramarPorHttp(RECEPCION_CENTRO, turno.id, {
    startsAt: LUNES(9).toISOString(),
    resourceId: ids.bruno,
  });
  assert.equal(conBruno.status, 200, JSON.stringify(conBruno.json));
  assert.equal(conBruno.json.resourceId, ids.bruno);
  const conDiego = await reprogramarPorHttp(ADMIN, turno.id, {
    startsAt: LUNES(11).toISOString(),
    resourceId: ids.diego,
  });
  assert.equal(conDiego.status, 400);
});

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

const admin = () => ({
  userId: clinica.authIds[ADMIN],
  role: "ADMIN" as const,
  industry: "CLINICA" as const,
  descripcion: "Admin de prueba",
});

async function turnoEnSurConEvento(resourceId: string, calendarId: string, hora: number) {
  return prisma.booking.create({
    data: {
      organizationId: clinica.id,
      branchId: ids.sur,
      serviceTypeId: ids.control,
      resourceId,
      contactId: ids.contactId,
      startsAt: LUNES(hora),
      endsAt: LUNES(hora + 1),
      googleEventId: `evt-${randomUUID().slice(0, 8)}`,
      googleCalendarId: calendarId,
    },
  });
}

async function notificar(resourceId: string, calendarId: string, cambios: EventoCambiado[]) {
  const channelId = randomUUID();
  await prisma.googleCalendarChannel.create({
    data: {
      organizationId: clinica.id,
      branchId: ids.sur,
      calendarId,
      resourceId,
      channelId,
      channelResourceId: "res",
      channelExpiration: new Date(Date.now() + 86400000),
      syncToken: "t1",
    },
  });
  const token = await firmarWebhookToken({
    organizationId: clinica.id,
    branchId: ids.sur,
    channelId,
  });
  return procesarNotificacion(
    { channelId, resourceState: "exists", token },
    doblarGoogle({ cambios }).cliente,
  );
}

const tareasFalsasDeGoogle = () =>
  prisma.activity.count({
    where: {
      organizationId: clinica.id,
      OR: [
        { subject: { startsWith: PREFIJO_TAREA_MOVIDO_EN_GOOGLE } },
        { subject: { startsWith: PREFIJO_TAREA_BORRADO_EN_GOOGLE } },
      ],
    },
  });

test("Google, mismo profesional: se actualiza el evento en su calendario y la notificación de vuelta no crea la tarea de 'movido en Google'", async () => {
  await limpiar();
  const turno = await turnoEnSurConEvento(ids.diego, "cal-diego", 9);
  const google = doblarGoogle();
  await reprogramarTurno(clinica.id, turno.id, { startsAt: LUNES(11) }, admin(), google.cliente);
  assert.deepEqual(google.actualizados, [
    { calendarId: "cal-diego", eventId: turno.googleEventId!, inicio: LUNES(11) },
  ]);
  const despues = await prisma.booking.findUniqueOrThrow({ where: { id: turno.id } });
  assert.equal(despues.googleEventId, turno.googleEventId);

  await notificar(ids.diego, "cal-diego", [
    { id: turno.googleEventId!, status: "confirmed", inicio: LUNES(11), fin: LUNES(12) },
  ]);
  assert.equal(await tareasFalsasDeGoogle(), 0);
});

test("Google, otro profesional: se borra en el calendario viejo, se crea en el nuevo y el borrado no crea la tarea de 'borrado en Google'", async () => {
  await limpiar();
  const turno = await turnoEnSurConEvento(ids.diego, "cal-diego", 9);
  const google = doblarGoogle();
  await reprogramarTurno(
    clinica.id,
    turno.id,
    { startsAt: LUNES(10), resourceId: ids.eva },
    admin(),
    google.cliente,
  );
  assert.deepEqual(google.borrados, [{ calendarId: "cal-diego", eventId: turno.googleEventId! }]);
  assert.deepEqual(
    google.creados.map((c) => c.calendarId),
    ["cal-eva"],
  );
  const despues = await prisma.booking.findUniqueOrThrow({ where: { id: turno.id } });
  assert.equal(despues.googleEventId, google.creados[0].id);
  assert.equal(despues.googleCalendarId, "cal-eva");

  await notificar(ids.diego, "cal-diego", [{ id: turno.googleEventId!, status: "cancelled" }]);
  assert.equal(await tareasFalsasDeGoogle(), 0);
  assert.equal(
    (await prisma.booking.findUniqueOrThrow({ where: { id: turno.id } })).status,
    "CONFIRMED",
  );
});

test("Google fallando al actualizar: el turno queda reprogramado y hay una tarea para la recepción de la sede", async () => {
  await limpiar();
  const turno = await turnoEnSurConEvento(ids.diego, "cal-diego", 9);
  await reprogramarTurno(
    clinica.id,
    turno.id,
    { startsAt: LUNES(12) },
    admin(),
    doblarGoogle({ actualizarFalla: true }).cliente,
  );
  const despues = await prisma.booking.findUniqueOrThrow({ where: { id: turno.id } });
  assert.deepEqual(despues.startsAt, LUNES(12));
  const tarea = await prisma.activity.findFirstOrThrow({
    where: {
      organizationId: clinica.id,
      subject: { startsWith: PREFIJO_TAREA_GOOGLE_DESINCRONIZADO },
    },
  });
  assert.equal(tarea.branchId, ids.sur);
  assert.match(
    tarea.body ?? "",
    /con Diego se reprogramó .*no se pudo actualizar en Google Calendar/,
  );
});

// ---------------------------------------------------------------------------
// Archivar un profesional con turnos futuros (último: archiva a Bruno)
// ---------------------------------------------------------------------------

test("archivar un profesional con turnos futuros: la pantalla los cuenta antes, no se cancelan y hay una tarea por turno", async () => {
  await limpiar();
  const t1 = await turnoEnCentro(ids.bruno, 9);
  const t2 = await turnoEnCentro(ids.bruno, 11);
  const cuenta = await pedir(
    clinica,
    "GET",
    `/api/clinica/profesionales/${ids.bruno}/turnos-futuros`,
    undefined,
    como(ADMIN),
  );
  assert.equal(cuenta.status, 200);
  assert.equal(cuenta.json.cantidad, 2);

  const archivado = await pedir(
    clinica,
    "DELETE",
    `/api/resources/${ids.bruno}`,
    undefined,
    como(ADMIN),
  );
  assert.equal(archivado.status, 204, JSON.stringify(archivado.json));
  for (const t of [t1, t2]) {
    assert.equal(
      (await prisma.booking.findUniqueOrThrow({ where: { id: t.id } })).status,
      "CONFIRMED",
    );
  }
  const tareas = await prisma.activity.findMany({
    where: {
      organizationId: clinica.id,
      subject: { startsWith: PREFIJO_TAREA_PROFESIONAL_ARCHIVADO },
    },
  });
  assert.equal(tareas.length, 2);
  assert.ok(
    tareas.every(
      (t) => t.assigneeId === clinica.authIds[RECEPCION_CENTRO] && t.branchId === ids.centro,
    ),
  );
});
