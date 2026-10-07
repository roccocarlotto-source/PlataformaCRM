import {
  IngestionStatus,
  Prisma,
  type ImportBatch,
  type ImportBatchStatus,
  type ImportEntityType,
  type ImportOriginKind,
  type ImportRowDecision,
  type ImportRowOutcome,
} from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import type { PromotionNote } from "../types/promotion";
import { AppError } from "../utils/AppError";
import { deriveExternalId } from "../utils/externalId";
import type { FilaCruda } from "../utils/spreadsheet";
import {
  FILAS_POR_TANDA,
  IMPORT_BATCH_TRANSACTION_TIMEOUT_MS,
  MENSAJE_NUL,
  contieneNul,
} from "./ingestionEvent.repository";

// ---------------------------------------------------------------------------
// Persistencia del asistente de importación (docs/importacion-de-datos.md §2):
// el lote (import_batches), sus filas en el staging de siempre
// (ingestion_events con batch_id = el lote) y los vínculos con el sistema de
// origen (external_record_links).
//
// organizationId en el WHERE de TODA lectura y escritura (M4): el aislamiento
// lo da la consulta misma, no un chequeo previo. Las transiciones de estado
// son compare-and-swap (`status in [...]` en el WHERE) y devuelven el count:
// quien llama decide qué significa que no haya tocado nada.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Lotes
// ---------------------------------------------------------------------------

export function createImportBatch(
  data: {
    organizationId: string;
    sourceId: string;
    entityType: ImportEntityType;
    originKind: ImportOriginKind;
    fileName: string | null;
    fileSha256: string | null;
    fileBytes: number | null;
    rowCount: number;
    config: Prisma.InputJsonValue;
    createdByUserId: string;
  },
  db: Db = prisma,
): Promise<ImportBatch> {
  return db.importBatch.create({ data });
}

export function findImportBatch(
  organizationId: string,
  id: string,
  db: Db = prisma,
): Promise<ImportBatch | null> {
  return db.importBatch.findFirst({ where: { id, organizationId } });
}

export async function listImportBatches(
  organizationId: string,
  paginado: { page: number; pageSize: number },
  db: Db = prisma,
): Promise<{ data: ImportBatch[]; total: number }> {
  const where = { organizationId };
  const [data, total] = await Promise.all([
    db.importBatch.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (paginado.page - 1) * paginado.pageSize,
      take: paginado.pageSize,
    }),
    db.importBatch.count({ where }),
  ]);
  return { data, total };
}

// CAS: el lote pasa a `data` solo si está en uno de los estados `desde`.
export function transicionarLote(
  organizationId: string,
  id: string,
  desde: ImportBatchStatus[],
  data: Prisma.ImportBatchUpdateManyMutationInput,
  db: Db = prisma,
): Promise<{ count: number }> {
  return db.importBatch.updateMany({
    where: { id, organizationId, status: { in: desde } },
    data,
  });
}

// El worker de lotes (workers/importBatchWorker.ts) toma UN lote en ANALYZING
// y lo deja bloqueado hasta el fin de su transacción: mismo mecanismo que
// claimNextPendingEvent, sin estado "analizando por alguien" que un proceso
// muerto dejaría colgado. Un PUT de ajustes sobre ese lote espera al lock y
// lo vuelve a poner en ANALYZING al terminar.
export async function claimLoteParaAnalizar(db: Db): Promise<ImportBatch | null> {
  const filas = await db.$queryRaw<{ id: string; organization_id: string }[]>`
    SELECT id, organization_id FROM import_batches
    WHERE status = 'ANALYZING'::"ImportBatchStatus"
    ORDER BY updated_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  `;
  if (filas.length === 0) return null;
  return findImportBatch(filas[0].organization_id, filas[0].id, db);
}

// Un lote que el admin pidió deshacer (§8.3), con el mismo reclamo por fila.
export async function claimLoteParaDeshacer(db: Db): Promise<ImportBatch | null> {
  const filas = await db.$queryRaw<{ id: string; organization_id: string }[]>`
    SELECT id, organization_id FROM import_batches
    WHERE status = 'UNDOING'::"ImportBatchStatus"
    ORDER BY updated_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  `;
  if (filas.length === 0) return null;
  return findImportBatch(filas[0].organization_id, filas[0].id, db);
}

// Lotes confirmados a los que ya no les queda ninguna fila por promover.
export async function claimLoteTerminado(db: Db): Promise<ImportBatch | null> {
  const filas = await db.$queryRaw<{ id: string; organization_id: string }[]>`
    SELECT b.id, b.organization_id FROM import_batches b
    WHERE b.status = 'RUNNING'::"ImportBatchStatus"
      AND NOT EXISTS (
        SELECT 1 FROM ingestion_events e
        WHERE e.organization_id = b.organization_id AND e.batch_id = b.id
          AND e.status IN ('STAGED'::"IngestionStatus", 'PENDING'::"IngestionStatus")
      )
    ORDER BY b.updated_at
    FOR UPDATE OF b SKIP LOCKED
    LIMIT 1
  `;
  if (filas.length === 0) return null;
  return findImportBatch(filas[0].organization_id, filas[0].id, db);
}

// ---------------------------------------------------------------------------
// Filas
// ---------------------------------------------------------------------------

export interface FilaAStaging {
  rowNumber: number;
  rawPayload: FilaCruda;
}

// Las filas del lote, en STAGED: el worker no las toma hasta que se confirme.
// Cada lote trae SUS filas (externalId = hash del lote y el número de fila),
// así que una re-subida del mismo archivo es un lote completo y no "todo
// duplicado" (§2.3: la garantía de no duplicar está en los vínculos). Todas
// en una transacción, como insertPendingEventsBatch (M-17).
export async function insertarFilasStaged(
  data: { organizationId: string; sourceId: string; batchId: string; filas: FilaAStaging[] },
  db: Db = prisma,
): Promise<number> {
  for (const fila of data.filas) {
    if (contieneNul(fila.rawPayload)) {
      throw new AppError(`La fila ${String(fila.rowNumber)} del archivo ${MENSAJE_NUL}`, 400);
    }
  }
  const ejecutar = async (tx: Db): Promise<number> => {
    let insertadas = 0;
    for (let i = 0; i < data.filas.length; i += FILAS_POR_TANDA) {
      const tanda = data.filas.slice(i, i + FILAS_POR_TANDA);
      const valores = tanda.map(
        (fila) => Prisma.sql`(
          ${data.organizationId}::uuid,
          ${data.sourceId}::uuid,
          ${data.batchId}::uuid,
          ${deriveExternalId({ lote: data.batchId, fila: fila.rowNumber })},
          ${JSON.stringify(fila.rawPayload)}::jsonb,
          'STAGED'::"IngestionStatus",
          ${fila.rowNumber}::int,
          now(), now()
        )`,
      );
      const r = await tx.$executeRaw`
        INSERT INTO ingestion_events (
          organization_id, source_id, batch_id, external_id, raw_payload, status,
          row_number, created_at, updated_at
        )
        VALUES ${Prisma.join(valores)}
      `;
      insertadas += r;
    }
    return insertadas;
  };
  return "$transaction" in db
    ? db.$transaction((tx) => ejecutar(tx), { timeout: IMPORT_BATCH_TRANSACTION_TIMEOUT_MS })
    : ejecutar(db);
}

export interface FilaDelLote {
  id: string;
  rowNumber: number | null;
  rawPayload: Prisma.JsonValue;
  decision: ImportRowDecision | null;
}

// Una tanda de filas del lote, en orden de archivo, para el análisis.
export function leerTandaDeFilas(
  organizationId: string,
  batchId: string,
  desdeRowNumber: number,
  cantidad: number,
  db: Db = prisma,
): Promise<FilaDelLote[]> {
  return db.ingestionEvent.findMany({
    where: { organizationId, batchId, rowNumber: { gt: desdeRowNumber } },
    orderBy: { rowNumber: "asc" },
    take: cantidad,
    select: { id: true, rowNumber: true, rawPayload: true, decision: true },
  });
}

// El plan de cada fila, en un UPDATE por tanda.
export async function guardarPlanes(
  organizationId: string,
  planes: { id: string; plan: unknown }[],
  db: Db,
): Promise<void> {
  for (let i = 0; i < planes.length; i += FILAS_POR_TANDA) {
    const tanda = planes.slice(i, i + FILAS_POR_TANDA);
    const valores = tanda.map((p) => Prisma.sql`(${p.id}::uuid, ${JSON.stringify(p.plan)}::jsonb)`);
    await db.$executeRaw`
      UPDATE ingestion_events AS e SET plan = v.plan, updated_at = now()
      FROM (VALUES ${Prisma.join(valores)}) AS v(id, plan)
      WHERE e.id = v.id AND e.organization_id = ${organizationId}::uuid
    `;
  }
}

const FILA_PUBLICA = {
  id: true,
  rowNumber: true,
  rawPayload: true,
  plan: true,
  decision: true,
  status: true,
  outcome: true,
  errorMessage: true,
  promotedEntityId: true,
  changes: true,
} satisfies Prisma.IngestionEventSelect;

export async function listarFilasDelLote(
  organizationId: string,
  batchId: string,
  filtro: { tipo?: string; page: number; pageSize: number },
  db: Db = prisma,
) {
  const where: Prisma.IngestionEventWhereInput = {
    organizationId,
    batchId,
    ...(filtro.tipo ? { plan: { path: ["tipo"], equals: filtro.tipo } } : {}),
  };
  const [data, total] = await Promise.all([
    db.ingestionEvent.findMany({
      where,
      orderBy: { rowNumber: "asc" },
      skip: (filtro.page - 1) * filtro.pageSize,
      take: filtro.pageSize,
      select: FILA_PUBLICA,
    }),
    db.ingestionEvent.count({ where }),
  ]);
  return { data, total };
}

// La decisión por fila (§8.2), solo mientras el lote no se confirmó.
export function decidirFilas(
  organizationId: string,
  batchId: string,
  rowIds: string[],
  decision: ImportRowDecision | null,
  db: Db = prisma,
): Promise<{ count: number }> {
  return db.ingestionEvent.updateMany({
    where: { organizationId, batchId, id: { in: rowIds }, status: IngestionStatus.STAGED },
    data: { decision },
  });
}

export function confirmarFilas(
  organizationId: string,
  batchId: string,
  db: Db,
): Promise<{ count: number }> {
  return db.ingestionEvent.updateMany({
    where: { organizationId, batchId, status: IngestionStatus.STAGED },
    data: { status: IngestionStatus.PENDING },
  });
}

export function borrarFilasSinConfirmar(
  organizationId: string,
  batchId: string,
  db: Db,
): Promise<{ count: number }> {
  return db.ingestionEvent.deleteMany({
    where: { organizationId, batchId, status: IngestionStatus.STAGED },
  });
}

// ---------------------------------------------------------------------------
// Purga de lo que nunca se confirmó (docs/importacion-de-datos.md §9.4 y
// docs/data-classification.md §5.1): las filas STAGED de un lote que lleva
// más de 7 días sin confirmar se borran y el lote pasa a CANCELLED, con el
// motivo. Es una copia de datos personales del cliente que nadie importó. La
// corre purge:ingestion-events, con la misma ejecución manual.
//
// Primero el lote (CAS sobre su estado): un lote que se está confirmando en
// ese momento ya no está en STAGED/READY y no se toca. Después, solo las
// filas STAGED de los lotes que se cancelaron acá.
// ---------------------------------------------------------------------------

export const DIAS_PARA_DESCARTAR_SIN_CONFIRMAR = 7;
export const MOTIVO_DESCARTADO_SIN_CONFIRMAR = `Se descartó sola: no se confirmó en ${String(DIAS_PARA_DESCARTAR_SIN_CONFIRMAR)} días`;

export function corteDeSinConfirmar(ahora: Date = new Date()): Date {
  const corte = new Date(ahora);
  corte.setUTCDate(corte.getUTCDate() - DIAS_PARA_DESCARTAR_SIN_CONFIRMAR);
  return corte;
}

function lotesSinConfirmarWhere(corte: Date, scope: { organizationId?: string }) {
  return {
    status: { in: ["STAGED", "READY"] as ImportBatchStatus[] },
    createdAt: { lt: corte },
    ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
  };
}

// Para --dry-run.
export async function contarSinConfirmarVencidos(
  corte: Date,
  scope: { organizationId?: string } = {},
  db: Db = prisma,
) {
  const lotes = await db.importBatch.findMany({
    where: lotesSinConfirmarWhere(corte, scope),
    select: { id: true },
  });
  const filas = await db.ingestionEvent.count({
    where: { batchId: { in: lotes.map((l) => l.id) }, status: IngestionStatus.STAGED },
  });
  return { lotes: lotes.length, filas };
}

export async function descartarSinConfirmarVencidos(
  corte: Date,
  scope: { organizationId?: string } = {},
): Promise<{ lotes: number; filas: number }> {
  const candidatos = await prisma.importBatch.findMany({
    where: lotesSinConfirmarWhere(corte, scope),
    select: { id: true, organizationId: true },
  });
  let lotes = 0;
  let filas = 0;
  for (const c of candidatos) {
    await prisma.$transaction(async (tx) => {
      const cas = await transicionarLote(
        c.organizationId,
        c.id,
        ["STAGED", "READY"],
        { status: "CANCELLED", errorMessage: MOTIVO_DESCARTADO_SIN_CONFIRMAR },
        tx,
      );
      if (cas.count === 0) return;
      lotes++;
      filas += (await borrarFilasSinConfirmar(c.organizationId, c.id, tx)).count;
    });
  }
  return { lotes, filas };
}

export interface ResumenDeFilas {
  total: number;
  porEstado: Record<string, number>;
  porPlan: Record<string, number>;
  porResultado: Record<string, number>;
}

// Los contadores en vivo: de qué estado está cada fila, qué dijo la vista
// previa y qué pasó al promover. Derivados con GROUP BY, como
// getResumenDeLote; al terminar el lote se materializan en counters.
export async function resumenDeFilas(
  organizationId: string,
  batchId: string,
  db: Db = prisma,
): Promise<ResumenDeFilas> {
  const filas = await db.$queryRaw<
    { status: string; tipo: string | null; outcome: string | null; n: bigint }[]
  >`
    SELECT status::text AS status, plan->>'tipo' AS tipo, outcome::text AS outcome, count(*) AS n
    FROM ingestion_events
    WHERE organization_id = ${organizationId}::uuid AND batch_id = ${batchId}::uuid
    GROUP BY 1, 2, 3
  `;
  const resumen: ResumenDeFilas = { total: 0, porEstado: {}, porPlan: {}, porResultado: {} };
  for (const f of filas) {
    const n = Number(f.n);
    resumen.total += n;
    resumen.porEstado[f.status] = (resumen.porEstado[f.status] ?? 0) + n;
    if (f.tipo) resumen.porPlan[f.tipo] = (resumen.porPlan[f.tipo] ?? 0) + n;
    if (f.outcome) resumen.porResultado[f.outcome] = (resumen.porResultado[f.outcome] ?? 0) + n;
  }
  return resumen;
}

// Las filas fallidas, para el CSV a corregir y volver a subir.
export function filasFallidas(organizationId: string, batchId: string, db: Db = prisma) {
  return db.ingestionEvent.findMany({
    where: { organizationId, batchId, status: IngestionStatus.FAILED },
    orderBy: { rowNumber: "asc" },
    select: { rowNumber: true, rawPayload: true, errorMessage: true },
  });
}

// Las filas que cambiaron un registro existente, para el CSV de cambios.
export function filasConCambios(organizationId: string, batchId: string, db: Db = prisma) {
  return db.ingestionEvent.findMany({
    where: { organizationId, batchId, outcome: "UPDATED" },
    orderBy: { rowNumber: "asc" },
    select: { rowNumber: true, promotedEntityId: true, changes: true },
  });
}

// La fila del asistente promovida. CAS sobre PENDING, como markEventProcessed.
export function marcarFilaPromovida(
  id: string,
  organizationId: string,
  resultado: {
    outcome: ImportRowOutcome;
    entityType: ImportEntityType;
    entityId: string | null;
    contactId: string | null;
    changes: unknown[];
    notas: PromotionNote[];
  },
  db: Db,
): Promise<{ count: number }> {
  return db.ingestionEvent.updateMany({
    where: { id, organizationId, status: IngestionStatus.PENDING },
    data: {
      status: IngestionStatus.PROCESSED,
      outcome: resultado.outcome,
      promotedEntityType: resultado.entityType,
      promotedEntityId: resultado.entityId,
      promotedContactId: resultado.contactId,
      changes:
        resultado.changes.length > 0 ? (resultado.changes as Prisma.InputJsonValue) : Prisma.DbNull,
      promotionNotes:
        resultado.notas.length > 0
          ? (resultado.notas as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
      errorMessage: null,
    },
  });
}

// ---------------------------------------------------------------------------
// Vínculos con el sistema de origen (§2.2)
// ---------------------------------------------------------------------------

// clave -> id del registro, para las claves que tienen vínculo.
export async function buscarVinculos(
  organizationId: string,
  sourceId: string,
  entityType: ImportEntityType,
  claves: readonly string[],
  db: Db = prisma,
): Promise<Map<string, string>> {
  if (claves.length === 0) return new Map();
  const filas = await db.externalRecordLink.findMany({
    where: { organizationId, sourceId, entityType, externalKey: { in: [...claves] } },
    select: { externalKey: true, entityId: true },
  });
  return new Map(filas.map((f) => [f.externalKey, f.entityId]));
}

// Crea o repunta el vínculo, con el ON CONFLICT del único (la garantía de §2.2
// está en la base). created_by_batch_id dice qué lote CREÓ el registro al que
// apunta, y es lo que deshace un lote (§8.3):
//   - vínculo nuevo: el que se pasa (el lote si lo creó, null si solo vinculó);
//   - vínculo existente al MISMO registro (una re-subida): se conserva el que
//     tenía. Sin esto, reimportar dejaría al lote original sin poder deshacer
//     lo que creó;
//   - vínculo existente a OTRO registro (el anterior se borró): se reemplaza.
export function guardarVinculo(
  data: {
    organizationId: string;
    sourceId: string;
    entityType: ImportEntityType;
    externalKey: string;
    entityId: string;
    createdByBatchId: string | null;
  },
  db: Db,
): Promise<number> {
  return db.$executeRaw`
    INSERT INTO external_record_links (
      organization_id, source_id, entity_type, external_key, entity_id,
      created_by_batch_id, created_at, updated_at
    ) VALUES (
      ${data.organizationId}::uuid, ${data.sourceId}::uuid,
      ${data.entityType}::"ImportEntityType", ${data.externalKey}, ${data.entityId}::uuid,
      ${data.createdByBatchId}::uuid, now(), now()
    )
    ON CONFLICT (organization_id, source_id, entity_type, external_key) DO UPDATE SET
      created_by_batch_id = CASE
        WHEN external_record_links.entity_id = excluded.entity_id
          THEN external_record_links.created_by_batch_id
        ELSE excluded.created_by_batch_id
      END,
      entity_id = excluded.entity_id,
      updated_at = now()
  `;
}
