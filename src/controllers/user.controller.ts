import type { Response } from "express";
import { z } from "zod";
import { deleteUser, listUsers, updateUser } from "../services/user.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

const idParamSchema = z.string().uuid("id inválido");

const roleSchema = z.enum(["ADMIN", "USER"]);

// z.coerce.boolean() coacciona cualquier string no vacío (incluido "false")
// a true — no sirve para un query param booleano. Se acepta explícitamente
// "true"/"false" y se traduce a boolean acá.
const booleanQueryParam = z.enum(["true", "false"]).transform((v) => v === "true");

const listQuerySchema = z.object({
  // Tope de cordura, el mismo que ingestionEvent (S2-5) — B-21.
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  role: roleSchema.optional(),
  isActive: booleanQueryParam.optional(),
  sortBy: z.enum(["fullName", "createdAt"]).default("fullName"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

// No es un editor genérico: únicamente isActive y role. email/id/
// organizationId/deletedAt no son campos de este schema — no hay forma de
// enviarlos, ni por error.
const updateUserSchema = z
  .object({
    isActive: z.boolean(),
    role: roleSchema,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

export const listUsersHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const query = parseOrThrow(listQuerySchema, req.query);
  const result = await listUsers(req.auth.organizationId, query);
  res.status(200).json(result);
});

export const updateUserHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  const input = parseOrThrow(updateUserSchema, req.body);
  const user = await updateUser(req.auth.organizationId, req.auth.userId, id, input);
  res.status(200).json(user);
});

export const deleteUserHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  await deleteUser(req.auth.organizationId, req.auth.userId, id);
  res.status(204).send();
});
