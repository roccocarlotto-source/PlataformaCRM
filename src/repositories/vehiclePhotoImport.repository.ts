import { createHash } from "node:crypto";
import { Prisma, type VehiclePhotoImport, type VehiclePhotoImportStatus } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// La cola de fotos del stock importado (vehicle_photo_imports,
// docs/importacion-de-datos.md §6). organizationId en el WHERE de todo (M4).
// ---------------------------------------------------------------------------

export function hashDeUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

export interface FotoAEncolar {
  url: string;
  position: number;
  // SKIPPED con su motivo, para las que pasan un tope: quedan en el informe.
  omitida?: string;
}

// El único (organización, vehículo, hash de la URL) hace que una URL ya
// encolada para esa unidad —en este lote o en uno anterior— no se vuelva a
// bajar. Devuelve cuántas filas nuevas quedaron.
export async function encolarFotos(
  data: { organizationId: string; batchId: string; vehicleId: string; fotos: FotoAEncolar[] },
  db: Db,
): Promise<number> {
  if (data.fotos.length === 0) return 0;
  const valores = data.fotos.map(
    (f) => Prisma.sql`(
      ${data.organizationId}::uuid, ${data.batchId}::uuid, ${data.vehicleId}::uuid,
      ${f.url.slice(0, 2048)}, ${hashDeUrl(f.url)}, ${f.position}::int,
      ${f.omitida ? "SKIPPED" : "PENDING"}::"VehiclePhotoImportStatus", ${f.omitida ?? null},
      now(), now()
    )`,
  );
  return db.$executeRaw`
    INSERT INTO vehicle_photo_imports (
      organization_id, batch_id, vehicle_id, url, url_sha256, position, status, error,
      created_at, updated_at
    )
    VALUES ${Prisma.join(valores)}
    ON CONFLICT (organization_id, vehicle_id, url_sha256) DO NOTHING
  `;
}

export async function urlsYaEncoladas(
  organizationId: string,
  vehicleId: string,
  urls: string[],
  db: Db,
): Promise<Set<string>> {
  const filas = await db.vehiclePhotoImport.findMany({
    where: { organizationId, vehicleId, urlSha256: { in: urls.map(hashDeUrl) } },
    select: { urlSha256: true },
  });
  return new Set(filas.map((f) => f.urlSha256));
}

// Cuántas fotos tiene o va a tener la unidad: las de la galería más las
// encoladas que todavía no se bajaron.
export async function fotosDelVehiculo(organizationId: string, vehicleId: string, db: Db) {
  const [galeria, pendientes] = await Promise.all([
    db.vehiclePhoto.count({ where: { organizationId, vehicleId } }),
    db.vehiclePhotoImport.count({ where: { organizationId, vehicleId, status: "PENDING" } }),
  ]);
  return galeria + pendientes;
}

export function fotosDelLote(organizationId: string, batchId: string, db: Db) {
  return db.vehiclePhotoImport.count({
    where: { organizationId, batchId, status: { not: "SKIPPED" } },
  });
}

export async function bytesDelLote(organizationId: string, batchId: string, db: Db = prisma) {
  const r = await db.vehiclePhotoImport.aggregate({
    where: { organizationId, batchId, status: "DONE" },
    _sum: { bytes: true },
  });
  return r._sum.bytes ?? 0;
}

// Reclama UNA foto pendiente con un lease: la marca como intentada y corre su
// próximo intento hasta que venza el lease. Si el proceso muere a mitad de la
// descarga, la foto vuelve a ser reclamable sola cuando vence (mismo
// mecanismo que los turnos del agente). La descarga ocurre FUERA de toda
// transacción.
export async function reclamarFoto(
  leaseMs: number,
  db: Db = prisma,
): Promise<VehiclePhotoImport | null> {
  const filas = await db.$queryRaw<{ id: string }[]>`
    UPDATE vehicle_photo_imports
    SET attempts = attempts + 1,
        next_attempt_at = now() + (${leaseMs}::int * interval '1 millisecond'),
        updated_at = now()
    WHERE id = (
      SELECT id FROM vehicle_photo_imports
      WHERE status = 'PENDING'::"VehiclePhotoImportStatus"
        AND coalesce(next_attempt_at, created_at) <= now()
      ORDER BY coalesce(next_attempt_at, created_at), position
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id
  `;
  if (filas.length === 0) return null;
  return db.vehiclePhotoImport.findUnique({ where: { id: filas[0].id } });
}

export function marcarFoto(
  id: string,
  organizationId: string,
  data: {
    status: VehiclePhotoImportStatus;
    error?: string | null;
    bytes?: number | null;
    vehiclePhotoId?: string | null;
    nextAttemptAt?: Date | null;
  },
  db: Db = prisma,
) {
  return db.vehiclePhotoImport.updateMany({ where: { id, organizationId }, data });
}

export async function resumenDeFotos(
  organizationId: string,
  batchId: string,
  db: Db = prisma,
): Promise<Record<string, number>> {
  const filas = await db.vehiclePhotoImport.groupBy({
    by: ["status"],
    where: { organizationId, batchId },
    _count: { _all: true },
  });
  return Object.fromEntries(filas.map((f) => [f.status, f._count._all]));
}

// Las fotos que no se bajaron, para el CSV del informe.
export function fotosConProblemas(organizationId: string, batchId: string, db: Db = prisma) {
  return db.vehiclePhotoImport.findMany({
    where: { organizationId, batchId, status: { in: ["FAILED", "SKIPPED"] } },
    orderBy: [{ vehicleId: "asc" }, { position: "asc" }],
    select: {
      url: true,
      status: true,
      error: true,
      vehicle: { select: { internalCode: true, make: true, model: true } },
    },
  });
}
