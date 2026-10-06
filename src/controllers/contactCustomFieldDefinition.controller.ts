import type { Response } from "express";
import { z } from "zod";
import {
  actualizarDefinicion,
  borrarDefinicion,
  crearDefinicion,
  listarDefiniciones,
  obtenerDefinicion,
  usoDeOpciones,
} from "../services/contactCustomFieldDefinition.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import {
  MAX_LARGO_DE_ETIQUETA,
  MAX_LARGO_DE_OPCION,
  MAX_OPCIONES,
  TIPOS_DE_CAMPO,
} from "../utils/camposPersonalizados";
import { parseOrThrow } from "../utils/validation";

// ---------------------------------------------------------------------------
// Campos personalizados de contactos, v1 (B6): las definiciones por
// organización. GET para cualquier usuario autenticado (la ficha los
// muestra a todos); POST/PATCH/DELETE solo ADMIN (routes). Las reglas de
// negocio —tope de 30, key única, tipo inmutable, opciones de un SELECT—
// viven en el service; acá solo la forma del request.
// ---------------------------------------------------------------------------

const idParamSchema = z.string().uuid("id inválido");

const etiqueta = z
  .string()
  .trim()
  .min(1, "label es requerido")
  .max(
    MAX_LARGO_DE_ETIQUETA,
    `label no puede superar los ${String(MAX_LARGO_DE_ETIQUETA)} caracteres`,
  );

const opcion = z
  .string()
  .max(
    MAX_LARGO_DE_OPCION,
    `una opción no puede superar los ${String(MAX_LARGO_DE_OPCION)} caracteres`,
  );

const opciones = z
  .array(opcion)
  .max(MAX_OPCIONES, `options no puede tener más de ${String(MAX_OPCIONES)} elementos`);

// Exportados para testear la frontera del schema sin base ni HTTP.
export const createContactCustomFieldDefinitionSchema = z.object({
  label: etiqueta,
  type: z.enum(TIPOS_DE_CAMPO),
  options: opciones.optional(),
  agentEditable: z.boolean().optional(),
});

export const updateContactCustomFieldDefinitionSchema = z
  .object({
    label: etiqueta,
    // Se acepta solo para rechazarlo con el mensaje del service si cambia.
    type: z.enum(TIPOS_DE_CAMPO),
    options: opciones,
    // Las opciones que cambiaron de texto: los contactos que las tenían
    // elegidas pasan al texto nuevo. Solo junto con `options` (service).
    renamedOptions: z
      .array(z.object({ from: opcion, to: opcion }))
      .max(MAX_OPCIONES, `renamedOptions no puede tener más de ${String(MAX_OPCIONES)} elementos`),
    agentEditable: z.boolean(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

export const listContactCustomFieldDefinitionsHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    res.status(200).json(await listarDefiniciones(req.auth.organizationId));
  },
);

export const getContactCustomFieldDefinitionHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    res.status(200).json(await obtenerDefinicion(req.auth.organizationId, id));
  },
);

// Cuántos contactos usan cada opción de un campo de lista. Solo ADMIN
// (routes): es para la pantalla que las edita.
export const getContactCustomFieldOptionUsageHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    res.status(200).json({ contactsByOption: await usoDeOpciones(req.auth.organizationId, id) });
  },
);

export const createContactCustomFieldDefinitionHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(createContactCustomFieldDefinitionSchema, req.body);
    res.status(201).json(await crearDefinicion(req.auth.organizationId, input));
  },
);

export const updateContactCustomFieldDefinitionHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const input = parseOrThrow(updateContactCustomFieldDefinitionSchema, req.body);
    res.status(200).json(await actualizarDefinicion(req.auth.organizationId, id, input));
  },
);

export const deleteContactCustomFieldDefinitionHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    await borrarDefinicion(req.auth.organizationId, id);
    res.status(204).send();
  },
);
