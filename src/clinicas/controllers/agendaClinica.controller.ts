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
import {
  contarTurnosFuturosDelProfesional,
  reprogramarTurno,
} from "../services/reprogramar.service";
import {
  LARGO_MAXIMO_DE_NOTA,
  marcarTurno,
  type EstadoDeCierre,
} from "../services/atendido.service";
import { findResourceById } from "../../repositories/resource.repository";
import { exigirSedeDelActor } from "../../services/permisos";
import { AppError } from "../../utils/AppError";
import { MAX_DIAS_DE_CONTROL } from "../postTurno/config";
import { configurarControlDeLaPrestacion } from "../postTurno/control.service";
import {
  MAX_HORAS_PARA_CAMBIAR_UN_TURNO,
  configuracionDeClinicaDeLaSede,
  configurarClinicaDeLaSede,
} from "../services/configuracionDeSede.service";
import {
  asignarCalendarioAlProfesional,
  listarCalendariosDeLaSede,
} from "../services/googlePorProfesional.service";

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

// ---------------------------------------------------------------------------
// R8: el calendario de Google de cada profesional (docs/rubros.md §4.6).
// ---------------------------------------------------------------------------

const branchIdSchema = z.string().uuid("branchId inválido");

const calendarioBodySchema = z
  .object({
    calendarId: z
      .string()
      .trim()
      .min(1)
      .max(255, "El ID no puede superar los 255 caracteres")
      .nullable(),
  })
  .strict();

export const listarCalendariosHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const branchId = parseOrThrow(branchIdSchema, req.params.branchId);
    const calendarios = await listarCalendariosDeLaSede(req.auth.organizationId, branchId);
    res.status(200).json({ calendarios });
  },
);

export const asignarCalendarioHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const resourceId = parseOrThrow(resourceIdSchema, req.params.resourceId);
    const { calendarId } = parseOrThrow(calendarioBodySchema, req.body);
    res
      .status(200)
      .json(await asignarCalendarioAlProfesional(req.auth.organizationId, resourceId, calendarId));
  },
);

// ---------------------------------------------------------------------------
// R9: reprogramar (docs/rubros.md §4.7) y los turnos futuros de un profesional.
// ---------------------------------------------------------------------------

const reprogramarBodySchema = z
  .object({
    startsAt: instanteSchema,
    resourceId: z.string().uuid("resourceId inválido").optional(),
    isOverbooking: z.boolean().optional(),
    force: z.boolean().optional(),
  })
  .strict();

export const reprogramarTurnoHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(z.string().uuid("id inválido"), req.params.id);
    const input = parseOrThrow(reprogramarBodySchema, req.body);
    const booking = await reprogramarTurno(req.auth.organizationId, id, input, {
      ...req.auth,
      descripcion: req.auth.fullName,
    });
    res.status(200).json(booking);
  },
);

export const turnosFuturosHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const resourceId = parseOrThrow(resourceIdSchema, req.params.resourceId);
    const recurso = await findResourceById(resourceId, req.auth.organizationId);
    if (!recurso) throw new AppError("Profesional no encontrado", 404);
    exigirSedeDelActor(req.auth, recurso.branchId, "Profesional no encontrado");
    res.status(200).json({
      cantidad: await contarTurnosFuturosDelProfesional(req.auth.organizationId, resourceId),
    });
  },
);

// ---------------------------------------------------------------------------
// R10: atendido / no vino (docs/rubros.md §4.8). Nota opcional y corta; la
// pantalla avisa que no se carguen datos de salud.
// ---------------------------------------------------------------------------

const marcaBodySchema = z
  .object({
    nota: z
      .string()
      .trim()
      .max(LARGO_MAXIMO_DE_NOTA, `La nota no puede superar los ${LARGO_MAXIMO_DE_NOTA} caracteres`)
      .nullish(),
  })
  .strict();

function marcarHandler(estado: EstadoDeCierre) {
  return asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    const id = parseOrThrow(z.string().uuid("id inválido"), req.params.id);
    const { nota } = parseOrThrow(marcaBodySchema, req.body ?? {});
    const booking = await marcarTurno(
      req.auth.organizationId,
      id,
      estado,
      { ...req.auth, descripcion: req.auth.fullName },
      nota,
    );
    res.status(200).json(booking);
  });
}

export const marcarAtendidoHandler = marcarHandler("COMPLETED");
export const marcarNoVinoHandler = marcarHandler("NO_SHOW");

// ---------------------------------------------------------------------------
// R11: la configuración de clínica de una sede (docs/rubros.md §5.1, D10).
// ---------------------------------------------------------------------------

const configuracionDeSedeBodySchema = z
  .object({
    // Entero ≥ 0, o null para "sin plazo" (D10: sin valor por defecto).
    minHoursToChangeBooking: z
      .number({ invalid_type_error: "minHoursToChangeBooking debe ser un número" })
      .int("minHoursToChangeBooking debe ser un número entero")
      .min(0, "minHoursToChangeBooking no puede ser negativo")
      .max(
        MAX_HORAS_PARA_CAMBIAR_UN_TURNO,
        `minHoursToChangeBooking no puede superar ${MAX_HORAS_PARA_CAMBIAR_UN_TURNO}`,
      )
      .nullable()
      .optional(),
    // R13 (docs/rubros.md §6.2): el recordatorio. Los mismos rangos que los
    // CHECK de clinic_branch_settings.
    reminderHoursBefore: z
      .number({ invalid_type_error: "reminderHoursBefore debe ser un número" })
      .int("reminderHoursBefore debe ser un número entero")
      .min(1, "reminderHoursBefore tiene que ser al menos 1")
      .max(72, "reminderHoursBefore no puede superar 72")
      .optional(),
    lateBookingReminder: z
      .enum(["NO_ENVIAR", "EN_EL_MOMENTO", "HORAS_ANTES"], {
        errorMap: () => ({
          message: "lateBookingReminder debe ser NO_ENVIAR, EN_EL_MOMENTO o HORAS_ANTES",
        }),
      })
      .optional(),
    lateBookingHoursBefore: z
      .number({ invalid_type_error: "lateBookingHoursBefore debe ser un número" })
      .int("lateBookingHoursBefore debe ser un número entero")
      .min(1, "lateBookingHoursBefore tiene que ser al menos 1")
      .max(23, "lateBookingHoursBefore no puede superar 23")
      .optional(),
  })
  .strict()
  .refine((c) => Object.keys(c).length > 0, { message: "No hay nada para guardar" });

export const configuracionDeSedeHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const branchId = parseOrThrow(z.string().uuid("branchId inválido"), req.params.branchId);
    res.status(200).json(await configuracionDeClinicaDeLaSede(req.auth.organizationId, branchId));
  },
);

export const configurarSedeHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const branchId = parseOrThrow(z.string().uuid("branchId inválido"), req.params.branchId);
    const input = parseOrThrow(configuracionDeSedeBodySchema, req.body);
    res.status(200).json(await configurarClinicaDeLaSede(req.auth.organizationId, branchId, input));
  },
);

// ---------------------------------------------------------------------------
// R14: el control de una prestación (docs/rubros.md §7.2). Configuración: solo
// ADMIN. Del módulo post_turno: una automotora recibe 403 con motivo RUBRO.
// ---------------------------------------------------------------------------

const controlBodySchema = z
  .object({
    followUpAfterDays: z
      .number({ invalid_type_error: "followUpAfterDays debe ser un número" })
      .int("followUpAfterDays debe ser un número entero")
      .min(1, "followUpAfterDays tiene que ser al menos 1")
      .max(MAX_DIAS_DE_CONTROL, `followUpAfterDays no puede superar ${MAX_DIAS_DE_CONTROL}`)
      .nullable(),
  })
  .strict();

export const configurarControlHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idSchema, req.params.serviceTypeId);
    const { followUpAfterDays } = parseOrThrow(controlBodySchema, req.body);
    res
      .status(200)
      .json(await configurarControlDeLaPrestacion(req.auth.organizationId, id, followUpAfterDays));
  },
);
