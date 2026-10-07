import type { ImportBatch, ImportSync, Prisma } from "@prisma/client";
import { logger } from "../lib/logger";
import { prisma, type Db } from "../lib/prisma";
import {
  crearSync,
  registrarCorridaFallida,
  registrarCorridaOk,
  soltarSync,
} from "../repositories/importSync.repository";
import { AppError } from "../utils/AppError";
import { describirError } from "../utils/backoff";
import type { AjustesDeImportacion } from "../utils/importacionMapeo";
import {
  LIMITES_DEL_ASISTENTE,
  parsearArchivo,
  type LecturaDelArchivo,
} from "../utils/spreadsheet";
import { crearLoteConFilas } from "./importacionLote";
import { leerPlanilla, type PlanillaDeSheets } from "./importacionSheets";
import { updateVehicleEnTransaccion } from "./vehicle.service";

// ---------------------------------------------------------------------------
// LA SINCRONIZACIÓN DEL STOCK DESDE GOOGLE SHEETS (docs/importacion-de-datos.md
// §7, decisión 15).
//
// Se crea al confirmar un lote de stock que vino de un link de Sheets, con el
// mismo mapeo y ajustes. Cada corrida (correrSincronizacion, desde
// workers/importSyncWorker.ts) baja la planilla y crea un lote con
// originKind = SYNC, ya configurado: el worker de lotes lo analiza y lo
// CONFIRMA SOLO (sin vista previa), el de ingesta promueve sus filas, y al
// terminar se miran las unidades que desaparecieron (marcarFaltantes).
//
// Reglas:
//   - la planilla manda sobre los campos mapeados: la política es siempre
//     OVERWRITE, sea cual sea la del lote que la creó;
//   - nunca borra, y nunca pisa el estado que maneja el CRM (eso ya lo hace el
//     plan del vehículo: MOTIVO_ESTADO_DEL_CRM);
//   - una corrida que no puede bajar o leer la planilla es una falla; a la
//     tercera seguida se pausa sola (importSync.repository.ts).
// ---------------------------------------------------------------------------

export const INTERVALO_MINIMO_HORAS = 1;
export const INTERVALO_MAXIMO_HORAS = 168;
// El lock de una corrida: bajar y escribir el staging, con holgura (§7).
export const LOCK_DE_CORRIDA_MS = 15 * 60_000;

export interface ConfigDeSync {
  archivo: { encabezados: string[]; lectura: LecturaDelArchivo };
  ajustes: AjustesDeImportacion;
}

export interface PedidoDeSincronizar {
  intervalHours: number;
  marcarFaltantes: boolean;
}

// Al confirmar el lote (importacion.service.ts confirmarImportacion), dentro
// de su transacción. El lote queda como la primera corrida de la
// sincronización.
export async function crearSincronizacionDesdeLote(
  lote: ImportBatch,
  pedido: PedidoDeSincronizar,
  tx: Db,
): Promise<ImportSync> {
  const config = lote.config as {
    archivo?: { encabezados: string[]; lectura: LecturaDelArchivo; planilla?: PlanillaDeSheets };
    ajustes?: AjustesDeImportacion | null;
  } | null;
  const planilla = config?.archivo?.planilla;
  if (lote.entityType !== "VEHICLE" || lote.originKind !== "GOOGLE_SHEETS_LINK" || !planilla) {
    throw new AppError(
      "Solo se sincroniza un lote de stock que vino de un link de Google Sheets",
      400,
    );
  }
  if (!config.ajustes || !config.archivo) {
    throw new AppError("La importación no tiene el mapeo configurado", 409);
  }
  const syncConfig: ConfigDeSync = {
    archivo: { encabezados: config.archivo.encabezados, lectura: config.archivo.lectura },
    ajustes: { ...config.ajustes, duplicados: "OVERWRITE" },
  };
  const sync = await crearSync(
    {
      organizationId: lote.organizationId,
      sourceId: lote.sourceId,
      createdByUserId: lote.createdByUserId,
      sheetId: planilla.sheetId,
      sheetGid: planilla.gid,
      config: syncConfig as unknown as Prisma.InputJsonValue,
      intervalHours: pedido.intervalHours,
      markMissingUnavailable: pedido.marcarFaltantes,
      nextRunAt: new Date(Date.now() + pedido.intervalHours * 3_600_000),
    },
    tx,
  );
  await tx.importBatch.updateMany({
    where: { id: lote.id, organizationId: lote.organizationId },
    data: { syncId: sync.id },
  });
  return sync;
}

const EN_CURSO = ["STAGED", "ANALYZING", "READY", "RUNNING"] as const;

export type ResultadoDeCorrida = "LOTE_CREADO" | "FALLIDA" | "ANTERIOR_EN_CURSO";

// Una corrida de una sincronización ya reclamada (reclamarSync). La descarga
// va fuera de toda transacción; el lote y sus filas, en una.
export async function correrSincronizacion(sync: ImportSync): Promise<ResultadoDeCorrida> {
  const org = sync.organizationId;
  const anterior = await prisma.importBatch.count({
    where: { organizationId: org, syncId: sync.id, status: { in: [...EN_CURSO] } },
  });
  if (anterior > 0) {
    // No es una falla: la corrida anterior todavía no terminó. Se suelta el
    // lock y toca de nuevo en el próximo intervalo.
    await soltarSync(sync.id, org);
    return "ANTERIOR_EN_CURSO";
  }
  const config = sync.config as unknown as ConfigDeSync;
  try {
    const contenido = await leerPlanilla({ sheetId: sync.sheetId, gid: sync.sheetGid });
    const parseado = await parsearArchivo(contenido, "csv", {
      separador: ",",
      codificacion: "utf-8",
      limites: LIMITES_DEL_ASISTENTE,
    });
    // Una columna mapeada que ya no está es una falla, no un "se ignora": si
    // es la que identifica a la unidad (código, patente, VIN), la corrida
    // crearía duplicados de todo el stock.
    const encabezados = new Set(parseado.encabezados);
    const faltan = Object.keys(config.ajustes.mapeo).filter((h) => !encabezados.has(h));
    if (faltan.length > 0) {
      throw new AppError(`La planilla cambió: faltan las columnas ${faltan.join(", ")}`, 400);
    }
    await prisma.$transaction(async (tx) =>
      crearLoteConFilas(
        {
          organizationId: org,
          sourceId: sync.sourceId,
          entityType: "VEHICLE",
          originKind: "SYNC",
          nombre: "Google Sheets",
          contenido,
          parseado,
          config: {
            archivo: {
              nombre: "Google Sheets",
              encabezados: parseado.encabezados,
              lectura: parseado.lectura,
              planilla: { sheetId: sync.sheetId, gid: sync.sheetGid },
            },
            ajustes: config.ajustes,
          } as unknown as Prisma.InputJsonValue,
          createdByUserId: sync.createdByUserId,
          syncId: sync.id,
          status: "ANALYZING",
        },
        tx,
      ),
    );
    await registrarCorridaOk(sync.id, org);
    return "LOTE_CREADO";
  } catch (err) {
    const motivo = err instanceof Error ? err.message : describirError(err);
    logger.warn(
      { syncId: sync.id, organizationId: org, motivo },
      "Falló una sincronización de stock",
    );
    await registrarCorridaFallida(sync.id, org, motivo);
    return "FALLIDA";
  }
}

export interface ResumenDeFaltantes {
  faltantes: number;
  marcadasNoDisponibles: number;
  // Con filas fallidas no se marca ninguna: una fila que falló puede ser una
  // unidad que sigue en la planilla.
  sinMarcarPorFallidas: boolean;
}

// Al terminar una corrida (workers/importBatchWorker.ts, en la transacción que
// cierra el lote): las unidades que este origen trajo alguna vez y que la
// planilla ya no tiene. Se informan siempre; se pasan a No disponible solo con
// mark_missing_unavailable, solo si están Disponibles y sin una oportunidad
// que las retenga. Nunca se borran.
export async function marcarFaltantes(
  lote: ImportBatch,
  db: Db,
): Promise<ResumenDeFaltantes | null> {
  if (!lote.syncId) return null;
  const sync = await db.importSync.findFirst({
    where: { id: lote.syncId, organizationId: lote.organizationId },
  });
  if (!sync) return null;
  const faltantes = await db.$queryRaw<{ id: string; disponible: boolean }[]>`
    SELECT DISTINCT v.id,
      (v.status = 'AVAILABLE'::"VehicleStatus" AND NOT EXISTS (
        SELECT 1 FROM opportunities o
        WHERE o.organization_id = v.organization_id AND o.vehicle_id = v.id
          AND o.deleted_at IS NULL AND o.status IN ('OPEN', 'WON')
      )) AS disponible
    FROM external_record_links l
    JOIN vehicles v ON v.organization_id = l.organization_id AND v.id = l.entity_id
    WHERE l.organization_id = ${lote.organizationId}::uuid
      AND l.source_id = ${lote.sourceId}::uuid
      AND l.entity_type = 'VEHICLE'::"ImportEntityType"
      AND v.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM ingestion_events e
        WHERE e.organization_id = l.organization_id AND e.batch_id = ${lote.id}::uuid
          AND (e.promoted_entity_id = v.id OR e.plan->>'existenteId' = v.id::text)
      )
  `;
  // Fallidas al promover, o que la vista previa ya marcó como FAIL.
  const [{ fallidas }] = await db.$queryRaw<{ fallidas: number }[]>`
    SELECT count(*)::int AS fallidas FROM ingestion_events
    WHERE organization_id = ${lote.organizationId}::uuid AND batch_id = ${lote.id}::uuid
      AND (status IN ('FAILED', 'DEAD_LETTER') OR plan->>'tipo' = 'FAIL')
  `;
  const resumen: ResumenDeFaltantes = {
    faltantes: faltantes.length,
    marcadasNoDisponibles: 0,
    sinMarcarPorFallidas: false,
  };
  if (!sync.markMissingUnavailable || faltantes.length === 0) return resumen;
  if (fallidas > 0) {
    resumen.sinMarcarPorFallidas = true;
    return resumen;
  }
  const responsable = (sync.config as unknown as ConfigDeSync).ajustes.stock?.responsableId;
  if (!responsable) return resumen;
  for (const f of faltantes.filter((x) => x.disponible)) {
    await updateVehicleEnTransaccion(
      lote.organizationId,
      responsable,
      f.id,
      { status: "UNAVAILABLE" },
      db,
    );
    resumen.marcadasNoDisponibles++;
  }
  return resumen;
}
