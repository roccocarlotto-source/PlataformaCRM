import { Prisma } from "@prisma/client";
import { prisma, type Db } from "../../lib/prisma";

// ---------------------------------------------------------------------------
// Las consultas del barrido de ventas (docs/servicios.md §5 y §2.2.1, S10).
// SQL a mano: comparan columnas de tres tablas (oportunidades, stock y
// vehículos de clientes) y normalizan la matrícula del stock, que no tiene
// columna normalizada.
// ---------------------------------------------------------------------------

/** La matrícula o el chasis normalizados en SQL: la misma regla que
 *  normalizarIdentificador (mayúsculas, solo letras y dígitos). */
const normalizado = (columna: Prisma.Sql) =>
  Prisma.sql`upper(regexp_replace(coalesce(${columna}, ''), '[^A-Za-z0-9]', '', 'g'))`;

/** Las ventas que todavía no son un vehículo de cliente: ganadas, con unidad y
 *  contacto vigente. Una venta ya convertida tiene su vehículo (aunque después
 *  haya dejado de ser del cliente, por ejemplo por una permuta: no se vuelve a
 *  crear). Tampoco cuenta una unidad que ya es el origen de un vehículo
 *  vigente (dos ventas ganadas de la misma unidad: un error de carga). */
const ventasSinConvertir = (organizationId: string) => Prisma.sql`
  FROM opportunities o
  JOIN vehicles v ON v.id = o.vehicle_id AND v.organization_id = o.organization_id
  JOIN contacts c ON c.id = o.contact_id AND c.organization_id = o.organization_id
  WHERE o.organization_id = ${organizationId}::uuid
    AND o.status = 'WON' AND o.deleted_at IS NULL
    AND c.deleted_at IS NULL AND c.personal_data_erased_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM customer_vehicles cv
      WHERE cv.organization_id = o.organization_id AND cv.deleted_at IS NULL
        AND (cv.source_opportunity_id = o.id
          OR (cv.source_vehicle_id = o.vehicle_id AND cv.ownership_ended_at IS NULL))
    )`;

export interface VentaParaConvertir {
  opportunityId: string;
  contactId: string;
  stockVehicleId: string;
  actualCloseDate: Date | null;
  branchId: string;
  make: string;
  model: string;
  year: number;
  licensePlate: string | null;
  vin: string | null;
  mileage: number | null;
}

/** Hasta `limite` ventas por convertir, una por unidad (la venta más nueva). */
export function ventasParaConvertir(
  organizationId: string,
  limite: number,
  db: Db = prisma,
): Promise<VentaParaConvertir[]> {
  return db.$queryRaw<VentaParaConvertir[]>`
    SELECT DISTINCT ON (o.vehicle_id)
      o.id AS "opportunityId", o.contact_id AS "contactId", o.vehicle_id AS "stockVehicleId",
      o.actual_close_date AS "actualCloseDate", v.branch_id AS "branchId",
      v.make, v.model, v.year, v.license_plate AS "licensePlate", v.vin, v.mileage
    ${ventasSinConvertir(organizationId)}
    ORDER BY o.vehicle_id, o.actual_close_date DESC NULLS LAST, o.updated_at DESC
    LIMIT ${limite}`;
}

/** Cuántas ventas se van a convertir: el aviso de Plataforma al activar. */
export async function contarVentasParaConvertir(
  organizationId: string,
  db: Db = prisma,
): Promise<number> {
  const [{ n }] = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(DISTINCT o.vehicle_id) AS n ${ventasSinConvertir(organizationId)}`;
  return Number(n);
}

export interface VentaRevertida {
  customerVehicleId: string;
  contactId: string;
  branchId: string | null;
  make: string;
  model: string;
  licensePlate: string | null;
  purchasedOn: Date | null;
  // ¿Se cargó después de que existía la venta? Lo que crea el barrido, sí,
  // siempre. Uno cargado antes era del cliente y la venta solo lo completó.
  posteriorALaVenta: boolean;
  ordenes: number;
}

/** Los vehículos vigentes cuya venta dejó de estar ganada: volvió a abierta,
 *  pasó a perdida, se borró o ya no es la venta de esa unidad. Solo si el
 *  vehículo sigue siendo del comprador: uno que ya cambió de dueño no depende
 *  de esa venta. */
export function ventasRevertidas(organizationId: string, db: Db = prisma) {
  return db.$queryRaw<VentaRevertida[]>`
    SELECT cv.id AS "customerVehicleId", cv.contact_id AS "contactId", cv.branch_id AS "branchId",
      cv.make, cv.model, cv.license_plate AS "licensePlate", cv.purchased_on AS "purchasedOn",
      cv.created_at > o.created_at AS "posteriorALaVenta",
      (SELECT count(*)::int FROM service_orders so
        WHERE so.organization_id = cv.organization_id AND so.customer_vehicle_id = cv.id) AS ordenes
    FROM customer_vehicles cv
    JOIN opportunities o ON o.id = cv.source_opportunity_id AND o.organization_id = cv.organization_id
    WHERE cv.organization_id = ${organizationId}::uuid
      AND cv.deleted_at IS NULL AND cv.ownership_ended_at IS NULL
      AND cv.contact_id = o.contact_id
      AND (o.status <> 'WON' OR o.deleted_at IS NOT NULL
        OR o.vehicle_id IS DISTINCT FROM cv.source_vehicle_id)`;
}

export interface Permuta {
  customerVehicleId: string;
  contactId: string;
  branchId: string | null;
  make: string;
  model: string;
  licensePlate: string | null;
  purchasedOn: Date | null;
  stockVehicleId: string;
  internalCode: string;
}

/** Las permutas (§2.2.1): una unidad del stock vigente con la matrícula o el
 *  chasis de un vehículo de cliente vigente, que entró al stock DESPUÉS de que
 *  el vehículo existía. Sin esa condición, la unidad de una venta vieja del
 *  mismo auto (que sigue en el stock como vendida) parecería una permuta del
 *  dueño nuevo. Nunca la unidad de la que salió el propio vehículo, ni una que
 *  se le vendió a ESE cliente: es la venta que se registró después de que el
 *  cliente ya traía el auto al taller (el alta la completa), no una permuta. */
export function permutas(organizationId: string, db: Db = prisma) {
  return db.$queryRaw<Permuta[]>`
    SELECT DISTINCT ON (cv.id)
      cv.id AS "customerVehicleId", cv.contact_id AS "contactId", cv.branch_id AS "branchId",
      cv.make, cv.model, cv.license_plate AS "licensePlate", cv.purchased_on AS "purchasedOn",
      v.id AS "stockVehicleId", v.internal_code AS "internalCode"
    FROM customer_vehicles cv
    JOIN vehicles v ON v.organization_id = cv.organization_id AND v.deleted_at IS NULL
      AND v.id IS DISTINCT FROM cv.source_vehicle_id
      AND v.created_at > cv.created_at
      AND ((cv.license_plate_norm IS NOT NULL
            AND ${normalizado(Prisma.sql`v.license_plate`)} = cv.license_plate_norm)
        OR (cv.vin IS NOT NULL AND ${normalizado(Prisma.sql`v.vin`)} = cv.vin))
    WHERE cv.organization_id = ${organizationId}::uuid
      AND cv.deleted_at IS NULL AND cv.ownership_ended_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM opportunities o
        WHERE o.organization_id = cv.organization_id AND o.vehicle_id = v.id
          AND o.contact_id = cv.contact_id AND o.status = 'WON' AND o.deleted_at IS NULL
      )
    ORDER BY cv.id, v.created_at`;
}

/** La primera activación del módulo: define qué ventas reciben el primer
 *  service (§6.1). Reactivar no la cambia. */
export async function primeraActivacion(organizationId: string, db: Db = prisma) {
  const fila = await db.organizationModule.findUnique({
    where: { organizationId_module: { organizationId, module: "servicios" } },
    select: { enabledAt: true },
  });
  return fila?.enabledAt ?? null;
}
