import { prisma, type Db } from "../../lib/prisma";

// ---------------------------------------------------------------------------
// La configuración del taller (docs/servicios.md §2.6), 1:1 con la
// organización. Se crea al activar el módulo (organizationModules.service);
// si falta, el código usa los mismos defaults que la columna, así nada
// depende de que la fila exista (el patrón de ClinicSettings).
// ---------------------------------------------------------------------------

/** Los defaults de workshop_settings: los mismos de la migración
 *  20261118120000_servicios_tablas. */
export const CONFIGURACION_DEL_TALLER_POR_DEFECTO = {
  defaultNextServiceMonths: 12,
  firstServiceAfterMonths: 12,
} as const;

export interface ConfiguracionDelTaller {
  defaultNextServiceMonths: number | null;
  firstServiceAfterMonths: number | null;
}

/** La configuración de la organización, o los defaults si no tiene fila. No
 *  devuelve next_order_number: es un contador interno, no configuración. */
export async function leerConfiguracionDelTaller(
  organizationId: string,
  db: Db = prisma,
): Promise<ConfiguracionDelTaller> {
  const fila = await db.workshopSettings.findUnique({
    where: { organizationId },
    select: { defaultNextServiceMonths: true, firstServiceAfterMonths: true },
  });
  return fila ?? { ...CONFIGURACION_DEL_TALLER_POR_DEFECTO };
}

/** Crea la fila con sus defaults si no existe. Idempotente: no toca una fila
 *  que ya está (una reactivación conserva la configuración). */
export async function asegurarConfiguracionDelTaller(organizationId: string, db: Db) {
  await db.workshopSettings.createMany({ data: [{ organizationId }], skipDuplicates: true });
}
