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
import {
  borrarBloqueoDeProfesional,
  configurarSobreturnos,
  crearBloqueoDeProfesional,
  listarBloqueos,
} from "../services/bloqueos.service";

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
    // R6: "true" suma los horarios completos que se pueden tomar como
    // sobreturno (solo el panel; el agente nunca lo pide).
    sobreturnos: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
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
    // R6 (§4.4): sobreturno, con el profesional elegido.
    isOverbooking: z.boolean().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// R6: bloqueos y sobreturnos de un profesional (§4.4, §4.5).
// ---------------------------------------------------------------------------

const resourceIdSchema = z.string().uuid("resourceId inválido");
const bloqueoIdSchema = z.string().uuid("id inválido");

const rangoQuerySchema = z
  .object({ from: instanteSchema, to: instanteSchema })
  .refine((query) => query.from.getTime() < query.to.getTime(), {
    message: "`from` tiene que ser anterior a `to`",
  });

const bloqueoBodySchema = z
  .object({
    startsAt: instanteSchema,
    endsAt: instanteSchema,
    reason: z.string().trim().max(200, "El motivo no puede superar los 200 caracteres").nullish(),
  })
  .strict();

const sobreturnosBodySchema = z
  .object({
    allowsOverbooking: z.boolean(),
    maxOverbookingsPerDay: z.number().int().min(1, "El tope es de al menos 1").max(50),
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
    const turnos = await disponibilidadDeLaPrestacion(
      req.auth.organizationId,
      {
        serviceTypeId: query.serviceTypeId,
        ...(query.resourceId ? { resourceId: query.resourceId } : {}),
        desde: query.from,
        hasta: query.to,
        ...(query.sobreturnos ? { conSobreturnos: true } : {}),
      },
      undefined,
      req.auth,
    );
    res.status(200).json({
      availability: turnos.map((t) => ({
        startsAt: t.inicio.toISOString(),
        endsAt: t.fin.toISOString(),
        availableSeats: t.lugaresDisponibles,
        resource: t.profesional,
        ...(t.sobreturno ? { overbooking: true } : {}),
      })),
    });
  },
);

export const crearTurnoDeClinicaHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(turnoBodySchema, req.body);
    const booking = await crearTurnoDeClinica(req.auth.organizationId, input, undefined, req.auth);
    res.status(201).json(booking);
  },
);

export const listarBloqueosHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const resourceId = parseOrThrow(resourceIdSchema, req.params.resourceId);
    const { from, to } = parseOrThrow(rangoQuerySchema, req.query);
    const bloqueos = await listarBloqueos(
      req.auth.organizationId,
      resourceId,
      { desde: from, hasta: to },
      req.auth,
    );
    res.status(200).json({ bloqueos });
  },
);

export const crearBloqueoHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const resourceId = parseOrThrow(resourceIdSchema, req.params.resourceId);
    const input = parseOrThrow(bloqueoBodySchema, req.body);
    const resultado = await crearBloqueoDeProfesional(
      req.auth.organizationId,
      resourceId,
      input,
      req.auth,
    );
    res.status(201).json(resultado);
  },
);

export const borrarBloqueoHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(bloqueoIdSchema, req.params.id);
    await borrarBloqueoDeProfesional(req.auth.organizationId, id, req.auth);
    res.status(204).send();
  },
);

export const configurarSobreturnosHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const resourceId = parseOrThrow(resourceIdSchema, req.params.resourceId);
    const input = parseOrThrow(sobreturnosBodySchema, req.body);
    res.status(200).json(await configurarSobreturnos(req.auth.organizationId, resourceId, input));
  },
);
