import type { CustomerVehicleNoticeSource, Prisma } from "@prisma/client";
import { prisma, type Db } from "../../lib/prisma";
import {
  CONFIG_DEL_RECAMBIO_POR_DEFECTO,
  TRIGGER_RECAMBIO,
  configDelRecambioSchema,
  type ConfigDelRecambio,
} from "./config";

// ---------------------------------------------------------------------------
// El acceso a datos del aviso de recambio (docs/servicios.md §7, S13).
// ---------------------------------------------------------------------------

/** Lo que el recambio pide de un vehículo y su cliente (§7.2): vehículo
 *  vigente con fecha de compra; cliente vigente, sin "sin interés" y sin una
 *  oportunidad abierta (si ya está comprando, no hace falta avisar). */
export function vehiculosParaElRecambio(
  organizationId: string,
  extra: Prisma.CustomerVehicleWhereInput = {},
): Prisma.CustomerVehicleWhereInput {
  return {
    organizationId,
    deletedAt: null,
    ownershipEndedAt: null,
    purchasedOn: { not: null },
    contact: {
      deletedAt: null,
      noInterestAt: null,
      opportunities: { none: { status: "OPEN", deletedAt: null } },
    },
    ...extra,
  };
}

/** La configuración del recambio de la organización: la de su regla (la
 *  activa si hay, si no la última), o los defaults para que la lista de
 *  vencidos sirva antes de armarla (§7.4). */
export async function configDelRecambioDe(
  organizationId: string,
  db: Db = prisma,
): Promise<ConfigDelRecambio> {
  const regla = await db.automation.findFirst({
    where: { organizationId, triggerType: TRIGGER_RECAMBIO, deletedAt: null },
    select: { triggerConfig: true },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });
  if (!regla) return { ...CONFIG_DEL_RECAMBIO_POR_DEFECTO };
  const config = configDelRecambioSchema.safeParse(regla.triggerConfig);
  return config.success ? config.data : { ...CONFIG_DEL_RECAMBIO_POR_DEFECTO };
}

/** Los avisos de recambio (automáticos o manuales) de estos vehículos. */
export function avisosDeRecambio(
  organizationId: string,
  customerVehicleIds: string[],
  db: Db = prisma,
) {
  return db.customerVehicleNotice.findMany({
    where: { organizationId, kind: "REPLACEMENT", customerVehicleId: { in: customerVehicleIds } },
    select: { customerVehicleId: true, dueOn: true },
  });
}

export const claveDeAviso = (customerVehicleId: string, dueOn: Date) =>
  `${customerVehicleId}|${dueOn.toISOString().slice(0, 10)}`;

export function crearAvisoDeRecambio(
  data: {
    organizationId: string;
    customerVehicleId: string;
    dueOn: Date;
    source: CustomerVehicleNoticeSource;
    automationId?: string | null;
    createdById?: string | null;
  },
  tx: Prisma.TransactionClient,
) {
  return tx.customerVehicleNotice.create({
    data: {
      organizationId: data.organizationId,
      customerVehicleId: data.customerVehicleId,
      kind: "REPLACEMENT",
      dueOn: data.dueOn,
      source: data.source,
      automationId: data.automationId ?? null,
      createdById: data.createdById ?? null,
    },
    select: { id: true },
  });
}
