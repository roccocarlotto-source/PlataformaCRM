import { Weekday } from "@prisma/client";
import type { Response } from "express";
import { z } from "zod";
import { getWorkingHours, replaceWorkingHoursForResource } from "../services/workingHours.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";
import { minutosDesdeHoraLocal } from "../utils/workingHours";

const resourceIdParamSchema = z.string().uuid("resourceId inválido");

// z.nativeEnum sobre el enum real de Prisma, no literales a mano: si Weekday
// cambia en schema.prisma este schema se actualiza solo. Es el patrón que
// ALTO-12 señaló y que resource.controller.ts ya aplica a ResourceType.
const weekdaySchema = z.nativeEnum(Weekday, {
  errorMap: () => ({
    message: "weekday debe ser MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY o SUNDAY",
  }),
});

// LA API HABLA "HH:MM" y la base guarda minutos. La traducción vive acá, en el
// borde, y la hace minutosDesdeHoraLocal — que además es la que rechaza "25:00"
// y "12:60". Un z.string().regex() acá duplicaría esa regla en dos lugares.
const horaSchema = z.string().refine((valor) => minutosDesdeHoraLocal(valor) !== undefined, {
  message: 'La hora debe tener formato HH:MM entre 00:00 y 24:00 (por ejemplo "09:00")',
});

const franjaSchema = z
  .object({
    weekday: weekdaySchema,
    startTime: horaSchema,
    endTime: horaSchema,
  })
  .refine(
    (franja) =>
      (minutosDesdeHoraLocal(franja.startTime) as number) <
      (minutosDesdeHoraLocal(franja.endTime) as number),
    { message: "startTime tiene que ser anterior a endTime" },
  );

// PUT con la semana ENTERA, no POST/PATCH/DELETE por franja. El razonamiento
// está en workingHours.repository.ts; en una línea: así es como se usa (un dueño
// carga su horario una vez), la validación que importa es sobre el conjunto, y
// el resultado es idempotente.
//
// Un arreglo VACÍO es válido y significa "este recurso no atiende". No es un
// caso raro: es cómo se saca de circulación un recurso sin borrarlo.
const reemplazarHorarioSchema = z.object({
  workingHours: z
    .array(franjaSchema)
    // Tope defensivo: 7 días × franjas razonables. Sin él, un cliente podría
    // mandar cien mil franjas y hacer que la expansión de disponibilidad las
    // recorra todas por cada día del rango.
    .max(50, "No se pueden cargar más de 50 franjas por recurso"),
});

export const getWorkingHoursHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const resourceId = parseOrThrow(resourceIdParamSchema, req.params.resourceId);
    const franjas = await getWorkingHours(req.auth.organizationId, resourceId);
    res.status(200).json({ workingHours: franjas });
  },
);

export const replaceWorkingHoursHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const resourceId = parseOrThrow(resourceIdParamSchema, req.params.resourceId);
    const { workingHours } = parseOrThrow(reemplazarHorarioSchema, req.body);

    const franjas = await replaceWorkingHoursForResource(
      req.auth.organizationId,
      resourceId,
      workingHours.map((franja) => ({
        weekday: franja.weekday,
        startMinute: minutosDesdeHoraLocal(franja.startTime) as number,
        endMinute: minutosDesdeHoraLocal(franja.endTime) as number,
      })),
    );

    res.status(200).json({ workingHours: franjas });
  },
);
