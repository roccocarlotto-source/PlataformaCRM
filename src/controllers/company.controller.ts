import type { Response } from "express";
import { z } from "zod";
import {
  createCompany,
  deleteCompany,
  getCompanyById,
  listCompanies,
  updateCompany,
} from "../services/company.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

const idParamSchema = z.string().uuid("id inválido");

// Campos compartidos entre create (todos requeridos salvo los opcionales
// explícitos) y update (todos opcionales vía .partial() más abajo).
const companyFields = {
  name: z
    .string()
    .trim()
    .min(1, "name es requerido")
    .max(255, "name no puede superar los 255 caracteres"),
  domain: z
    .string()
    .trim()
    .max(255, "domain no puede superar los 255 caracteres")
    .optional(),
  industry: z
    .string()
    .trim()
    .max(100, "industry no puede superar los 100 caracteres")
    .optional(),
  phone: z
    .string()
    .trim()
    .max(30, "phone no puede superar los 30 caracteres")
    .optional(),
  city: z
    .string()
    .trim()
    .max(100, "city no puede superar los 100 caracteres")
    .optional(),
  country: z
    .string()
    .trim()
    .max(100, "country no puede superar los 100 caracteres")
    .optional(),
  ownerId: z.string().uuid("ownerId inválido").optional(),
};

const createCompanySchema = z.object(companyFields);

const updateCompanySchema = z
  .object(companyFields)
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).optional(),
  industry: z.string().trim().min(1).optional(),
  ownerId: z.string().uuid("ownerId inválido").optional(),
  sortBy: z.enum(["name", "createdAt", "industry"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const createCompanyHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(createCompanySchema, req.body);
    const company = await createCompany(
      req.auth.organizationId,
      req.auth.userId,
      input,
    );
    res.status(201).json(company);
  },
);

export const listCompaniesHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(listQuerySchema, req.query);
    const result = await listCompanies(req.auth.organizationId, query);
    res.status(200).json(result);
  },
);

export const getCompanyHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const company = await getCompanyById(req.auth.organizationId, id);
    res.status(200).json(company);
  },
);

export const updateCompanyHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const input = parseOrThrow(updateCompanySchema, req.body);
    const company = await updateCompany(
      req.auth.organizationId,
      req.auth.userId,
      id,
      input,
    );
    res.status(200).json(company);
  },
);

export const deleteCompanyHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    await deleteCompany(req.auth.organizationId, id);
    res.status(204).send();
  },
);
