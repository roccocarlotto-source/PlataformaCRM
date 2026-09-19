import type { Response } from "express";
import { z } from "zod";
import {
  createKnowledgeBaseEntry,
  deleteKnowledgeBaseEntry,
  getKnowledgeBaseEntryById,
  listKnowledgeBaseEntries,
  updateKnowledgeBaseEntry,
} from "../services/knowledgeBaseEntry.service";
import { extraerTextoDeArchivo } from "../services/knowledgeBaseExtraction.service";
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

// ---------------------------------------------------------------------------
// POST /api/knowledge-base/extract-text — ítem 60.
//
// MISMO ESPÍRITU QUE POST /api/imports/preview: extrae y devuelve, no guarda
// nada. No crea ni toca ninguna entrada, no escribe en la base y el archivo se
// va con el request. Por eso es 200 y no 201 ni 202 — la respuesta ES el
// resultado completo de la operación y la operación ya terminó.
//
// NO LEE req.auth.organizationId, y no es un olvido: no hay nada que aislar
// porque no toca la base. req.auth sirve para llegar hasta acá —authenticate y
// authorize("ADMIN") ya corrieron— y nada más. Mismo razonamiento que
// previsualizarEncabezadosHandler.
//
// NO VALIDA EL TOPE DE 10.000 CARACTERES de `content`. Esa regla vive en el
// POST/PATCH de la entrada, que es donde el dato se guarda de verdad, y
// duplicarla acá sería dos fuentes de verdad para la misma regla: el día que
// cambie una, la otra queda mintiendo. Lo que este endpoint devuelve es texto;
// si no entra en el campo, el formulario ya lo muestra con su contador y su
// maxLength y quien lo subió lo recorta a mano.
//
// SIN logAccesoADatosPersonales, a diferencia de resumenDeLoteHandler: lo que
// se extrae acá es documentación del negocio —horarios, políticas, un FAQ—, no
// datos personales de terceros como las filas de una importación de leads. Si
// alguien sube un archivo con datos personales adentro, el registro que
// corresponde es el del guardado de la entrada, no el de la lectura del
// archivo.
// ---------------------------------------------------------------------------
export const extraerTextoDeArchivoHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    // knowledgeBaseUpload ya garantizó que existe y cortó con 400 si no — el
    // non-null está respaldado por el middleware, igual que req.auth lo está
    // por authenticate.
    const archivo = req.file!;

    const resultado = await extraerTextoDeArchivo({
      contenido: archivo.buffer,
      mimetype: archivo.mimetype,
    });

    res.status(200).json(resultado);
  },
);
