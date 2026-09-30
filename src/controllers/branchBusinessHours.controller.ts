import type { Response } from "express";
import { z } from "zod";
import {
  getBusinessHours,
  replaceBusinessHoursForBranch,
} from "../services/branchBusinessHours.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";
import { minutosDesdeHoraLocal } from "../utils/workingHours";
import { franjaSchema } from "./workingHours.controller";

// ---------------------------------------------------------------------------
// Horario de atención de la sucursal (G-07). Mismo formato de franja que
// GET/PUT /api/resources/:resourceId/working-hours —el mismo franjaSchema, así
// que "HH:MM", días y validaciones son idénticos—; lo único que cambia es la
// clave (`businessHours`) y el verbo.
//
// PATCH que reemplaza la SEMANA ENTERA, no una franja: es cómo se usa (se carga
// el horario una vez) y la validación que importa (superposición) es sobre el
// conjunto, igual que el PUT de los recursos. `[]` borra el horario propio y
// la sucursal vuelve al default (lunes a sábado de 9 a 20).
// ---------------------------------------------------------------------------

const branchIdParamSchema = z.string().uuid("id de sucursal inválido");

const reemplazarHorarioDeAtencionSchema = z.object({
  businessHours: z
    .array(franjaSchema)
    .max(50, "No se pueden cargar más de 50 franjas por sucursal"),
});

export const getBranchBusinessHoursHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const branchId = parseOrThrow(branchIdParamSchema, req.params.id);
    res.status(200).json(await getBusinessHours(req.auth.organizationId, branchId));
  },
);

export const replaceBranchBusinessHoursHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const branchId = parseOrThrow(branchIdParamSchema, req.params.id);
    const { businessHours } = parseOrThrow(reemplazarHorarioDeAtencionSchema, req.body);

    const horario = await replaceBusinessHoursForBranch(
      req.auth.organizationId,
      branchId,
      businessHours.map((franja) => ({
        weekday: franja.weekday,
        startMinute: minutosDesdeHoraLocal(franja.startTime) as number,
        endMinute: minutosDesdeHoraLocal(franja.endTime) as number,
      })),
    );

    res.status(200).json(horario);
  },
);
