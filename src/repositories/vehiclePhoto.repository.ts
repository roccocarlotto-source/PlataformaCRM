import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// VehiclePhoto — la galería de una unidad (Fase 2b). Sin soft delete y sin
// updatedAt por decisión de la Fase 1 (ver el modelo en prisma/schema.prisma):
// una foto se borra de verdad y se reemplaza, no se edita.
//
// Mismas reglas que vehicle.repository.ts: organizationId en todo WHERE, y
// updateMany/deleteMany en vez de update/delete para que el WHERE efectivo
// exija organizationId y vehicleId además de id (M4); `count === 0` es 404
// en el service. Casi todo recibe `db` sin default: las escrituras corren
// dentro de la transacción del service con el lock de organización tomado.
// ---------------------------------------------------------------------------

// "La galería de esta unidad, en orden" — la única lectura, sobre el índice
// (organization_id, vehicle_id, position). El desempate por createdAt es para
// que dos fotos con la misma position (imposible por construcción, pero sin
// unique de base) salgan siempre en el mismo orden.
export function findPhotosByVehicle(vehicleId: string, organizationId: string, db: Db = prisma) {
  return db.vehiclePhoto.findMany({
    where: { organizationId, vehicleId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

// La portada de cada unidad de una página del listado, en UNA consulta (Fase
// 3b): a lo sumo una fila por unidad (índice único parcial
// vehicle_photos_vehicle_cover_unique), así que sin paginar — el tope real es
// el pageSize del listado, que ya está acotado a 100 en el controller.
export function findCoverPhotosByVehicleIds(
  vehicleIds: string[],
  organizationId: string,
  db: Db = prisma,
) {
  return db.vehiclePhoto.findMany({
    where: { organizationId, vehicleId: { in: vehicleIds }, isCover: true },
  });
}

export function countPhotosByVehicle(vehicleId: string, organizationId: string, db: Db = prisma) {
  return db.vehiclePhoto.count({ where: { organizationId, vehicleId } });
}

export function findPhotoById(
  id: string,
  vehicleId: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.vehiclePhoto.findFirst({ where: { id, organizationId, vehicleId } });
}

export function createPhoto(
  data: {
    organizationId: string;
    vehicleId: string;
    storagePath: string;
    slot: string | null;
    position: number;
    isCover: boolean;
  },
  db: Db,
) {
  return db.vehiclePhoto.create({ data });
}

export function updatePhoto(
  id: string,
  vehicleId: string,
  organizationId: string,
  data: { slot?: string | null; isCover?: boolean; position?: number },
  db: Db,
) {
  return db.vehiclePhoto.updateMany({ where: { id, organizationId, vehicleId }, data });
}

// Desmarca la portada actual de la unidad, sea cual sea. Va ANTES de marcar
// la nueva en la misma transacción: el índice único parcial
// vehicle_photos_vehicle_cover_unique no admite dos en true ni por un
// instante, así que el orden de los dos UPDATE es lo que hace que el segundo
// no falle.
export function clearCover(vehicleId: string, organizationId: string, db: Db) {
  return db.vehiclePhoto.updateMany({
    where: { organizationId, vehicleId, isCover: true },
    data: { isCover: false },
  });
}

export function deletePhoto(id: string, vehicleId: string, organizationId: string, db: Db) {
  return db.vehiclePhoto.deleteMany({ where: { id, organizationId, vehicleId } });
}
