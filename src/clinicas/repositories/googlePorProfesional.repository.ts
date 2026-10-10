import { prisma, type Db } from "../../lib/prisma";

// ---------------------------------------------------------------------------
// Un calendario de Google por profesional de clínica (docs/rubros.md §4.6, D4,
// R8). Las filas de google_calendar_channels con resource_id: una por
// calendario de profesional, junto a la del calendario de la sede (resource_id
// NULL), que es la única que tiene una automotora y que este archivo no toca.
//
// LA FUENTE DE VERDAD ES Resource.googleCalendarId: las filas de canal se
// derivan de ahí (asegurarFilasDeProfesionales). Reconectar o desconectar una
// sede borra sus filas de canal (R7); el worker las vuelve a crear en la
// próxima pasada para los profesionales que siguen teniendo calendario.
// ---------------------------------------------------------------------------

const SELECT_DEL_CANAL = {
  id: true,
  organizationId: true,
  branchId: true,
  calendarId: true,
  resourceId: true,
  channelId: true,
  channelResourceId: true,
  channelExpiration: true,
  syncToken: true,
  branch: { select: { timezone: true } },
} as const;

/** El canal de un calendario de profesional, por el X-Goog-Channel-ID del
 *  webhook. Sin organizationId en el WHERE por el mismo motivo que
 *  findConnectionByChannelId (el channelId es la clave de entrada; el token
 *  firmado se compara después). null si el canal no es de un profesional. */
export function findCanalDeProfesionalPorChannelId(channelId: string, db: Db = prisma) {
  return db.googleCalendarChannel.findFirst({
    where: { channelId, resourceId: { not: null } },
    select: SELECT_DEL_CANAL,
  });
}

/** Crea la fila de canal de cada profesional de clínica con calendario propio
 *  cuya sede tiene Google ACTIVE y todavía no la tiene, y devuelve las filas
 *  que necesitan un canal (sin canal, o que vence antes del límite).
 *  `alcance.organizationId`: solo para tests, como findConnectionsNeedingChannel. */
export async function asegurarFilasDeProfesionales(
  limiteDeVencimiento: Date,
  // `resourceId`: solo ese profesional (abrir su canal al asignarle el
  // calendario).
  alcance: { organizationId?: string; resourceId?: string } = {},
  db: Db = prisma,
) {
  const profesionales = await db.resource.findMany({
    where: {
      googleCalendarId: { not: null },
      deletedAt: null,
      organization: { industry: "CLINICA" },
      ...(alcance.organizationId ? { organizationId: alcance.organizationId } : {}),
      ...(alcance.resourceId ? { id: alcance.resourceId } : {}),
    },
    select: { id: true, organizationId: true, branchId: true, googleCalendarId: true },
  });
  if (profesionales.length === 0) return [];

  const conexiones = await db.googleCalendarConnection.findMany({
    where: {
      status: "ACTIVE",
      OR: profesionales.map((p) => ({ organizationId: p.organizationId, branchId: p.branchId })),
    },
    select: { organizationId: true, branchId: true },
  });
  const activa = new Set(conexiones.map((c) => `${c.organizationId}:${c.branchId}`));
  const conCalendario = profesionales.filter((p) =>
    activa.has(`${p.organizationId}:${p.branchId}`),
  );
  if (conCalendario.length === 0) return [];

  await db.googleCalendarChannel.createMany({
    data: conCalendario.map((p) => ({
      organizationId: p.organizationId,
      branchId: p.branchId,
      calendarId: p.googleCalendarId!,
      resourceId: p.id,
    })),
    skipDuplicates: true,
  });

  const filas = await db.googleCalendarChannel.findMany({
    where: {
      OR: conCalendario.map((p) => ({
        organizationId: p.organizationId,
        branchId: p.branchId,
        calendarId: p.googleCalendarId!,
        resourceId: p.id,
      })),
    },
    select: SELECT_DEL_CANAL,
  });
  return filas.filter(
    (f) =>
      f.channelId === null ||
      f.channelExpiration === null ||
      f.channelExpiration < limiteDeVencimiento,
  );
}

/** Guarda el canal recién abierto en la fila del calendario del profesional,
 *  solo si la fila sigue siendo de ese profesional (pudo cambiar de calendario
 *  mientras se abría). Limpia el error anterior. */
export function guardarCanalDeProfesional(
  id: string,
  resourceId: string,
  datos: { channelId: string; channelResourceId: string; channelExpiration: Date },
  db: Db = prisma,
) {
  return db.googleCalendarChannel.updateMany({
    where: { id, resourceId },
    data: { ...datos, lastErrorAt: null, lastErrorMessage: null },
  });
}

export function guardarSyncTokenDelCanal(id: string, syncToken: string, db: Db = prisma) {
  return db.googleCalendarChannel.updateMany({ where: { id }, data: { syncToken } });
}

/** El texto que se guarda como error de un canal: solo el error de Google
 *  (o de esta integración), nunca un token. Por las dudas se tapan las formas
 *  de un access token ("ya29."), de un refresh token ("1//") y de un header
 *  Bearer, y se corta a 500. PURA. */
export function mensajeDeErrorDelCanal(mensaje: string): string {
  return mensaje
    .replace(/Bearer\s+[\w.~+/=-]+/gi, "Bearer [oculto]")
    .replace(/ya29\.[\w.-]+/g, "[token oculto]")
    .replace(/1\/\/[\w.-]+/g, "[token oculto]")
    .slice(0, 500);
}

export function registrarErrorDelCanal(id: string, mensaje: string, db: Db = prisma) {
  return db.googleCalendarChannel.updateMany({
    where: { id },
    data: { lastErrorAt: new Date(), lastErrorMessage: mensajeDeErrorDelCanal(mensaje) },
  });
}

/** El error del calendario de un profesional (freebusy o evento), sin tocar la
 *  conexión de la sede: un calendario borrado no rompe a los demás. */
export function registrarErrorDelCalendario(
  organizationId: string,
  branchId: string,
  calendarId: string,
  mensaje: string,
  db: Db = prisma,
) {
  return db.googleCalendarChannel.updateMany({
    where: { organizationId, branchId, calendarId, resourceId: { not: null } },
    data: { lastErrorAt: new Date(), lastErrorMessage: mensajeDeErrorDelCanal(mensaje) },
  });
}

/** Los canales abiertos de los profesionales de una sede (para cerrarlos al
 *  desconectar Google). */
export function findCanalesAbiertosDeProfesionales(
  organizationId: string,
  branchId: string,
  db: Db = prisma,
) {
  return db.googleCalendarChannel.findMany({
    where: { organizationId, branchId, resourceId: { not: null }, channelId: { not: null } },
    select: { channelId: true, channelResourceId: true },
  });
}

/** Saca la fila de canal de un profesional (cambió de calendario o lo quitó) y
 *  devuelve lo que hay que detener en Google. */
export async function quitarFilaDelProfesional(
  organizationId: string,
  resourceId: string,
  db: Db = prisma,
) {
  const filas = await db.googleCalendarChannel.findMany({
    where: { organizationId, resourceId },
    select: { id: true, branchId: true, channelId: true, channelResourceId: true },
  });
  await db.googleCalendarChannel.deleteMany({ where: { organizationId, resourceId } });
  return filas;
}

export function guardarCalendarioDelProfesional(
  organizationId: string,
  resourceId: string,
  googleCalendarId: string | null,
  db: Db = prisma,
) {
  return db.resource.updateMany({
    where: { id: resourceId, organizationId, deletedAt: null },
    data: { googleCalendarId },
  });
}

/** Otro profesional de la sede que ya usa ese calendario. */
export function findOtroProfesionalConElCalendario(
  organizationId: string,
  branchId: string,
  calendarId: string,
  resourceId: string,
  db: Db = prisma,
) {
  return db.resource.findFirst({
    where: {
      organizationId,
      branchId,
      googleCalendarId: calendarId,
      deletedAt: null,
      id: { not: resourceId },
    },
    select: { id: true, name: true },
  });
}

/** Desvincula una reserva de su evento de Google (se borró allá): la reserva
 *  sigue en pie en la plataforma, sin espejo. */
export function desvincularEventoDeGoogle(id: string, organizationId: string, db: Db = prisma) {
  return db.booking.updateMany({
    where: { id, organizationId },
    data: { googleEventId: null, googleCalendarId: null },
  });
}
