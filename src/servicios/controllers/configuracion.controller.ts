import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../types/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { currencySchema, parseOrThrow } from "../../utils/validation";
import { leerConfiguracionDelTaller } from "../repositories/workshopSettings.repository";
import {
  actualizarTipo,
  borrarTipo,
  crearTipo,
  guardarConfiguracion,
  listarTipos,
} from "../services/configuracion.service";

// La configuración del taller (docs/servicios.md §1.6, §4.8). Llega acá solo
// si la organización tiene el módulo activado: lo decide el gate dentro de
// `authenticate` (403 MODULO_NO_INCLUIDO con motivo NO_ACTIVADO si no). Leer
// es de cualquiera; escribir, solo ADMIN (authorize en la ruta). Sin fila de
// configuración, los defaults.

const idParamSchema = z.string().guid("id inválido");

// Meses: el CHECK de la base va de 1 a 60; null = no proponer / no fijar.
const mesesSchema = z.number().int("los meses tienen que ser un entero").min(1).max(60).nullable();

export const configuracionSchema = z
  .object({
    defaultNextServiceMonths: mesesSchema,
    firstServiceAfterMonths: mesesSchema,
    // #12: la moneda del taller (CHECK de 3 letras en la base).
    currency: currencySchema,
  })
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

const nombreSchema = z
  .string()
  .trim()
  .min(1, "name es requerido")
  .max(120, "name no puede superar los 120 caracteres");

export const crearTipoSchema = z
  .object({
    name: nombreSchema,
    nextServiceAfterMonths: mesesSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const actualizarTipoSchema = z
  .object({ name: nombreSchema, nextServiceAfterMonths: mesesSchema, isActive: z.boolean() })
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

const tiposQuerySchema = z.object({
  soloActivos: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

export const leerConfiguracionHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    res.status(200).json(await leerConfiguracionDelTaller(req.auth.organizationId));
  },
);

export const guardarConfiguracionHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(configuracionSchema, req.body);
    res.status(200).json(await guardarConfiguracion(req.auth.organizationId, input));
  },
);

export const listarTiposHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const { soloActivos } = parseOrThrow(tiposQuerySchema, req.query);
  res.status(200).json(await listarTipos(req.auth.organizationId, soloActivos ?? false));
});

export const crearTipoHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const input = parseOrThrow(crearTipoSchema, req.body);
  res.status(201).json(await crearTipo(req.auth.organizationId, input));
});

export const actualizarTipoHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const input = parseOrThrow(actualizarTipoSchema, req.body);
    res.status(200).json(await actualizarTipo(req.auth.organizationId, id, input));
  },
);

export const borrarTipoHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  await borrarTipo(req.auth.organizationId, id);
  res.status(204).send();
});
