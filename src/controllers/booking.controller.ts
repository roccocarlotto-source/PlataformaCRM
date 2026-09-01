import { BookingStatus } from "@prisma/client";
import type { Response } from "express";
import { z } from "zod";
import { obtenerDisponibilidad, MAX_DIAS_DE_RANGO } from "../services/availability.service";
import {
  cancelBooking,
  createBooking,
  getBookingById,
  listBookings,
} from "../services/booking.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

const idParamSchema = z.string().uuid("id inválido");

// z.coerce.date() sobre un ISO-8601. Se exige la zona (offset o Z) revisando la
// cadena ANTES de coaccionar: `new Date("2026-09-07T09:00")` la interpreta en la
// zona del SERVIDOR, que es exactamente lo que todo este módulo evita — una
// reserva pedida sin zona quedaría a una hora distinta según dónde corra el
// proceso.
const FORMA_ISO_CON_ZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const instanteSchema = z
  .string()
  .regex(
    FORMA_ISO_CON_ZONA,
    'Tiene que ser una fecha-hora ISO 8601 CON zona, por ejemplo "2026-09-07T09:00:00-03:00" o "2026-09-07T12:00:00Z"',
  )
  .transform((valor) => new Date(valor))
  .refine((fecha) => !Number.isNaN(fecha.getTime()), { message: "Fecha-hora inválida" });

// ---------------------------------------------------------------------------
// GET /api/availability
// ---------------------------------------------------------------------------

const disponibilidadQuerySchema = z
  .object({
    resourceId: z.string().uuid("resourceId inválido"),
    serviceTypeId: z.string().uuid("serviceTypeId inválido"),
    from: instanteSchema,
    to: instanteSchema,
  })
  .refine((query) => query.from.getTime() < query.to.getTime(), {
    message: "`from` tiene que ser anterior a `to`",
  })
  .refine(
    (query) => query.to.getTime() - query.from.getTime() <= MAX_DIAS_DE_RANGO * 24 * 60 * 60 * 1000,
    { message: `El rango no puede superar los ${MAX_DIAS_DE_RANGO} días` },
  );

export const getAvailabilityHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(disponibilidadQuerySchema, req.query);

    const turnos = await obtenerDisponibilidad(req.auth.organizationId, {
      resourceId: query.resourceId,
      serviceTypeId: query.serviceTypeId,
      desde: query.from,
      hasta: query.to,
    });

    res.status(200).json({
      availability: turnos.map((turno) => ({
        startsAt: turno.inicio.toISOString(),
        endsAt: turno.fin.toISOString(),
        availableSeats: turno.lugaresDisponibles,
      })),
    });
  },
);

// ---------------------------------------------------------------------------
// POST /api/bookings
// ---------------------------------------------------------------------------

// SIN endsAt: sale de ServiceType.durationMin. Dejar que quien llama lo mande
// permitiría reservar dos horas de un servicio de treinta minutos y romper la
// grilla para todos los demás. Que no esté en el schema es lo que convierte esa
// decisión en un 400 y no en un campo ignorado en silencio.
const createBookingSchema = z.object({
  resourceId: z.string().uuid("resourceId inválido"),
  serviceTypeId: z.string().uuid("serviceTypeId inválido"),
  contactId: z.string().uuid("contactId inválido"),
  opportunityId: z.string().uuid("opportunityId inválido").optional(),
  startsAt: instanteSchema,
});

const listQuerySchema = z.object({
  // Tope de cordura, el mismo que ingestionEvent (S2-5) — B-21.
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  branchId: z.string().uuid("branchId inválido").optional(),
  resourceId: z.string().uuid("resourceId inválido").optional(),
  serviceTypeId: z.string().uuid("serviceTypeId inválido").optional(),
  contactId: z.string().uuid("contactId inválido").optional(),
  status: z
    .nativeEnum(BookingStatus, {
      errorMap: () => ({ message: "status debe ser CONFIRMED, CANCELLED, COMPLETED o NO_SHOW" }),
    })
    .optional(),
  from: instanteSchema.optional(),
  to: instanteSchema.optional(),
  sortBy: z.enum(["startsAt", "createdAt"]).default("startsAt"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

export const createBookingHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(createBookingSchema, req.body);
    const booking = await createBooking(req.auth.organizationId, input);
    res.status(201).json(booking);
  },
);

export const listBookingsHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(listQuerySchema, req.query);

    const result = await listBookings(req.auth.organizationId, {
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      filters: {
        branchId: query.branchId,
        resourceId: query.resourceId,
        serviceTypeId: query.serviceTypeId,
        contactId: query.contactId,
        status: query.status,
        desde: query.from,
        hasta: query.to,
      },
    });

    res.status(200).json(result);
  },
);

export const getBookingHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  const booking = await getBookingById(req.auth.organizationId, id);
  res.status(200).json(booking);
});

// PATCH /:id/cancel y no DELETE /:id: cancelar NO borra nada — la reserva queda
// como historia con status CANCELLED. Un DELETE prometería un borrado que no
// ocurre, y además el módulo no tiene ninguna operación que borre reservas.
export const cancelBookingHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const booking = await cancelBooking(req.auth.organizationId, id);
    res.status(200).json(booking);
  },
);
