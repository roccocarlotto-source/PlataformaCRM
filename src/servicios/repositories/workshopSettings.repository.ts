import type { Prisma } from "@prisma/client";
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

/** Edición de la configuración (ADMIN, §4.8). Crea la fila si faltaba. */
export async function actualizarConfiguracionDelTaller(
  organizationId: string,
  data: Partial<ConfiguracionDelTaller>,
  db: Db = prisma,
): Promise<ConfiguracionDelTaller> {
  return db.workshopSettings.upsert({
    where: { organizationId },
    create: { organizationId, ...data },
    update: data,
    select: { defaultNextServiceMonths: true, firstServiceAfterMonths: true },
  });
}

/** El número de la orden nueva (D18): consecutivo por organización, tomado con
 *  UPDATE … RETURNING dentro de la transacción del alta. El UPDATE bloquea la
 *  fila hasta el commit, así que dos altas simultáneas no pueden llevarse el
 *  mismo número, y si el alta se revierte el número vuelve (sin huecos). El
 *  patrón de nextVehicleStockNumber. */
export async function tomarNumeroDeOrden(
  organizationId: string,
  tx: Prisma.TransactionClient,
): Promise<number> {
  await asegurarConfiguracionDelTaller(organizationId, tx);
  const [fila] = await tx.$queryRaw<{ numero: number }[]>`
    UPDATE workshop_settings
    SET next_order_number = next_order_number + 1, updated_at = now()
    WHERE organization_id = ${organizationId}::uuid
    RETURNING next_order_number - 1 AS numero`;
  return Number(fila.numero);
}
