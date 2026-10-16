import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../types/auth";
import { AppError } from "../../utils/AppError";
import { asyncHandler } from "../../utils/asyncHandler";
import { parseOrThrow } from "../../utils/validation";
import {
  ACCIONES_DEL_RECAMBIO,
  listarRecambiosVencidos,
  registrarAvisoDeRecambio,
} from "../recambio/lista.service";

// Recambios vencidos sin contactar (docs/servicios.md §7.4, S13). ADMIN y
// USER, con el módulo (gate en `authenticate`).

const idParamSchema = z.string().uuid("id inválido");
const accionSchema = z.enum(ACCIONES_DEL_RECAMBIO, {
  errorMap: () => ({ message: "accion tiene que ser TAREA o CONTACTADO" }),
});

export const listarRecambiosQuerySchema = z.object({
  estado: z.literal("vencidos", {
    errorMap: () => ({ message: "estado tiene que ser vencidos" }),
  }),
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
  branchId: z.string().uuid("branchId inválido").optional(),
});

export const listarRecambiosHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const { page, pageSize, branchId } = parseOrThrow(listarRecambiosQuerySchema, req.query);
    res.status(200).json(
      await listarRecambiosVencidos(req.auth.organizationId, req.auth, {
        page,
        pageSize,
        branchId,
      }),
    );
  },
);

export const registrarAvisoDeRecambioHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const { accion } = parseOrThrow(z.object({ accion: accionSchema }).strict(), req.body);
    res
      .status(201)
      .json(await registrarAvisoDeRecambio(req.auth.organizationId, req.auth.userId, id, accion));
  },
);

// Para varias filas seleccionadas: una por una, y el resultado de cada una.
export const registrarAvisosDeRecambioHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const { vehiculoIds, accion } = parseOrThrow(
      z
        .object({
          vehiculoIds: z.array(idParamSchema).min(1, "Elegí al menos un vehículo").max(100),
          accion: accionSchema,
        })
        .strict(),
      req.body,
    );
    const resultados: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of new Set(vehiculoIds)) {
      try {
        await registrarAvisoDeRecambio(req.auth.organizationId, req.auth.userId, id, accion);
        resultados.push({ id, ok: true });
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        resultados.push({ id, ok: false, error: err.message });
      }
    }
    res.status(200).json({ resultados });
  },
);
