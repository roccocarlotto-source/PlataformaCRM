import type { Response } from "express";
import { z } from "zod";
import {
  createKnowledgeBaseEntry,
  deleteKnowledgeBaseEntry,
  getKnowledgeBaseEntryById,
  listKnowledgeBaseEntries,
  updateKnowledgeBaseEntry,
} from "../services/knowledgeBaseEntry.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

// ---------------------------------------------------------------------------
// Borde HTTP de la base de conocimiento por sucursal (ítem 59). Mismo molde
// que agent.controller.ts, con cuatro campos en vez de trece.
// ---------------------------------------------------------------------------

const idParamSchema = z.string().uuid("id inválido");

// El mismo tope que Agent.name, y por el mismo motivo: es lo que se lee en una
// tabla. Además es exactamente el VarChar(200) de la columna, así que un título
// más largo es un 400 y no un error del motor.
const titleSchema = z
  .string({ required_error: "title es requerido" })
  .trim()
  .min(1, "title es requerido")
  .max(200, "title no puede superar los 200 caracteres");

// 10.000 caracteres (~2000 palabras) es un tope de CORDURA, no un límite
// técnico: la columna es Text y aguantaría cualquier cosa. Existe para que
// quien carga esto piense en una entrada por tema y no pegue un PDF entero
// —cada entrada activa de la sucursal se suma al system prompt de TODOS sus
// agentes, en CADA turno, y eso se paga por token. Ver el comentario del
// modelo en schema.prisma.
const contentSchema = z
  .string({ required_error: "content es requerido" })
  .trim()
  .min(1, "content es requerido")
  .max(10_000, "content no puede superar los 10000 caracteres");

const branchIdSchema = z.string().uuid("branchId inválido");

const createKnowledgeBaseEntrySchema = z.object({
  branchId: branchIdSchema,
  title: titleSchema,
  content: contentSchema,
  isActive: z.boolean().optional(),
});

// CON branchId, a diferencia de updateAgentSchema: una entrada de KB SÍ cambia
// de sucursal, porque no hay ningún dato histórico denormalizado que dependa de
// ella. Ver la nota de UpdateKnowledgeBaseEntryInput en
// knowledgeBaseEntry.service.ts — el service valida la sucursal nueva contra la
// organización, igual que en el create.
const updateKnowledgeBaseEntrySchema = z
  .object({
    branchId: branchIdSchema,
    title: titleSchema,
    content: contentSchema,
    isActive: z.boolean(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

const listQuerySchema = z.object({
  // Tope de cordura, el mismo que agent (B-21).
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  // Busca por TÍTULO, no por contenido — ver el comentario de buildWhere en
  // knowledgeBaseEntry.repository.ts.
  search: z.string().trim().min(1).optional(),
  branchId: branchIdSchema.optional(),
  // Llega como string en la query; "true"/"false" y nada más.
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  sortBy: z.enum(["title", "createdAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const createKnowledgeBaseEntryHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(createKnowledgeBaseEntrySchema, req.body);
    const entry = await createKnowledgeBaseEntry(req.auth.organizationId, input);
    res.status(201).json(entry);
  },
);

export const listKnowledgeBaseEntriesHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(listQuerySchema, req.query);
    const result = await listKnowledgeBaseEntries(req.auth.organizationId, query);
    res.status(200).json(result);
  },
);

export const getKnowledgeBaseEntryHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const entry = await getKnowledgeBaseEntryById(req.auth.organizationId, id);
    res.status(200).json(entry);
  },
);

export const updateKnowledgeBaseEntryHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const input = parseOrThrow(updateKnowledgeBaseEntrySchema, req.body);
    const entry = await updateKnowledgeBaseEntry(req.auth.organizationId, id, input);
    res.status(200).json(entry);
  },
);

export const deleteKnowledgeBaseEntryHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    await deleteKnowledgeBaseEntry(req.auth.organizationId, id);
    res.status(204).send();
  },
);
