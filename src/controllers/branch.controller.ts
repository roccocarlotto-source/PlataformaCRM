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
import { QR_DESTINATION_URL_MAX_LENGTH } from "./qr.controller";
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

// Datos de cobro (ítem 74). El link de pago se valida con la MISMA forma que
// destinationUrl de qr.controller.ts —http(s):// y el mismo tope de 2048—: es
// el mismo tipo de dato (una URL que un tercero va a abrir) y no hay motivo
// para que las dos pantallas acepten cosas distintas.
//
// Los dos son opcionales Y nullable, igual que defaultOwnerId: `null` es la
// forma explícita de vaciarlos desde el PATCH, y el formulario manda siempre
// la clave. Un string vacío NO es null acá — el formulario ya convierte "" en
// null antes de mandar, y aceptar "" como "vacío" sería un segundo significado
// para lo mismo.
export const BRANCH_BANK_TRANSFER_DETAILS_MAX_LENGTH = 2000;

const paymentLinkUrlSchema = z
  .string()
  .trim()
  .min(1, "paymentLinkUrl no puede estar vacío (mandá null para no configurarlo)")
  .max(
    QR_DESTINATION_URL_MAX_LENGTH,
    `paymentLinkUrl no puede superar los ${QR_DESTINATION_URL_MAX_LENGTH} caracteres`,
  )
  .regex(/^https?:\/\//i, "paymentLinkUrl tiene que empezar con http:// o https://");

// Texto libre (CBU/alias/IBAN/titular varían por país y banco). El tope es de
// cordura: es un dato para copiar o leer en voz alta, no un documento.
const bankTransferDetailsSchema = z
  .string()
  .trim()
  .min(1, "bankTransferDetails no puede estar vacío (mandá null para no configurarlo)")
  .max(
    BRANCH_BANK_TRANSFER_DETAILS_MAX_LENGTH,
    `bankTransferDetails no puede superar los ${BRANCH_BANK_TRANSFER_DETAILS_MAX_LENGTH} caracteres`,
  );

const branchFields = {
  name: z
    .string()
    .trim()
    .min(1, "name es requerido")
    .max(255, "name no puede superar los 255 caracteres"),
  timezone: timezoneSchema,
  // Vendedor por defecto de la sucursal (ítem 69). Acá solo se valida la FORMA
  // (un UUID); que el usuario exista, sea de esta organización y esté activo lo
  // decide el service contra la base, igual que con cualquier otro ownerId.
  //
  // `.nullable()` ya en el create y no solo en el update: un POST con
  // `defaultOwnerId: null` es la forma explícita de decir "sin vendedor por
  // defecto", y rechazarla obligaría al formulario a omitir la clave según el
  // caso en vez de mandar siempre el mismo objeto.
  defaultOwnerId: z.string().uuid("defaultOwnerId debe ser un UUID").nullable().optional(),
  paymentLinkUrl: paymentLinkUrlSchema.nullable().optional(),
  bankTransferDetails: bankTransferDetailsSchema.nullable().optional(),
};

// timezone es REQUERIDA al crear, aunque la columna tenga default 'UTC'. El
// default existe para que el esquema describa el dato igual que
// organizations.timezone; la forma esperada de usar el API es elegirla
// explícitamente, porque una sucursal silenciosamente en UTC produce turnos a la
// hora equivocada y nadie lo nota hasta que un cliente no aparece.
export const createBranchSchema = z.object(branchFields);

export const updateBranchSchema = z
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
