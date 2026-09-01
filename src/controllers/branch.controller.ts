import type { Response } from "express";
import { z } from "zod";
import {
  createBranch,
  deleteBranch,
  getBranchById,
  listBranches,
  updateBranch,
} from "../services/branch.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { esZonaHorariaValida } from "../utils/timezone";
import { parseOrThrow } from "../utils/validation";

const idParamSchema = z.string().uuid("id inválido");

// La zona horaria se valida contra el runtime, no contra una lista propia — ver
// src/utils/timezone.ts. Una zona mal tipeada no falla al guardarse: falla
// después, con un turno a la hora equivocada como único síntoma.
const timezoneSchema = z
  .string()
  .trim()
  .min(1, "timezone es requerido")
  .max(50, "timezone no puede superar los 50 caracteres")
  .refine(esZonaHorariaValida, {
    message: "timezone debe ser una zona horaria IANA válida (ej. America/Argentina/Buenos_Aires)",
  });

const branchFields = {
  name: z
    .string()
    .trim()
    .min(1, "name es requerido")
    .max(255, "name no puede superar los 255 caracteres"),
  timezone: timezoneSchema,
};

// timezone es REQUERIDA al crear, aunque la columna tenga default 'UTC'. El
// default existe para que el esquema describa el dato igual que
// organizations.timezone; la forma esperada de usar el API es elegirla
// explícitamente, porque una sucursal silenciosamente en UTC produce turnos a la
// hora equivocada y nadie lo nota hasta que un cliente no aparece.
const createBranchSchema = z.object(branchFields);

const updateBranchSchema = z
  .object(branchFields)
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

const listQuerySchema = z.object({
  // Tope de cordura, el mismo que ingestionEvent (S2-5) — B-21.
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).optional(),
  sortBy: z.enum(["name", "createdAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const createBranchHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(createBranchSchema, req.body);
    const branch = await createBranch(req.auth.organizationId, input);
    res.status(201).json(branch);
  },
);

export const listBranchesHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(listQuerySchema, req.query);
    const result = await listBranches(req.auth.organizationId, query);
    res.status(200).json(result);
  },
);

export const getBranchHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  const branch = await getBranchById(req.auth.organizationId, id);
  res.status(200).json(branch);
});

export const updateBranchHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const input = parseOrThrow(updateBranchSchema, req.body);
    const branch = await updateBranch(req.auth.organizationId, id, input);
    res.status(200).json(branch);
  },
);

export const deleteBranchHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    await deleteBranch(req.auth.organizationId, id);
    res.status(204).send();
  },
);
