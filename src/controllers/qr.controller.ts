import type { Response } from "express";
import { z } from "zod";
import {
  createDigitalQrCode,
  deleteQrCode,
  listQrCodes,
  updateQrCode,
} from "../services/qr.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

// ---------------------------------------------------------------------------
// Validación de name / destinationUrl / message — los mismos límites que
// create_digital_qr_code / update_qr_code del original (0008/0015), con Zod en
// vez de los `if` a mano de plpgsql: name requerido y hasta 80; destinationUrl
// requerido, http(s):// y hasta 2048; message opcional y hasta 500. El trim y
// el "vacío = null" de message replican el nullif(btrim(...)) original.
// ---------------------------------------------------------------------------

export const QR_NAME_MAX_LENGTH = 80;
export const QR_DESTINATION_URL_MAX_LENGTH = 2048;
export const QR_MESSAGE_MAX_LENGTH = 500;

const idParamSchema = z.string().uuid("id inválido");

const nameSchema = z
  .string()
  .trim()
  .min(1, "name es requerido")
  .max(QR_NAME_MAX_LENGTH, `name no puede superar los ${QR_NAME_MAX_LENGTH} caracteres`);

const destinationUrlSchema = z
  .string()
  .trim()
  .min(1, "destinationUrl es requerido")
  .max(
    QR_DESTINATION_URL_MAX_LENGTH,
    `destinationUrl no puede superar los ${QR_DESTINATION_URL_MAX_LENGTH} caracteres`,
  )
  .regex(/^https?:\/\//i, "destinationUrl tiene que empezar con http:// o https://");

// Vacío o solo espacios -> null (nullif(btrim(...)) original). Nullable para
// que PATCH pueda vaciarlo explícitamente — mismo criterio que M-10.
const messageSchema = z
  .string()
  .trim()
  .max(QR_MESSAGE_MAX_LENGTH, `message no puede superar los ${QR_MESSAGE_MAX_LENGTH} caracteres`)
  .nullable()
  .transform((valor) => (valor === null || valor.length === 0 ? null : valor));

const createFields = {
  branchId: z.string().uuid("branchId inválido"),
  name: nameSchema,
  destinationUrl: destinationUrlSchema,
  message: messageSchema.optional().default(null),
};

// Único camino de creación desde 20260904120000_remove_qr_claim_and_single_use:
// ya no existe el claim de un QR físico ni la elección de qrType — todo QR
// nace digital y reusable.
export const createDigitalQrSchema = z.object(createFields);

// PATCH parcial: cada campo opcional, message además anulable. branchId no
// está: mover un QR de sucursal no es una operación del original ni de esta
// fase.
export const updateQrSchema = z
  .object({
    name: nameSchema,
    destinationUrl: destinationUrlSchema,
    message: messageSchema,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

export const listQrQuerySchema = z.object({
  // Mismo tope de cordura que el resto de los listados (B-21).
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  branchId: z.string().uuid("branchId inválido").optional(),
  sortBy: z.enum(["createdAt", "displayNumber"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const createDigitalQrHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(createDigitalQrSchema, req.body);
    const qrCode = await createDigitalQrCode(req.auth.organizationId, input);
    res.status(201).json(qrCode);
  },
);

export const listQrHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const query = parseOrThrow(listQrQuerySchema, req.query);
  const result = await listQrCodes(req.auth.organizationId, query);
  res.status(200).json(result);
});

export const updateQrHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  const input = parseOrThrow(updateQrSchema, req.body);
  const qrCode = await updateQrCode(req.auth.organizationId, id, input);
  res.status(200).json(qrCode);
});

export const deleteQrHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  await deleteQrCode(req.auth.organizationId, id);
  res.status(204).send();
});
