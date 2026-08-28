import type { Response } from "express";
import { z } from "zod";
import { logAccesoADatosPersonales } from "../lib/accessLog";
import {
  createContact,
  deleteContact,
  erasePersonalData,
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

// ---------------------------------------------------------------------------
// Borrado de datos personales a pedido — D2-4 de
// docs/review-fase2-2026-08-28.md.
//
// POST y no DELETE, y no es un detalle de gusto: DELETE /api/contacts/:id ya
// existe y significa otra cosa (soft delete, reversible). Dos verbos distintos
// sobre el mismo recurso para dos operaciones que no se parecen es exactamente
// lo que evita que alguien invoque la irreversible creyendo que invoca la otra.
// El sufijo del path la nombra en vez de dejarla implícita en el método.
//
// 200 con un resumen, no 204: la operación es irreversible y quien la pide
// tiene que poder decir qué se borró. `ingestionEventsAnonimizados` es lo que
// el estándar llama borrado verificable.
//
// SE REGISTRA EL ACCESO igual que las lecturas de la capa de ingesta (D2-5).
// Acá pesa más todavía: es la única operación del sistema que destruye datos
// personales sin vuelta atrás, así que quién la pidió y sobre quién es
// justamente lo que hay que poder reconstruir después.
export const erasePersonalDataHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);

    logAccesoADatosPersonales({
      auth: req.auth,
      recurso: "POST /api/contacts/:id/erase-personal-data",
      clase: "Sensitive",
      detalle: { contactId: id, operacion: "borrado_irreversible" },
    });

    const resultado = await erasePersonalData(req.auth.organizationId, id);
    res.status(200).json(resultado);
  },
);
