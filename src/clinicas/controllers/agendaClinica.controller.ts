import type { Response } from "express";
import { z } from "zod";
import { instanteSchema } from "../../controllers/booking.controller";
import { MAX_DIAS_DE_RANGO } from "../../services/availability.service";
import type { AuthenticatedRequest } from "../../types/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { parseOrThrow } from "../../utils/validation";
import {
  crearTurnoDeClinica,
  definirProfesionales,
  disponibilidadDeLaPrestacion,
  listarPrestaciones,
  profesionalesDeUnaPrestacion,
} from "../services/agendaClinica.service";

// ---------------------------------------------------------------------------
// Agenda de clínica (docs/rubros.md §4.3, R5): prestaciones con sus
// profesionales, la disponibilidad de una prestación y el turno con o sin
// profesional elegido. Mismo contrato de fechas que /api/availability y
// /api/bookings (ISO 8601 con zona).
// ---------------------------------------------------------------------------

const idSchema = z.string().uuid("serviceTypeId inválido");

const listarQuerySchema = z.object({
  branchId: z.string().uuid("branchId inválido").optional(),
});

const profesionalesBodySchema = z
  .object({
    resourceIds: z.array(z.string().uuid("resourceId inválido")).max(50),
  })
  .strict();

const disponibilidadQuerySchema = z
  .object({
    serviceTypeId: z.string().uuid("serviceTypeId inválido"),
    // El profesional elegido; sin él, todos los de la prestación.
    resourceId: z.string().uuid("resourceId inválido").optional(),
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

const turnoBodySchema = z
  .object({
    serviceTypeId: z.string().uuid("serviceTypeId inválido"),
    contactId: z.string().uuid("contactId inválido"),
    startsAt: instanteSchema,
    // Sin profesional: el primero libre.
    resourceId: z.string().uuid("resourceId inválido").optional(),
    force: z.boolean().optional(),
  })
  .strict();

export const listarPrestacionesHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const { branchId } = parseOrThrow(listarQuerySchema, req.query);
    res
      .status(200)
      .json({ prestaciones: await listarPrestaciones(req.auth.organizationId, { branchId }) });
  },
);

export const profesionalesDePrestacionHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idSchema, req.params.serviceTypeId);
    res
      .status(200)
      .json({ profesionales: await profesionalesDeUnaPrestacion(req.auth.organizationId, id) });
  },
);

export const definirProfesionalesHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idSchema, req.params.serviceTypeId);
    const { resourceIds } = parseOrThrow(profesionalesBodySchema, req.body);
    res.status(200).json({
      profesionales: await definirProfesionales(req.auth.organizationId, id, resourceIds),
    });
  },
);

export const disponibilidadDeClinicaHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(disponibilidadQuerySchema, req.query);
    const turnos = await disponibilidadDeLaPrestacion(req.auth.organizationId, {
      serviceTypeId: query.serviceTypeId,
      ...(query.resourceId ? { resourceId: query.resourceId } : {}),
      desde: query.from,
      hasta: query.to,
    });
    res.status(200).json({
      availability: turnos.map((t) => ({
        startsAt: t.inicio.toISOString(),
        endsAt: t.fin.toISOString(),
        availableSeats: t.lugaresDisponibles,
        resource: t.profesional,
      })),
    });
  },
);

export const crearTurnoDeClinicaHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(turnoBodySchema, req.body);
    const booking = await crearTurnoDeClinica(req.auth.organizationId, input, undefined, {
      role: req.auth.role,
    });
    res.status(201).json(booking);
  },
);
