import type { LateBookingReminder } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { getBranchById } from "../../services/branch.service";
import { leerConfiguracionDeSede } from "../repositories/clinicSettings.repository";

// ---------------------------------------------------------------------------
// La configuración de clínica de una sede que edita el ADMIN:
//   - R11: el plazo mínimo para que el asistente reprograme o cancele un turno
//     (minHoursToChangeBooking, docs/rubros.md §5.1 y D10: sin valor por
//     defecto; null = sin plazo);
//   - R13: el recordatorio (§6.2): cuántas horas antes sale (1 a 72, default
//     24) y qué hacer con un turno dado con menos anticipación (NO_ENVIAR por
//     defecto, EN_EL_MOMENTO, o HORAS_ANTES con 1 a 23 horas, default 2).
// Cambiarla no recalcula los recordatorios ya agendados (§6.2).
// ---------------------------------------------------------------------------

/** Tope razonable: un año. Evita un Int fuera de rango en la columna. */
export const MAX_HORAS_PARA_CAMBIAR_UN_TURNO = 8760;

export interface ConfiguracionEditableDeSede {
  minHoursToChangeBooking: number | null;
  reminderHoursBefore: number;
  lateBookingReminder: LateBookingReminder;
  lateBookingHoursBefore: number;
}

export type CambiosDeConfiguracionDeSede = Partial<ConfiguracionEditableDeSede>;

const SELECCION = {
  minHoursToChangeBooking: true,
  reminderHoursBefore: true,
  lateBookingReminder: true,
  lateBookingHoursBefore: true,
} as const;

export async function configuracionDeClinicaDeLaSede(
  organizationId: string,
  branchId: string,
): Promise<ConfiguracionEditableDeSede> {
  // 404 si la sede no es de la organización (o no existe).
  await getBranchById(organizationId, branchId);
  const c = await leerConfiguracionDeSede(organizationId, branchId);
  return {
    minHoursToChangeBooking: c.minHoursToChangeBooking,
    reminderHoursBefore: c.reminderHoursBefore,
    lateBookingReminder: c.lateBookingReminder,
    lateBookingHoursBefore: c.lateBookingHoursBefore,
  };
}

/** Guarda solo lo que viene; lo demás queda como estaba. */
export async function configurarClinicaDeLaSede(
  organizationId: string,
  branchId: string,
  cambios: CambiosDeConfiguracionDeSede,
): Promise<ConfiguracionEditableDeSede> {
  await getBranchById(organizationId, branchId);
  // Upsert: una sede creada antes de que la organización fuera clínica puede
  // no tener su fila todavía (los demás campos, con su default).
  return prisma.clinicBranchSettings.upsert({
    where: { branchId },
    create: { organizationId, branchId, ...cambios },
    update: cambios,
    select: SELECCION,
  });
}
