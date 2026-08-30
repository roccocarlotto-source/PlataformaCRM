import type { BookingStatus, Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Booking — acceso a datos (P2.1, paso 3).
//
// Sin soft delete: cancelar es un `status`. Ver el comentario del modelo.
// ---------------------------------------------------------------------------

export interface BookingFilters {
  branchId?: string;
  resourceId?: string;
  serviceTypeId?: string;
  contactId?: string;
  status?: BookingStatus;
  // Rango sobre startsAt, para la vista de agenda.
  desde?: Date;
  hasta?: Date;
}

export type BookingSortBy = "startsAt" | "createdAt";
export type SortOrder = "asc" | "desc";

function buildWhere(organizationId: string, filters: BookingFilters): Prisma.BookingWhereInput {
  return {
    organizationId,
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.resourceId ? { resourceId: filters.resourceId } : {}),
    ...(filters.serviceTypeId ? { serviceTypeId: filters.serviceTypeId } : {}),
    ...(filters.contactId ? { contactId: filters.contactId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.desde || filters.hasta
      ? {
          startsAt: {
            ...(filters.desde ? { gte: filters.desde } : {}),
            ...(filters.hasta ? { lt: filters.hasta } : {}),
          },
        }
      : {}),
  };
}

export function findManyBookings(
  organizationId: string,
  filters: BookingFilters,
  pagination: { skip: number; take: number },
  sort: { sortBy: BookingSortBy; sortOrder: SortOrder },
  db: Db = prisma,
) {
  return db.booking.findMany({
    where: buildWhere(organizationId, filters),
    orderBy: { [sort.sortBy]: sort.sortOrder },
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countBookings(organizationId: string, filters: BookingFilters, db: Db = prisma) {
  return db.booking.count({ where: buildWhere(organizationId, filters) });
}

export function findBookingById(id: string, organizationId: string, db: Db = prisma) {
  return db.booking.findFirst({ where: { id, organizationId } });
}

// ---------------------------------------------------------------------------
// LA CONSULTA CALIENTE DEL MÓDULO: las reservas CONFIRMED de un recurso que se
// superponen con [inicio, fin).
//
// LA CONDICIÓN DE SUPERPOSICIÓN ES `startsAt < fin AND endsAt > inicio`, y las
// dos desigualdades son ESTRICTAS a propósito:
//
//   - Estrictas => dos turnos consecutivos (9:00-9:30 y 9:30-10:00) NO se
//     consideran superpuestos, que es lo que permite trabajar de corrido.
//   - Y captura la superposición PARCIAL, no solo la coincidencia exacta: un
//     turno de 9:15 a 9:45 choca con uno de 9:00 a 9:30 aunque no empiecen a la
//     misma hora. Comparar solo `startsAt` igual sería el bug obvio de esta
//     función, y dejaría reservar encima de un turno existente con solo correrlo
//     quince minutos.
//
// SOLO CONFIRMED OCUPA. Una reserva CANCELLED liberó su cupo; COMPLETED y
// NO_SHOW son historia (ya pasaron) y no pueden bloquear una reserva nueva.
//
// POR RECURSO Y NO POR SERVICIO: dos servicios distintos que comparten el mismo
// recurso compiten por él igual. Contar por serviceTypeId dejaría reservar un
// "corte de pelo" encima de una "barba" del mismo barbero.
// ---------------------------------------------------------------------------
export function countOverlappingBookings(
  organizationId: string,
  resourceId: string,
  inicio: Date,
  fin: Date,
  db: Db = prisma,
  excluirBookingId?: string,
) {
  return db.booking.count({
    where: {
      organizationId,
      resourceId,
      status: "CONFIRMED",
      startsAt: { lt: fin },
      endsAt: { gt: inicio },
      ...(excluirBookingId ? { id: { not: excluirBookingId } } : {}),
    },
  });
}

// Las reservas CONFIRMED de un recurso dentro de un rango — lo que necesita el
// cálculo de disponibilidad para descontar cupo. Devuelve las filas (no un
// conteo) porque hay que agrupar por franja horaria del lado del service.
export function findConfirmedBookingsInRange(
  organizationId: string,
  resourceId: string,
  desde: Date,
  hasta: Date,
  db: Db = prisma,
) {
  return db.booking.findMany({
    where: {
      organizationId,
      resourceId,
      status: "CONFIRMED",
      startsAt: { lt: hasta },
      endsAt: { gt: desde },
    },
    select: { startsAt: true, endsAt: true },
    orderBy: { startsAt: "asc" },
  });
}

// El conteo del RESTRICT de deleteServiceType. Cierra el pendiente (1) que
// PR #41 dejó anotado en serviceType.service.ts.
//
// SOLO CONFIRMED, y la decisión estaba explícitamente pendiente en aquel
// comentario: COMPLETED y NO_SHOW son historia, no reservas vivas — borrar el
// servicio no las pierde ni las contradice. CANCELLED tampoco bloquea, por lo
// mismo.
export function countActiveBookingsByServiceType(
  serviceTypeId: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.booking.count({
    where: { serviceTypeId, organizationId, status: "CONFIRMED" },
  });
}

export interface CreateBookingData {
  organizationId: string;
  branchId: string;
  serviceTypeId: string;
  resourceId: string;
  contactId: string;
  opportunityId?: string;
  startsAt: Date;
  endsAt: Date;
}

export function createBooking(data: CreateBookingData, db: Db = prisma) {
  return db.booking.create({ data });
}

// Segunda escritura, DESPUÉS de que Google respondió y fuera de la transacción
// de creación. Ver el comentario de createBooking en booking.service.ts sobre
// por qué la llamada a Google no puede vivir adentro de la transacción.
//
// SOLO SOBRE UNA RESERVA TODAVÍA CONFIRMED — M-2 de docs/auditoria-2026-08-29.md.
// Entre el commit de la reserva y la respuesta de Google pasan hasta diez
// segundos, y en esa ventana puede llegar una cancelación: markBookingCancelled
// la aplica (la fila está CONFIRMED y sin googleEventId, así que no hay nada que
// borrar en Google), y si esta escritura no mirara el status, el id que Google
// devuelve tarde quedaría escrito sobre una fila CANCELLED — un evento vivo en
// el calendario del negocio que nadie vuelve a borrar, porque desde la base esa
// reserva nunca tuvo evento. Con el status en el WHERE, el caller lee count ===
// 0 y sabe que tiene que borrar el evento recién creado. Mismo criterio que
// markBookingCancelled: el WHERE decide, no el pre-check.
export function setGoogleEventId(
  id: string,
  organizationId: string,
  googleEventId: string,
  db: Db = prisma,
) {
  return db.booking.updateMany({
    where: { id, organizationId, status: "CONFIRMED" },
    data: { googleEventId },
  });
}

export function markBookingCancelled(id: string, organizationId: string, db: Db = prisma) {
  return db.booking.updateMany({
    where: { id, status: "CONFIRMED" },
    data: { status: "CANCELLED" },
  });
}

// La reserva que refleja un evento concreto de Google — la búsqueda de la
// sincronización inversa (paso 4).
//
// EXIGE organizationId además del googleEventId, y no es simetría con el resto
// del archivo: los ids de evento los asigna GOOGLE, no este sistema, así que
// nada garantiza que sean únicos entre calendarios de organizaciones distintas.
// Sin el organizationId en el WHERE, una colisión —o un id reproducido a
// propósito— alcanzaría para cancelar la reserva de otro tenant.
//
// Sin filtro por status: quien llama necesita ver también las ya canceladas para
// distinguir "no hay nada que hacer" de "no existe".
export function findBookingByGoogleEventId(
  googleEventId: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.booking.findFirst({ where: { googleEventId, organizationId } });
}
