import type { CustomerVehicleEndReason, Prisma } from "@prisma/client";
import { prisma, type Db } from "../../lib/prisma";

// ---------------------------------------------------------------------------
// Vehículos de clientes (docs/servicios.md §2.2), el auto que el cliente trae
// al taller. Distinto del stock (`vehicles`).
//
// "Vigente" quiere decir deleted_at IS NULL AND ownership_ended_at IS NULL. Un
// vehículo borrado no existe para la API (404); uno que ya no es del cliente se
// sigue viendo, con su marca, pero no ocupa su matrícula ni su chasis.
// ---------------------------------------------------------------------------

// Estados finales de una orden: lo demás es una orden abierta.
export const ESTADOS_FINALES_DE_ORDEN = ["ENTREGADO", "CANCELADO"] as const;

const contactoResumido = { select: { id: true, firstName: true, lastName: true } } as const;

// Lo que devuelven el listado y la ficha.
export const camposDelVehiculo = {
  id: true,
  contactId: true,
  branchId: true,
  make: true,
  model: true,
  year: true,
  licensePlate: true,
  vin: true,
  mileage: true,
  purchasedOn: true,
  nextServiceDueOn: true,
  nextServiceSetFromOrderId: true,
  remindersOptOut: true,
  sourceVehicleId: true,
  sourceOpportunityId: true,
  ownershipEndedAt: true,
  ownershipEndReason: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  contact: contactoResumido,
  branch: { select: { id: true, name: true } },
  // La orden abierta, si tiene (la tarjeta del contacto y la ficha la
  // muestran). Hasta S4 no hay órdenes: siempre vacío.
  serviceOrders: {
    where: { status: { notIn: [...ESTADOS_FINALES_DE_ORDEN] } },
    select: { id: true, number: true, status: true },
    orderBy: { createdAt: "desc" },
    take: 1,
  },
} satisfies Prisma.CustomerVehicleSelect;

export type FilaDeVehiculo = Prisma.CustomerVehicleGetPayload<{ select: typeof camposDelVehiculo }>;

export interface FiltrosDeVehiculos {
  // Ya normalizado para matrícula y chasis; tal cual para el nombre.
  q?: { texto: string; normalizado: string };
  contactId?: string;
  branchId?: string;
  branchIds?: readonly string[];
  incluirNoVigentes?: boolean;
}

function whereDeVehiculos(
  organizationId: string,
  f: FiltrosDeVehiculos,
): Prisma.CustomerVehicleWhereInput {
  const where: Prisma.CustomerVehicleWhereInput = { organizationId, deletedAt: null };
  if (!f.incluirNoVigentes) where.ownershipEndedAt = null;
  if (f.contactId) where.contactId = f.contactId;
  if (f.branchId) where.branchId = f.branchId;
  else if (f.branchIds) where.branchId = { in: [...f.branchIds] };
  if (f.q) {
    const or: Prisma.CustomerVehicleWhereInput[] = [
      { contact: { firstName: { contains: f.q.texto, mode: "insensitive" } } },
      { contact: { lastName: { contains: f.q.texto, mode: "insensitive" } } },
    ];
    if (f.q.normalizado) {
      or.unshift(
        { licensePlateNorm: { startsWith: f.q.normalizado } },
        { vin: { startsWith: f.q.normalizado } },
      );
    }
    where.OR = or;
  }
  return where;
}

export async function findManyCustomerVehicles(
  organizationId: string,
  filtros: FiltrosDeVehiculos,
  paginado: { skip: number; take: number },
): Promise<FilaDeVehiculo[]> {
  return prisma.customerVehicle.findMany({
    where: whereDeVehiculos(organizationId, filtros),
    select: camposDelVehiculo,
    // Los vigentes primero; dentro, el último cargado arriba.
    orderBy: [{ ownershipEndedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
    ...paginado,
  });
}

export async function countCustomerVehicles(
  organizationId: string,
  filtros: FiltrosDeVehiculos,
): Promise<number> {
  return prisma.customerVehicle.count({ where: whereDeVehiculos(organizationId, filtros) });
}

export async function findCustomerVehicleById(
  organizationId: string,
  id: string,
  db: Db = prisma,
): Promise<FilaDeVehiculo | null> {
  return db.customerVehicle.findFirst({
    where: { id, organizationId, deletedAt: null },
    select: camposDelVehiculo,
  });
}

/** Lo que necesita el alta de una orden (una consulta, sin relaciones). */
export async function findVehiculoParaOrden(organizationId: string, id: string, db: Db = prisma) {
  return db.customerVehicle.findFirst({
    where: { id, organizationId, deletedAt: null },
    select: { id: true, contactId: true, branchId: true, ownershipEndedAt: true },
  });
}

/** El vehículo vigente que ya tiene esta matrícula o este chasis, si hay
 *  (el 409 de D16). `exceptoId`: el propio, al editar. */
export async function findVigenteConIdentificador(
  organizationId: string,
  identificadores: { licensePlateNorm?: string | null; vin?: string | null },
  exceptoId?: string,
  db: Db = prisma,
): Promise<{ id: string; campo: "licensePlate" | "vin" } | null> {
  const base = {
    organizationId,
    deletedAt: null,
    ownershipEndedAt: null,
    ...(exceptoId ? { id: { not: exceptoId } } : {}),
  };
  if (identificadores.licensePlateNorm) {
    const fila = await db.customerVehicle.findFirst({
      where: { ...base, licensePlateNorm: identificadores.licensePlateNorm },
      select: { id: true },
    });
    if (fila) return { id: fila.id, campo: "licensePlate" };
  }
  if (identificadores.vin) {
    const fila = await db.customerVehicle.findFirst({
      where: { ...base, vin: identificadores.vin },
      select: { id: true },
    });
    if (fila) return { id: fila.id, campo: "vin" };
  }
  return null;
}

export async function countOrdenesAbiertasDelVehiculo(
  organizationId: string,
  customerVehicleId: string,
  db: Db = prisma,
): Promise<number> {
  return db.serviceOrder.count({
    where: {
      organizationId,
      customerVehicleId,
      status: { notIn: [...ESTADOS_FINALES_DE_ORDEN] },
    },
  });
}

/** Toma la fila del vehículo (FOR UPDATE) dentro de una transacción: cambiar
 *  dueño y borrar deciden sobre lo que leen, y dos pedidos simultáneos no
 *  pueden pasar los dos el chequeo. */
export async function bloquearVehiculo(
  organizationId: string,
  id: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM customer_vehicles
    WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid
    FOR UPDATE`;
}

export async function createCustomerVehicle(
  data: Prisma.CustomerVehicleUncheckedCreateInput,
  db: Db = prisma,
): Promise<{ id: string }> {
  return db.customerVehicle.create({ data, select: { id: true } });
}

export async function updateCustomerVehicle(
  organizationId: string,
  id: string,
  data: Prisma.CustomerVehicleUncheckedUpdateManyInput,
  db: Db = prisma,
): Promise<number> {
  const r = await db.customerVehicle.updateMany({
    where: { id, organizationId, deletedAt: null },
    data,
  });
  return r.count;
}

export async function findOwnerChanges(organizationId: string, customerVehicleId: string) {
  return prisma.customerVehicleOwnerChange.findMany({
    where: { organizationId, customerVehicleId },
    select: {
      id: true,
      kind: true,
      endReason: true,
      previousPurchasedOn: true,
      stockVehicleId: true,
      note: true,
      changedAt: true,
      fromContact: contactoResumido,
      toContact: contactoResumido,
      changedBy: { select: { id: true, fullName: true } },
    },
    orderBy: { changedAt: "desc" },
  });
}

export async function createOwnerChange(
  data: {
    organizationId: string;
    customerVehicleId: string;
    kind: "CAMBIO_DE_DUENO" | "FIN";
    fromContactId: string;
    toContactId?: string;
    endReason?: CustomerVehicleEndReason;
    previousPurchasedOn: Date | null;
    note?: string | null;
    changedById: string;
  },
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.customerVehicleOwnerChange.create({ data });
}

/** El historial de órdenes del vehículo (§4.5), de la más nueva a la más vieja. */
export async function findOrdenesDelVehiculo(organizationId: string, customerVehicleId: string) {
  return prisma.serviceOrder.findMany({
    where: { organizationId, customerVehicleId },
    select: {
      id: true,
      number: true,
      status: true,
      deliveredAt: true,
      mileageIn: true,
      amount: true,
      currency: true,
      createdAt: true,
      assignee: { select: { id: true, fullName: true } },
      jobTypes: { select: { serviceJobType: { select: { id: true, name: true } } } },
    },
    orderBy: [{ number: "desc" }],
  });
}

/** Borrado completo de los datos personales de un contacto (D14, §2.8): matrícula,
 *  chasis y notas de sus vehículos, y la nota de los cambios de dueño en los que
 *  figura. El vehículo queda (marca, modelo, año, km), como las órdenes: los
 *  números del taller no cambian. Corre en la transacción del borrado. */
export async function anonimizarVehiculosDelContacto(
  organizationId: string,
  contactId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.customerVehicle.updateMany({
    where: { organizationId, contactId },
    data: { licensePlate: null, licensePlateNorm: null, vin: null, notes: null },
  });
  await tx.customerVehicleOwnerChange.updateMany({
    where: { organizationId, OR: [{ fromContactId: contactId }, { toContactId: contactId }] },
    data: { note: null },
  });
}

/** El contacto, si es de la organización y no está borrado (soft). */
export async function findContactoDelVehiculo(organizationId: string, id: string, db: Db = prisma) {
  return db.contact.findFirst({
    where: { id, organizationId, deletedAt: null },
    select: { id: true, personalDataErasedAt: true },
  });
}

/** ¿La sucursal es de la organización y está vigente? */
export async function existeSucursal(organizationId: string, id: string): Promise<boolean> {
  const fila = await prisma.branch.findFirst({
    where: { id, organizationId, deletedAt: null },
    select: { id: true },
  });
  return fila !== null;
}
