import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../types/auth";
import { AppError } from "../../utils/AppError";
import { asyncHandler } from "../../utils/asyncHandler";
import { parseOrThrow } from "../../utils/validation";
import {
  actualizarVehiculo,
  borrarVehiculo,
  cambiarDueno,
  crearVehiculo,
  listarVehiculos,
  obtenerVehiculo,
  ordenesDelVehiculo,
} from "../services/vehiculos.service";

// ---------------------------------------------------------------------------
// Frontera de validación de los vehículos de clientes (docs/servicios.md §2.2,
// S3). Molde: vehicle.controller.ts. Zod repite los límites de la base (largos
// de VarChar, año, km >= 0) para que un body inválido sea un 400 con mensaje y
// no un 500 de Postgres. Textos nullable: trim, y vacío -> null.
//
// Todas las rutas pasan por el gate del módulo dentro de `authenticate`: sin el
// módulo activado no se llega acá (403 MODULO_NO_INCLUIDO, NO_ACTIVADO).
// ---------------------------------------------------------------------------

const idParamSchema = z.string().uuid("id inválido");

const textoOpcional = (max: number, campo: string) =>
  z
    .string()
    .trim()
    .max(max, `${campo} no puede superar los ${max} caracteres`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const fechaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "fecha inválida: AAAA-MM-DD")
  // Ida y vuelta: "2024-02-30" no es una fecha (V8 la correría al 1 de marzo).
  .refine((v) => {
    const t = Date.parse(`${v}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
  }, "fecha inválida");

// El año: el CHECK de la base va de 1900 a 2100; acá además no más que el año
// que viene (un 0 km del modelo siguiente).
const anioSchema = z
  .number()
  .int("year tiene que ser un entero")
  .min(1900, "year no puede ser anterior a 1900")
  .refine(
    (v) => v <= new Date().getUTCFullYear() + 1,
    "year no puede ser posterior al año que viene",
  );

const camposEditables = {
  branchId: z.string().uuid("branchId inválido").nullable().optional(),
  make: z
    .string()
    .trim()
    .min(1, "make es requerido")
    .max(60, "make no puede superar los 60 caracteres"),
  model: z
    .string()
    .trim()
    .min(1, "model es requerido")
    .max(80, "model no puede superar los 80 caracteres"),
  year: anioSchema.nullable().optional(),
  licensePlate: textoOpcional(20, "licensePlate"),
  vin: textoOpcional(30, "vin"),
  mileage: z
    .number()
    .int("mileage tiene que ser un entero")
    .min(0)
    .max(9_999_999)
    .nullable()
    .optional(),
  purchasedOn: fechaSchema.nullable().optional(),
  nextServiceDueOn: fechaSchema.nullable().optional(),
  remindersOptOut: z.boolean().optional(),
  notes: textoOpcional(2000, "notes"),
};

export const crearVehiculoSchema = z.object({
  contactId: z.string().uuid("contactId inválido"),
  ...camposEditables,
});

export const actualizarVehiculoSchema = z
  .object(camposEditables)
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

const nota = textoOpcional(1000, "nota");

export const cambiarDuenoSchema = z.union([
  z.object({ toContactId: z.string().uuid("toContactId inválido"), nota }).strict(),
  // PERMUTA no: la escribe el barrido de permutas (S10), nunca una persona.
  z.object({ fin: z.enum(["VENDIDO_A_TERCERO", "OTRO"]), nota }).strict(),
]);

const booleanoDeQuery = z
  .enum(["true", "false"])
  .transform((v) => v === "true")
  .optional();

export const listarVehiculosQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  q: z.string().trim().min(1).max(100).optional(),
  contactId: z.string().uuid("contactId inválido").optional(),
  branchId: z.string().uuid("branchId inválido").optional(),
  incluirNoVigentes: booleanoDeQuery,
  // S13: los que no tienen fecha de compra.
  sinFechaDeCompra: booleanoDeQuery,
});

// El dueño no se edita (§2.2): tiene su propia acción, que deja el registro.
export const MENSAJE_DUENO_NO_EDITABLE =
  "El dueño no se edita: se cambia con la acción Cambiar dueño.";

export const listarVehiculosHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(listarVehiculosQuerySchema, req.query);
    res.status(200).json(await listarVehiculos(req.auth.organizationId, req.auth, query));
  },
);

export const obtenerVehiculoHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    res.status(200).json(await obtenerVehiculo(req.auth.organizationId, id));
  },
);

export const crearVehiculoHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(crearVehiculoSchema, req.body);
    res.status(201).json(await crearVehiculo(req.auth.organizationId, input));
  },
);

export const actualizarVehiculoHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    if (req.body && typeof req.body === "object" && "contactId" in req.body) {
      throw new AppError(MENSAJE_DUENO_NO_EDITABLE, 400);
    }
    const input = parseOrThrow(actualizarVehiculoSchema, req.body);
    res.status(200).json(await actualizarVehiculo(req.auth.organizationId, id, input));
  },
);

export const borrarVehiculoHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    await borrarVehiculo(req.auth.organizationId, id);
    res.status(204).send();
  },
);

export const cambiarDuenoHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const input = parseOrThrow(cambiarDuenoSchema, req.body);
    res.status(200).json(await cambiarDueno(req.auth.organizationId, req.auth.userId, id, input));
  },
);

export const ordenesDelVehiculoHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    res.status(200).json(await ordenesDelVehiculo(req.auth.organizationId, id));
  },
);
