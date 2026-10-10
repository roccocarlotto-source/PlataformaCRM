import { prisma } from "../../lib/prisma";
import { getBranchById } from "../../services/branch.service";
import { leerConfiguracionDeSede } from "../repositories/clinicSettings.repository";

// ---------------------------------------------------------------------------
// La configuración de clínica de una sede que edita el ADMIN (R11). Hoy, el
// plazo mínimo para que el asistente reprograme o cancele un turno
// (minHoursToChangeBooking, docs/rubros.md §5.1 y D10: configurable por sede,
// sin valor por defecto; null = sin plazo). Las demás columnas de
// ClinicBranchSettings (recordatorios, R13) se suman acá cuando tengan pantalla.
// ---------------------------------------------------------------------------

/** Tope razonable: un año. Evita un Int fuera de rango en la columna. */
export const MAX_HORAS_PARA_CAMBIAR_UN_TURNO = 8760;

export interface ConfiguracionEditableDeSede {
  minHoursToChangeBooking: number | null;
}

export async function configuracionDeClinicaDeLaSede(
  organizationId: string,
  branchId: string,
): Promise<ConfiguracionEditableDeSede> {
  // 404 si la sede no es de la organización (o no existe).
  await getBranchById(organizationId, branchId);
  const { minHoursToChangeBooking } = await leerConfiguracionDeSede(organizationId, branchId);
  return { minHoursToChangeBooking };
}

export async function configurarClinicaDeLaSede(
  organizationId: string,
  branchId: string,
  input: ConfiguracionEditableDeSede,
): Promise<ConfiguracionEditableDeSede> {
  await getBranchById(organizationId, branchId);
  // Upsert: una sede creada antes de que la organización fuera clínica puede
  // no tener su fila todavía.
  const fila = await prisma.clinicBranchSettings.upsert({
    where: { branchId },
    create: {
      organizationId,
      branchId,
      minHoursToChangeBooking: input.minHoursToChangeBooking,
    },
    update: { minHoursToChangeBooking: input.minHoursToChangeBooking },
    select: { minHoursToChangeBooking: true },
  });
  return fila;
}
