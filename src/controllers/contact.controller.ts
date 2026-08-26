import type { Response } from "express";
import { z } from "zod";
import {
  createContact,
  deleteContact,
  getContactById,
  listContacts,
  updateContact,
} from "../services/contact.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

const idParamSchema = z.string().uuid("id inválido");

const lifecycleStageSchema = z.enum(["LEAD", "MQL", "SQL", "CUSTOMER", "CHURNED"]);

// Campos compartidos entre create (firstName/lastName requeridos) y update
// (todos opcionales vía .partial() más abajo).
const contactFields = {
  firstName: z
    .string()
    .trim()
    .min(1, "firstName es requerido")
    .max(100, "firstName no puede superar los 100 caracteres"),
  lastName: z
    .string()
    .trim()
    .min(1, "lastName es requerido")
    .max(100, "lastName no puede superar los 100 caracteres"),
  email: z
    .string()
    .trim()
    .email("email inválido")
    .max(255, "email no puede superar los 255 caracteres")
    .optional(),
  phone: z.string().trim().max(30, "phone no puede superar los 30 caracteres").optional(),
  jobTitle: z.string().trim().max(100, "jobTitle no puede superar los 100 caracteres").optional(),
  lifecycleStage: lifecycleStageSchema.optional(),
  source: z.string().trim().max(100, "source no puede superar los 100 caracteres").optional(),
  companyId: z.string().uuid("companyId inválido").optional(),
  ownerId: z.string().uuid("ownerId inválido").optional(),
};

const createContactSchema = z.object(contactFields);

const updateContactSchema = z
  .object(contactFields)
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).optional(),
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  email: z.string().trim().min(1).optional(),
  companyId: z.string().uuid("companyId inválido").optional(),
  ownerId: z.string().uuid("ownerId inválido").optional(),
  lifecycleStage: lifecycleStageSchema.optional(),
  source: z.string().trim().min(1).optional(),
  sortBy: z.enum(["firstName", "lastName", "createdAt", "lifecycleStage"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const createContactHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(createContactSchema, req.body);
    const contact = await createContact(req.auth.organizationId, req.auth.userId, input);
    res.status(201).json(contact);
  },
);

export const listContactsHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(listQuerySchema, req.query);
    const result = await listContacts(req.auth.organizationId, query);
    res.status(200).json(result);
  },
);

export const getContactHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  const contact = await getContactById(req.auth.organizationId, id);
  res.status(200).json(contact);
});

export const updateContactHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const input = parseOrThrow(updateContactSchema, req.body);
    const contact = await updateContact(req.auth.organizationId, req.auth.userId, id, input);
    res.status(200).json(contact);
  },
);

export const deleteContactHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    await deleteContact(req.auth.organizationId, id);
    res.status(204).send();
  },
);
