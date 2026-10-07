import { Prisma, type ImportSync } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Las sincronizaciones del stock desde Google Sheets (import_syncs,
// docs/importacion-de-datos.md §7). organizationId en el WHERE de todo (M4),
// salvo el reclamo del worker, que es entre organizaciones como el de los
// lotes.
// ---------------------------------------------------------------------------

// Fallas seguidas que la pausan sola (§7).
export const FALLAS_PARA_PAUSAR = 3;

export function crearSync(
  data: {
    organizationId: string;
    sourceId: string;
    createdByUserId: string;
    sheetId: string;
    sheetGid: string;
    config: Prisma.InputJsonValue;
    intervalHours: number;
    markMissingUnavailable: boolean;
    nextRunAt: Date;
  },
  db: Db,
): Promise<ImportSync> {
  return db.importSync.create({ data });
}

// Reclama UNA sincronización vencida. En la misma sentencia corre next_run_at
// un intervalo DESDE AHORA (una corrida tardía corre una vez, no una por cada
// intervalo perdido) y toma el lock en la base. Bajar la planilla pasa
// después, fuera de esta sentencia. Un proceso que muere a mitad de la corrida
// la libera cuando vence locked_until.
export async function reclamarSync(lockMs: number, db: Db = prisma): Promise<ImportSync | null> {
  const filas = await db.$queryRaw<{ id: string }[]>`
    UPDATE import_syncs
    SET next_run_at = now() + (interval_hours * interval '1 hour'),
        locked_until = now() + (${lockMs}::int * interval '1 millisecond'),
        updated_at = now()
    WHERE id = (
      SELECT id FROM import_syncs
      WHERE deleted_at IS NULL AND paused_at IS NULL
        AND next_run_at <= now()
        AND (locked_until IS NULL OR locked_until < now())
      ORDER BY next_run_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id
  `;
  if (filas.length === 0) return null;
  return db.importSync.findUnique({ where: { id: filas[0].id } });
}

// Una corrida que bajó y leyó la planilla: OK, aunque después tenga filas
// fallidas (eso es del lote, no de la sincronización).
export function registrarCorridaOk(id: string, organizationId: string, db: Db = prisma) {
  return db.importSync.updateMany({
    where: { id, organizationId },
    data: {
      lastRunAt: new Date(),
      lastStatus: "OK",
      lastError: null,
      consecutiveFailures: 0,
      lockedUntil: null,
    },
  });
}

// Una corrida que no pudo bajar o leer la planilla. A la tercera seguida, la
// sincronización se pausa sola (AUTO_FAILURES).
export function registrarCorridaFallida(
  id: string,
  organizationId: string,
  error: string,
  db: Db = prisma,
) {
  return db.$executeRaw`
    UPDATE import_syncs
    SET last_run_at = now(),
        last_status = 'FAILED'::"ImportSyncRunStatus",
        last_error = ${error.slice(0, 1000)},
        consecutive_failures = consecutive_failures + 1,
        locked_until = NULL,
        paused_at = CASE WHEN consecutive_failures + 1 >= ${FALLAS_PARA_PAUSAR}::int
                         THEN now() ELSE paused_at END,
        paused_reason = CASE WHEN consecutive_failures + 1 >= ${FALLAS_PARA_PAUSAR}::int
                             THEN 'AUTO_FAILURES'::"ImportSyncPauseReason" ELSE paused_reason END,
        updated_at = now()
    WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid
  `;
}

// Una corrida que no se hizo porque la anterior sigue en curso: suelta el lock
// sin contar como falla ni como corrida.
export function soltarSync(id: string, organizationId: string, db: Db = prisma) {
  return db.importSync.updateMany({ where: { id, organizationId }, data: { lockedUntil: null } });
}

export function findSync(organizationId: string, id: string, db: Db = prisma) {
  return db.importSync.findFirst({ where: { id, organizationId, deletedAt: null } });
}

export function listarSyncs(organizationId: string, db: Db = prisma) {
  return db.importSync.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      source: { select: { name: true } },
      // La última corrida, para el informe.
      batches: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, createdAt: true, rowCount: true, counters: true },
      },
    },
  });
}

export function pausarSync(organizationId: string, id: string, db: Db = prisma) {
  return db.importSync.updateMany({
    where: { id, organizationId, deletedAt: null, pausedAt: null },
    data: { pausedAt: new Date(), pausedReason: "MANUAL" },
  });
}

// Reanudar borra las fallas acumuladas y corre en la próxima pasada.
export function reanudarSync(organizationId: string, id: string, db: Db = prisma) {
  return db.importSync.updateMany({
    where: { id, organizationId, deletedAt: null },
    data: { pausedAt: null, pausedReason: null, consecutiveFailures: 0, nextRunAt: new Date() },
  });
}

export function borrarSync(organizationId: string, id: string, db: Db = prisma) {
  return db.importSync.updateMany({
    where: { id, organizationId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}
