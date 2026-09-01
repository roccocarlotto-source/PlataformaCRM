import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { createBooking as insertarReserva } from "../repositories/booking.repository";
import { lockResourceForUpdate } from "../repositories/resource.repository";
import { AppError } from "../utils/AppError";
import { getCifrador } from "../utils/encryption";
import { obtenerDisponibilidad } from "./availability.service";
import { cancelBooking, createBooking } from "./booking.service";
import { createBranch } from "./branch.service";
import { createResource, deleteResource } from "./resource.service";
import { createServiceType, deleteServiceType, updateServiceType } from "./serviceType.service";
import { replaceWorkingHoursForResource } from "./workingHours.service";
import {
  GoogleAuthError,
  type ClienteGoogleCalendar,
  type IntervaloOcupado,
} from "./googleCalendar.service";

// ---------------------------------------------------------------------------
// P2.1, paso 3 — horario de trabajo, disponibilidad y reservas, contra Postgres
// real.
//
// GOOGLE ESTÁ MOCKEADO SIEMPRE. Lo real es todo lo demás: la base, las FKs
// compuestas, los CHECK, los locks y la aritmética de horarios.
//
// Lo que se prueba acá y no se puede probar sin base:
//
//   1. El horario de trabajo se guarda y se reemplaza entero.
//   2. La disponibilidad sale del horario real y descuenta reservas reales.
//   3. POST /api/bookings rechaza fuera de horario y por capacidad, CON la misma
//      lógica que la disponibilidad usa para ofrecer.
//   4. Un fallo de Google —o una sucursal sin Google— NO bloquea la reserva.
//   5. La cancelación libera el cupo.
//   6. El RESTRICT de deleteServiceType ahora cuenta reservas reales.
//
// CADA TEST TRAE SU PROPIA ORGANIZACIÓN, mismo criterio que los otros archivos
// de integración: el runner los corre en paralelo contra una base compartida.

const TZ = "America/Argentina/Buenos_Aires"; // UTC-3, sin horario de verano

interface Escenario {
  organizationId: string;
  branchId: string;
  resourceId: string;
  serviceTypeId: string;
  contactId: string;
}

// Lunes 7 de septiembre de 2026. 9 a 13 local = 12:00Z a 16:00Z.
const LUNES_9_LOCAL = new Date("2026-09-07T12:00:00Z");

async function montar(
  etiqueta: string,
  opciones: { durationMin?: number; capacity?: number; conHorario?: boolean } = {},
): Promise<Escenario> {
  const org = await prisma.organization.create({
    data: {
      name: `Booking3 ${etiqueta} ${randomUUID()}`,
      slug: `booking3-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });

  const branch = await createBranch(org.id, { name: "Centro", timezone: TZ });

  const resource = await createResource(org.id, {
    branchId: branch.id,
    name: "Juan (barbero)",
    type: "PERSON",
  });

  const serviceType = await createServiceType(org.id, {
    branchId: branch.id,
    resourceId: resource.id,
    name: "Corte de pelo",
    durationMin: opciones.durationMin ?? 60,
    capacity: opciones.capacity ?? 1,
  });

  const contact = await prisma.contact.create({
    data: { organizationId: org.id, firstName: "Ana", lastName: "Pérez" },
  });

  if (opciones.conHorario !== false) {
    // Lunes de 9 a 13, hora local de la sucursal.
    await replaceWorkingHoursForResource(org.id, resource.id, [
      { weekday: "MONDAY", startMinute: 540, endMinute: 780 },
    ]);
  }

  return {
    organizationId: org.id,
    branchId: branch.id,
    resourceId: resource.id,
    serviceTypeId: serviceType.id,
    contactId: contact.id,
  };
}

async function desmontar(escenario: Escenario) {
  const where = { organizationId: escenario.organizationId };
  await prisma.booking.deleteMany({ where });
  await prisma.workingHours.deleteMany({ where });
  await prisma.googleCalendarConnection.deleteMany({ where });
  await prisma.serviceType.deleteMany({ where });
  await prisma.resource.deleteMany({ where });
  await prisma.branch.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await prisma.organization.delete({ where: { id: escenario.organizationId } });
}

function assertAppError(err: unknown, statusCode: number) {
  assert.ok(err instanceof AppError, `debe ser AppError, no un error crudo. Fue: ${String(err)}`);
  assert.equal(err.statusCode, statusCode);
}

async function capturar(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  assert.fail("se esperaba un error y no hubo ninguno");
}

// ---------------------------------------------------------------------------
// El doble de Google
// ---------------------------------------------------------------------------

interface OpcionesDelDoble {
  ocupados?: IntervaloOcupado[];
  fallaAlCrearEvento?: Error;
  fallaAlEliminarEvento?: Error;
  fallaAlConsultar?: Error;
  eventId?: string;
  // M-2: se llama cuando el service YA LLEGÓ a Google (la reserva está
  // commiteada) y la promesa que devuelve es lo que el doble espera antes de
  // responder con el id. Es lo que le da al test el control de la ventana
  // entre el commit y la respuesta de Google: puede cancelar de verdad en el
  // medio y recién después soltar la respuesta.
  alCrearEvento?: () => Promise<void> | void;
}

interface Doble {
  cliente: ClienteGoogleCalendar;
  eventosCreados: { titulo: string; zona: string }[];
  eventosBorrados: string[];
}

// SIN conexión a Google en la base, obtenerAccessToken lanza 404 antes de tocar
// al cliente — así que este doble solo se ejercita de verdad en los tests que
// crean la fila de conexión. Los demás recorren el camino "sin Google", que es
// justamente el que tiene que funcionar igual.
function doblarGoogle(opciones: OpcionesDelDoble = {}): Doble {
  const eventosCreados: { titulo: string; zona: string }[] = [];
  const eventosBorrados: string[] = [];

  const cliente: ClienteGoogleCalendar = {
    construirUrlDeAutorizacion: (state) => `https://accounts.google.com/fake?state=${state}`,
    intercambiarCodigo: () =>
      Promise.resolve({
        refreshToken: "1//refresh-de-prueba",
        accessToken: "access",
        expiraEnSegundos: 3599,
        scope: "",
      }),
    renovarAccessToken: () =>
      Promise.resolve({ accessToken: "access-renovado", expiraEnSegundos: 3599, scope: "" }),
    revocarToken: () => Promise.resolve(),
    consultarFreeBusy: () =>
      opciones.fallaAlConsultar
        ? Promise.reject(opciones.fallaAlConsultar)
        : Promise.resolve(opciones.ocupados ?? []),
    crearEvento: async (evento) => {
      if (opciones.fallaAlCrearEvento) {
        throw opciones.fallaAlCrearEvento;
      }
      eventosCreados.push({ titulo: evento.titulo, zona: evento.zona });
      await opciones.alCrearEvento?.();
      return opciones.eventId ?? "evento-google-1";
    },
    eliminarEvento: (evento) => {
      if (opciones.fallaAlEliminarEvento) {
        return Promise.reject(opciones.fallaAlEliminarEvento);
      }
      eventosBorrados.push(evento.eventId);
      return Promise.resolve();
    },

    // Agregados en el paso 4 (sincronización inversa). Este archivo no los
    // ejercita —lo hace googleCalendarSync.integration-test.ts— pero la interfaz
    // los exige. Lanzan a propósito: si algún test de acá terminara llamándolos,
    // el fallo dice qué pasó en vez de devolver un valor inventado.
    crearCanalDeNotificaciones: () =>
      Promise.reject(new Error("crearCanalDeNotificaciones no se usa en este archivo")),
    detenerCanal: () => Promise.resolve(),
    listarCambios: () => Promise.reject(new Error("listarCambios no se usa en este archivo")),
  };

  return { cliente, eventosCreados, eventosBorrados };
}

// Conecta Google para una sucursal escribiendo la fila directamente: el flujo
// OAuth completo ya está probado en google-calendar-connection.integration-test.
async function conectarGoogle(escenario: Escenario) {
  await prisma.googleCalendarConnection.create({
    data: {
      organizationId: escenario.organizationId,
      branchId: escenario.branchId,
      refreshToken: getCifrador().encrypt("1//refresh-de-prueba"),
      calendarId: "primary",
      status: "ACTIVE",
    },
  });
}

// ---------------------------------------------------------------------------
// 1. Horario de trabajo
// ---------------------------------------------------------------------------

test("el horario semanal se guarda y se lee con las horas en formato local", async () => {
  const escenario = await montar("horario");
  try {
    const franjas = await replaceWorkingHoursForResource(
      escenario.organizationId,
      escenario.resourceId,
      [
        { weekday: "MONDAY", startMinute: 540, endMinute: 780 },
        { weekday: "MONDAY", startMinute: 960, endMinute: 1200 },
        { weekday: "TUESDAY", startMinute: 540, endMinute: 780 },
      ],
    );

    assert.equal(franjas.length, 3);
    assert.deepEqual(franjas[0], { weekday: "MONDAY", startTime: "09:00", endTime: "13:00" });
    assert.deepEqual(franjas[1], { weekday: "MONDAY", startTime: "16:00", endTime: "20:00" });
    assert.deepEqual(franjas[2], { weekday: "TUESDAY", startTime: "09:00", endTime: "13:00" });
  } finally {
    await desmontar(escenario);
  }
});

test("reemplazar el horario BORRA el anterior en vez de acumular", async () => {
  const escenario = await montar("reemplazo");
  try {
    await replaceWorkingHoursForResource(escenario.organizationId, escenario.resourceId, [
      { weekday: "MONDAY", startMinute: 540, endMinute: 780 },
      { weekday: "TUESDAY", startMinute: 540, endMinute: 780 },
    ]);

    const despues = await replaceWorkingHoursForResource(
      escenario.organizationId,
      escenario.resourceId,
      [{ weekday: "FRIDAY", startMinute: 600, endMinute: 720 }],
    );

    assert.equal(despues.length, 1, "no acumula: reemplaza");
    assert.equal(despues[0].weekday, "FRIDAY");

    const enBase = await prisma.workingHours.count({
      where: { resourceId: escenario.resourceId },
    });
    assert.equal(enBase, 1);
  } finally {
    await desmontar(escenario);
  }
});

test("un horario vacío es válido y deja al recurso sin atender", async () => {
  const escenario = await montar("vacio");
  try {
    const franjas = await replaceWorkingHoursForResource(
      escenario.organizationId,
      escenario.resourceId,
      [],
    );

    assert.deepEqual(franjas, []);

    // Y la consecuencia: sin horario no hay disponibilidad, y eso no es un error.
    const turnos = await obtenerDisponibilidad(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        desde: new Date("2026-09-07T00:00:00Z"),
        hasta: new Date("2026-09-08T00:00:00Z"),
      },
      doblarGoogle().cliente,
    );

    assert.deepEqual(turnos, []);
  } finally {
    await desmontar(escenario);
  }
});

test("franjas superpuestas del mismo día se rechazan", async () => {
  const escenario = await montar("superpuestas");
  try {
    assertAppError(
      await capturar(() =>
        replaceWorkingHoursForResource(escenario.organizationId, escenario.resourceId, [
          { weekday: "MONDAY", startMinute: 540, endMinute: 780 },
          { weekday: "MONDAY", startMinute: 720, endMinute: 1200 },
        ]),
      ),
      400,
    );
  } finally {
    await desmontar(escenario);
  }
});

test("la base RECHAZA una franja con fin anterior al inicio", async () => {
  // El CHECK de la migración: la defensa que sobrevive a un camino de escritura
  // que no pase por el service.
  const escenario = await montar("check-franja");
  try {
    await assert.rejects(
      () =>
        prisma.workingHours.create({
          data: {
            organizationId: escenario.organizationId,
            resourceId: escenario.resourceId,
            weekday: "MONDAY",
            startMinute: 780,
            endMinute: 540,
          },
        }),
      /minute_range/,
    );
  } finally {
    await desmontar(escenario);
  }
});

test("el horario de un recurso de OTRA organización da 404", async () => {
  const a = await montar("iso-a");
  const b = await montar("iso-b");
  try {
    assertAppError(
      await capturar(() => replaceWorkingHoursForResource(b.organizationId, a.resourceId, [])),
      404,
    );
  } finally {
    await desmontar(a);
    await desmontar(b);
  }
});

// ---------------------------------------------------------------------------
// 2. Disponibilidad
// ---------------------------------------------------------------------------

test("la disponibilidad sale del horario real, en la zona de la sucursal", async () => {
  const escenario = await montar("dispo");
  try {
    const turnos = await obtenerDisponibilidad(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        desde: new Date("2026-09-07T00:00:00Z"),
        hasta: new Date("2026-09-08T00:00:00Z"),
      },
      doblarGoogle().cliente,
    );

    // Lunes 9 a 13 local (UTC-3) = 12:00Z a 16:00Z, turnos de 60 minutos.
    assert.equal(turnos.length, 4);
    assert.equal(turnos[0].inicio.toISOString(), "2026-09-07T12:00:00.000Z");
    assert.equal(turnos[3].fin.toISOString(), "2026-09-07T16:00:00.000Z");
  } finally {
    await desmontar(escenario);
  }
});

test("una reserva existente desaparece de la disponibilidad", async () => {
  const escenario = await montar("dispo-reserva");
  try {
    await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doblarGoogle().cliente,
    );

    const turnos = await obtenerDisponibilidad(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        desde: new Date("2026-09-07T00:00:00Z"),
        hasta: new Date("2026-09-08T00:00:00Z"),
      },
      doblarGoogle().cliente,
    );

    assert.equal(turnos.length, 3);
    assert.ok(
      !turnos.some((t) => t.inicio.getTime() === LUNES_9_LOCAL.getTime()),
      "el horario reservado no puede seguir ofreciéndose",
    );
  } finally {
    await desmontar(escenario);
  }
});

test("un evento en Google descuenta de la disponibilidad", async () => {
  const escenario = await montar("dispo-google");
  try {
    await conectarGoogle(escenario);

    const turnos = await obtenerDisponibilidad(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        desde: new Date("2026-09-07T00:00:00Z"),
        hasta: new Date("2026-09-08T00:00:00Z"),
      },
      doblarGoogle({
        ocupados: [{ inicio: "2026-09-07T13:00:00Z", fin: "2026-09-07T14:00:00Z" }],
      }).cliente,
    );

    assert.equal(turnos.length, 3);
    assert.ok(!turnos.some((t) => t.inicio.toISOString() === "2026-09-07T13:00:00.000Z"));
  } finally {
    await desmontar(escenario);
  }
});

test("si Google falla, la disponibilidad se calcula igual con lo local", async () => {
  // Devolver un 500 dejaría la agenda entera inutilizable por un problema
  // ajeno. Se acepta el riesgo de ofrecer un turno de más.
  const escenario = await montar("dispo-google-caido");
  try {
    await conectarGoogle(escenario);

    const turnos = await obtenerDisponibilidad(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        desde: new Date("2026-09-07T00:00:00Z"),
        hasta: new Date("2026-09-08T00:00:00Z"),
      },
      doblarGoogle({
        fallaAlConsultar: new GoogleAuthError("Google caído", false),
      }).cliente,
    );

    assert.equal(turnos.length, 4, "el horario de trabajo sigue produciendo turnos");
  } finally {
    await desmontar(escenario);
  }
});

test("una clase con cupo muestra los lugares restantes en vez de desaparecer", async () => {
  // EL CASO QUE JUSTIFICA QUE LA CAPACIDAD VIVA ACÁ Y NO EN GOOGLE.
  const escenario = await montar("cupo", { capacity: 3 });
  try {
    await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doblarGoogle().cliente,
    );

    const turnos = await obtenerDisponibilidad(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        desde: new Date("2026-09-07T00:00:00Z"),
        hasta: new Date("2026-09-08T00:00:00Z"),
      },
      doblarGoogle().cliente,
    );

    const conInscripto = turnos.find((t) => t.inicio.getTime() === LUNES_9_LOCAL.getTime());
    assert.ok(conInscripto, "la clase sigue disponible con un solo inscripto");
    assert.equal(conInscripto.lugaresDisponibles, 2);
  } finally {
    await desmontar(escenario);
  }
});

test("pedir disponibilidad de un servicio que ese recurso no provee da 400", async () => {
  const escenario = await montar("cruce");
  try {
    const otroRecurso = await createResource(escenario.organizationId, {
      branchId: escenario.branchId,
      name: "Sala 2",
      type: "ROOM",
    });

    assertAppError(
      await capturar(() =>
        obtenerDisponibilidad(
          escenario.organizationId,
          {
            resourceId: otroRecurso.id,
            serviceTypeId: escenario.serviceTypeId,
            desde: new Date("2026-09-07T00:00:00Z"),
            hasta: new Date("2026-09-08T00:00:00Z"),
          },
          doblarGoogle().cliente,
        ),
      ),
      400,
    );
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// 3. Crear reservas
// ---------------------------------------------------------------------------

test("una reserva dentro del horario se crea, con endsAt derivado de la duración", async () => {
  const escenario = await montar("crear", { durationMin: 30 });
  try {
    const booking = await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doblarGoogle().cliente,
    );

    assert.equal(booking.status, "CONFIRMED");
    assert.equal(booking.startsAt.toISOString(), "2026-09-07T12:00:00.000Z");
    // El fin sale de durationMin, no de quien llama.
    assert.equal(booking.endsAt.toISOString(), "2026-09-07T12:30:00.000Z");
    assert.equal(booking.branchId, escenario.branchId, "la sucursal se deriva del recurso");
  } finally {
    await desmontar(escenario);
  }
});

test("una reserva FUERA del horario de trabajo se rechaza", async () => {
  const escenario = await montar("fuera-horario");
  try {
    // Lunes a las 20:00Z = 17:00 local, ya cerró (trabaja 9 a 13).
    const err = await capturar(() =>
      createBooking(
        escenario.organizationId,
        {
          resourceId: escenario.resourceId,
          serviceTypeId: escenario.serviceTypeId,
          contactId: escenario.contactId,
          startsAt: new Date("2026-09-07T20:00:00Z"),
        },
        doblarGoogle().cliente,
      ),
    );

    assertAppError(err, 400);
    assert.ok((err as AppError).message.includes("horario de trabajo"));
  } finally {
    await desmontar(escenario);
  }
});

test("una reserva que EXCEDE el cierre se rechaza aunque empiece en horario", async () => {
  // Servicio de 60 minutos empezando 12:30 local: terminaría 13:30, media hora
  // después del cierre. Es el mismo criterio con el que la disponibilidad no lo
  // ofrece — y probar los dos lados juntos es lo que garantiza que no divergen.
  const escenario = await montar("excede-cierre");
  try {
    assertAppError(
      await capturar(() =>
        createBooking(
          escenario.organizationId,
          {
            resourceId: escenario.resourceId,
            serviceTypeId: escenario.serviceTypeId,
            contactId: escenario.contactId,
            startsAt: new Date("2026-09-07T15:30:00Z"), // 12:30 local
          },
          doblarGoogle().cliente,
        ),
      ),
      400,
    );
  } finally {
    await desmontar(escenario);
  }
});

test("un día SIN franja cargada rechaza la reserva", async () => {
  const escenario = await montar("dia-sin-franja");
  try {
    // Martes 8/9 a las 12:00Z: el recurso solo trabaja los lunes.
    assertAppError(
      await capturar(() =>
        createBooking(
          escenario.organizationId,
          {
            resourceId: escenario.resourceId,
            serviceTypeId: escenario.serviceTypeId,
            contactId: escenario.contactId,
            startsAt: new Date("2026-09-08T12:00:00Z"),
          },
          doblarGoogle().cliente,
        ),
      ),
      400,
    );
  } finally {
    await desmontar(escenario);
  }
});

test("con capacidad 1, el MISMO horario no se puede reservar dos veces", async () => {
  const escenario = await montar("capacidad-1");
  try {
    await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doblarGoogle().cliente,
    );

    assertAppError(
      await capturar(() =>
        createBooking(
          escenario.organizationId,
          {
            resourceId: escenario.resourceId,
            serviceTypeId: escenario.serviceTypeId,
            contactId: escenario.contactId,
            startsAt: LUNES_9_LOCAL,
          },
          doblarGoogle().cliente,
        ),
      ),
      409,
    );
  } finally {
    await desmontar(escenario);
  }
});

test("dos reservas que se PISAN PARCIALMENTE también chocan", async () => {
  // El caso que el prompt marca explícitamente: no alcanza con comparar horarios
  // idénticos. Servicio de 60 minutos: 12:00-13:00 y 12:30-13:30 compiten por el
  // mismo barbero.
  const escenario = await montar("pisada-parcial");
  try {
    await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doblarGoogle().cliente,
    );

    assertAppError(
      await capturar(() =>
        createBooking(
          escenario.organizationId,
          {
            resourceId: escenario.resourceId,
            serviceTypeId: escenario.serviceTypeId,
            contactId: escenario.contactId,
            startsAt: new Date("2026-09-07T12:30:00Z"),
          },
          doblarGoogle().cliente,
        ),
      ),
      409,
    );
  } finally {
    await desmontar(escenario);
  }
});

test("dos reservas CONSECUTIVAS sí se pueden agendar", async () => {
  // El contrapunto: si el chequeo de superposición usara <=, no se podría
  // trabajar de corrido.
  const escenario = await montar("consecutivas", { durationMin: 60 });
  try {
    await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doblarGoogle().cliente,
    );

    const segunda = await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: new Date("2026-09-07T13:00:00Z"),
      },
      doblarGoogle().cliente,
    );

    assert.equal(segunda.status, "CONFIRMED");
  } finally {
    await desmontar(escenario);
  }
});

test("una clase con cupo acepta varias reservas y rechaza la que pasa el tope", async () => {
  const escenario = await montar("cupo-tope", { capacity: 2 });
  try {
    for (let i = 0; i < 2; i++) {
      await createBooking(
        escenario.organizationId,
        {
          resourceId: escenario.resourceId,
          serviceTypeId: escenario.serviceTypeId,
          contactId: escenario.contactId,
          startsAt: LUNES_9_LOCAL,
        },
        doblarGoogle().cliente,
      );
    }

    const err = await capturar(() =>
      createBooking(
        escenario.organizationId,
        {
          resourceId: escenario.resourceId,
          serviceTypeId: escenario.serviceTypeId,
          contactId: escenario.contactId,
          startsAt: LUNES_9_LOCAL,
        },
        doblarGoogle().cliente,
      ),
    );

    assertAppError(err, 409);
    assert.ok((err as AppError).message.includes("lugares"));
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// A-7 (docs/auditoria-2026-08-29.md) — LA CARRERA POR EL ÚLTIMO CUPO, forzada
// de verdad y contra el lock correcto.
//
// El test anterior hacía Promise.allSettled sobre dos createBooking reales del
// MISMO servicio y esperaba que el scheduler los solapara antes de que ninguno
// commiteara. Dos problemas, independientes:
//
//   1. NO FORZABA EL SOLAPAMIENTO. Cada createBooking hace varias lecturas
//      fuera de transacción antes de la FASE 2; que los dos llegaran al conteo
//      antes de que ninguno insertara dependía del timing. Con el lock sacado,
//      el test detectaba el bug a veces.
//   2. EL LOCK QUE DECÍA PROBAR ERA REDUNDANTE EN ÉL MISMO. createBooking toma
//      DOS locks —resource y después serviceType— y las dos reservas usaban el
//      mismo serviceTypeId, así que sacar lockResourceForUpdate y dejar solo
//      lockServiceTypeForUpdate dejaba el test verde: el del servicio ya
//      serializaba dos reservas del mismo servicio.
//
// Lo que se hace ahora, con la misma técnica de T-1
// (activity.service.integration-test.ts) y del test de A-1 en
// stage.service.integration-test.ts:
//
//   - DOS SERVICIOS DISTINTOS SOBRE EL MISMO RECURSO ("Corte" y "Barba" del
//     mismo barbero). Es el caso real que countOverlappingBookings describe:
//     compiten por el recurso aunque no sean el mismo servicio. Y es lo que
//     hace que el lock del servicio NO alcance: cada uno lockea SU servicio, y
//     el único lock que comparten es el del recurso.
//   - Una transacción A del test toma el lock del recurso con la misma sentencia
//     que usa createBooking (lockResourceForUpdate), inserta la reserva de
//     "Corte" —lo que haría un createBooking que llegó primero— y se queda
//     abierta sin commitear.
//   - Se arranca el createBooking REAL de "Barba" y se confirma contra
//     pg_stat_activity que quedó bloqueado por A, y contra pg_locks que lo que
//     espera es la fila de `resources` — no otra cosa.
//   - Recién entonces se libera A, y el service tiene que perder con 409.
//
// POR QUÉ ESTO SÍ DISTINGUE EL LOCK CORRECTO: si alguien saca
// lockResourceForUpdate de createBooking y deja lockServiceTypeForUpdate, la
// reserva de "Barba" lockea el servicio "Barba" (libre), NO se bloquea, cuenta
// cero (la de "Corte" sigue sin commitear bajo READ COMMITTED), inserta y
// commitea — y el test falla dos veces: no se detecta ningún backend bloqueado,
// y la base termina con DOS reservas CONFIRMED para el mismo barbero a la misma
// hora. Con el lock, la reserva de "Barba" espera en `resources` hasta que A
// commitea, relee, cuenta uno y rechaza.
//
// Lo que NO cambia acá es el service: este PR es de calidad de test.
// ---------------------------------------------------------------------------

// Corre `escrituras` dentro de una transacción A que primero toma el lock del
// recurso y queda abierta; arranca `operacionDelService` mientras A sigue
// abierta; confirma contra Postgres que quedó bloqueada por A y sobre qué
// relación espera; libera A; devuelve el resultado del service (o su error).
async function correrContraRecursoBloqueado<T>(
  escenario: Escenario,
  escrituras: (txA: Prisma.TransactionClient) => Promise<void>,
  operacionDelService: () => Promise<T>,
): Promise<{ resultado: PromiseSettledResult<T>; relacionesEnEspera: string[] }> {
  let aPid: number | undefined;

  let signalAHaEscrito: () => void;
  const aHaEscrito = new Promise<void>((resolve) => {
    signalAHaEscrito = resolve;
  });

  let liberarA: () => void;
  const liberacionDeA = new Promise<void>((resolve) => {
    liberarA = resolve;
  });

  // maxWait/timeout generosos: el plazo real lo administra liberacionDeA, no el
  // default de 5 s de $transaction — mismo criterio que T-1.
  const txAPromise = prisma.$transaction(
    async (txA) => {
      const pidRow = await txA.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      aPid = pidRow[0].pid;

      await lockResourceForUpdate(escenario.resourceId, escenario.organizationId, txA);
      await escrituras(txA);

      signalAHaEscrito();
      await liberacionDeA;
    },
    { maxWait: 15000, timeout: 15000 },
  );

  await aHaEscrito;
  assert.ok(aPid !== undefined, "debe conocerse el pid de la transacción A");

  const servicePromise = operacionDelService();
  // Evita un unhandledRejection mientras el polling mantiene la promesa
  // pendiente; el resultado real se consume más abajo.
  servicePromise.catch(() => {});

  // Confirmo contra Postgres real que hay un backend bloqueado por A, y capturo
  // su pid para preguntarle a pg_locks sobre qué fila espera.
  let pidBloqueado: number | undefined;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<{ pid: number }[]>`
      SELECT pid FROM pg_stat_activity
      WHERE ${aPid}::int = ANY(pg_blocking_pids(pid))
    `;
    if (rows.length > 0) {
      pidBloqueado = rows[0].pid;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.ok(
    pidBloqueado !== undefined,
    "no se detectó ningún backend bloqueado por el lock del recurso dentro del plazo — sin lockResourceForUpdate, createBooking no espera a nadie y sobrevende el cupo",
  );

  // Un backend que espera un lock de fila sostiene un lock `tuple` sobre la
  // relación de esa fila. Es lo que dice EN QUÉ TABLA se trabó.
  const enEspera = await prisma.$queryRaw<{ relname: string }[]>`
    SELECT c.relname
    FROM pg_locks l
    JOIN pg_class c ON c.oid = l.relation
    WHERE l.pid = ${pidBloqueado}::int AND l.locktype = 'tuple'
  `;
  const relacionesEnEspera = enEspera.map((r) => r.relname);

  liberarA!();
  await txAPromise;

  const [resultado] = await Promise.allSettled([servicePromise]);
  return { resultado, relacionesEnEspera };
}

test("A-7: DOS SERVICIOS DISTINTOS del mismo recurso compiten por el último cupo — el segundo espera el lock del RECURSO y pierde con 409", async () => {
  const escenario = await montar("carrera");
  try {
    // El segundo servicio del mismo barbero. Misma duración y capacidad 1: dos
    // turnos de una hora a la misma hora no entran en la misma persona.
    const barba = await createServiceType(escenario.organizationId, {
      branchId: escenario.branchId,
      resourceId: escenario.resourceId,
      name: "Barba",
      durationMin: 60,
      capacity: 1,
    });

    const finDelTurno = new Date(LUNES_9_LOCAL.getTime() + 60 * 60 * 1000);

    const { resultado, relacionesEnEspera } = await correrContraRecursoBloqueado(
      escenario,
      // A: la reserva de "Corte" que llegó primero, todavía sin commitear.
      async (txA) => {
        await insertarReserva(
          {
            organizationId: escenario.organizationId,
            branchId: escenario.branchId,
            serviceTypeId: escenario.serviceTypeId,
            resourceId: escenario.resourceId,
            contactId: escenario.contactId,
            startsAt: LUNES_9_LOCAL,
            endsAt: finDelTurno,
          },
          txA,
        );
      },
      // El service real: la reserva de "Barba", mismo barbero, misma hora.
      () =>
        createBooking(
          escenario.organizationId,
          {
            resourceId: escenario.resourceId,
            serviceTypeId: barba.id,
            contactId: escenario.contactId,
            startsAt: LUNES_9_LOCAL,
          },
          doblarGoogle().cliente,
        ),
    );

    assert.deepEqual(
      relacionesEnEspera,
      ["resources"],
      "createBooking tiene que esperar el FOR UPDATE del RECURSO: el lock del servicio no sirve acá porque 'Barba' y 'Corte' son servicios distintos",
    );

    assert.equal(resultado.status, "rejected", "la segunda reserva tiene que perder");
    assertAppError((resultado as PromiseRejectedResult).reason, 409);
    assert.ok(
      ((resultado as PromiseRejectedResult).reason as AppError).message.includes("reservado"),
    );

    const enBase = await prisma.booking.findMany({
      where: { resourceId: escenario.resourceId, status: "CONFIRMED" },
      select: { serviceTypeId: true },
    });
    assert.equal(enBase.length, 1, "un solo turno CONFIRMED para el barbero a esa hora");
    assert.equal(enBase[0].serviceTypeId, escenario.serviceTypeId, "y es el que llegó primero");
  } finally {
    await desmontar(escenario);
  }
});

test("A-7: la contracara — con el cupo LIBRE, la reserva que esperó el lock del recurso entra al liberarse", async () => {
  // Misma barrera, sin reserva previa: A solo sostiene el lock del recurso. Es
  // lo que prueba que el lock serializa y no bloquea de más — la reserva que
  // esperó no pierde nada por haber esperado.
  const escenario = await montar("carrera-libre");
  try {
    const barba = await createServiceType(escenario.organizationId, {
      branchId: escenario.branchId,
      resourceId: escenario.resourceId,
      name: "Barba",
      durationMin: 60,
      capacity: 1,
    });

    const { resultado, relacionesEnEspera } = await correrContraRecursoBloqueado(
      escenario,
      async () => undefined,
      () =>
        createBooking(
          escenario.organizationId,
          {
            resourceId: escenario.resourceId,
            serviceTypeId: barba.id,
            contactId: escenario.contactId,
            startsAt: LUNES_9_LOCAL,
          },
          doblarGoogle().cliente,
        ),
    );

    assert.deepEqual(relacionesEnEspera, ["resources"]);
    assert.equal(resultado.status, "fulfilled", "sin competencia real, la reserva entra");

    const enBase = await prisma.booking.count({
      where: { resourceId: escenario.resourceId, status: "CONFIRMED" },
    });
    assert.equal(enBase, 1);
  } finally {
    await desmontar(escenario);
  }
});

test("un contacto de otra organización no se puede reservar", async () => {
  const a = await montar("contacto-a");
  const b = await montar("contacto-b");
  try {
    assertAppError(
      await capturar(() =>
        createBooking(
          a.organizationId,
          {
            resourceId: a.resourceId,
            serviceTypeId: a.serviceTypeId,
            contactId: b.contactId,
            startsAt: LUNES_9_LOCAL,
          },
          doblarGoogle().cliente,
        ),
      ),
      400,
    );
  } finally {
    await desmontar(a);
    await desmontar(b);
  }
});

test("la base RECHAZA una reserva con fin anterior al inicio", async () => {
  const escenario = await montar("check-reserva");
  try {
    await assert.rejects(
      () =>
        prisma.booking.create({
          data: {
            organizationId: escenario.organizationId,
            branchId: escenario.branchId,
            serviceTypeId: escenario.serviceTypeId,
            resourceId: escenario.resourceId,
            contactId: escenario.contactId,
            startsAt: new Date("2026-09-07T13:00:00Z"),
            endsAt: new Date("2026-09-07T12:00:00Z"),
          },
        }),
      /time_range/,
    );
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// 4. Google NO bloquea la reserva — §4 del documento de diseño
// ---------------------------------------------------------------------------

test("una sucursal SIN Google conectado reserva igual, sin googleEventId", async () => {
  // NO ES UN ERROR: conectar Google es opcional.
  const escenario = await montar("sin-google");
  try {
    const booking = await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doblarGoogle().cliente,
    );

    assert.equal(booking.status, "CONFIRMED");
    assert.equal(booking.googleEventId, null);
  } finally {
    await desmontar(escenario);
  }
});

test("si Google FALLA al crear el evento, la reserva se guarda igual", async () => {
  // §4: "el sistema no debe bloquear una reserva por una falla del proveedor
  // externo". La reserva local es la fuente de verdad.
  const escenario = await montar("google-falla");
  try {
    await conectarGoogle(escenario);

    const booking = await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doblarGoogle({ fallaAlCrearEvento: new GoogleAuthError("Google caído", false) }).cliente,
    );

    assert.equal(booking.status, "CONFIRMED");
    assert.equal(booking.googleEventId ?? null, null);

    const enBase = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    assert.equal(enBase.status, "CONFIRMED");
    assert.equal(enBase.googleEventId, null);

    // Control negativo de B-4: un Google CAÍDO (grantInvalido: false) no toca la
    // conexión. Marcar ERROR por un mal minuto ajeno obligaría a reconectar.
    const conexion = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: escenario.branchId },
    });
    assert.equal(conexion.status, "ACTIVE");
    assert.equal(conexion.lastErrorMessage, null);
  } finally {
    await desmontar(escenario);
  }
});

// B-4 (docs/auditoria-2026-08-29.md): un 401 de Google EN events.insert —no en
// el refresh del token, que obtenerAccessToken ya cubre— tiene que dejar la
// conexión en ERROR. Antes solo quedaba un logger.warn y la fila seguía ACTIVE
// indefinidamente: la conexión rota era invisible. El test de arriba es el
// control negativo de este.
test("si Google rechaza el GRANT al crear el evento, la reserva se guarda igual y la conexión pasa a ERROR", async () => {
  const escenario = await montar("google-grant-crear");
  try {
    await conectarGoogle(escenario);

    const booking = await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doblarGoogle({
        fallaAlCrearEvento: new GoogleAuthError("Google rechazó la solicitud (401)", true),
      }).cliente,
    );

    // §4 sigue valiendo: la reserva no se bloquea por Google.
    assert.equal(booking.status, "CONFIRMED");
    assert.equal(booking.googleEventId ?? null, null);

    const conexion = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: escenario.branchId },
    });
    assert.equal(conexion.status, "ERROR");
    assert.equal(conexion.lastErrorMessage, "Google rechazó la solicitud (401)");
    assert.ok(conexion.lastErrorAt);
  } finally {
    await desmontar(escenario);
  }
});

test("con Google conectado, la reserva guarda el googleEventId y manda la zona correcta", async () => {
  const escenario = await montar("google-ok");
  try {
    await conectarGoogle(escenario);

    const doble = doblarGoogle({ eventId: "evt-abc" });

    const booking = await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doble.cliente,
    );

    assert.equal(booking.googleEventId, "evt-abc");

    const enBase = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    assert.equal(enBase.googleEventId, "evt-abc", "la segunda escritura persistió");

    assert.equal(doble.eventosCreados.length, 1);
    assert.equal(doble.eventosCreados[0].zona, TZ, "la zona es la de la SUCURSAL");
    assert.ok(doble.eventosCreados[0].titulo.includes("Ana"));
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// 5. Cancelación
// ---------------------------------------------------------------------------

test("cancelar libera el cupo y permite volver a reservar el horario", async () => {
  const escenario = await montar("cancelar");
  try {
    const booking = await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doblarGoogle().cliente,
    );

    const cancelada = await cancelBooking(
      escenario.organizationId,
      booking.id,
      doblarGoogle().cliente,
    );
    assert.equal(cancelada.status, "CANCELLED");

    // El cupo se liberó: el mismo horario vuelve a estar disponible...
    const turnos = await obtenerDisponibilidad(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        desde: new Date("2026-09-07T00:00:00Z"),
        hasta: new Date("2026-09-08T00:00:00Z"),
      },
      doblarGoogle().cliente,
    );
    assert.equal(turnos.length, 4);

    // ...y se puede reservar de nuevo.
    const nueva = await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doblarGoogle().cliente,
    );
    assert.equal(nueva.status, "CONFIRMED");
  } finally {
    await desmontar(escenario);
  }
});

test("cancelar borra el evento en Google", async () => {
  const escenario = await montar("cancelar-google");
  try {
    await conectarGoogle(escenario);

    const booking = await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doblarGoogle({ eventId: "evt-a-borrar" }).cliente,
    );

    const doble = doblarGoogle();
    await cancelBooking(escenario.organizationId, booking.id, doble.cliente);

    assert.deepEqual(doble.eventosBorrados, ["evt-a-borrar"]);
  } finally {
    await desmontar(escenario);
  }
});

// B-4, el otro camino: un 401 de Google EN events.delete. La cancelación se
// aplica igual (el cupo se libera sí o sí) y la conexión queda en ERROR.
test("si Google rechaza el GRANT al borrar el evento, la reserva queda cancelada igual y la conexión pasa a ERROR", async () => {
  const escenario = await montar("google-grant-borrar");
  try {
    await conectarGoogle(escenario);

    const booking = await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doblarGoogle({ eventId: "evt-grant-muerto" }).cliente,
    );

    const doble = doblarGoogle({
      fallaAlEliminarEvento: new GoogleAuthError("Google rechazó la solicitud (401)", true),
    });
    const cancelada = await cancelBooking(escenario.organizationId, booking.id, doble.cliente);

    assert.equal(cancelada.status, "CANCELLED");
    assert.deepEqual(doble.eventosBorrados, [], "el doble rechazó antes de registrar el borrado");

    const enBase = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    assert.equal(enBase.status, "CANCELLED");

    const conexion = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: escenario.branchId },
    });
    assert.equal(conexion.status, "ERROR");
    assert.equal(conexion.lastErrorMessage, "Google rechazó la solicitud (401)");
    assert.ok(conexion.lastErrorAt);
  } finally {
    await desmontar(escenario);
  }
});

// Control negativo del anterior: Google CAÍDO al borrar (grantInvalido: false)
// cancela igual y NO toca la conexión.
test("si Google está caído al borrar el evento, la reserva queda cancelada igual y la conexión sigue ACTIVE", async () => {
  const escenario = await montar("google-caido-borrar");
  try {
    await conectarGoogle(escenario);

    const booking = await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doblarGoogle({ eventId: "evt-google-caido" }).cliente,
    );

    const cancelada = await cancelBooking(
      escenario.organizationId,
      booking.id,
      doblarGoogle({ fallaAlEliminarEvento: new GoogleAuthError("Google caído", false) }).cliente,
    );

    assert.equal(cancelada.status, "CANCELLED");

    const conexion = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: escenario.branchId },
    });
    assert.equal(conexion.status, "ACTIVE");
    assert.equal(conexion.lastErrorMessage, null);
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// M-2 (docs/auditoria-2026-08-29.md) — la ventana entre el commit y Google.
//
// La reserva se commitea en la FASE 2 y Google se llama DESPUÉS, fuera de la
// transacción (decisión documentada en createBooking, que no se toca). En esa
// ventana —hasta el timeout de Google— puede llegar una cancelación: la fila
// está CONFIRMED y sin googleEventId, así que cancelBooking la aplica y no
// encuentra nada que borrar en Google. Cuando Google responde tarde,
// setGoogleEventId escribía el id sobre la fila ya CANCELLED: un evento vivo en
// el calendario del negocio que nadie volvía a borrar, porque desde la base
// esa reserva nunca tuvo evento.
//
// LA VENTANA SE FUERZA, NO SE RAZONA: a diferencia de A-1 y A-7 (un lock de
// Postgres sostenido), acá es tiempo entre un commit ya hecho y una respuesta
// de red que no llegó. El doble avisa cuando el service llegó a Google
// (`alCrearEvento`) y se queda esperando una promesa que el test controla: el
// test confirma contra la base que la reserva ya está commiteada y sin evento,
// cancela DE VERDAD con cancelBooking, y recién entonces suelta la respuesta.
// ---------------------------------------------------------------------------

test("M-2: cancelar mientras Google todavía no respondió deja la reserva CANCELLED y BORRA el evento recién creado", async () => {
  const escenario = await montar("m2-ventana");
  try {
    await conectarGoogle(escenario);

    let llegoAGoogle!: () => void;
    const llegada = new Promise<void>((resolve) => {
      llegoAGoogle = resolve;
    });
    let soltarRespuesta!: () => void;
    const respuestaRetenida = new Promise<void>((resolve) => {
      soltarRespuesta = resolve;
    });

    const doble = doblarGoogle({
      eventId: "evento-que-nacio-huerfano",
      alCrearEvento: () => {
        llegoAGoogle();
        return respuestaRetenida;
      },
    });

    // (a) Se arranca la reserva sin esperarla: va a quedar detenida dentro del
    // doble, con la FASE 2 ya commiteada.
    const creacion = createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doble.cliente,
    );

    await llegada;

    // La premisa de la ventana, contra la base: la reserva existe, está
    // CONFIRMED y todavía no tiene evento.
    const commiteada = await prisma.booking.findFirstOrThrow({
      where: { resourceId: escenario.resourceId },
    });
    assert.equal(commiteada.status, "CONFIRMED");
    assert.equal(commiteada.googleEventId, null, "Google todavía no respondió");

    // (b) La cancelación REAL, en el medio. No encuentra evento que borrar.
    const cancelada = await cancelBooking(escenario.organizationId, commiteada.id, doble.cliente);
    assert.equal(cancelada.status, "CANCELLED");
    assert.deepEqual(doble.eventosBorrados, [], "no había evento que borrar al cancelar");

    // (c) Recién ahora Google "responde" y createBooking sigue con la FASE 3.
    soltarRespuesta();
    const resultado = await creacion;

    // Las dos partes del hallazgo. Sin el fix: la fila quedaba CANCELLED pero
    // con googleEventId escrito encima, y eventosBorrados seguía vacío.
    const final = await prisma.booking.findUniqueOrThrow({ where: { id: commiteada.id } });
    assert.equal(final.status, "CANCELLED", "la cancelación no se pisa");
    assert.equal(
      final.googleEventId,
      null,
      "el id tardío no se escribe sobre una reserva cancelada",
    );

    assert.deepEqual(doble.eventosCreados.length, 1, "Google sí creó el evento");
    assert.deepEqual(
      doble.eventosBorrados,
      ["evento-que-nacio-huerfano"],
      "el evento recién creado tiene que borrarse: es un huérfano que nadie más va a ver",
    );

    // Y lo que createBooking devuelve es la reserva como quedó, no una CONFIRMED
    // con evento que ya no existe.
    assert.equal(resultado.status, "CANCELLED");
    assert.equal(resultado.googleEventId, null);
  } finally {
    await desmontar(escenario);
  }
});

test("cancelar dos veces da 409", async () => {
  const escenario = await montar("cancelar-2x");
  try {
    const booking = await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doblarGoogle().cliente,
    );

    await cancelBooking(escenario.organizationId, booking.id, doblarGoogle().cliente);

    assertAppError(
      await capturar(() =>
        cancelBooking(escenario.organizationId, booking.id, doblarGoogle().cliente),
      ),
      409,
    );
  } finally {
    await desmontar(escenario);
  }
});

test("una reserva de otra organización no se puede cancelar (404)", async () => {
  const a = await montar("cancel-iso-a");
  const b = await montar("cancel-iso-b");
  try {
    const booking = await createBooking(
      a.organizationId,
      {
        resourceId: a.resourceId,
        serviceTypeId: a.serviceTypeId,
        contactId: a.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doblarGoogle().cliente,
    );

    assertAppError(
      await capturar(() => cancelBooking(b.organizationId, booking.id, doblarGoogle().cliente)),
      404,
    );
  } finally {
    await desmontar(a);
    await desmontar(b);
  }
});

// ---------------------------------------------------------------------------
// 6. El RESTRICT de deleteServiceType, que hasta ahora contaba 0 fijo
// ---------------------------------------------------------------------------

test("no se puede borrar un servicio con reservas CONFIRMED", async () => {
  const escenario = await montar("restrict-servicio");
  try {
    await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doblarGoogle().cliente,
    );

    const err = await capturar(() =>
      deleteServiceType(escenario.organizationId, escenario.serviceTypeId),
    );

    assertAppError(err, 400);
    assert.ok((err as AppError).message.includes("reservas activas"));

    const persistido = await prisma.serviceType.findUniqueOrThrow({
      where: { id: escenario.serviceTypeId },
    });
    assert.equal(persistido.deletedAt, null);
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// A-4 (docs/auditoria-2026-08-29.md) — mover un servicio de recurso con
// reservas CONFIRMED se rechaza, igual que borrarlo.
// ---------------------------------------------------------------------------

test("A-4: no se puede mover a otro recurso un servicio con reservas CONFIRMED, y el recurso viejo sigue sin poder borrarse", async () => {
  const escenario = await montar("a4-mover");
  try {
    const otroRecurso = await createResource(escenario.organizationId, {
      branchId: escenario.branchId,
      name: "Pedro (barbero)",
      type: "PERSON",
    });

    await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doblarGoogle().cliente,
    );

    const err = await capturar(() =>
      updateServiceType(escenario.organizationId, escenario.serviceTypeId, {
        resourceId: otroRecurso.id,
      }),
    );

    assertAppError(err, 400);
    assert.ok((err as AppError).message.includes("reservas activas"));

    const persistido = await prisma.serviceType.findUniqueOrThrow({
      where: { id: escenario.serviceTypeId },
    });
    assert.equal(persistido.resourceId, escenario.resourceId, "el servicio no se movió");

    // El escenario completo del hallazgo: con el movimiento rechazado, el
    // recurso viejo sigue teniendo un servicio activo y deleteResource lo
    // sigue protegiendo — la cadena de RESTRICT no se rompió.
    const borrado = await capturar(() =>
      deleteResource(escenario.organizationId, escenario.resourceId),
    );
    assertAppError(borrado, 400);
  } finally {
    await desmontar(escenario);
  }
});

test("A-4: con la reserva CANCELADA el servicio sí se puede mover, y las reservas históricas conservan el recurso viejo", async () => {
  const escenario = await montar("a4-mover-cancelada");
  try {
    const otroRecurso = await createResource(escenario.organizationId, {
      branchId: escenario.branchId,
      name: "Pedro (barbero)",
      type: "PERSON",
    });

    const reserva = await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doblarGoogle().cliente,
    );
    await cancelBooking(escenario.organizationId, reserva.id, doblarGoogle().cliente);

    const movido = await updateServiceType(escenario.organizationId, escenario.serviceTypeId, {
      resourceId: otroRecurso.id,
    });
    assert.equal(movido.resourceId, otroRecurso.id);

    // Una reserva cancelada es historia: sigue diciendo con qué recurso fue.
    const historica = await prisma.booking.findUniqueOrThrow({ where: { id: reserva.id } });
    assert.equal(historica.resourceId, escenario.resourceId);
  } finally {
    await desmontar(escenario);
  }
});

test("A-4: mover al MISMO recurso con reservas activas no es un movimiento y no se rechaza", async () => {
  const escenario = await montar("a4-mismo-recurso");
  try {
    await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doblarGoogle().cliente,
    );

    const actualizado = await updateServiceType(escenario.organizationId, escenario.serviceTypeId, {
      resourceId: escenario.resourceId,
      name: "Corte renombrado",
    });
    assert.equal(actualizado.name, "Corte renombrado");
    assert.equal(actualizado.resourceId, escenario.resourceId);
  } finally {
    await desmontar(escenario);
  }
});

// La otra mitad de A-4: createBooking relee el servicio con el lock sostenido.
// Acá se prueba el caso secuencial (el servicio se movió ANTES de la reserva);
// la versión concurrente la cierra el lock + esta misma relectura.
test("A-4: reservar contra un recurso que YA NO provee el servicio se rechaza con 400", async () => {
  const escenario = await montar("a4-reservar-movido");
  try {
    const otroRecurso = await createResource(escenario.organizationId, {
      branchId: escenario.branchId,
      name: "Pedro (barbero)",
      type: "PERSON",
    });
    await updateServiceType(escenario.organizationId, escenario.serviceTypeId, {
      resourceId: otroRecurso.id,
    });

    const err = await capturar(() =>
      createBooking(
        escenario.organizationId,
        {
          resourceId: escenario.resourceId,
          serviceTypeId: escenario.serviceTypeId,
          contactId: escenario.contactId,
          startsAt: LUNES_9_LOCAL,
        },
        doblarGoogle().cliente,
      ),
    );
    assertAppError(err, 400);
    assert.ok((err as AppError).message.includes("no lo provee"));
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// A-5 (docs/auditoria-2026-08-29.md) — la grilla no se corre con `from`, contra
// la base y el horario real.
// ---------------------------------------------------------------------------

test("A-5: consultar 'a partir de ahora' devuelve la misma grilla que consultar desde el inicio del día, con menos turnos al principio", async () => {
  const escenario = await montar("a5-grilla");
  try {
    // Reserva existente de 10 a 11 local (13:00Z-14:00Z).
    await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: new Date("2026-09-07T13:00:00Z"),
      },
      doblarGoogle().cliente,
    );

    const consultar = (desde: Date) =>
      obtenerDisponibilidad(
        escenario.organizationId,
        {
          resourceId: escenario.resourceId,
          serviceTypeId: escenario.serviceTypeId,
          desde,
          hasta: new Date("2026-09-08T00:00:00Z"),
        },
        doblarGoogle().cliente,
      );

    const desdeElInicio = await consultar(new Date("2026-09-07T00:00:00Z"));
    const aPartirDeLas9y10 = await consultar(new Date("2026-09-07T12:10:00Z"));

    const inicios = (turnos: { inicio: Date }[]) => turnos.map((t) => t.inicio.toISOString());

    // Lunes 9-13 local, turnos de 60: 9, 10 (reservado), 11, 12.
    assert.deepEqual(inicios(desdeElInicio), [
      "2026-09-07T12:00:00.000Z",
      "2026-09-07T14:00:00.000Z",
      "2026-09-07T15:00:00.000Z",
    ]);

    // Con el bug: la franja llegaba como 9:10-13:00, la grilla salía 9:10,
    // 10:10, 11:10 (12:10 no entra), 9:10 y 10:10 chocaban con la reserva de
    // las 10, y el resultado era ["11:10"] — un turno que la grilla real no
    // tiene, y que si alguien lo reservaba tapaba los de 11 y 12.
    assert.deepEqual(
      inicios(aPartirDeLas9y10),
      ["2026-09-07T14:00:00.000Z", "2026-09-07T15:00:00.000Z"],
      "misma grilla que desde el inicio del día, sin el turno de las 9 que ya empezó",
    );
  } finally {
    await desmontar(escenario);
  }
});

test("una reserva CANCELADA no bloquea el borrado del servicio", async () => {
  const escenario = await montar("restrict-cancelada");
  try {
    const booking = await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doblarGoogle().cliente,
    );

    await cancelBooking(escenario.organizationId, booking.id, doblarGoogle().cliente);

    await deleteServiceType(escenario.organizationId, escenario.serviceTypeId);

    const persistido = await prisma.serviceType.findUniqueOrThrow({
      where: { id: escenario.serviceTypeId },
    });
    assert.notEqual(persistido.deletedAt, null);
  } finally {
    await desmontar(escenario);
  }
});

test("COMPLETED y NO_SHOW son historia y tampoco bloquean el borrado", async () => {
  // La decisión que PR #41 dejó explícitamente pendiente. Bloquear por historia
  // haría que un servicio con un año de uso fuera imposible de dar de baja.
  const escenario = await montar("restrict-historia");
  try {
    const booking = await createBooking(
      escenario.organizationId,
      {
        resourceId: escenario.resourceId,
        serviceTypeId: escenario.serviceTypeId,
        contactId: escenario.contactId,
        startsAt: LUNES_9_LOCAL,
      },
      doblarGoogle().cliente,
    );

    await prisma.booking.update({ where: { id: booking.id }, data: { status: "COMPLETED" } });

    await deleteServiceType(escenario.organizationId, escenario.serviceTypeId);

    const persistido = await prisma.serviceType.findUniqueOrThrow({
      where: { id: escenario.serviceTypeId },
    });
    assert.notEqual(persistido.deletedAt, null);
  } finally {
    await desmontar(escenario);
  }
});
