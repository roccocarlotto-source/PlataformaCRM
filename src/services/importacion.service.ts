import { Prisma, SourceType, type ImportBatch, type ImportRowDecision } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { findActiveContactCustomFieldDefinitions } from "../repositories/contactCustomFieldDefinition.repository";
import {
  borrarFilasSinConfirmar,
  confirmarFilas,
  decidirFilas,
  filasConCambios,
  filasFallidas,
  findImportBatch,
  listarFilasDelLote,
  listImportBatches,
  resumenDeFilas,
  transicionarLote,
} from "../repositories/importacion.repository";
import { IMPORT_BATCH_TRANSACTION_TIMEOUT_MS } from "../repositories/ingestionEvent.repository";
import { fotosConProblemas, resumenDeFotos } from "../repositories/vehiclePhotoImport.repository";
import { findOrganizationById } from "../repositories/organization.repository";
import { createSource, findSourceById } from "../repositories/source.repository";
import { crearAjustesSchema, type TIPOS_IMPORTABLES } from "../schemas/importacion.schema";
import { AppError } from "../utils/AppError";
import { armarCsv } from "../utils/csvDeSalida";
import {
  claveDeCampoPersonalizado,
  sugerirMapeo,
  type AjustesDeImportacion,
} from "../utils/importacionMapeo";
import {
  LIMITES_DEL_ASISTENTE,
  formatoDesdeNombre,
  parsearArchivo,
  type Codificacion,
  type FilaCruda,
  type ArchivoParseado,
  type LecturaDelArchivo,
  type Separador,
  type ValorDeCelda,
} from "../utils/spreadsheet";
import { parseOrThrow } from "../utils/validation";
import { aDefinicionDeCampo } from "./contactCustomFieldDefinition.service";
import { crearLoteConFilas } from "./importacionLote";
import { crearSincronizacionDesdeLote, type PedidoDeSincronizar } from "./importacionSync.service";
import {
  borrarSync,
  findSync,
  listarSyncs,
  pausarSync,
  reanudarSync,
} from "../repositories/importSync.repository";
import { leerPlanilla, parsearLinkDeSheets, type PlanillaDeSheets } from "./importacionSheets";

// ---------------------------------------------------------------------------
// El asistente de importación de Plataforma → Importar datos
// (docs/importacion-de-datos.md §8), del lado HTTP. Solo platform admin, con
// la organización del PATH: nunca la del JWT, que es la del admin.
//
// Los pasos, como transiciones del lote:
//   subir      -> STAGED   archivo leído, filas en staging, mapeo sugerido
//   configurar -> ANALYZING mapeo y ajustes; el worker calcula la vista previa
//              -> READY    (workers/importBatchWorker.ts)
//   decidir               por fila, mientras está READY
//   confirmar  -> RUNNING  las filas pasan a PENDING; las promueve el worker
//              -> DONE     de ingesta, y el de lotes cierra el lote al final
//   cancelar   -> CANCELLED antes de confirmar; las filas se borran
// ---------------------------------------------------------------------------

type TipoImportable = (typeof TIPOS_IMPORTABLES)[number];

const FILAS_DE_MUESTRA = 5;

export interface ConfigDelLote {
  archivo: {
    nombre: string | null;
    encabezados: string[];
    lectura: LecturaDelArchivo;
    // Solo si vino de un link de Google Sheets: para la sincronización.
    planilla?: PlanillaDeSheets;
  };
  ajustes: AjustesDeImportacion | null;
}

function configDe(lote: ImportBatch): ConfigDelLote {
  return lote.config as unknown as ConfigDelLote;
}

async function exigirOrganizacion(organizationId: string): Promise<void> {
  if (!(await findOrganizationById(organizationId))) {
    throw new AppError("Organización no encontrada", 404);
  }
}

async function exigirLote(organizationId: string, batchId: string): Promise<ImportBatch> {
  const lote = await findImportBatch(organizationId, batchId);
  if (!lote) throw new AppError("Importación no encontrada", 404);
  return lote;
}

async function definicionesDe(organizationId: string) {
  return (await findActiveContactCustomFieldDefinitions(organizationId)).map(aDefinicionDeCampo);
}

// ---------------------------------------------------------------------------
// Subir
// ---------------------------------------------------------------------------

export interface SubirImportacion {
  entityType: TipoImportable;
  sourceId?: string;
  sourceName?: string;
  separador?: Separador;
  codificacion?: Codificacion;
  hoja?: string;
}

export async function subirImportacion(
  organizationId: string,
  userId: string,
  pedido: SubirImportacion,
  archivo: { nombre: string; contenido: Buffer },
) {
  await exigirOrganizacion(organizationId);

  // Primero el archivo: un archivo ilegible no tiene que dejar una fuente
  // nueva creada.
  const formato = formatoDesdeNombre(archivo.nombre);
  const parseado = await parsearArchivo(archivo.contenido, formato, {
    separador: pedido.separador,
    codificacion: pedido.codificacion,
    hoja: pedido.hoja,
    limites: LIMITES_DEL_ASISTENTE,
  });

  await exigirFuenteUsable(organizationId, pedido.sourceId);

  return crearLote(organizationId, userId, pedido, parseado, {
    nombre: archivo.nombre,
    contenido: archivo.contenido,
    originKind: "FILE",
  });
}

// Google Sheets por link (§4.2): solo stock (decisión 3), leído como CSV.
export async function subirLinkDeSheets(
  organizationId: string,
  userId: string,
  pedido: { entityType: TipoImportable; sourceId?: string; sourceName?: string; sheetUrl: string },
) {
  await exigirOrganizacion(organizationId);
  if (pedido.entityType !== "VEHICLE") {
    throw new AppError(
      "El link de Google Sheets es solo para el stock: contactos, empresas e historial se suben como archivo",
      400,
    );
  }
  const planilla = parsearLinkDeSheets(pedido.sheetUrl);
  const contenido = await leerPlanilla(planilla);
  // La exportación de Google es CSV con coma y UTF-8: se lee así, sin adivinar.
  const parseado = await parsearArchivo(contenido, "csv", {
    separador: ",",
    codificacion: "utf-8",
    limites: LIMITES_DEL_ASISTENTE,
  });
  await exigirFuenteUsable(organizationId, pedido.sourceId);
  return crearLote(organizationId, userId, pedido, parseado, {
    nombre: "Google Sheets",
    contenido,
    originKind: "GOOGLE_SHEETS_LINK",
    planilla,
  });
}

async function exigirFuenteUsable(organizationId: string, sourceId: string | undefined) {
  if (sourceId === undefined) return;
  const fuente = await findSourceById(sourceId, organizationId);
  if (!fuente) throw new AppError("Sistema de origen no encontrado", 404);
  if (fuente.type !== SourceType.FILE_IMPORT) {
    throw new AppError(
      "El sistema de origen tiene que ser una fuente de archivos (FILE_IMPORT)",
      400,
    );
  }
  if (!fuente.isActive) throw new AppError("El sistema de origen está pausado", 400);
}

// El lote y sus filas en STAGED, en una transacción (con la fuente nueva si
// hace falta). Lo comparten el archivo y el link de Sheets.
async function crearLote(
  organizationId: string,
  userId: string,
  pedido: { entityType: TipoImportable; sourceId?: string; sourceName?: string },
  parseado: ArchivoParseado,
  origen: {
    nombre: string;
    contenido: Buffer;
    originKind: "FILE" | "GOOGLE_SHEETS_LINK";
    planilla?: PlanillaDeSheets;
  },
) {
  const config: ConfigDelLote = {
    archivo: {
      nombre: origen.nombre,
      encabezados: parseado.encabezados,
      lectura: parseado.lectura,
      ...(origen.planilla ? { planilla: origen.planilla } : {}),
    },
    ajustes: null,
  };

  const lote = await prisma.$transaction(
    async (tx) => {
      const sourceId =
        pedido.sourceId ??
        (
          await createSource(
            {
              organizationId,
              name: pedido.sourceName as string,
              type: SourceType.FILE_IMPORT,
            },
            tx,
          )
        ).id;
      return crearLoteConFilas(
        {
          organizationId,
          sourceId,
          entityType: pedido.entityType,
          originKind: origen.originKind,
          nombre: origen.nombre,
          contenido: origen.contenido,
          parseado,
          config: config as unknown as Prisma.InputJsonValue,
          createdByUserId: userId,
        },
        tx,
      );
    },
    { timeout: IMPORT_BATCH_TRANSACTION_TIMEOUT_MS },
  );

  const definiciones = pedido.entityType === "CONTACT" ? await definicionesDe(organizationId) : [];
  return {
    lote,
    encabezados: parseado.encabezados,
    lectura: parseado.lectura,
    muestra: parseado.filas.slice(0, FILAS_DE_MUESTRA),
    mapeoSugerido: sugerirMapeo(pedido.entityType, parseado.encabezados, definiciones),
  };
}

// ---------------------------------------------------------------------------
// Configurar
// ---------------------------------------------------------------------------

export async function configurarImportacion(
  organizationId: string,
  batchId: string,
  cuerpo: unknown,
) {
  const lote = await exigirLote(organizationId, batchId);
  const ajustes = parseOrThrow(crearAjustesSchema(lote.entityType), cuerpo);
  if (ajustes.historial) {
    // El autor del historial tiene que ser un usuario activo de ESTA
    // organización (decisión 5): authorId es una FK compuesta.
    const autor = await prisma.user.findFirst({
      where: { id: ajustes.historial.autorId, organizationId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!autor)
      throw new AppError("El autor elegido no es un usuario activo de la organización", 400);
  }
  if (ajustes.stock) {
    // La sucursal de las unidades nuevas y quién firma los cambios de ficha,
    // de ESTA organización (las dos son FKs compuestas).
    const [sucursal, responsable] = await Promise.all([
      prisma.branch.findFirst({
        where: { id: ajustes.stock.branchId, organizationId, deletedAt: null },
        select: { id: true },
      }),
      prisma.user.findFirst({
        where: { id: ajustes.stock.responsableId, organizationId, deletedAt: null, isActive: true },
        select: { id: true },
      }),
    ]);
    if (!sucursal) throw new AppError("La sucursal elegida no es de la organización", 400);
    if (!responsable) {
      throw new AppError("El responsable elegido no es un usuario activo de la organización", 400);
    }
  }
  const config = configDe(lote);

  const encabezados = new Set(config.archivo.encabezados);
  const faltan = Object.keys(ajustes.mapeo).filter((h) => !encabezados.has(h));
  if (faltan.length > 0) {
    throw new AppError(`Estas columnas no están en el archivo: ${faltan.join(", ")}`, 400);
  }
  const keys = Object.values(ajustes.mapeo).flatMap((d) => {
    const key = claveDeCampoPersonalizado(d);
    return key === null ? [] : [key];
  });
  if (keys.length > 0) {
    const existentes = new Set((await definicionesDe(organizationId)).map((d) => d.key));
    const desconocidos = keys.filter((k) => !existentes.has(k));
    if (desconocidos.length > 0) {
      throw new AppError(`Estos campos personalizados no existen: ${desconocidos.join(", ")}`, 400);
    }
  }

  const nueva: ConfigDelLote = { ...config, ajustes };
  const r = await transicionarLote(organizationId, batchId, ["STAGED", "READY"], {
    config: nueva as unknown as Prisma.InputJsonValue,
    status: "ANALYZING",
    errorMessage: null,
    counters: Prisma.DbNull,
  });
  if (r.count === 0) {
    throw new AppError(
      "La importación ya se confirmó o se canceló: no se puede cambiar el mapeo",
      409,
    );
  }
  return exigirLote(organizationId, batchId);
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export async function obtenerImportacion(organizationId: string, batchId: string) {
  const lote = await exigirLote(organizationId, batchId);
  return {
    lote,
    resumen: await resumenDeFilas(organizationId, batchId),
    // Solo en el stock: las fotos encoladas por estado (PENDING, DONE, FAILED,
    // SKIPPED). Siguen bajándose después de que el lote terminó.
    fotos: lote.entityType === "VEHICLE" ? await resumenDeFotos(organizationId, batchId) : null,
  };
}

// Las fotos que no se bajaron, con la unidad y el motivo (§8.1, paso 8).
export async function csvDeFotos(organizationId: string, batchId: string): Promise<Buffer> {
  await exigirLote(organizationId, batchId);
  const filas = await fotosConProblemas(organizationId, batchId);
  return armarCsv(
    ["Unidad", "Vehículo", "Link", "Estado", "Motivo"],
    filas.map((f) => [
      f.vehicle.internalCode,
      `${f.vehicle.make} ${f.vehicle.model}`,
      f.url,
      f.status === "FAILED" ? "No se pudo bajar" : "Omitida",
      f.error,
    ]),
  );
}

export function listarImportaciones(
  organizationId: string,
  paginado: { page: number; pageSize: number },
) {
  return listImportBatches(organizationId, paginado);
}

export async function listarFilas(
  organizationId: string,
  batchId: string,
  filtro: { tipo?: string; page: number; pageSize: number },
) {
  await exigirLote(organizationId, batchId);
  return listarFilasDelLote(organizationId, batchId, filtro);
}

// ---------------------------------------------------------------------------
// Decidir, confirmar, cancelar
// ---------------------------------------------------------------------------

export async function decidirFilasDeImportacion(
  organizationId: string,
  batchId: string,
  rowIds: string[],
  decision: ImportRowDecision | null,
) {
  const lote = await exigirLote(organizationId, batchId);
  if (lote.status !== "READY") {
    throw new AppError(
      "Solo se decide fila por fila con la vista previa lista y sin confirmar",
      409,
    );
  }
  const r = await decidirFilas(organizationId, batchId, rowIds, decision);
  return { actualizadas: r.count };
}

// El orden de dependencias (§5.5): el historial busca contactos, así que no se
// confirma mientras un lote de contactos de la misma organización se está
// importando (las notas no encontrarían a los que todavía no se crearon).
const DEPENDE_DE: Partial<Record<string, string[]>> = {
  ACTIVITY: ["CONTACT"],
  CONTACT: ["COMPANY", "VEHICLE"],
};

export async function confirmarImportacion(
  organizationId: string,
  batchId: string,
  sincronizar?: PedidoDeSincronizar,
) {
  const lote = await exigirLote(organizationId, batchId);
  const previos = DEPENDE_DE[lote.entityType] ?? [];
  if (previos.length > 0) {
    const corriendo = await prisma.importBatch.count({
      where: {
        organizationId,
        status: "RUNNING",
        entityType: { in: previos as ("CONTACT" | "COMPANY")[] },
      },
    });
    if (corriendo > 0) {
      throw new AppError(
        "Hay una importación de la que esta depende todavía en curso: esperá a que termine y volvé a analizar",
        409,
      );
    }
  }
  return prisma.$transaction(async (tx) => {
    const r = await transicionarLote(
      organizationId,
      batchId,
      ["READY"],
      { status: "RUNNING", confirmedAt: new Date() },
      tx,
    );
    if (r.count === 0) {
      throw new AppError("Solo se confirma una importación con la vista previa lista", 409);
    }
    const filas = await confirmarFilas(organizationId, batchId, tx);
    // "Mantener sincronizado" (§7): solo un lote de stock de Google Sheets.
    const sync = sincronizar ? await crearSincronizacionDesdeLote(lote, sincronizar, tx) : null;
    return { confirmadas: filas.count, syncId: sync?.id ?? null };
  });
}

export async function cancelarImportacion(organizationId: string, batchId: string) {
  await exigirLote(organizationId, batchId);
  return prisma.$transaction(async (tx) => {
    const r = await transicionarLote(
      organizationId,
      batchId,
      ["STAGED", "ANALYZING", "READY"],
      { status: "CANCELLED" },
      tx,
    );
    if (r.count === 0) {
      throw new AppError("La importación ya se confirmó: no se puede cancelar", 409);
    }
    const borradas = await borrarFilasSinConfirmar(organizationId, batchId, tx);
    return { borradas: borradas.count };
  });
}

// ---------------------------------------------------------------------------
// Informe: los CSV (§8.1, paso 8)
// ---------------------------------------------------------------------------

function celdaDe(valor: unknown): ValorDeCelda {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "string" || typeof valor === "number" || typeof valor === "boolean") {
    return valor;
  }
  return Array.isArray(valor) ? valor.map(String).join(", ") : JSON.stringify(valor);
}

// Las filas fallidas con sus columnas ORIGINALES, en el orden del archivo, y
// una columna "Motivo" al final: se corrige y se vuelve a subir.
export async function csvDeFallidas(organizationId: string, batchId: string): Promise<Buffer> {
  const lote = await exigirLote(organizationId, batchId);
  const encabezados = configDe(lote).archivo.encabezados;
  const filas = await filasFallidas(organizationId, batchId);
  return armarCsv(
    [...encabezados, "Motivo"],
    filas.map((f) => {
      const datos = (f.rawPayload ?? {}) as FilaCruda;
      return [...encabezados.map((h) => celdaDe(datos[h])), f.errorMessage];
    }),
  );
}

// Lo que la importación cambió en registros existentes, con el antes y el
// después (§8.3): lo actualizado no se deshace, se corrige a mano con esto.
export async function csvDeCambios(organizationId: string, batchId: string): Promise<Buffer> {
  await exigirLote(organizationId, batchId);
  const filas = await filasConCambios(organizationId, batchId);
  const lineas: ValorDeCelda[][] = [];
  for (const f of filas) {
    const cambios = Array.isArray(f.changes)
      ? (f.changes as { campo: string; antes: unknown; despues: unknown }[])
      : [];
    for (const c of cambios) {
      lineas.push([f.rowNumber, f.promotedEntityId, c.campo, celdaDe(c.antes), celdaDe(c.despues)]);
    }
  }
  return armarCsv(["Fila", "Registro", "Campo", "Antes", "Después"], lineas);
}

// ---------------------------------------------------------------------------
// Opciones para el asistente: lo de la organización que el admin necesita
// elegir y que no puede leer por las rutas del tenant (no es miembro).
// ---------------------------------------------------------------------------

export async function opcionesDeImportacion(organizationId: string) {
  await exigirOrganizacion(organizationId);
  const [usuarios, fuentes, campos, sucursales] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId, deletedAt: null, isActive: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        email: true,
        fullName: true,
        createdAt: true,
        role: { select: { name: true } },
      },
    }),
    prisma.source.findMany({
      where: { organizationId, deletedAt: null, type: SourceType.FILE_IMPORT },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, isActive: true },
    }),
    definicionesDe(organizationId),
    prisma.branch.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  return {
    usuarios: usuarios.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      rol: u.role.name,
    })),
    fuentes,
    camposPersonalizados: campos,
    sucursales,
  };
}

// ---------------------------------------------------------------------------
// Sincronizaciones (§7)
// ---------------------------------------------------------------------------

export async function listarSincronizaciones(organizationId: string) {
  await exigirOrganizacion(organizationId);
  // Sin config: el mapeo y los ajustes no hacen falta en la lista.
  return (await listarSyncs(organizationId)).map((sync) => ({
    id: sync.id,
    source: sync.source,
    intervalHours: sync.intervalHours,
    markMissingUnavailable: sync.markMissingUnavailable,
    nextRunAt: sync.nextRunAt,
    lastRunAt: sync.lastRunAt,
    lastStatus: sync.lastStatus,
    lastError: sync.lastError,
    consecutiveFailures: sync.consecutiveFailures,
    pausedAt: sync.pausedAt,
    pausedReason: sync.pausedReason,
    createdAt: sync.createdAt,
    ultimaCorrida: sync.batches[0] ?? null,
  }));
}

export async function cambiarSincronizacion(
  organizationId: string,
  syncId: string,
  accion: "pausar" | "reanudar" | "borrar",
) {
  if (!(await findSync(organizationId, syncId))) {
    throw new AppError("Sincronización no encontrada", 404);
  }
  const hacer = { pausar: pausarSync, reanudar: reanudarSync, borrar: borrarSync }[accion];
  await hacer(organizationId, syncId);
  return accion === "borrar" ? null : findSync(organizationId, syncId);
}
