import type { VehiclePhotoImport } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import {
  DescargaRechazada,
  fetchPublico,
  urlDeDescargaDirecta,
  type Descarga,
} from "../lib/fetchPublico";
import {
  bytesDelLote,
  encolarFotos,
  fotosDelLote,
  fotosDelVehiculo,
  hashDeUrl,
  marcarFoto,
  urlsYaEncoladas,
  type FotoAEncolar,
} from "../repositories/vehiclePhotoImport.repository";
import { resolverFalloDelJob, describirError } from "../utils/backoff";
import { detectImageType, VEHICLE_PHOTO_MAX_BYTES } from "../utils/vehiclePhoto";
import { subirFotoDeVehiculo } from "./vehiclePhoto.service";

// ---------------------------------------------------------------------------
// LAS FOTOS DEL STOCK IMPORTADO (docs/importacion-de-datos.md §6, decisión 13).
//
// La promoción del vehículo ENCOLA (encolarFotosDelVehiculo) y termina: bajar
// veinte fotos dentro de la transacción que tiene la fila sería colgar el
// worker y la conexión. El worker de fotos (workers/importPhotoWorker.ts) las
// baja de a una con fetchPublico (SSRF, topes) y las guarda por el mismo
// camino que una foto subida a mano (subirFotoDeVehiculo: bucket
// vehicle-photos, magic bytes, portada).
//
// Una foto que falla no tumba el vehículo: queda FAILED con su motivo, en el
// informe y en su CSV.
// ---------------------------------------------------------------------------

export const TOPES_DE_FOTOS = {
  porVehiculo: 20,
  porLote: 3_000,
  bytesPorLote: 1_500 * 1024 * 1024,
  bytesPorFoto: VEHICLE_PHOTO_MAX_BYTES,
  timeoutMs: 15_000,
  conectarTimeoutMs: 5_000,
  maxIntentos: 3,
  backoff: { baseMs: 60_000, topeMs: 10 * 60_000 },
};

// Los links de una celda: separados por espacios, comas, punto y coma, barras
// o saltos de línea; sin repetidos, en orden.
export function linksDeLaCelda(texto: string | undefined): string[] {
  if (!texto) return [];
  const links: string[] = [];
  for (const parte of texto.split(/[\s,;|]+/)) {
    const t = parte.trim();
    if (t !== "" && !links.includes(t)) links.push(t);
  }
  return links;
}

// Encola las fotos de una unidad, con los topes (§6): hasta 20 por unidad
// contando las que ya tiene, y hasta 3.000 por lote. Las que pasan un tope
// quedan SKIPPED con el motivo. Una URL ya encolada para esa unidad no se
// repite (reimportar no la vuelve a bajar).
export async function encolarFotosDelVehiculo(
  organizationId: string,
  batchId: string,
  vehicleId: string,
  links: string[],
  db: Db,
): Promise<{ encoladas: number; omitidas: number }> {
  if (links.length === 0) return { encoladas: 0, omitidas: 0 };
  const yaEstan = await urlsYaEncoladas(organizationId, vehicleId, links, db);
  const nuevas = links.filter((l) => !yaEstan.has(hashDeUrl(l)));
  let libresEnUnidad =
    TOPES_DE_FOTOS.porVehiculo - (await fotosDelVehiculo(organizationId, vehicleId, db));
  let libresEnLote = TOPES_DE_FOTOS.porLote - (await fotosDelLote(organizationId, batchId, db));
  const fotos: FotoAEncolar[] = nuevas.map((url, i) => {
    let omitida: string | undefined;
    if (libresEnUnidad <= 0)
      omitida = `la unidad ya tiene ${String(TOPES_DE_FOTOS.porVehiculo)} fotos`;
    else if (libresEnLote <= 0)
      omitida = `el lote ya tiene ${String(TOPES_DE_FOTOS.porLote)} fotos`;
    if (!omitida) {
      libresEnUnidad--;
      libresEnLote--;
    }
    return { url, position: i, omitida };
  });
  await encolarFotos({ organizationId, batchId, vehicleId, fotos }, db);
  const omitidas = fotos.filter((f) => f.omitida).length;
  return { encoladas: fotos.length - omitidas, omitidas };
}

export type Descargar = (url: string) => Promise<Descarga>;

export const descargarFotoPublica: Descargar = (url) =>
  fetchPublico(urlDeDescargaDirecta(url), {
    maxBytes: TOPES_DE_FOTOS.bytesPorFoto,
    timeoutMs: TOPES_DE_FOTOS.timeoutMs,
    conectarTimeoutMs: TOPES_DE_FOTOS.conectarTimeoutMs,
  });

class FotoInvalida extends Error {}

// Procesa UNA foto ya reclamada (reclamarFoto). La descarga va fuera de toda
// transacción; guardarla, por subirFotoDeVehiculo, que toma su propio lock.
export async function procesarFoto(
  foto: VehiclePhotoImport,
  descargar: Descargar = descargarFotoPublica,
  db: Db = prisma,
): Promise<"DONE" | "FAILED" | "SKIPPED" | "REINTENTAR"> {
  const org = foto.organizationId;
  const vehiculo = await db.vehicle.findFirst({
    where: { id: foto.vehicleId, organizationId: org, deletedAt: null },
    select: { id: true },
  });
  if (!vehiculo) {
    await marcarFoto(foto.id, org, { status: "SKIPPED", error: "la unidad se dio de baja" }, db);
    return "SKIPPED";
  }
  if ((await bytesDelLote(org, foto.batchId, db)) >= TOPES_DE_FOTOS.bytesPorLote) {
    await marcarFoto(
      foto.id,
      org,
      { status: "SKIPPED", error: "el lote ya bajó el máximo de 1,5 GB de fotos" },
      db,
    );
    return "SKIPPED";
  }
  try {
    const descarga = await descargar(foto.url);
    const imagen = detectImageType(descarga.buffer);
    if (!imagen) {
      const esHtml = (descarga.contentType ?? "").includes("text/html");
      throw new FotoInvalida(
        esHtml && descarga.urlFinal.includes("google.com")
          ? "el archivo de Drive no está compartido (o no es una imagen)"
          : "no es una imagen JPEG, PNG ni WebP",
      );
    }
    const { photoId } = await subirFotoDeVehiculo(org, foto.vehicleId, {
      buffer: descarga.buffer,
      image: imagen,
    });
    await marcarFoto(
      foto.id,
      org,
      {
        status: "DONE",
        error: null,
        bytes: descarga.buffer.length,
        vehiclePhotoId: photoId,
        nextAttemptAt: null,
      },
      db,
    );
    return "DONE";
  } catch (err) {
    const clase =
      err instanceof FotoInvalida ||
      (err instanceof DescargaRechazada && err.clase === "PERMANENTE")
        ? "PERMANENTE"
        : "TRANSITORIO";
    const resolucion = resolverFalloDelJob(foto.attempts, clase, new Date(), {
      maxIntentos: TOPES_DE_FOTOS.maxIntentos,
      backoff: TOPES_DE_FOTOS.backoff,
    });
    const motivo = err instanceof Error ? err.message : describirError(err);
    if (resolucion.estado === "FAILED") {
      await marcarFoto(
        foto.id,
        org,
        { status: "FAILED", error: motivo.slice(0, 500), nextAttemptAt: null },
        db,
      );
      return "FAILED";
    }
    await marcarFoto(
      foto.id,
      org,
      { status: "PENDING", error: motivo.slice(0, 500), nextAttemptAt: resolucion.nextAttemptAt },
      db,
    );
    return "REINTENTAR";
  }
}
