import type { Weekday } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { findResourceById, lockResourceForUpdate } from "../repositories/resource.repository";
import {
  findWorkingHoursByResource,
  replaceWorkingHours,
} from "../repositories/workingHours.repository";
import { AppError } from "../utils/AppError";
import { encontrarFranjasSuperpuestas, horaLocalDesdeMinutos } from "../utils/workingHours";

// ---------------------------------------------------------------------------
// Horario semanal de un Resource (P2.1, paso 3).
//
// Resuelve el pendiente que el paso 2 dejó anotado en
// docs/roadmap-implementacion.md §2.1: sin esto, GET /api/availability no tenía
// contra qué calcular.
// ---------------------------------------------------------------------------

// Lo que sale por la API: horas legibles, no minutos. La base guarda enteros
// porque toda la lógica es aritmética; del otro lado hay una persona cargando el
// horario de su negocio.
export interface FranjaPublica {
  weekday: Weekday;
  startTime: string;
  endTime: string;
}

export function serializarFranja(franja: {
  weekday: Weekday;
  startMinute: number;
  endMinute: number;
}): FranjaPublica {
  return {
    weekday: franja.weekday,
    startTime: horaLocalDesdeMinutos(franja.startMinute),
    endTime: horaLocalDesdeMinutos(franja.endMinute),
  };
}

async function validarResource(organizationId: string, resourceId: string) {
  const resource = await findResourceById(resourceId, organizationId);
  if (!resource) {
    throw new AppError("El recurso indicado no existe o no pertenece a tu organización", 404);
  }
  return resource;
}

export async function getWorkingHours(
  organizationId: string,
  resourceId: string,
): Promise<FranjaPublica[]> {
  await validarResource(organizationId, resourceId);

  const franjas = await findWorkingHoursByResource(resourceId, organizationId);

  return franjas.map(serializarFranja);
}

export interface FranjaEntrante {
  weekday: Weekday;
  startMinute: number;
  endMinute: number;
}

// ---------------------------------------------------------------------------
// REEMPLAZO COMPLETO del horario semanal.
//
// La forma del endpoint (PUT con la semana entera) está argumentada en
// workingHours.repository.ts. Acá vive lo que hay que validar ANTES de escribir.
//
// UN ARREGLO VACÍO ES VÁLIDO y significa "este recurso no atiende": borra todas
// las franjas. No es un caso raro — es cómo se saca de circulación un recurso
// sin borrarlo, y la disponibilidad resultante es cero, que es lo correcto.
// ---------------------------------------------------------------------------
export async function replaceWorkingHoursForResource(
  organizationId: string,
  resourceId: string,
  franjas: FranjaEntrante[],
): Promise<FranjaPublica[]> {
  await validarResource(organizationId, resourceId);

  // El orden de los minutos ya lo garantiza Zod en el controller y el CHECK en
  // la base; lo que NO puede ver ninguno de los dos es la relación ENTRE filas.
  // Dos franjas del mismo día que se pisan es un error de carga que produciría
  // turnos duplicados en la disponibilidad — el mismo horario ofrecido dos
  // veces— así que se rechaza acá, que es el único lugar donde se ve el
  // conjunto completo.
  const superpuesta = encontrarFranjasSuperpuestas(franjas);
  if (superpuesta) {
    throw new AppError(
      `Hay franjas superpuestas el día ${superpuesta.weekday}: revisá que no se pisen entre sí`,
      400,
    );
  }

  const guardadas = await prisma.$transaction(async (tx) => {
    // El lock del recurso serializa contra deleteResource: sin él, se podría
    // cargar el horario de un recurso que está siendo borrado en paralelo y
    // dejar filas colgando de un recurso ya inactivo.
    await lockResourceForUpdate(resourceId, organizationId, tx);

    // Revalidación con el lock sostenido, mismo criterio que createServiceType.
    const resource = await findResourceById(resourceId, organizationId, tx);
    if (!resource) {
      throw new AppError("El recurso indicado no existe o no pertenece a tu organización", 404);
    }

    return replaceWorkingHours(resourceId, organizationId, franjas, tx);
  });

  return guardadas.map(serializarFranja);
}
