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
// explícitos) y update (todos opcionales vía .partial() más abajo). Solo los
// que NO cambian de nulabilidad entre uno y otro; los que sí, van definidos
// dos veces más abajo.
const companyFields = {
  name: z
    .string()
    .trim()
    .min(1, "name es requerido")
    .max(255, "name no puede superar los 255 caracteres"),
  ownerId: z.string().uuid("ownerId inválido").optional(),
};

// Exportados para testear la frontera del schema sin base ni HTTP
// (company.controller.test.ts), mismo criterio que opportunity y stage.
export const createCompanySchema = z.object({
  ...companyFields,
  domain: z.string().trim().max(255, "domain no puede superar los 255 caracteres").optional(),
  industry: z.string().trim().max(100, "industry no puede superar los 100 caracteres").optional(),
  phone: z.string().trim().max(30, "phone no puede superar los 30 caracteres").optional(),
  city: z.string().trim().max(100, "city no puede superar los 100 caracteres").optional(),
  country: z.string().trim().max(100, "country no puede superar los 100 caracteres").optional(),
});

// M-10 (auditoría 2026-08-29): domain/industry/phone/city/country son
// .nullable() acá (a diferencia de create): permiten limpiarse
// explícitamente con un `null` en PATCH. Sin .nullable(), `{"domain": null}`
// rebotaba con 400 de Zod antes de llegar al service, aunque
// UpdateCompanyInput y UpdateCompanyData ya los tipaban `string | null`.
// Mismo patrón que opportunity y activity.
export const updateCompanySchema = z
  .object({
    ...companyFields,
    domain: z
      .string()
      .trim()
      .max(255, "domain no puede superar los 255 caracteres")
      .nullable()
      .optional(),
    industry: z
      .string()
      .trim()
      .max(100, "industry no puede superar los 100 caracteres")
      .nullable()
      .optional(),
    phone: z
      .string()
      .trim()
      .max(30, "phone no puede superar los 30 caracteres")
      .nullable()
      .optional(),
    city: z
      .string()
      .trim()
      .max(100, "city no puede superar los 100 caracteres")
      .nullable()
      .optional(),
    country: z
      .string()
      .trim()
      .max(100, "country no puede superar los 100 caracteres")
      .nullable()
      .optional(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

const listQuerySchema = z.object({
  // Tope de cordura, el mismo que ingestionEvent (S2-5) — B-21.
  page: z.coerce.number().int().positive().max(10_000).default(1),
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
    const company = await createCompany(req.auth.organizationId, req.auth.userId, input);
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

export const getCompanyHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  const company = await getCompanyById(req.auth.organizationId, id);
  res.status(200).json(company);
});

export const updateCompanyHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const input = parseOrThrow(updateCompanySchema, req.body);
    const company = await updateCompany(req.auth.organizationId, req.auth.userId, id, input);
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
