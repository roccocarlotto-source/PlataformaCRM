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
import { obtenerDisponibilidad } from "../services/availability.service";
import { cancelBooking, createBooking, relojDeReservas } from "../services/booking.service";
import { createBranch } from "../services/branch.service";
import {
  GoogleAuthError,
  type ClienteGoogleCalendar,
  type ConsultaFreeBusy,
  type EventoCambiado,
} from "../services/googleCalendar.service";
import { procesarNotificacion } from "../services/googleCalendarSync.service";
import { createResource, deleteResource } from "../services/resource.service";
import { createServiceType } from "../services/serviceType.service";
import { replaceWorkingHoursForResource } from "../services/workingHours.service";
import { getCifrador } from "../utils/encryption";
import { firmarWebhookToken } from "../utils/webhookToken";
import { renovarCanalesVencidos } from "../workers/googleCalendarChannelWorker";
import { disponibilidadDeLaPrestacion } from "./services/agendaClinica.service";
import {
  PREFIJO_TAREA_BORRADO_EN_GOOGLE,
  PREFIJO_TAREA_MOVIDO_EN_GOOGLE,
  asignarCalendarioAlProfesional,
  listarCalendariosDeLaSede,
} from "./services/googlePorProfesional.service";

// ---------------------------------------------------------------------------
// Un calendario de Google por profesional de clínica (docs/rubros.md §4.6, D4,
// D16, R8), contra Postgres con un doble de Google.
//
// Clínica: una sede con Google conectado (el calendario de la sede es
// "primary"), Ana con calendario propio ("cal-ana"), Bruno sin calendario, una
// Recepción de la sede. Automotora: una sucursal conectada con un vendedor.
// Lunes 1/3/2027, 9 a 13 en Buenos Aires, con el reloj de reservas fijado.
// ---------------------------------------------------------------------------

const TZ = "America/Argentina/Buenos_Aires";
const LUNES = (hora: number) =>
  new Date(`2027-03-01T${String(hora + 3).padStart(2, "0")}:00:00.000Z`);
const AHORA_FIJO = new Date("2027-02-28T12:00:00Z");
const LUNES_9_A_13 = [{ weekday: "MONDAY" as const, startMinute: 540, endMinute: 780 }];

let clinica: OrgDePrueba;
let automotora: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);

interface Agenda {
  sede: string;
  ana: string;
  bruno: string;
  consulta: string;
  consultaBruno: string;
  contactId: string;
}
let clin: Agenda;
let auto: { sede: string; vendedor: string; servicio: string; contactId: string };

// ---------------------------------------------------------------------------
// El doble de Google: ocupado por calendario, y registro de lo que se pidió.
// ---------------------------------------------------------------------------
interface Doble {
  cliente: ClienteGoogleCalendar;
  freebusy: string[][];
  eventosCreados: { calendarId: string; titulo: string }[];
  eventosBorrados: { calendarId: string; eventId: string }[];
  canalesCreados: { calendarId: string; channelId: string; token: string }[];
  canalesDetenidos: string[];
  listados: { calendarId: string; syncToken?: string }[];
}

function doblarGoogle(
  opciones: {
    ocupado?: Record<string, { inicio: Date; fin: Date }[]>;
    cambios?: EventoCambiado[];
    calendarioRoto?: string;
    conLista?: boolean;
  } = {},
): Doble {
  const d: Omit<Doble, "cliente"> = {
    freebusy: [],
    eventosCreados: [],
    eventosBorrados: [],
    canalesCreados: [],
    canalesDetenidos: [],
    listados: [],
  };
  const cliente: ClienteGoogleCalendar = {
    construirUrlDeAutorizacion: (state) => `https://accounts.google.com/fake?state=${state}`,
    intercambiarCodigo: () =>
      Promise.resolve({
        refreshToken: "1//r",
        accessToken: "a",
        expiraEnSegundos: 3599,
        scope: "",
      }),
    renovarAccessToken: () =>
      Promise.resolve({ accessToken: "access", expiraEnSegundos: 3599, scope: "" }),
    revocarToken: () => Promise.resolve(),
    consultarFreeBusy: (consulta: ConsultaFreeBusy) => {
      d.freebusy.push(consulta.calendarIds);
      if (opciones.calendarioRoto && consulta.calendarIds.includes(opciones.calendarioRoto)) {
        return Promise.reject(new GoogleAuthError("notFound", true));
      }
      return Promise.resolve(
        consulta.calendarIds.flatMap((id) =>
          (opciones.ocupado?.[id] ?? []).map((o) => ({
            inicio: o.inicio.toISOString(),
            fin: o.fin.toISOString(),
          })),
        ),
      );
    },
    crearEvento: (evento) => {
      d.eventosCreados.push({ calendarId: evento.calendarId, titulo: evento.titulo });
      return Promise.resolve(`evt-${randomUUID().slice(0, 8)}`);
    },
    eliminarEvento: (evento) => {
      d.eventosBorrados.push({ calendarId: evento.calendarId, eventId: evento.eventId });
      return Promise.resolve();
    },
    crearCanalDeNotificaciones: (canal) => {
      if (opciones.calendarioRoto === canal.calendarId) {
        return Promise.reject(new GoogleAuthError("notFound", false));
      }
      d.canalesCreados.push({
        calendarId: canal.calendarId,
        channelId: canal.channelId,
        token: canal.token,
      });
      return Promise.resolve({
        channelId: canal.channelId,
        resourceId: `res-${canal.channelId.slice(0, 8)}`,
        expiration: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
    },
    detenerCanal: (canal) => {
      d.canalesDetenidos.push(canal.channelId);
      return Promise.resolve();
    },
    listarCambios: (consulta) => {
      d.listados.push({ calendarId: consulta.calendarId, syncToken: consulta.syncToken });
      return Promise.resolve({ eventos: opciones.cambios ?? [], nextSyncToken: "token-nuevo" });
    },
    ...(opciones.conLista
      ? {
          listarCalendarios: () =>
            Promise.resolve([{ id: "cal-ana", summary: "Ana", accessRole: "owner" }]),
        }
      : {}),
  };
  return { cliente, ...d };
}

async function conectar(organizationId: string, branchId: string) {
  await prisma.googleCalendarConnection.create({
    data: {
      organizationId,
      branchId,
      refreshToken: getCifrador().encrypt("1//refresh"),
      calendarId: "primary",
      status: "ACTIVE",
    },
  });
}

before(async () => {
  mock.method(relojDeReservas, "ahora", () => AHORA_FIJO);
  ({ baseUrl, cerrar } = await levantarApp());
  clinica = await crearOrgDePrueba("google-por-profesional", "COMPLETA", "CLINICA", 2);
  automotora = await crearOrgDePrueba("google-por-profesional", "COMPLETA", "AUTOMOTORA", 1);

  const sede = await createBranch(clinica.id, { name: "Centro", timezone: TZ }, "CLINICA");
  const ana = await createResource(clinica.id, { branchId: sede.id, name: "Ana", type: "PERSON" });
  const bruno = await createResource(clinica.id, {
    branchId: sede.id,
    name: "Bruno",
    type: "PERSON",
  });
  for (const r of [ana, bruno]) {
    await replaceWorkingHoursForResource(clinica.id, r.id, LUNES_9_A_13);
  }
  const consulta = await createServiceType(clinica.id, {
    branchId: sede.id,
    resourceId: ana.id,
    name: "Consulta",
    durationMin: 60,
  });
  const consultaBruno = await createServiceType(clinica.id, {
    branchId: sede.id,
    resourceId: bruno.id,
    name: "Control",
    durationMin: 60,
  });
  const contacto = await prisma.contact.create({
    data: { organizationId: clinica.id, firstName: "Paciente", lastName: "Ejemplo" },
  });
  await conectar(clinica.id, sede.id);
  await prisma.resource.update({ where: { id: ana.id }, data: { googleCalendarId: "cal-ana" } });
  const recepcion = await findRoleByName("RECEPCION");
  if (!recepcion) throw new Error("Falta el rol RECEPCION");
  await prisma.user.update({ where: { id: clinica.authIds[1] }, data: { roleId: recepcion.id } });
  await prisma.userBranch.create({
    data: { organizationId: clinica.id, userId: clinica.authIds[1], branchId: sede.id },
  });
  clin = {
    sede: sede.id,
    ana: ana.id,
    bruno: bruno.id,
    consulta: consulta.id,
    consultaBruno: consultaBruno.id,
    contactId: contacto.id,
  };

  const sucursal = await createBranch(automotora.id, { name: "Centro", timezone: TZ });
  const vendedor = await createResource(automotora.id, {
    branchId: sucursal.id,
    name: "Vendedor",
    type: "PERSON",
  });
  await replaceWorkingHoursForResource(automotora.id, vendedor.id, LUNES_9_A_13);
  const testDrive = await createServiceType(automotora.id, {
    branchId: sucursal.id,
    resourceId: vendedor.id,
    name: "Test drive",
    durationMin: 60,
  });
  const cliente = await prisma.contact.create({
    data: { organizationId: automotora.id, firstName: "Cliente", lastName: "Ejemplo" },
  });
  await conectar(automotora.id, sucursal.id);
  auto = {
    sede: sucursal.id,
    vendedor: vendedor.id,
    servicio: testDrive.id,
    contactId: cliente.id,
  };
});

after(async () => {
  mock.restoreAll();
  if (cerrar) await cerrar();
  for (const org of [clinica, automotora]) {
    if (!org) continue;
    const where = { organizationId: org.id };
    await prisma.activity.deleteMany({ where });
    await prisma.booking.deleteMany({ where });
    await prisma.googleCalendarChannel.deleteMany({ where });
    await prisma.googleCalendarConnection.deleteMany({ where });
    await prisma.userBranch.deleteMany({ where });
    await prisma.serviceTypeResource.deleteMany({ where });
    await prisma.serviceType.deleteMany({ where });
    await prisma.workingHours.deleteMany({ where });
    await prisma.resource.deleteMany({ where });
    await prisma.clinicBranchSettings.deleteMany({ where });
    await borrarOrgDePrueba(org);
  }
});

async function limpiar() {
  for (const org of [clinica, automotora]) {
    const where = { organizationId: org.id };
    await prisma.activity.deleteMany({ where });
    await prisma.booking.deleteMany({ where });
    await prisma.googleCalendarChannel.deleteMany({ where });
  }
  await prisma.resource.update({ where: { id: clin.ana }, data: { googleCalendarId: "cal-ana" } });
}

const horas = (turnos: { inicio: Date }[]) => turnos.map((t) => t.inicio.getUTCHours() - 3);

// ---------------------------------------------------------------------------
// Disponibilidad
// ---------------------------------------------------------------------------

test("clínica: a cada profesional se le resta solo su calendario; sin calendario no resta nada y el de la sede nunca", async () => {
  await limpiar();
  const google = doblarGoogle({
    ocupado: {
      "cal-ana": [{ inicio: LUNES(10), fin: LUNES(11) }],
      primary: [{ inicio: LUNES(9), fin: LUNES(13) }],
    },
  });
  const deAna = await disponibilidadDeLaPrestacion(
    clinica.id,
    { serviceTypeId: clin.consulta, desde: LUNES(0), hasta: LUNES(20) },
    google.cliente,
  );
  assert.deepEqual(horas(deAna), [9, 11, 12]);
  const deBruno = await disponibilidadDeLaPrestacion(
    clinica.id,
    { serviceTypeId: clin.consultaBruno, desde: LUNES(0), hasta: LUNES(20) },
    google.cliente,
  );
  assert.deepEqual(horas(deBruno), [9, 10, 11, 12], "el calendario de la sede no se resta");
  assert.deepEqual(google.freebusy, [["cal-ana"]], "Bruno no consulta Google");
});

test("automotora (D17): el freebusy de la sucursal se resta como siempre, con un solo calendario", async () => {
  await limpiar();
  const google = doblarGoogle({ ocupado: { primary: [{ inicio: LUNES(9), fin: LUNES(11) }] } });
  const turnos = await obtenerDisponibilidad(
    automotora.id,
    { resourceId: auto.vendedor, serviceTypeId: auto.servicio, desde: LUNES(0), hasta: LUNES(20) },
    google.cliente,
  );
  assert.deepEqual(horas(turnos), [11, 12]);
  assert.deepEqual(google.freebusy, [["primary"]]);
});

test("un calendario de profesional roto no marca la conexión de la sede ni rompe la disponibilidad", async () => {
  await limpiar();
  const google = doblarGoogle({ calendarioRoto: "cal-ana" });
  const deAna = await disponibilidadDeLaPrestacion(
    clinica.id,
    { serviceTypeId: clin.consulta, desde: LUNES(0), hasta: LUNES(20) },
    google.cliente,
  );
  assert.deepEqual(horas(deAna), [9, 10, 11, 12], "se calcula sin Google");
  const conexion = await prisma.googleCalendarConnection.findFirstOrThrow({
    where: { organizationId: clinica.id },
  });
  assert.equal(conexion.status, "ACTIVE");
});

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

test("el turno de un profesional con calendario va a su calendario y se cancela ahí; sin calendario, al de la sede", async () => {
  await limpiar();
  const google = doblarGoogle();
  const deAna = await createBooking(
    clinica.id,
    {
      resourceId: clin.ana,
      serviceTypeId: clin.consulta,
      contactId: clin.contactId,
      startsAt: LUNES(9),
    },
    google.cliente,
  );
  const guardado = await prisma.booking.findUniqueOrThrow({ where: { id: deAna.id } });
  assert.equal(guardado.googleCalendarId, "cal-ana");
  assert.ok(guardado.googleEventId);

  const deBruno = await createBooking(
    clinica.id,
    {
      resourceId: clin.bruno,
      serviceTypeId: clin.consultaBruno,
      contactId: clin.contactId,
      startsAt: LUNES(9),
    },
    google.cliente,
  );
  const deBrunoGuardado = await prisma.booking.findUniqueOrThrow({ where: { id: deBruno.id } });
  assert.equal(deBrunoGuardado.googleCalendarId, null);
  assert.deepEqual(
    google.eventosCreados.map((e) => e.calendarId),
    ["cal-ana", "primary"],
  );

  // Aunque Ana cambie de calendario después, se borra donde se creó.
  await prisma.resource.update({ where: { id: clin.ana }, data: { googleCalendarId: "cal-otro" } });
  await cancelBooking(clinica.id, deAna.id, google.cliente);
  assert.deepEqual(google.eventosBorrados, [
    { calendarId: "cal-ana", eventId: guardado.googleEventId! },
  ]);
});

// ---------------------------------------------------------------------------
// Canales, worker y webhook
// ---------------------------------------------------------------------------

test("el worker abre el canal de la sede y el del calendario de cada profesional; un calendario roto no frena al resto", async () => {
  await limpiar();
  await prisma.resource.update({
    where: { id: clin.bruno },
    data: { googleCalendarId: "cal-rota" },
  });
  try {
    const google = doblarGoogle({ calendarioRoto: "cal-rota" });
    await renovarCanalesVencidos({ cliente: google.cliente, organizationId: clinica.id });
    assert.deepEqual(google.canalesCreados.map((c) => c.calendarId).sort(), ["cal-ana", "primary"]);
    const deAna = await prisma.googleCalendarChannel.findFirstOrThrow({
      where: { organizationId: clinica.id, resourceId: clin.ana },
    });
    assert.ok(deAna.channelId);
    const rota = await prisma.googleCalendarChannel.findFirstOrThrow({
      where: { organizationId: clinica.id, resourceId: clin.bruno },
    });
    assert.equal(rota.channelId, null);
    assert.ok(rota.lastErrorMessage, "el error queda en su fila");

    // Una segunda pasada no reabre los que están vigentes.
    const otraPasada = doblarGoogle({ calendarioRoto: "cal-rota" });
    await renovarCanalesVencidos({ cliente: otraPasada.cliente, organizationId: clinica.id });
    assert.deepEqual(otraPasada.canalesCreados, []);
  } finally {
    await prisma.resource.update({ where: { id: clin.bruno }, data: { googleCalendarId: null } });
  }
});

async function canalDeAnaConSyncToken() {
  const google = doblarGoogle();
  await renovarCanalesVencidos({ cliente: google.cliente, organizationId: clinica.id });
  const fila = await prisma.googleCalendarChannel.findFirstOrThrow({
    where: { organizationId: clinica.id, resourceId: clin.ana },
  });
  await prisma.googleCalendarChannel.update({
    where: { id: fila.id },
    data: { syncToken: "token-de-ana" },
  });
  return fila;
}

test("D16: un turno de clínica borrado en Google no se cancela; queda una tarea para Recepción de la sede", async () => {
  await limpiar();
  const turno = await createBooking(
    clinica.id,
    {
      resourceId: clin.ana,
      serviceTypeId: clin.consulta,
      contactId: clin.contactId,
      startsAt: LUNES(10),
    },
    doblarGoogle().cliente,
  );
  const { googleEventId } = await prisma.booking.findUniqueOrThrow({ where: { id: turno.id } });
  const fila = await canalDeAnaConSyncToken();

  const google = doblarGoogle({ cambios: [{ id: googleEventId!, status: "cancelled" }] });
  const token = await firmarWebhookToken({
    organizationId: clinica.id,
    branchId: clin.sede,
    channelId: fila.channelId!,
  });
  const resultado = await procesarNotificacion(
    { channelId: fila.channelId!, resourceState: "exists", token },
    google.cliente,
  );
  assert.equal(resultado.bookingsCancelados, 0);
  assert.deepEqual(google.listados, [{ calendarId: "cal-ana", syncToken: "token-de-ana" }]);

  const despues = await prisma.booking.findUniqueOrThrow({ where: { id: turno.id } });
  assert.equal(despues.status, "CONFIRMED", "la plataforma es la fuente de verdad");
  assert.equal(despues.googleEventId, null, "ya no tiene espejo en Google");
  const tarea = await prisma.activity.findFirstOrThrow({
    where: { organizationId: clinica.id, subject: { startsWith: PREFIJO_TAREA_BORRADO_EN_GOOGLE } },
  });
  assert.equal(tarea.assigneeId, clinica.authIds[1], "a la Recepción de la sede");
  assert.equal(tarea.branchId, clin.sede);
  assert.match(tarea.body ?? "", /Ana/);
  const canal = await prisma.googleCalendarChannel.findUniqueOrThrow({ where: { id: fila.id } });
  assert.equal(canal.syncToken, "token-nuevo", "el syncToken va a la fila del calendario de Ana");
});

test("D16: un turno de clínica movido en Google no se reprograma; queda una sola tarea aunque la notificación se repita", async () => {
  await limpiar();
  const turno = await createBooking(
    clinica.id,
    {
      resourceId: clin.ana,
      serviceTypeId: clin.consulta,
      contactId: clin.contactId,
      startsAt: LUNES(11),
    },
    doblarGoogle().cliente,
  );
  const { googleEventId } = await prisma.booking.findUniqueOrThrow({ where: { id: turno.id } });
  const fila = await canalDeAnaConSyncToken();
  const movido: EventoCambiado = {
    id: googleEventId!,
    status: "confirmed",
    inicio: LUNES(12),
    fin: LUNES(13),
  };
  const token = await firmarWebhookToken({
    organizationId: clinica.id,
    branchId: clin.sede,
    channelId: fila.channelId!,
  });
  for (let i = 0; i < 2; i++) {
    await prisma.googleCalendarChannel.update({
      where: { id: fila.id },
      data: { syncToken: "token-de-ana" },
    });
    await procesarNotificacion(
      { channelId: fila.channelId!, resourceState: "exists", token },
      doblarGoogle({ cambios: [movido] }).cliente,
    );
  }
  const despues = await prisma.booking.findUniqueOrThrow({ where: { id: turno.id } });
  assert.deepEqual(despues.startsAt, LUNES(11), "el turno no se movió");
  assert.equal(despues.status, "CONFIRMED");
  const tareas = await prisma.activity.findMany({
    where: { organizationId: clinica.id, subject: { startsWith: PREFIJO_TAREA_MOVIDO_EN_GOOGLE } },
  });
  assert.equal(tareas.length, 1);
});

test("automotora: un turno borrado en Google se sigue cancelando solo, como hoy", async () => {
  await limpiar();
  const turno = await createBooking(
    automotora.id,
    {
      resourceId: auto.vendedor,
      serviceTypeId: auto.servicio,
      contactId: auto.contactId,
      startsAt: LUNES(9),
    },
    doblarGoogle().cliente,
  );
  const { googleEventId, googleCalendarId } = await prisma.booking.findUniqueOrThrow({
    where: { id: turno.id },
  });
  assert.equal(googleCalendarId, null);
  const channelId = randomUUID();
  await prisma.googleCalendarConnection.updateMany({
    where: { organizationId: automotora.id, branchId: auto.sede },
    data: {
      channelId,
      channelResourceId: "res-auto",
      channelExpiration: new Date(Date.now() + 86400000),
      syncToken: "token-auto",
    },
  });
  await prisma.googleCalendarChannel.create({
    data: {
      organizationId: automotora.id,
      branchId: auto.sede,
      calendarId: "primary",
      channelId,
      channelResourceId: "res-auto",
      channelExpiration: new Date(Date.now() + 86400000),
      syncToken: "token-auto",
    },
  });
  const token = await firmarWebhookToken({
    organizationId: automotora.id,
    branchId: auto.sede,
    channelId,
  });
  const resultado = await procesarNotificacion(
    { channelId, resourceState: "exists", token },
    doblarGoogle({ cambios: [{ id: googleEventId!, status: "cancelled" }] }).cliente,
  );
  assert.equal(resultado.bookingsCancelados, 1);
  const despues = await prisma.booking.findUniqueOrThrow({ where: { id: turno.id } });
  assert.equal(despues.status, "CANCELLED");
  assert.equal(await prisma.activity.count({ where: { organizationId: automotora.id } }), 0);
});

// ---------------------------------------------------------------------------
// Elegir el calendario de un profesional
// ---------------------------------------------------------------------------

test("asignar calendario: valida contra Google, rechaza el de la sede y el repetido, y al cambiarlo detiene el canal viejo", async () => {
  await limpiar();
  const conCanal = await canalDeAnaConSyncToken();
  const google = doblarGoogle({ calendarioRoto: "cal-sin-permiso" });

  await assert.rejects(
    asignarCalendarioAlProfesional(clinica.id, clin.bruno, "primary", google.cliente),
    (err: unknown) => err instanceof Error && /calendario de la sede/.test(err.message),
  );
  await assert.rejects(
    asignarCalendarioAlProfesional(clinica.id, clin.bruno, "cal-ana", google.cliente),
    (err: unknown) => err instanceof Error && /ya es de Ana/.test(err.message),
  );
  await assert.rejects(
    asignarCalendarioAlProfesional(clinica.id, clin.bruno, "cal-sin-permiso", google.cliente),
    (err: unknown) => err instanceof Error && /no puede usar ese calendario/.test(err.message),
  );

  const cambiado = await asignarCalendarioAlProfesional(
    clinica.id,
    clin.ana,
    "cal-ana-nuevo",
    google.cliente,
  );
  assert.equal(cambiado.googleCalendarId, "cal-ana-nuevo");
  assert.deepEqual(google.canalesDetenidos, [conCanal.channelId]);
  assert.equal(
    await prisma.googleCalendarChannel.count({ where: { id: conCanal.id } }),
    0,
    "la fila del calendario viejo se va; el worker abre la del nuevo",
  );

  const quitado = await asignarCalendarioAlProfesional(clinica.id, clin.ana, null, google.cliente);
  assert.equal(quitado.googleCalendarId, null);
});

test("asignar calendario abre el canal de Google en el momento; si falla, el worker lo abre en su pasada", async () => {
  await limpiar();
  await prisma.resource.update({ where: { id: clin.ana }, data: { googleCalendarId: null } });

  const google = doblarGoogle();
  const asignado = await asignarCalendarioAlProfesional(
    clinica.id,
    clin.ana,
    "cal-ana",
    google.cliente,
  );
  assert.equal(asignado.canalAbierto, true);
  assert.deepEqual(
    google.canalesCreados.map((c) => c.calendarId),
    ["cal-ana"],
    "se abrió en el momento, sin esperar al worker",
  );
  const fila = await prisma.googleCalendarChannel.findFirstOrThrow({
    where: { organizationId: clinica.id, resourceId: clin.ana },
  });
  assert.equal(fila.channelId, google.canalesCreados[0].channelId);
  // El worker no lo reabre: ya está vigente.
  const pasada = doblarGoogle();
  await renovarCanalesVencidos({ cliente: pasada.cliente, organizationId: clinica.id });
  assert.ok(!pasada.canalesCreados.some((c) => c.calendarId === "cal-ana"));

  // Con Google fallando al abrir el canal, la asignación vale igual y el
  // worker (el respaldo) lo abre después.
  await prisma.resource.update({ where: { id: clin.bruno }, data: { googleCalendarId: null } });
  try {
    const conFalla = doblarGoogle({ calendarioRoto: "cal-bruno" });
    conFalla.cliente.consultarFreeBusy = () => Promise.resolve([]);
    const deBruno = await asignarCalendarioAlProfesional(
      clinica.id,
      clin.bruno,
      "cal-bruno",
      conFalla.cliente,
    );
    assert.equal(deBruno.googleCalendarId, "cal-bruno");
    assert.equal(deBruno.canalAbierto, false);
    const sinCanal = await prisma.googleCalendarChannel.findFirstOrThrow({
      where: { organizationId: clinica.id, resourceId: clin.bruno },
    });
    assert.equal(sinCanal.channelId, null);
    assert.ok(sinCanal.lastErrorMessage);
    const respaldo = doblarGoogle();
    await renovarCanalesVencidos({ cliente: respaldo.cliente, organizationId: clinica.id });
    assert.ok(respaldo.canalesCreados.some((c) => c.calendarId === "cal-bruno"));
  } finally {
    await prisma.googleCalendarChannel.deleteMany({
      where: { organizationId: clinica.id, resourceId: clin.bruno },
    });
    await prisma.resource.update({ where: { id: clin.bruno }, data: { googleCalendarId: null } });
  }
});

test("la lista de calendarios: con el scope, la de la cuenta; sin él, 409 para usar el respaldo", async () => {
  const conLista = await listarCalendariosDeLaSede(
    clinica.id,
    clin.sede,
    doblarGoogle({ conLista: true }).cliente,
  );
  assert.deepEqual(conLista, [{ id: "cal-ana", summary: "Ana", accessRole: "owner" }]);
  await assert.rejects(
    listarCalendariosDeLaSede(clinica.id, clin.sede, doblarGoogle().cliente),
    (err: unknown) => err instanceof Error && "statusCode" in err && err.statusCode === 409,
  );
});

test("las rutas de R8 son de agenda_clinica: una automotora recibe 403 con motivo RUBRO", async () => {
  const lista = await pedir(
    automotora,
    "GET",
    `/api/branches/${auto.sede}/google-calendar/calendars`,
  );
  assert.equal(lista.status, 403);
  assert.equal(lista.json.error?.motivo, "RUBRO");
  const asignar = await pedir(
    automotora,
    "PUT",
    `/api/clinica/profesionales/${auto.vendedor}/google-calendar`,
    { calendarId: "x" },
  );
  assert.equal(asignar.status, 403);
  // Recepción de la clínica no configura el calendario.
  const deRecepcion = await pedir(
    clinica,
    "PUT",
    `/api/clinica/profesionales/${clin.bruno}/google-calendar`,
    { calendarId: "x" },
    clinica.tokens[1],
  );
  assert.equal(deRecepcion.status, 403);
});

// ---------------------------------------------------------------------------
// Archivar un profesional (el "eliminar" de recursos es un soft delete).
// ---------------------------------------------------------------------------

test("archivar un profesional con calendario y bloqueos: se borra su fila de canal, se detiene el canal en Google y los bloqueos quedan", async () => {
  await limpiar();
  const carla = await createResource(clinica.id, {
    branchId: clin.sede,
    name: "Carla",
    type: "PERSON",
  });
  await prisma.resource.update({
    where: { id: carla.id },
    data: { googleCalendarId: "cal-carla" },
  });
  await prisma.resourceTimeOff.create({
    data: {
      organizationId: clinica.id,
      resourceId: carla.id,
      startsAt: LUNES(9),
      endsAt: LUNES(10),
    },
  });
  try {
    await renovarCanalesVencidos({ cliente: doblarGoogle().cliente, organizationId: clinica.id });
    const fila = await prisma.googleCalendarChannel.findFirstOrThrow({
      where: { organizationId: clinica.id, resourceId: carla.id },
    });
    assert.ok(fila.channelId);

    const google = doblarGoogle();
    await deleteResource(clinica.id, carla.id, google.cliente);

    const archivada = await prisma.resource.findUniqueOrThrow({ where: { id: carla.id } });
    assert.ok(archivada.deletedAt, "se archiva, no se borra la fila");
    assert.deepEqual(google.canalesDetenidos, [fila.channelId]);
    assert.equal(await prisma.googleCalendarChannel.count({ where: { id: fila.id } }), 0);
    assert.equal(
      await prisma.resourceTimeOff.count({ where: { resourceId: carla.id } }),
      1,
      "los bloqueos quedan como historia: con soft delete el RESTRICT no se dispara",
    );

    // Una notificación tardía de ese canal ya no encuentra fila.
    const token = await firmarWebhookToken({
      organizationId: clinica.id,
      branchId: clin.sede,
      channelId: fila.channelId!,
    });
    const tardia = await procesarNotificacion(
      { channelId: fila.channelId!, resourceState: "exists", token },
      doblarGoogle().cliente,
    );
    assert.equal(tardia.accion, "canal-desconocido");
    // Y el worker no lo vuelve a abrir.
    const pasada = doblarGoogle();
    await renovarCanalesVencidos({ cliente: pasada.cliente, organizationId: clinica.id });
    assert.ok(!pasada.canalesCreados.some((c) => c.calendarId === "cal-carla"));
  } finally {
    await prisma.resourceTimeOff.deleteMany({ where: { resourceId: carla.id } });
  }
});

test("archivar un recurso aunque Google falle al detener el canal: el archivado vale igual", async () => {
  await limpiar();
  const dario = await createResource(clinica.id, {
    branchId: clin.sede,
    name: "Darío",
    type: "PERSON",
  });
  await prisma.resource.update({
    where: { id: dario.id },
    data: { googleCalendarId: "cal-dario" },
  });
  await renovarCanalesVencidos({ cliente: doblarGoogle().cliente, organizationId: clinica.id });
  const google = doblarGoogle();
  google.cliente.detenerCanal = () => Promise.reject(new Error("Google caído"));
  await deleteResource(clinica.id, dario.id, google.cliente);
  const archivado = await prisma.resource.findUniqueOrThrow({ where: { id: dario.id } });
  assert.ok(archivado.deletedAt);
  assert.equal(await prisma.googleCalendarChannel.count({ where: { resourceId: dario.id } }), 0);
});
