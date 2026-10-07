import { createHash } from "node:crypto";
import type { ImportBatchStatus, ImportEntityType, ImportOriginKind, Prisma } from "@prisma/client";
import type { Db } from "../lib/prisma";
import { createImportBatch, insertarFilasStaged } from "../repositories/importacion.repository";
import type { ArchivoParseado } from "../utils/spreadsheet";

// ---------------------------------------------------------------------------
// Un lote con sus filas en STAGED, dentro de la transacción de quien llama. Lo
// comparten el asistente (un archivo o un link de Sheets,
// importacion.service.ts) y cada corrida de una sincronización
// (importacionSync.service.ts), que entra ya configurada (ANALYZING).
// ---------------------------------------------------------------------------

export async function crearLoteConFilas(
  data: {
    organizationId: string;
    sourceId: string;
    entityType: ImportEntityType;
    originKind: ImportOriginKind;
    nombre: string;
    contenido: Buffer;
    parseado: ArchivoParseado;
    config: Prisma.InputJsonValue;
    createdByUserId: string;
    syncId?: string;
    status?: ImportBatchStatus;
  },
  tx: Db,
) {
  const creado = await createImportBatch(
    {
      organizationId: data.organizationId,
      sourceId: data.sourceId,
      entityType: data.entityType,
      originKind: data.originKind,
      fileName: data.nombre.slice(0, 255),
      fileSha256: createHash("sha256").update(data.contenido).digest("hex"),
      fileBytes: data.contenido.length,
      rowCount: data.parseado.filas.length,
      config: data.config,
      createdByUserId: data.createdByUserId,
      ...(data.syncId ? { syncId: data.syncId } : {}),
      ...(data.status ? { status: data.status } : {}),
    },
    tx,
  );
  await insertarFilasStaged(
    {
      organizationId: data.organizationId,
      sourceId: data.sourceId,
      batchId: creado.id,
      filas: data.parseado.filas.map((rawPayload, i) => ({ rowNumber: i + 1, rawPayload })),
    },
    tx,
  );
  return creado;
}
