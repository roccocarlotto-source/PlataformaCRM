import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger";
import {
  getResumenDeLote,
  insertPendingEventsBatch,
  type ResumenDeLote,
} from "../repositories/ingestionEvent.repository";
import { findSourceById } from "../repositories/source.repository";
import { AppError } from "../utils/AppError";
import {
  filasParaStaging,
  formatoDesdeNombre,
  parsearArchivo,
} from "../utils/spreadsheet";

// ---------------------------------------------------------------------------
// Importación de Excel/CSV (ítem 5 de docs/ingestion-architecture.md §6).
//
// §6.5: "reusa staging y promoción; lo nuevo es parseo, mapeo de columnas y
// volumen". Este service es la mitad de "parseo y volumen": deja las filas en
// staging y devuelve el identificador de lote. La promoción no la toca — sigue
// siendo del worker, sin ningún cambio.
//
// EL PARSEO Y LA ESCRITURA SÍ VIVEN DENTRO DEL REQUEST, y no contradice §5. Lo
// que §5 prohíbe es procesar el archivo dentro del request: "Un Excel de 5.000
// filas no se procesa dentro de un request HTTP... La ruta de ingesta hace lo
// mínimo: valida, escribe las filas en IngestionEvent con status PENDING,
// responde 202". Eso es exactamente esto. Lo caro —promover cada fila, con su
// upsert y su política de merge— es lo que queda del otro lado.
// ---------------------------------------------------------------------------

export interface ResultadoImportacion {
  batchId: string;
  // Columnas detectadas en el archivo. Se devuelven porque son el dato que
  // permite diagnosticar un mapeo que no matchea: sin ellas, un ADMIN cuyas
  // 5.000 filas fallaron no tiene forma de saber si el problema es una tilde en
  // un encabezado.
  encabezados: string[];
  filasLeidas: number;
  // Filas que crearon un evento nuevo bajo este batchId.
  insertados: number;
  // Filas cuyo (sourceId, externalId) ya existía: el archivo, o parte de él, ya
  // se había subido antes. NO quedan asociadas a este lote — pertenecen al que
  // las trajo — así que este número solo se ve acá, en la respuesta de la
  // subida. Ver la duda abierta sobre esto en el reporte del ítem.
  duplicados: number;
}

export async function importarArchivo(
  organizationId: string,
  input: { sourceId: string; nombreArchivo: string; contenido: Buffer },
): Promise<ResultadoImportacion> {
  // findSourceById ya filtra organizationId y deletedAt: null, así que una
  // fuente de otra organización o retirada da 404 — para la API no existe.
  const source = await findSourceById(input.sourceId, organizationId);

  if (!source) {
    throw new AppError("Fuente no encontrada", 404);
  }

  // Solo FILE_IMPORT. Subir un archivo contra una fuente WEBHOOK mezclaría en
  // la misma Source eventos con dos contratos de payload distintos —el fijo del
  // webhook y el de los encabezados del archivo— y la promoción no tendría
  // forma de saber cuál aplicar a cada evento: la decisión se toma por `type`,
  // que es de la Source, no del evento.
  if (source.type !== "FILE_IMPORT") {
    throw new AppError(
      "Solo se pueden importar archivos a una fuente de tipo FILE_IMPORT",
      400,
    );
  }

  // isActive SÍ se respeta acá, igual que en el webhook: pausar una integración
  // tiene que pausar todas sus puertas de entrada, no solo la automática.
  if (!source.isActive) {
    throw new AppError("La fuente está pausada", 400);
  }

  const formato = formatoDesdeNombre(input.nombreArchivo);
  const parseado = await parsearArchivo(input.contenido, formato);

  // LAS FILAS SE ESCRIBEN CON SUS ENCABEZADOS ORIGINALES. fieldMapping no se
  // toca en todo este archivo, y es el invariante central del ítem: lo que se
  // guarda es lo que vino, para que un mapeo mal configurado se pueda corregir
  // y volver a correr (§1). La traducción vive en promotion.service.ts.
  const filas = filasParaStaging(parseado.filas);
  const batchId = randomUUID();

  const { insertados, duplicados } = await insertPendingEventsBatch({
    organizationId,
    sourceId: input.sourceId,
    batchId,
    filas,
  });

  logger.info(
    {
      batchId,
      organizationId,
      sourceId: input.sourceId,
      formato,
      filasLeidas: filas.length,
      insertados,
      duplicados,
    },
    "Importación de archivo aceptada",
  );

  return {
    batchId,
    encabezados: parseado.encabezados,
    filasLeidas: filas.length,
    insertados,
    duplicados,
  };
}

export async function obtenerResumenDeLote(
  organizationId: string,
  batchId: string,
): Promise<ResumenDeLote> {
  const resumen = await getResumenDeLote(organizationId, batchId);

  if (!resumen) {
    throw new AppError("Lote no encontrado", 404);
  }

  return resumen;
}
