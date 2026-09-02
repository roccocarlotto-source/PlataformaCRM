import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, mock, test } from "node:test";
import { prisma } from "../lib/prisma";
import { createBooking as insertarReserva } from "../repositories/booking.repository";
import {
  findConnectionByChannelId,
  findConnectionsNeedingChannel,
} from "../repositories/googleCalendarConnection.repository";
import { AppError } from "../utils/AppError";
import { getCifrador } from "../utils/encryption";
import { firmarWebhookToken, verificarWebhookToken } from "../utils/webhookToken";
import { renovarCanalesVencidos } from "../workers/googleCalendarChannelWorker";
import { createBooking, relojDeReservas } from "./booking.service";
import { createBranch } from "./branch.service";
import { desconectar, renovarCanal } from "./googleCalendarConnection.service";
import { procesarNotificacion } from "./googleCalendarSync.service";
import { createResource } from "./resource.service";
import { createServiceType } from "./serviceType.service";
import { replaceWorkingHoursForResource } from "./workingHours.service";
import {
  GoogleSyncTokenInvalidoError,
  type ClienteGoogleCalendar,
  type EventoCambiado,
} from "./googleCalendar.service";

// ---------------------------------------------------------------------------
// P2.1, paso 4 — sincronización inversa, contra Postgres real.
//
// GOOGLE ESTÁ MOCKEADO SIEMPRE. Lo real es todo lo demás: la base, el cifrado,
// la firma del token del canal, los CHECK y las transiciones de Booking.
//
// Lo que se prueba acá y no se puede probar sin base:
//
//   1. El token firmado es la ÚNICA defensa del webhook, y funciona.
//   2. Un evento cancelado en Google cancela el Booking y LIBERA EL CUPO.
//   3. Un evento MOVIDO no toca nada (decisión de producto).
//   4. El syncToken se guarda al final, y un 410 resincroniza.
//   5. El worker crea canales donde faltan y renueva los que vencen.
//   6. Desconectar cierra el canal.
//
// CADA TEST TRAE SU PROPIA ORGANIZACIÓN, mismo criterio que el resto de la
// suite: el runner corre los archivos en paralelo contra una base compartida.

const TZ = "America/Argentina/Buenos_Aires";

// Lunes 7/9/2026, 9:00 local = 12:00Z. El recurso trabaja lunes de 9 a 13.
const LUNES_9_LOCAL = new Date("2026-09-07T12:00:00Z");

// V-2: createBooking rechaza reservas en el pasado, y las de este archivo están
// fijadas en ese lunes — el reloj de la reserva se fija al domingo anterior,
// como en booking.integration-test.ts, para que la suite no caduque.
before(() => {
  mock.method(relojDeReservas, "ahora", () => new Date("2026-09-06T12:00:00Z"));
});

interface Escenario {
  organizationId: string;
  branchId: string;
  resourceId: string;
  serviceTypeId: string;
  contactId: string;
}

async function montar(etiqueta: string): Promise<Escenario> {
  const org = await prisma.organization.create({
    data: {
      name: `Sync ${etiqueta} ${randomUUID()}`,
      slug: `sync-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });

  const branch = await createBranch(org.id, { name: "Centro", timezone: TZ });
  const resource = await createResource(org.id, {
    branchId: branch.id,
    name: "Juan",
    type: "PERSON",
  });
  const serviceType = await createServiceType(org.id, {
    branchId: branch.id,
    resourceId: resource.id,
    name: "Corte",
    durationMin: 60,
  });
  const contact = await prisma.contact.create({
    data: { organizationId: org.id, firstName: "Ana", lastName: "Pérez" },
  });

  await replaceWorkingHoursForResource(org.id, resource.id, [
    { weekday: "MONDAY", startMinute: 540, endMinute: 780 },
  ]);

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
  cambios?: EventoCambiado[];
  nextSyncToken?: string;
  // Lanza GoogleSyncTokenInvalidoError la PRIMERA vez y responde bien la
  // segunda: es exactamente la secuencia de un 410 seguido de resincronización.
  syncTokenVencido?: boolean;
  expiration?: Date;
  // B-7: se llama cuando el service YA LLEGÓ a Google a crear el canal, antes
  // de que el doble responda. Es lo que le da al test la ventana entre la
  // lectura de la conexión y la escritura del canal: puede desconectar de
  // verdad ahí y recién después soltar la respuesta. Misma técnica que
  // `alCrearEvento` en booking.integration-test.ts (M-2).
  alCrearCanal?: () => Promise<void> | void;
}

interface Doble {
  cliente: ClienteGoogleCalendar;
  canalesCreados: { channelId: string; token: string; address: string }[];
  canalesDetenidos: { channelId: string; resourceId: string }[];
  listadosConSyncToken: (string | undefined)[];
  // M-3: con qué timeMin se llamó a events.list en cada listado. Una
  // sincronización completa tiene que llevarlo; una incremental, no.
  listadosConTimeMin: (string | undefined)[];
  // B-6: con qué zona se llamó en cada listado. Tiene que ser la de la
  // SUCURSAL, en todos.
  listadosConTimezone: string[];
}

function doblarGoogle(opciones: OpcionesDelDoble = {}): Doble {
  const canalesCreados: { channelId: string; token: string; address: string }[] = [];
  const canalesDetenidos: { channelId: string; resourceId: string }[] = [];
  const listadosConSyncToken: (string | undefined)[] = [];
  const listadosConTimeMin: (string | undefined)[] = [];
  const listadosConTimezone: string[] = [];
  let yaFallo = false;

  const cliente: ClienteGoogleCalendar = {
    construirUrlDeAutorizacion: (state) => `https://accounts.google.com/fake?state=${state}`,
    intercambiarCodigo: () =>
      Promise.resolve({
        refreshToken: "1//refresh",
        accessToken: "access",
        expiraEnSegundos: 3599,
        scope: "",
      }),
    renovarAccessToken: () =>
      Promise.resolve({ accessToken: "access-renovado", expiraEnSegundos: 3599, scope: "" }),
    revocarToken: () => Promise.resolve(),
    consultarFreeBusy: () => Promise.resolve([]),
    crearEvento: () => Promise.resolve("evt-nuevo"),
    eliminarEvento: () => Promise.resolve(),

    crearCanalDeNotificaciones: async (canal) => {
      canalesCreados.push({
        channelId: canal.channelId,
        token: canal.token,
        address: canal.address,
      });
      await opciones.alCrearCanal?.();
      return {
        channelId: canal.channelId,
        resourceId: `recurso-de-${canal.channelId.slice(0, 8)}`,
        expiration: opciones.expiration ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };
    },

    detenerCanal: (canal) => {
      canalesDetenidos.push({ channelId: canal.channelId, resourceId: canal.resourceId });
      return Promise.resolve();
    },

    listarCambios: (consulta) => {
      listadosConSyncToken.push(consulta.syncToken);
      listadosConTimeMin.push(consulta.timeMin);
      listadosConTimezone.push(consulta.timezone);

      if (opciones.syncTokenVencido && !yaFallo && consulta.syncToken) {
        yaFallo = true;
        return Promise.reject(new GoogleSyncTokenInvalidoError("token vencido"));
      }

      return Promise.resolve({
        eventos: opciones.cambios ?? [],
        nextSyncToken: opciones.nextSyncToken ?? "token-nuevo",
      });
    },
  };

  return {
    cliente,
    canalesCreados,
    canalesDetenidos,
    listadosConSyncToken,
    listadosConTimeMin,
    listadosConTimezone,
  };
}

// M-3: una sincronización completa se acota desde "ahora". El valor exacto no
// cambia ninguna rama —solo viaja como string a Google—, así que alcanza con
// que sea una fecha reciente; la tolerancia es generosa para no depender del
// reloj de la máquina del CI.
function assertTimeMinReciente(timeMin: string | undefined, contexto: string): void {
  assert.ok(timeMin, `${contexto}: la sincronización completa tiene que llevar timeMin`);
  const distanciaMs = Math.abs(Date.now() - new Date(timeMin).getTime());
  assert.ok(
    distanciaMs < 5_000,
    `${contexto}: timeMin (${timeMin}) tiene que ser "ahora", y dista ${String(distanciaMs)} ms`,
  );
}

// Crea la conexión directamente: el flujo OAuth completo ya está probado en
// google-calendar-connection.integration-test.ts.
async function conectarGoogle(
  escenario: Escenario,
  extra: {
    channelId?: string;
    channelResourceId?: string;
    channelExpiration?: Date;
    syncToken?: string;
  } = {},
) {
  return prisma.googleCalendarConnection.create({
    data: {
      organizationId: escenario.organizationId,
      branchId: escenario.branchId,
      refreshToken: getCifrador().encrypt("1//refresh"),
      calendarId: "primary",
      status: "ACTIVE",
      ...extra,
    },
  });
}

async function reservar(escenario: Escenario, googleEventId?: string, startsAt = LUNES_9_LOCAL) {
  const booking = await createBooking(
    escenario.organizationId,
    {
      resourceId: escenario.resourceId,
      serviceTypeId: escenario.serviceTypeId,
      contactId: escenario.contactId,
      startsAt,
    },
    doblarGoogle().cliente,
  );

  if (googleEventId) {
    await prisma.booking.update({ where: { id: booking.id }, data: { googleEventId } });
  }

  return booking;
}

// ---------------------------------------------------------------------------
// 1. El token firmado es la única defensa del webhook
// ---------------------------------------------------------------------------

test("una notificación con token inválido se rechaza con 403 sin tocar la base", async () => {
  const escenario = await montar("token-malo");
  try {
    const canal = randomUUID();
    await conectarGoogle(escenario, {
      channelId: canal,
      channelResourceId: "r1",
      channelExpiration: new Date(Date.now() + 86400000),
      syncToken: "t0",
    });

    assertAppError(
      await capturar(() =>
        procesarNotificacion(
          { channelId: canal, resourceState: "exists", token: "no-es-un-token-firmado" },
          doblarGoogle().cliente,
        ),
      ),
      403,
    );

    // El syncToken no cambió: no se procesó nada.
    const fila = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: escenario.branchId },
    });
    assert.equal(fila.syncToken, "t0");
  } finally {
    await desmontar(escenario);
  }
});

test("un token VÁLIDO pero de OTRO canal se rechaza", async () => {
  // EL AGUJERO QUE EL channelId DENTRO DEL TOKEN CIERRA: sin ese campo, un token
  // legítimo de la sucursal A podría reproducirse junto al X-Goog-Channel-ID de
  // la sucursal B.
  const escenario = await montar("canal-cruzado");
  try {
    const canalReal = randomUUID();
    await conectarGoogle(escenario, {
      channelId: canalReal,
      channelResourceId: "r1",
      channelExpiration: new Date(Date.now() + 86400000),
    });

    // Token firmado para OTRO canal, con la misma organización y sucursal.
    const tokenDeOtroCanal = await firmarWebhookToken({
      organizationId: escenario.organizationId,
      branchId: escenario.branchId,
      channelId: randomUUID(),
    });

    assertAppError(
      await capturar(() =>
        procesarNotificacion(
          { channelId: canalReal, resourceState: "exists", token: tokenDeOtroCanal },
          doblarGoogle().cliente,
        ),
      ),
      403,
    );
  } finally {
    await desmontar(escenario);
  }
});

test("resourceState = sync responde sin hacer nada", async () => {
  // Es el mensaje de confirmación que Google manda al CREAR el canal. No trae
  // cambios; procesarlo dispararía una sincronización completa inútil por cada
  // canal creado.
  const escenario = await montar("sync-inicial");
  try {
    const canal = randomUUID();
    await conectarGoogle(escenario, {
      channelId: canal,
      channelResourceId: "r1",
      channelExpiration: new Date(Date.now() + 86400000),
      syncToken: "t0",
    });

    const token = await firmarWebhookToken({
      organizationId: escenario.organizationId,
      branchId: escenario.branchId,
      channelId: canal,
    });

    const doble = doblarGoogle();
    const resultado = await procesarNotificacion(
      { channelId: canal, resourceState: "sync", token },
      doble.cliente,
    );

    assert.equal(resultado.accion, "sync-inicial");
    assert.deepEqual(doble.listadosConSyncToken, [], "no se llamó a events.list");
  } finally {
    await desmontar(escenario);
  }
});

test("una notificación de un canal que ya no está en la base responde sin error", async () => {
  // NO puede devolver 5xx: Google reintentaría con backoff una notificación que
  // nunca vamos a poder procesar.
  const escenario = await montar("canal-desconocido");
  try {
    const canalFantasma = randomUUID();

    const token = await firmarWebhookToken({
      organizationId: escenario.organizationId,
      branchId: escenario.branchId,
      channelId: canalFantasma,
    });

    const resultado = await procesarNotificacion(
      { channelId: canalFantasma, resourceState: "exists", token },
      doblarGoogle().cliente,
    );

    assert.equal(resultado.accion, "canal-desconocido");
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// 2. Evento cancelado en Google -> el Booking se cancela y libera el cupo
// ---------------------------------------------------------------------------

async function notificar(escenario: Escenario, canal: string, doble: Doble) {
  const token = await firmarWebhookToken({
    organizationId: escenario.organizationId,
    branchId: escenario.branchId,
    channelId: canal,
  });

  return procesarNotificacion({ channelId: canal, resourceState: "exists", token }, doble.cliente);
}

test("un evento CANCELADO en Google cancela el Booking y libera el cupo", async () => {
  const escenario = await montar("cancelado");
  try {
    const canal = randomUUID();
    await conectarGoogle(escenario, {
      channelId: canal,
      channelResourceId: "r1",
      channelExpiration: new Date(Date.now() + 86400000),
      syncToken: "t0",
    });

    const booking = await reservar(escenario, "evt-google-1");

    const resultado = await notificar(
      escenario,
      canal,
      doblarGoogle({ cambios: [{ id: "evt-google-1", status: "cancelled" }] }),
    );

    assert.equal(resultado.bookingsCancelados, 1);

    const persistido = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    assert.equal(persistido.status, "CANCELLED");

    // Y EL CUPO SE LIBERÓ DE VERDAD: se puede volver a reservar el horario.
    const nueva = await reservar(escenario);
    assert.equal(nueva.status, "CONFIRMED");
  } finally {
    await desmontar(escenario);
  }
});

test("un evento cancelado cuyo Booking YA estaba cancelado no hace nada", async () => {
  // Es lo que hace seguro guardar el syncToken al final: reprocesar la misma
  // notificación no puede tener efecto.
  const escenario = await montar("ya-cancelada");
  try {
    const canal = randomUUID();
    await conectarGoogle(escenario, {
      channelId: canal,
      channelResourceId: "r1",
      channelExpiration: new Date(Date.now() + 86400000),
      syncToken: "t0",
    });

    const booking = await reservar(escenario, "evt-1");
    await prisma.booking.update({ where: { id: booking.id }, data: { status: "CANCELLED" } });

    const resultado = await notificar(
      escenario,
      canal,
      doblarGoogle({ cambios: [{ id: "evt-1", status: "cancelled" }] }),
    );

    assert.equal(resultado.bookingsCancelados, 0);
  } finally {
    await desmontar(escenario);
  }
});

test("un evento cancelado que no corresponde a ningún Booking se ignora", async () => {
  // La inmensa mayoría de los cambios de un calendario son del negocio, no del
  // CRM.
  const escenario = await montar("evento-ajeno");
  try {
    const canal = randomUUID();
    await conectarGoogle(escenario, {
      channelId: canal,
      channelResourceId: "r1",
      channelExpiration: new Date(Date.now() + 86400000),
      syncToken: "t0",
    });

    const resultado = await notificar(
      escenario,
      canal,
      doblarGoogle({ cambios: [{ id: "evento-del-negocio", status: "cancelled" }] }),
    );

    assert.equal(resultado.bookingsCancelados, 0);
  } finally {
    await desmontar(escenario);
  }
});

test("un evento cancelado de OTRA organización no toca el Booking de ésta", async () => {
  // El googleEventId lo asigna Google, no este sistema, así que nada garantiza
  // que sea único entre calendarios de organizaciones distintas. Sin el
  // organizationId en el WHERE, una colisión alcanzaría para cancelar la reserva
  // de otro tenant.
  const a = await montar("cruce-a");
  const b = await montar("cruce-b");
  try {
    const canalB = randomUUID();
    await conectarGoogle(b, {
      channelId: canalB,
      channelResourceId: "r1",
      channelExpiration: new Date(Date.now() + 86400000),
      syncToken: "t0",
    });

    // Las dos organizaciones tienen una reserva con el MISMO googleEventId.
    const bookingDeA = await reservar(a, "evt-compartido");
    await reservar(b, "evt-compartido");

    await notificar(
      b,
      canalB,
      doblarGoogle({ cambios: [{ id: "evt-compartido", status: "cancelled" }] }),
    );

    const deA = await prisma.booking.findUniqueOrThrow({ where: { id: bookingDeA.id } });
    assert.equal(deA.status, "CONFIRMED", "la reserva de la otra organización no se toca");
  } finally {
    await desmontar(a);
    await desmontar(b);
  }
});

// ---------------------------------------------------------------------------
// 3. Evento MOVIDO -> no se aplica (decisión de producto)
// ---------------------------------------------------------------------------

test("un evento MOVIDO en Google NO reprograma el Booking: solo se registra", async () => {
  // DECISIÓN DE PRODUCTO, no una limitación técnica: mover un Booking es
  // reprogramar, y reprogramar exige revalidar horario de trabajo, capacidad y
  // Google. Aplicarlo automáticamente acá sería construir esa validación por la
  // puerta de atrás — o peor, NO construirla y mover la reserva a un horario
  // fuera del horario de trabajo o encima de otro turno.
  const escenario = await montar("movido");
  try {
    const canal = randomUUID();
    await conectarGoogle(escenario, {
      channelId: canal,
      channelResourceId: "r1",
      channelExpiration: new Date(Date.now() + 86400000),
      syncToken: "t0",
    });

    const booking = await reservar(escenario, "evt-movido");

    const resultado = await notificar(
      escenario,
      canal,
      doblarGoogle({
        cambios: [
          {
            id: "evt-movido",
            status: "confirmed",
            inicio: new Date("2026-09-07T15:00:00Z"),
            fin: new Date("2026-09-07T16:00:00Z"),
          },
        ],
      }),
    );

    assert.equal(resultado.eventosMovidos, 1);
    assert.equal(resultado.bookingsCancelados, 0);

    const persistido = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    assert.equal(persistido.status, "CONFIRMED", "el status no se toca");
    assert.equal(
      persistido.startsAt.toISOString(),
      LUNES_9_LOCAL.toISOString(),
      "el horario tampoco: la reserva queda desactualizada a propósito",
    );
  } finally {
    await desmontar(escenario);
  }
});

test("un evento que NO cambió de horario no cuenta como movido", async () => {
  const escenario = await montar("sin-cambio");
  try {
    const canal = randomUUID();
    await conectarGoogle(escenario, {
      channelId: canal,
      channelResourceId: "r1",
      channelExpiration: new Date(Date.now() + 86400000),
      syncToken: "t0",
    });

    const booking = await reservar(escenario, "evt-igual");

    const resultado = await notificar(
      escenario,
      canal,
      doblarGoogle({
        cambios: [
          {
            id: "evt-igual",
            status: "confirmed",
            inicio: booking.startsAt,
            fin: booking.endsAt,
          },
        ],
      }),
    );

    assert.equal(resultado.eventosMovidos, 0);
    assert.equal(resultado.accion, "sin-cambios");
  } finally {
    await desmontar(escenario);
  }
});

// B-5 (docs/auditoria-2026-08-29.md): el test de arriba no detectaba el bug
// porque manda booking.startsAt tal cual, con los mismos milisegundos de los
// dos lados. Google devuelve SEGUNDOS: una reserva creada con milisegundos
// —cualquier cliente que serialice con toISOString()— notificada con el mismo
// instante sin fracción no puede contar como movida.
test("una reserva con milisegundos notificada al segundo exacto NO cuenta como movida", async () => {
  const escenario = await montar("sin-cambio-ms");
  try {
    const canal = randomUUID();
    await conectarGoogle(escenario, {
      channelId: canal,
      channelResourceId: "r1",
      channelExpiration: new Date(Date.now() + 86400000),
      syncToken: "t0",
    });

    // Desde V-2 createBooking no acepta un startsAt con milisegundos (no está
    // en la grilla), así que la premisa "el CRM guardó los ms" solo puede venir
    // de una fila anterior a V-2 o escrita por otro camino: se inserta por el
    // repositorio, que es exactamente esa fila. La tolerancia de B-5 tiene que
    // seguir valiendo para ellas.
    const conMilisegundos = new Date("2026-09-07T12:00:00.347Z");
    const booking = await insertarReserva({
      organizationId: escenario.organizationId,
      branchId: escenario.branchId,
      serviceTypeId: escenario.serviceTypeId,
      resourceId: escenario.resourceId,
      contactId: escenario.contactId,
      startsAt: conMilisegundos,
      endsAt: new Date(conMilisegundos.getTime() + 60 * 60 * 1000),
    });
    await prisma.booking.update({
      where: { id: booking.id },
      data: { googleEventId: "evt-igual-ms" },
    });
    assert.equal(booking.startsAt.getMilliseconds(), 347, "la premisa: el CRM guardó los ms");

    // Lo que Google devolvería: el mismo instante, truncado al segundo.
    const alSegundo = (fecha: Date) => new Date(Math.floor(fecha.getTime() / 1000) * 1000);

    const resultado = await notificar(
      escenario,
      canal,
      doblarGoogle({
        cambios: [
          {
            id: "evt-igual-ms",
            status: "confirmed",
            inicio: alSegundo(booking.startsAt),
            fin: alSegundo(booking.endsAt),
          },
        ],
      }),
    );

    assert.equal(resultado.eventosMovidos, 0);
    assert.equal(resultado.accion, "sin-cambios");
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// 4. El syncToken
// ---------------------------------------------------------------------------

test("el syncToken nuevo se guarda al terminar de procesar", async () => {
  const escenario = await montar("guardar-token");
  try {
    const canal = randomUUID();
    await conectarGoogle(escenario, {
      channelId: canal,
      channelResourceId: "r1",
      channelExpiration: new Date(Date.now() + 86400000),
      syncToken: "t0",
    });

    const doble = doblarGoogle({ nextSyncToken: "t1" });
    await notificar(escenario, canal, doble);

    assert.deepEqual(doble.listadosConSyncToken, ["t0"], "se llamó con el token guardado");
    // M-3: con syncToken NO va timeMin — Google no admite los dos juntos.
    assert.deepEqual(doble.listadosConTimeMin, [undefined]);

    const fila = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: escenario.branchId },
    });
    assert.equal(fila.syncToken, "t1");
  } finally {
    await desmontar(escenario);
  }
});

test("la PRIMERA sincronización (sin token) no reconcilia hacia atrás: solo guarda el token", async () => {
  // Una sincronización completa trae el calendario entero del negocio —años de
  // eventos ajenos al CRM— y compararlos todos es un problema distinto y mucho
  // más grande que "mantenerse al día".
  const escenario = await montar("primera-sync");
  try {
    const canal = randomUUID();
    await conectarGoogle(escenario, {
      channelId: canal,
      channelResourceId: "r1",
      channelExpiration: new Date(Date.now() + 86400000),
      // sin syncToken
    });

    const booking = await reservar(escenario, "evt-viejo");

    const doble = doblarGoogle({
      cambios: [{ id: "evt-viejo", status: "cancelled" }],
      nextSyncToken: "t-inicial",
    });
    const resultado = await notificar(escenario, canal, doble);

    assert.equal(resultado.accion, "sync-inicial");
    assert.equal(resultado.bookingsCancelados, 0, "NO se reconcilia hacia atrás");

    // M-3: la lista completa va acotada desde ahora, y sin syncToken.
    assert.equal(doble.listadosConSyncToken[0], undefined);
    assertTimeMinReciente(doble.listadosConTimeMin[0], "primera sincronización");

    const persistido = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    assert.equal(persistido.status, "CONFIRMED");

    const fila = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: escenario.branchId },
    });
    assert.equal(fila.syncToken, "t-inicial", "pero el token sí queda guardado");
  } finally {
    await desmontar(escenario);
  }
});

test("un 410 resincroniza completo y guarda un token nuevo", async () => {
  const escenario = await montar("410");
  try {
    const canal = randomUUID();
    await conectarGoogle(escenario, {
      channelId: canal,
      channelResourceId: "r1",
      channelExpiration: new Date(Date.now() + 86400000),
      syncToken: "vencido",
    });

    const doble = doblarGoogle({ syncTokenVencido: true, nextSyncToken: "t-fresco" });

    const resultado = await notificar(escenario, canal, doble);

    assert.equal(resultado.accion, "sync-inicial");
    // Dos llamadas: la primera con el token vencido, la segunda sin token.
    assert.deepEqual(doble.listadosConSyncToken, ["vencido", undefined]);
    // M-3: la incremental va sin timeMin; la completa del reintento, acotada.
    assert.equal(doble.listadosConTimeMin[0], undefined);
    assertTimeMinReciente(doble.listadosConTimeMin[1], "resincronización tras 410");

    const fila = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: escenario.branchId },
    });
    assert.equal(fila.syncToken, "t-fresco");
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// 5. El worker de renovación
// ---------------------------------------------------------------------------

test("el worker crea un canal donde no hay ninguno", async () => {
  // "Sin canal" y "canal por vencer" son el mismo caso — es lo que permite que
  // el flujo OAuth del paso 2 no cree canales.
  const escenario = await montar("worker-crea");
  try {
    await conectarGoogle(escenario);

    const doble = doblarGoogle();
    const antes = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: escenario.branchId },
    });
    assert.equal(antes.channelId, null);

    await renovarCanal(antes, doble.cliente);

    const despues = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: escenario.branchId },
    });

    assert.ok(despues.channelId);
    assert.ok(despues.channelResourceId, "el resourceId es obligatorio para poder cerrarlo");
    assert.ok(despues.channelExpiration);

    assert.equal(doble.canalesCreados.length, 1);
    assert.equal(doble.canalesCreados[0].channelId, despues.channelId);
    assert.deepEqual(doble.canalesDetenidos, [], "no había canal viejo que cerrar");
  } finally {
    await desmontar(escenario);
  }
});

test("el token del canal se firma con el channelId real y verifica", async () => {
  const escenario = await montar("worker-token");
  try {
    await conectarGoogle(escenario);

    const doble = doblarGoogle();
    const conexion = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: escenario.branchId },
    });

    await renovarCanal(conexion, doble.cliente);

    const verificado = await verificarWebhookToken(doble.canalesCreados[0].token);

    assert.equal(verificado.organizationId, escenario.organizationId);
    assert.equal(verificado.branchId, escenario.branchId);
    assert.equal(verificado.channelId, doble.canalesCreados[0].channelId);
  } finally {
    await desmontar(escenario);
  }
});

test("al renovar, el canal NUEVO se guarda ANTES de cerrar el viejo", async () => {
  // El orden evita la ventana ciega: cerrando primero, cualquier cambio hecho en
  // Google entre el cierre y la creación no dispararía notificación y se
  // perdería.
  const escenario = await montar("worker-renueva");
  try {
    const canalViejo = randomUUID();
    await conectarGoogle(escenario, {
      channelId: canalViejo,
      channelResourceId: "recurso-viejo",
      channelExpiration: new Date(Date.now() + 3600000),
    });

    const conexion = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: escenario.branchId },
    });

    const doble = doblarGoogle();
    await renovarCanal(conexion, doble.cliente);

    const despues = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: escenario.branchId },
    });

    assert.notEqual(despues.channelId, canalViejo, "quedó guardado el canal nuevo");
    assert.deepEqual(doble.canalesDetenidos, [
      { channelId: canalViejo, resourceId: "recurso-viejo" },
    ]);
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// A-8 (docs/auditoria-2026-08-29.md) — el barrido del worker, probado de verdad.
//
// Los dos tests negativos de acá abajo llamaban `renovarCanalesVencidos()` sin
// doble y afirmaban que la fila no había cambiado. En CI no hay ninguna
// GOOGLE_*, así que cada conexión reventaba en getClienteGoogleCalendar() con
// un 500 de configuración ANTES de llegar a ninguna lógica, el bucle la contaba
// como `fallidos` y seguía: NINGUNA conexión podía cambiar en esa llamada, y
// los tests quedaban verdes aunque el filtro de la consulta no existiera.
// Además el barrido recorría la base ENTERA —las conexiones de los otros
// archivos de la suite, que corren en paralelo— y con credenciales reales en
// .env las habría marcado ERROR contra Google.
//
// Ahora cada test (a) inyecta el doble, (b) se acota a su organización, (c)
// afirma sobre el `resumen` y sobre lo que el doble vio, y (d) monta en la
// misma organización una conexión que SÍ tiene que procesarse: así "no tocó la
// que no debía" se prueba junto con "sí tocó la que debía", y el test no puede
// quedar verde porque nada pasó.
// ---------------------------------------------------------------------------

// Una segunda sucursal de la misma organización, con su propia conexión. Es lo
// que permite tener en un mismo test una conexión que el worker debe procesar y
// otra que no, sin duplicar `montar`.
async function conectarSegundaSucursal(
  escenario: Escenario,
  extra: Parameters<typeof conectarGoogle>[1] & { status?: "ACTIVE" | "REVOKED" } = {},
) {
  const sucursal = await createBranch(escenario.organizationId, {
    name: `Sucursal 2 ${randomUUID().slice(0, 8)}`,
    timezone: TZ,
  });
  const { status, ...canal } = extra;
  const conexion = await prisma.googleCalendarConnection.create({
    data: {
      organizationId: escenario.organizationId,
      branchId: sucursal.id,
      refreshToken: status === "REVOKED" ? null : getCifrador().encrypt("1//refresh"),
      calendarId: "primary",
      status: status ?? "ACTIVE",
      ...canal,
    },
  });
  return { sucursal, conexion };
}

test("el worker NO toca conexiones cuyo canal está lejos de vencer — y SÍ renueva, en la misma pasada, la que vence dentro del margen", async () => {
  const escenario = await montar("worker-vigente");
  try {
    const canalVigente = randomUUID();
    await conectarGoogle(escenario, {
      channelId: canalVigente,
      channelResourceId: "r-vigente",
      // Vence en 6 días: muy por encima del margen de 24 h.
      channelExpiration: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
    });

    // La contraparte, en la misma organización: vence en una hora, dentro del
    // margen. Si el filtro por vencimiento desapareciera, las dos se renovarían;
    // si desapareciera todo el barrido, ninguna.
    const canalPorVencer = randomUUID();
    const { sucursal: porVencer } = await conectarSegundaSucursal(escenario, {
      channelId: canalPorVencer,
      channelResourceId: "r-por-vencer",
      channelExpiration: new Date(Date.now() + 60 * 60 * 1000),
    });

    const doble = doblarGoogle();
    const resumen = await renovarCanalesVencidos({
      cliente: doble.cliente,
      organizationId: escenario.organizationId,
    });

    assert.deepEqual(
      resumen,
      { renovados: 1, fallidos: 0 },
      "exactamente una conexión tenía que renovarse; con el 500 de configuración de antes esto daba fallidos > 0 y el test no lo miraba",
    );

    const vigente = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: escenario.branchId },
    });
    assert.equal(vigente.channelId, canalVigente, "el canal vigente no se toca");

    const renovada = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: porVencer.id },
    });
    assert.notEqual(renovada.channelId, canalPorVencer, "el que vencía tiene un canal nuevo");

    // Lo que Google vio: un solo canal creado (el de la sucursal por vencer) y
    // un solo canal detenido (el viejo de esa misma sucursal). Nada del vigente.
    assert.equal(doble.canalesCreados.length, 1);
    assert.equal(doble.canalesCreados[0].channelId, renovada.channelId);
    assert.deepEqual(doble.canalesDetenidos, [
      { channelId: canalPorVencer, resourceId: "r-por-vencer" },
    ]);
  } finally {
    await desmontar(escenario);
  }
});

test("una conexión REVOKED no recibe canal — y la ACTIVE sin canal de la misma organización sí, en la misma pasada", async () => {
  const escenario = await montar("worker-revoked");
  try {
    await prisma.googleCalendarConnection.create({
      data: {
        organizationId: escenario.organizationId,
        branchId: escenario.branchId,
        refreshToken: null,
        calendarId: "primary",
        status: "REVOKED",
      },
    });

    // La contraparte: ACTIVE y sin canal, exactamente lo que queda después del
    // flujo OAuth. Si el filtro `status: "ACTIVE"` desapareciera, la REVOKED
    // entraría al bucle y renovarCanal reventaría en obtenerAccessToken (sin
    // token) → fallidos: 1.
    const { sucursal: activa } = await conectarSegundaSucursal(escenario);

    const doble = doblarGoogle();
    const resumen = await renovarCanalesVencidos({
      cliente: doble.cliente,
      organizationId: escenario.organizationId,
    });

    assert.deepEqual(resumen, { renovados: 1, fallidos: 0 });

    const revocada = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: escenario.branchId },
    });
    assert.equal(revocada.channelId, null, "una REVOKED nunca recibe canal");
    assert.equal(revocada.status, "REVOKED");

    const conCanal = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: activa.id },
    });
    assert.ok(conCanal.channelId, "la ACTIVE sin canal recibió el suyo");

    assert.equal(doble.canalesCreados.length, 1, "Google vio un solo canal: el de la ACTIVE");
    assert.deepEqual(doble.canalesDetenidos, []);
  } finally {
    await desmontar(escenario);
  }
});

test("el barrido acotado a una organización no toca las conexiones de otra (la premisa de la suite)", async () => {
  // Es la mitad "bomba de tiempo" de A-8: sin alcance, un barrido desde este
  // archivo pasaba por las conexiones de los otros archivos de la suite. Dos
  // organizaciones, las dos con una conexión ACTIVE sin canal: el barrido de
  // una no puede haber visto la otra.
  const a = await montar("worker-alcance-a");
  const b = await montar("worker-alcance-b");
  try {
    await conectarGoogle(a);
    await conectarGoogle(b);

    const doble = doblarGoogle();
    const resumen = await renovarCanalesVencidos({
      cliente: doble.cliente,
      organizationId: a.organizationId,
    });

    assert.deepEqual(resumen, { renovados: 1, fallidos: 0 });

    const deA = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: a.branchId },
    });
    assert.ok(deA.channelId, "la organización pedida se procesó");

    const deB = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: b.branchId },
    });
    assert.equal(deB.channelId, null, "la otra organización no se tocó");

    assert.equal(doble.canalesCreados.length, 1);
  } finally {
    await desmontar(a);
    await desmontar(b);
  }
});

// ---------------------------------------------------------------------------
// 6. Desconectar cierra el canal
// ---------------------------------------------------------------------------

test("desconectar cierra el canal en Google y lo limpia de la fila", async () => {
  const escenario = await montar("desconectar");
  try {
    const canal = randomUUID();
    await conectarGoogle(escenario, {
      channelId: canal,
      channelResourceId: "recurso-x",
      channelExpiration: new Date(Date.now() + 86400000),
      syncToken: "t0",
    });

    const doble = doblarGoogle();
    await desconectar(escenario.organizationId, escenario.branchId, doble.cliente);

    assert.deepEqual(doble.canalesDetenidos, [{ channelId: canal, resourceId: "recurso-x" }]);

    const fila = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: escenario.branchId },
    });

    assert.equal(fila.status, "REVOKED");
    assert.equal(fila.channelId, null, "el canal se limpia de la fila");
    assert.equal(fila.channelResourceId, null);
    assert.equal(fila.channelExpiration, null);
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// 7. El invariante de la base
// ---------------------------------------------------------------------------

test("la base RECHAZA un canal a medias (channelId sin resourceId)", async () => {
  // Un canal a medias es inutilizable de forma silenciosa: con channelId pero
  // sin resourceId, el webhook procesa notificaciones pero el canal NO SE PUEDE
  // CERRAR NUNCA.
  const escenario = await montar("check-canal");
  try {
    await assert.rejects(
      () =>
        prisma.googleCalendarConnection.create({
          data: {
            organizationId: escenario.organizationId,
            branchId: escenario.branchId,
            refreshToken: getCifrador().encrypt("1//refresh"),
            calendarId: "primary",
            status: "ACTIVE",
            channelId: randomUUID(),
            // sin channelResourceId ni channelExpiration
          },
        }),
      /channel_all_or_none/,
    );
  } finally {
    await desmontar(escenario);
  }
});

test("dos conexiones no pueden compartir el mismo channelId", async () => {
  const a = await montar("unique-a");
  const b = await montar("unique-b");
  try {
    const canal = randomUUID();

    await conectarGoogle(a, {
      channelId: canal,
      channelResourceId: "r1",
      channelExpiration: new Date(Date.now() + 86400000),
    });

    await assert.rejects(() =>
      conectarGoogle(b, {
        channelId: canal,
        channelResourceId: "r2",
        channelExpiration: new Date(Date.now() + 86400000),
      }),
    );
  } finally {
    await desmontar(a);
    await desmontar(b);
  }
});

// ---------------------------------------------------------------------------
// B-16 de docs/auditoria-2026-08-29.md — las dos lecturas del canal no traen el
// secreto. Directo al repository: la garantía es el `select`, y el shape exacto
// de las claves es el contrato — el deepEqual falla tanto si falta un campo que
// un caller necesita como si alguien vuelve a traer de más.
// ---------------------------------------------------------------------------

test("B-16: findConnectionByChannelId devuelve solo organizationId, branchId y syncToken — sin refreshToken", async () => {
  const escenario = await montar("b16-canal");
  try {
    const canal = randomUUID();
    await conectarGoogle(escenario, {
      channelId: canal,
      channelResourceId: "r-b16",
      // Los tres campos del canal o ninguno: lo exige el CHECK
      // channel_all_or_none_check (ver el test "la base RECHAZA un canal a medias").
      channelExpiration: new Date(Date.now() + 6 * 60 * 60 * 1000),
      syncToken: "sync-b16",
    });

    const conexion = await findConnectionByChannelId(canal);

    assert.ok(conexion, "la conexión existe");
    assert.deepEqual(conexion, {
      organizationId: escenario.organizationId,
      branchId: escenario.branchId,
      syncToken: "sync-b16",
      // B-6: la zona de la sucursal viaja con la conexión, y solo eso de branch.
      branch: { timezone: TZ },
    });
    assert.ok(!("refreshToken" in conexion), "el secreto no viaja por el camino del webhook");
  } finally {
    await desmontar(escenario);
  }
});

test("B-16: findConnectionsNeedingChannel devuelve solo lo que renovarCanal necesita — sin refreshToken", async () => {
  const escenario = await montar("b16-worker");
  try {
    // ACTIVE y sin canal: candidata segura del barrido, como tras el OAuth.
    await conectarGoogle(escenario);

    const filas = await findConnectionsNeedingChannel(new Date(Date.now() + 60_000), {
      organizationId: escenario.organizationId,
    });

    assert.equal(filas.length, 1);
    assert.deepEqual(filas[0], {
      organizationId: escenario.organizationId,
      branchId: escenario.branchId,
      channelId: null,
      channelResourceId: null,
    });
    assert.ok(!("refreshToken" in filas[0]), "el secreto no viaja por el barrido del worker");
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// B-6 de docs/auditoria-2026-08-29.md — la zona de la sucursal llega hasta
// events.list. El bug vive en leerInstante (probado en
// googleCalendar.service.test.ts); acá se prueba el cableado: la zona sale de
// la fila por findConnectionByChannelId y sincronizar la pasa en LAS DOS
// llamadas a listarCambios, la incremental y la completa tras un 410.
// ---------------------------------------------------------------------------

test("B-6: sincronizar pasa la zona de la SUCURSAL a listarCambios, también en la resincronización tras un 410", async () => {
  const escenario = await montar("b6-zona");
  try {
    const canal = randomUUID();
    await conectarGoogle(escenario, {
      channelId: canal,
      channelResourceId: "r-b6",
      channelExpiration: new Date(Date.now() + 86400000),
      syncToken: "vencido",
    });

    const doble = doblarGoogle({ syncTokenVencido: true });
    await notificar(escenario, canal, doble);

    assert.deepEqual(doble.listadosConSyncToken, ["vencido", undefined], "hubo 410 y reintento");
    assert.deepEqual(doble.listadosConTimezone, [TZ, TZ], "la zona de la sucursal, en las dos");
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// B-7 de docs/auditoria-2026-08-29.md — la carrera entre renovar el canal y
// desconectar. renovarCanal lee la conexión (obtenerAccessToken valida ACTIVE),
// va a Google a crear el canal, y recién después escribe la fila. Si
// desconectar() corre en el medio, la escritura vieja pisaba una fila REVOKED
// con un canal que nadie iba a renovar ni cerrar hasta vencer.
//
// La ventana se fuerza sin timing real: el doble desconecta DE VERDAD desde
// adentro de crearCanalDeNotificaciones, antes de responder — así el guard se
// ejercita con la fila ya cambiada en la base.
// ---------------------------------------------------------------------------

test("B-7: si la sucursal se desconecta mientras Google crea el canal, no se pisa la fila REVOKED, el canal huérfano se cierra y renovarCanal falla", async () => {
  const escenario = await montar("b7-carrera");
  try {
    await conectarGoogle(escenario);

    const doble: Doble = doblarGoogle({
      alCrearCanal: () => desconectar(escenario.organizationId, escenario.branchId, doble.cliente),
    });

    const antes = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: escenario.branchId },
    });
    assert.equal(antes.status, "ACTIVE");
    assert.equal(antes.channelId, null);

    assertAppError(await capturar(() => renovarCanal(antes, doble.cliente)), 409);

    const despues = await prisma.googleCalendarConnection.findFirstOrThrow({
      where: { branchId: escenario.branchId },
    });
    assert.equal(despues.status, "REVOKED", "desconectar corrió en el medio");
    assert.equal(despues.channelId, null, "la escritura NO pisó la fila REVOKED");
    assert.equal(despues.channelResourceId, null);
    assert.equal(despues.channelExpiration, null);

    // Google sí llegó a crear el canal, y ese mismo canal se cerró: no queda
    // ninguno vivo hasta vencer.
    assert.equal(doble.canalesCreados.length, 1);
    assert.deepEqual(doble.canalesDetenidos, [
      {
        channelId: doble.canalesCreados[0].channelId,
        resourceId: `recurso-de-${doble.canalesCreados[0].channelId.slice(0, 8)}`,
      },
    ]);
  } finally {
    await desmontar(escenario);
  }
});
