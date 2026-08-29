import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import {
  countOverlappingBookings,
  createBooking as createBookingRepo,
  findBookingById,
  findManyBookings,
  countBookings,
  markBookingCancelled,
  setGoogleEventId,
  type BookingFilters,
  type BookingSortBy,
  type SortOrder,
} from "../repositories/booking.repository";
import { findContactById } from "../repositories/contact.repository";
import { findOpportunityById } from "../repositories/opportunity.repository";
import { findResourceById, lockResourceForUpdate } from "../repositories/resource.repository";
import {
  findServiceTypeById,
  lockServiceTypeForUpdate,
} from "../repositories/serviceType.repository";
import { AppError } from "../utils/AppError";
import { estaDentroDelHorario } from "../utils/workingHours";
import { resolverContexto } from "./availability.service";
import type { ClienteGoogleCalendar } from "./googleCalendar.service";
import { borrarReservaDeGoogle, reflejarReservaEnGoogle } from "./googleCalendarConnection.service";

// ---------------------------------------------------------------------------
// Booking — creación y cancelación (P2.1, paso 3).
//
// FUERA DE ALCANCE A PROPÓSITO: REPROGRAMAR. Cambiar startsAt/endsAt de una
// reserva existente exige revalidar el horario de trabajo, la capacidad en el
// horario nuevo Y mover el evento en Google, o sea que es la creación completa
// otra vez más el manejo del estado anterior. Queda para después; hoy el camino
// es cancelar y crear.
//
// TAMPOCO SE EMITE NINGÚN EVENTO AL OUTBOX. El registro de handlers está vacío
// (nadie lo consume todavía), así que un evento emitido acá iría derecho a
// DEAD_LETTER en el próximo tick del worker — sería ruido, no una
// automatización. Es el paso 5.
// ---------------------------------------------------------------------------

export interface ListBookingsParams {
  page: number;
  pageSize: number;
  sortBy: BookingSortBy;
  sortOrder: SortOrder;
  filters: BookingFilters;
}

export async function listBookings(organizationId: string, params: ListBookingsParams) {
  const skip = (params.page - 1) * params.pageSize;

  const [data, total] = await Promise.all([
    findManyBookings(
      organizationId,
      params.filters,
      { skip, take: params.pageSize },
      { sortBy: params.sortBy, sortOrder: params.sortOrder },
    ),
    countBookings(organizationId, params.filters),
  ]);

  return {
    data,
    pagination: {
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / params.pageSize),
    },
  };
}

export async function getBookingById(organizationId: string, id: string) {
  const booking = await findBookingById(id, organizationId);
  if (!booking) {
    throw new AppError("Reserva no encontrada", 404);
  }
  return booking;
}

export interface CreateBookingInput {
  resourceId: string;
  serviceTypeId: string;
  contactId: string;
  opportunityId?: string;
  startsAt: Date;
}

// ---------------------------------------------------------------------------
// POST /api/bookings
//
// LA ESTRUCTURA DE ESTA FUNCIÓN ES LA DECISIÓN, más que cualquier línea suelta:
//
//   FASE 1 — validaciones sin lock (400 barato).
//   FASE 2 — TRANSACCIÓN CORTA: lock + revalidación de capacidad + INSERT.
//   FASE 3 — YA COMMITEADO: llamada a Google + segunda escritura.
//
// POR QUÉ GOOGLE VA AFUERA DE LA TRANSACCIÓN, que es lo que hay que entender de
// acá: la validación de capacidad necesita el lock del recurso para cerrar la
// carrera de dos reservas simultáneas por el mismo cupo. Pero sostener ese lock
// durante una llamada HTTP a un tercero —con hasta 10 segundos de timeout—
// SERIALIZARÍA TODAS LAS RESERVAS DE ESE RECURSO CONTRA LA LATENCIA DE GOOGLE:
// dos personas reservando a la vez con un Google lento esperarían una atrás de
// la otra, y un Google colgado bloquearía el recurso entero hasta el timeout.
//
// Es además exactamente el problema que OUTBOX_HANDLER_TIMEOUT_MS documenta en
// config/env.ts para el worker de eventos salientes: una llamada externa adentro
// de una transacción sostiene el lock y una conexión del pool hasta que algo
// afuera decida abortar.
//
// LO QUE SE ACEPTA A CAMBIO, escrito para que no sorprenda: entre el COMMIT y la
// respuesta de Google hay una ventana en la que la reserva existe acá y todavía
// no en Google. Si el proceso muere justo ahí, queda un Booking con
// googleEventId en NULL — que es EXACTAMENTE el mismo estado que produce una
// sucursal sin Google conectado, o sea un estado ya soportado y no una anomalía
// nueva. La alternativa (Google adentro) cambia esa ventana por un problema de
// concurrencia peor.
// ---------------------------------------------------------------------------
export async function createBooking(
  organizationId: string,
  input: CreateBookingInput,
  cliente?: ClienteGoogleCalendar,
) {
  // -------------------------------------------------------------------------
  // FASE 1 — validaciones
  // -------------------------------------------------------------------------

  const contact = await findContactById(input.contactId, organizationId);
  if (!contact) {
    throw new AppError("El contacto indicado no existe o no pertenece a tu organización", 400);
  }

  if (input.opportunityId) {
    const opportunity = await findOpportunityById(input.opportunityId, organizationId);
    if (!opportunity) {
      throw new AppError("La oportunidad indicada no existe o no pertenece a tu organización", 400);
    }
  }

  // El fin sale de la duración del servicio, NO del cliente. Dejar que quien
  // llama mande endsAt permitiría reservar dos horas de un servicio de treinta
  // minutos y romper la grilla de disponibilidad para todos los demás.
  const startsAt = input.startsAt;

  // resolverContexto es LA MISMA función que usa GET /api/availability: valida
  // que el servicio lo provea ese recurso, resuelve la zona de la sucursal y
  // expande el horario de trabajo. Compartirla es lo que garantiza que lo que se
  // ofrece y lo que se acepta no puedan divergir.
  const { serviceType, resource, branch, franjasDeTrabajo } = await resolverContexto(
    organizationId,
    {
      resourceId: input.resourceId,
      serviceTypeId: input.serviceTypeId,
      desde: startsAt,
      // Se expande un margen de un día para adelante y no solo el turno: el FIN
      // de una franja se recorta a `hasta` (el inicio no, desde A-5), así que
      // pedir exactamente [inicio, fin) devolvería la franja recortada al fin
      // del turno y `estaContenido` daría true aunque el turno excediera el
      // cierre — la validación no probaría nada de ese lado. Con el margen, la
      // franja llega entera y la contención es real.
      hasta: new Date(startsAt.getTime() + 24 * 60 * 60 * 1000),
    },
  );

  const endsAt = new Date(startsAt.getTime() + serviceType.durationMin * 60 * 1000);

  // LA VALIDACIÓN DE HORARIO, con la misma función que la disponibilidad.
  if (!estaDentroDelHorario({ inicio: startsAt, fin: endsAt }, franjasDeTrabajo)) {
    throw new AppError("El horario solicitado está fuera del horario de trabajo del recurso", 400);
  }

  // -------------------------------------------------------------------------
  // FASE 2 — transacción CORTA. Nada de red acá adentro.
  // -------------------------------------------------------------------------

  const booking = await prisma.$transaction(async (tx) => {
    // ORDEN FIJO: resource y DESPUÉS serviceType. Es el mismo orden que usa
    // createServiceType para branch->resource, y ningún camino del módulo toma
    // serviceType antes que resource, así que no hay forma de que dos
    // transacciones los tomen invertidos y se abracen.
    //
    // El de resource cierra la carrera de capacidad (es la unidad sobre la que
    // se cuenta); el de serviceType cierra el RESTRICT de deleteServiceType, que
    // decide sobre un conteo de reservas activas.
    await lockResourceForUpdate(input.resourceId, organizationId, tx);
    await lockServiceTypeForUpdate(input.serviceTypeId, organizationId, tx);

    // A-4 (auditoría 2026-08-29), la otra mitad — y M-1 de la misma auditoría:
    // RELEER EL RECURSO Y EL SERVICIO CON LOS LOCKS SOSTENIDOS. Los de arriba
    // salieron de resolverContexto, fuera de la transacción, y entre esa lectura
    // y este punto pudo commitear un deleteServiceType, un deleteResource o un
    // updateServiceType que movió el servicio a OTRO recurso. Ese último es el
    // que importa para A-4: updateServiceType toma este mismo lock y cuenta
    // reservas antes de mover; si esta transacción estaba esperando el lock,
    // su conteo dio cero y el movimiento commiteó — y sin esta relectura, la
    // reserva se insertaba igual sobre el recurso viejo, que es exactamente el
    // huérfano que A-4 describe. El lock serializa; la relectura es lo que
    // hace que serializar sirva de algo. Mismo patrón que createServiceType y
    // replaceWorkingHoursForResource.
    const resourceActual = await findResourceById(input.resourceId, organizationId, tx);
    if (!resourceActual) {
      throw new AppError("El recurso indicado no existe o no pertenece a tu organización", 400);
    }
    const serviceTypeActual = await findServiceTypeById(input.serviceTypeId, organizationId, tx);
    if (!serviceTypeActual) {
      throw new AppError("El servicio indicado no existe o no pertenece a tu organización", 400);
    }
    if (serviceTypeActual.resourceId !== resourceActual.id) {
      throw new AppError("El servicio indicado no lo provee ese recurso", 400);
    }

    // LA REVALIDACIÓN DE CAPACIDAD CON EL LOCK SOSTENIDO. Sin esto el control
    // sería evitable con solo llegar primero: dos requests concurrentes leerían
    // los dos "queda lugar" antes de que ninguno inserte. Es la lección de
    // ALTO-8 y de H-1. La capacidad sale de la relectura, no del pre-check.
    const tomados = await countOverlappingBookings(
      organizationId,
      input.resourceId,
      startsAt,
      endsAt,
      tx,
    );

    if (tomados >= serviceTypeActual.capacity) {
      throw new AppError(
        serviceTypeActual.capacity === 1
          ? "Ese horario ya está reservado"
          : `Ese horario ya no tiene lugares disponibles (capacidad ${serviceTypeActual.capacity})`,
        409,
      );
    }

    return createBookingRepo(
      {
        organizationId,
        branchId: resource.branchId,
        serviceTypeId: input.serviceTypeId,
        resourceId: input.resourceId,
        contactId: input.contactId,
        opportunityId: input.opportunityId,
        startsAt,
        endsAt,
      },
      tx,
    );
  });

  // -------------------------------------------------------------------------
  // FASE 3 — ya commiteado. La reserva EXISTE y vale, pase lo que pase acá.
  // -------------------------------------------------------------------------

  const googleEventId = await reflejarReservaEnGoogle(
    organizationId,
    resource.branchId,
    {
      titulo: `${serviceType.name} — ${contact.firstName} ${contact.lastName}`,
      descripcion: `Reserva creada desde el CRM.\nRecurso: ${resource.name}\nSucursal: ${branch.name}`,
      inicio: startsAt,
      fin: endsAt,
    },
    cliente,
  );

  if (!googleEventId) {
    // No es un error: la sucursal puede no tener Google conectado. La reserva ya
    // está guardada y es la fuente de verdad.
    return booking;
  }

  await setGoogleEventId(booking.id, organizationId, googleEventId);

  return { ...booking, googleEventId };
}

// ---------------------------------------------------------------------------
// PATCH /api/bookings/:id/cancel
//
// Mismo criterio de "no bloquear por un fallo externo" que la desconexión de
// googleCalendarConnection.service.ts: primero se cancela acá, después se
// intenta en Google. Si Google falla, la reserva queda cancelada igual — el
// cupo tiene que liberarse sí o sí, porque de lo contrario un Google caído
// dejaría horarios bloqueados que nadie puede recuperar.
// ---------------------------------------------------------------------------
export async function cancelBooking(
  organizationId: string,
  id: string,
  cliente?: ClienteGoogleCalendar,
) {
  const booking = await getBookingById(organizationId, id);

  if (booking.status !== "CONFIRMED") {
    // 409 y no un no-op silencioso, mismo criterio que revocar dos veces una
    // ApiKey o desconectar dos veces Google: quien llama pidió un cambio de
    // estado que no ocurrió.
    throw new AppError(
      booking.status === "CANCELLED"
        ? "Esta reserva ya estaba cancelada"
        : `No se puede cancelar una reserva en estado ${booking.status}`,
      409,
    );
  }

  // El WHERE del update incluye status: 'CONFIRMED', así que dos cancelaciones
  // concurrentes no se pisan: la segunda actualiza 0 filas. Es el mismo recurso
  // que hace innecesario un lock acá — a diferencia de la creación, cancelar no
  // decide sobre un conteo, solo transiciona una fila.
  const result = await markBookingCancelled(id, organizationId);

  if (result.count === 0) {
    throw new AppError("Esta reserva ya estaba cancelada", 409);
  }

  if (booking.googleEventId) {
    await borrarReservaDeGoogle(organizationId, booking.branchId, booking.googleEventId, cliente);
  } else {
    logger.debug(
      { bookingId: id, organizationId },
      "La reserva cancelada no tenía evento en Google; no hay nada que borrar",
    );
  }

  return getBookingById(organizationId, id);
}
