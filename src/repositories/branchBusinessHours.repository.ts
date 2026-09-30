import type { Weekday } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Horario de atención de la sucursal (G-07; modelo BranchBusinessHours). El
// calco de workingHours.repository.ts: la misma lectura ordenada y el mismo
// reemplazo de la semana entera dentro de la transacción de quien llama.
// ---------------------------------------------------------------------------

export function findBusinessHoursByBranch(
  branchId: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.branchBusinessHours.findMany({
    where: { branchId, organizationId },
    orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
  });
}

export interface FranjaDeAtencionAGuardar {
  weekday: Weekday;
  startMinute: number;
  endMinute: number;
}

// Borra y vuelve a crear, como replaceWorkingHours. Siempre con `db` de una
// transacción que ya tomó lockBranchForUpdate (branchBusinessHours.service.ts).
// Una semana vacía deja la sucursal sin horario propio: vuelve al default.
export async function replaceBusinessHours(
  branchId: string,
  organizationId: string,
  franjas: FranjaDeAtencionAGuardar[],
  db: Db,
) {
  await db.branchBusinessHours.deleteMany({ where: { branchId, organizationId } });

  if (franjas.length > 0) {
    await db.branchBusinessHours.createMany({
      data: franjas.map((franja) => ({
        organizationId,
        branchId,
        weekday: franja.weekday,
        startMinute: franja.startMinute,
        endMinute: franja.endMinute,
      })),
    });
  }

  return findBusinessHoursByBranch(branchId, organizationId, db);
}
