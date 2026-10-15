import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../types/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { currencySchema, MAX_AMOUNT, parseOrThrow } from "../../utils/validation";
import { ESTADOS, ESTADOS_INICIALES } from "../config/estados";
import { findUsuariosActivos } from "../repositories/serviceOrder.repository";
import {
  actualizarOrden,
  cambiarEstado,
  crearOrden,
  listarOrdenes,
  listarTurnosVinculables,
  obtenerOrden,
  registrarAprobacion,
} from "../services/ordenes.service";

// ---------------------------------------------------------------------------
// Frontera de validación de las órdenes de servicio (docs/servicios.md §2.3–
// §2.5, §3; S4a). Zod repite los límites de la base (largos, km >= 0, monto
// >= 0 con dos decimales, moneda ISO) para que un body inválido sea un 400 y no
// un 500. Textos nullable: trim, y vacío -> null. ADMIN y USER operan todas las
// órdenes (D9).
// ---------------------------------------------------------------------------

const idParamSchema = z.string().uuid("id inválido");

const texto = (max: number, campo: string) =>
  z
    .string()
    .trim()
    .max(max, `${campo} no puede superar los ${max} caracteres`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const estadoSchema = z
  .enum(ESTADOS as [string, ...string[]])
  .transform((v) => v as (typeof ESTADOS)[number]);

const kmSchema = z.number().int("los km tienen que ser un entero").min(0).max(9_999_999);

const montoSchema = z
  .number()
  .min(0, "el monto no puede ser negativo")
  .max(MAX_AMOUNT)
  // Tolerancia de coma flotante: 0.29 * 100 es 28.999999999999996.
  .refine(
    (v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6,
    "el monto admite hasta dos decimales",
  );

const instanteSchema = z.coerce.date({ invalid_type_error: "fecha inválida" });

const fechaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "fecha inválida: AAAA-MM-DD")
  .refine((v) => {
    const t = Date.parse(`${v}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
  }, "fecha inválida");

const tiposSchema = z.array(z.string().uuid("tipo inválido")).max(20);

export const crearOrdenSchema = z.object({
  customerVehicleId: z.string().uuid("customerVehicleId inválido"),
  contactId: z.string().uuid("contactId inválido").optional(),
  branchId: z.string().uuid("branchId inválido").optional(),
  estado: z
    .enum(ESTADOS_INICIALES as [string, ...string[]])
    .transform((v) => v as "AGENDADO" | "RECIBIDO"),
  scheduledFor: instanteSchema.nullable().optional(),
  mileageIn: kmSchema.nullable().optional(),
  assigneeId: z.string().uuid("assigneeId inválido").nullable().optional(),
  jobTypeIds: tiposSchema.optional(),
  notes: texto(8000, "notes"),
  damageNotes: texto(4000, "damageNotes"),
  amount: montoSchema.nullable().optional(),
  currency: currencySchema.nullable().optional(),
  // El turno de la agenda (§4.4, S4b).
  bookingId: z.string().uuid("bookingId inválido").optional(),
});

export const actualizarOrdenSchema = z
  .object({
    assigneeId: z.string().uuid("assigneeId inválido").nullable(),
    scheduledFor: instanteSchema.nullable(),
    mileageIn: kmSchema.nullable(),
    damageNotes: texto(4000, "damageNotes"),
    notes: texto(8000, "notes"),
    amount: montoSchema.nullable(),
    currency: currencySchema.nullable(),
    jobTypeIds: tiposSchema,
    // Vincular (id) o desvincular (null) el turno.
    bookingId: z.string().uuid("bookingId inválido").nullable(),
  })
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

export const cambiarEstadoSchema = z
  .object({
    desde: estadoSchema,
    hacia: estadoSchema,
    nota: texto(1000, "nota"),
    mileageIn: kmSchema.optional(),
    cancelReason: z.string().trim().min(1, "el motivo no puede estar vacío").max(500).optional(),
    proximoService: fechaSchema.nullable().optional(),
  })
  .strict();

export const aprobacionSchema = z
  .object({
    description: z.string().trim().min(1, "description es requerido").max(2000),
    decision: z.enum(["APROBADO", "RECHAZADO"]),
    approverName: z.string().trim().min(1, "approverName es requerido").max(200),
    channel: z.enum(["TELEFONO", "WHATSAPP", "PRESENCIAL", "OTRO"]),
    decidedAt: instanteSchema.refine(
      (d) => d.getTime() <= Date.now() + 5 * 60_000,
      "decidedAt no puede ser futura",
    ),
    amount: montoSchema.nullable().optional(),
    currency: currencySchema.nullable().optional(),
    sumarAlValor: z.boolean().optional(),
  })
  .strict();

const listaDeEstados = z
  .string()
  .transform((v) => v.split(",").filter(Boolean))
  .pipe(z.array(estadoSchema).max(ESTADOS.length));

export const listarOrdenesQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(10_000).default(1),
  // El tablero pide todas las abiertas de una vez: tope 200.
  pageSize: z.coerce.number().int().positive().max(200).default(20),
  estados: listaDeEstados.optional(),
  branchId: z.string().uuid("branchId inválido").optional(),
  assigneeId: z.string().uuid("assigneeId inválido").optional(),
  customerVehicleId: z.string().uuid("customerVehicleId inválido").optional(),
  bookingId: z.string().uuid("bookingId inválido").optional(),
  desde: instanteSchema.optional(),
  hasta: instanteSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

export const listarOrdenesHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(listarOrdenesQuerySchema, req.query);
    res.status(200).json(await listarOrdenes(req.auth.organizationId, req.auth, query));
  },
);

export const obtenerOrdenHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    res.status(200).json(await obtenerOrden(req.auth.organizationId, id));
  },
);

export const crearOrdenHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const input = parseOrThrow(crearOrdenSchema, req.body);
  res.status(201).json(await crearOrden(req.auth.organizationId, req.auth.userId, input));
});

export const actualizarOrdenHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const input = parseOrThrow(actualizarOrdenSchema, req.body);
    res.status(200).json(await actualizarOrden(req.auth.organizationId, id, input));
  },
);

export const cambiarEstadoHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const input = parseOrThrow(cambiarEstadoSchema, req.body);
    res.status(200).json(await cambiarEstado(req.auth.organizationId, req.auth.userId, id, input));
  },
);

export const registrarAprobacionHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const input = parseOrThrow(aprobacionSchema, req.body);
    res
      .status(201)
      .json(await registrarAprobacion(req.auth.organizationId, req.auth.userId, id, input));
  },
);

// GET /api/servicios/usuarios: id y nombre de los usuarios activos, para
// elegir el encargado (D9). GET /api/users es solo ADMIN y trae mucho más.
export const listarUsuariosHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    res.status(200).json(await findUsuariosActivos(req.auth.organizationId));
  },
);

const turnosQuerySchema = z.object({
  contactId: z.string().uuid("contactId inválido"),
});

// GET /api/servicios/turnos?contactId=: los turnos que se pueden vincular a
// una orden (§4.4). Bajo /api/servicios para no tocar /api/bookings, que es de
// todas las organizaciones (§1.6).
export const listarTurnosHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const { contactId } = parseOrThrow(turnosQuerySchema, req.query);
    res
      .status(200)
      .json(await listarTurnosVinculables(req.auth.organizationId, req.auth, contactId));
  },
);
