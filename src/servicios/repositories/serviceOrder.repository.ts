import type { Prisma, ServiceOrderStatus } from "@prisma/client";
import { prisma, type Db } from "../../lib/prisma";
import { ESTADOS_ABIERTOS } from "../config/estados";

// ---------------------------------------------------------------------------
// Órdenes de servicio (docs/servicios.md §2.3–§2.5). Sin borrado: una orden se
// cancela. El estado cambia solo con updateSiEstaEn (condicional sobre el
// estado anterior, §2.4) y cada cambio deja su fila en el historial.
// ---------------------------------------------------------------------------

const vehiculoResumido = {
  select: { id: true, make: true, model: true, year: true, licensePlate: true },
} as const;
const contactoResumido = { select: { id: true, firstName: true, lastName: true } } as const;
const usuarioResumido = { select: { id: true, fullName: true } } as const;

export const camposDeLaLista = {
  id: true,
  number: true,
  status: true,
  scheduledFor: true,
  createdAt: true,
  deliveredAt: true,
  cancelledAt: true,
  amount: true,
  currency: true,
  customerVehicle: vehiculoResumido,
  contact: contactoResumido,
  branch: { select: { id: true, name: true } },
  assignee: usuarioResumido,
  // Desde cuándo está en el estado actual (el tablero lo muestra).
  statusChanges: { select: { changedAt: true }, orderBy: { changedAt: "desc" }, take: 1 },
} satisfies Prisma.ServiceOrderSelect;

export const camposDeLaFicha = {
  ...camposDeLaLista,
  customerVehicleId: true,
  contactId: true,
  branchId: true,
  bookingId: true,
  assigneeId: true,
  mileageIn: true,
  damageNotes: true,
  notes: true,
  receivedAt: true,
  workStartedAt: true,
  readyAt: true,
  cancelReason: true,
  nextServiceDueOn: true,
  updatedAt: true,
  createdBy: usuarioResumido,
  jobTypes: {
    select: { serviceJobType: { select: { id: true, name: true, nextServiceAfterMonths: true } } },
    orderBy: { createdAt: "asc" },
  },
  approvals: {
    select: {
      id: true,
      description: true,
      decision: true,
      approverName: true,
      channel: true,
      decidedAt: true,
      amount: true,
      currency: true,
      createdAt: true,
      recordedBy: usuarioResumido,
    },
    orderBy: { createdAt: "desc" },
  },
  statusChanges: {
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      changedAt: true,
      note: true,
      changedBy: usuarioResumido,
    },
    orderBy: { changedAt: "desc" },
  },
} satisfies Prisma.ServiceOrderSelect;

export type FilaDeLaLista = Prisma.ServiceOrderGetPayload<{ select: typeof camposDeLaLista }>;
export type FilaDeLaFicha = Prisma.ServiceOrderGetPayload<{ select: typeof camposDeLaFicha }>;

export interface FiltrosDeOrdenes {
  estados?: readonly ServiceOrderStatus[];
  branchId?: string;
  branchIds?: readonly string[];
  assigneeId?: string;
  customerVehicleId?: string;
  desde?: Date;
  hasta?: Date;
  // El texto tal cual (nombre), normalizado (matrícula) y, si parece uno, el
  // número de orden ("OS-0042", "42").
  q?: { texto: string; normalizado: string; numero: number | null };
}

function whereDeOrdenes(
  organizationId: string,
  f: FiltrosDeOrdenes,
): Prisma.ServiceOrderWhereInput {
  const where: Prisma.ServiceOrderWhereInput = { organizationId };
  if (f.estados && f.estados.length > 0) where.status = { in: [...f.estados] };
  if (f.branchId) where.branchId = f.branchId;
  else if (f.branchIds) where.branchId = { in: [...f.branchIds] };
  if (f.assigneeId) where.assigneeId = f.assigneeId;
  if (f.customerVehicleId) where.customerVehicleId = f.customerVehicleId;
  if (f.desde || f.hasta) {
    where.createdAt = { ...(f.desde ? { gte: f.desde } : {}), ...(f.hasta ? { lt: f.hasta } : {}) };
  }
  if (f.q) {
    const or: Prisma.ServiceOrderWhereInput[] = [
      { contact: { firstName: { contains: f.q.texto, mode: "insensitive" } } },
      { contact: { lastName: { contains: f.q.texto, mode: "insensitive" } } },
    ];
    if (f.q.normalizado) {
      or.push({ customerVehicle: { licensePlateNorm: { startsWith: f.q.normalizado } } });
    }
    if (f.q.numero !== null) or.push({ number: f.q.numero });
    where.OR = or;
  }
  return where;
}

export async function findManyOrders(
  organizationId: string,
  filtros: FiltrosDeOrdenes,
  paginado: { skip: number; take: number },
): Promise<FilaDeLaLista[]> {
  return prisma.serviceOrder.findMany({
    where: whereDeOrdenes(organizationId, filtros),
    select: camposDeLaLista,
    orderBy: { number: "desc" },
    ...paginado,
  });
}

export async function countOrders(organizationId: string, filtros: FiltrosDeOrdenes) {
  return prisma.serviceOrder.count({ where: whereDeOrdenes(organizationId, filtros) });
}

export async function findOrderById(
  organizationId: string,
  id: string,
  db: Db = prisma,
): Promise<FilaDeLaFicha | null> {
  return db.serviceOrder.findFirst({ where: { id, organizationId }, select: camposDeLaFicha });
}

/** La orden que tiene el vehículo dentro del taller (de Recibido a Listo), si
 *  hay: para el 409 de "ya está en el taller". */
export async function findOrdenEnElTaller(
  organizationId: string,
  customerVehicleId: string,
  db: Db = prisma,
) {
  return db.serviceOrder.findFirst({
    where: {
      organizationId,
      customerVehicleId,
      status: { in: ESTADOS_ABIERTOS.filter((e) => e !== "AGENDADO") },
    },
    select: { id: true, number: true },
  });
}

export async function createOrder(
  data: Prisma.ServiceOrderUncheckedCreateInput,
  tx: Prisma.TransactionClient,
): Promise<{ id: string }> {
  return tx.serviceOrder.create({ data, select: { id: true } });
}

/** Cambia la orden solo si sigue en `desde` (§2.4). 0 = alguien la movió. */
export async function updateSiEstaEn(
  organizationId: string,
  id: string,
  desde: ServiceOrderStatus,
  data: Prisma.ServiceOrderUncheckedUpdateManyInput,
  tx: Prisma.TransactionClient,
): Promise<number> {
  const r = await tx.serviceOrder.updateMany({
    where: { id, organizationId, status: desde },
    data,
  });
  return r.count;
}

/** Edita una orden abierta. 0 = no existe o ya es final. */
export async function updateOrdenAbierta(
  organizationId: string,
  id: string,
  data: Prisma.ServiceOrderUncheckedUpdateManyInput,
  tx: Prisma.TransactionClient,
): Promise<number> {
  const r = await tx.serviceOrder.updateMany({
    where: { id, organizationId, status: { in: [...ESTADOS_ABIERTOS] } },
    data,
  });
  return r.count;
}

export async function createStatusChange(
  data: {
    organizationId: string;
    serviceOrderId: string;
    fromStatus: ServiceOrderStatus | null;
    toStatus: ServiceOrderStatus;
    changedById: string;
    note?: string | null;
  },
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.serviceOrderStatusChange.create({ data });
}

/** Reemplaza los tipos de la orden por estos. */
export async function setJobTypes(
  organizationId: string,
  serviceOrderId: string,
  ids: readonly string[],
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.serviceOrderJobType.deleteMany({ where: { organizationId, serviceOrderId } });
  if (ids.length === 0) return;
  await tx.serviceOrderJobType.createMany({
    data: ids.map((serviceJobTypeId) => ({ organizationId, serviceOrderId, serviceJobTypeId })),
  });
}

/** Cuándo entró la orden por última vez a este estado. */
export async function ultimaEntradaA(
  organizationId: string,
  serviceOrderId: string,
  estado: ServiceOrderStatus,
  db: Db = prisma,
): Promise<Date | null> {
  const fila = await db.serviceOrderStatusChange.findFirst({
    where: { organizationId, serviceOrderId, toStatus: estado },
    select: { changedAt: true },
    orderBy: { changedAt: "desc" },
  });
  return fila?.changedAt ?? null;
}

/** ¿Hay una aprobación registrada desde este momento? (§2.5) */
export async function hayAprobacionDesde(
  organizationId: string,
  serviceOrderId: string,
  desde: Date,
  db: Db = prisma,
): Promise<boolean> {
  const n = await db.serviceOrderApproval.count({
    where: { organizationId, serviceOrderId, createdAt: { gte: desde } },
  });
  return n > 0;
}

export async function createApproval(
  data: Prisma.ServiceOrderApprovalUncheckedCreateInput,
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.serviceOrderApproval.create({ data });
}

/** Los usuarios activos de la organización, para elegir el encargado (D9). */
export async function findUsuariosActivos(organizationId: string) {
  return prisma.user.findMany({
    where: { organizationId, isActive: true, deletedAt: null },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
}

export async function existeUsuarioActivo(organizationId: string, id: string): Promise<boolean> {
  const n = await prisma.user.count({
    where: { id, organizationId, isActive: true, deletedAt: null },
  });
  return n > 0;
}

/** Borrado completo de un contacto (D14, §2.8): daños al ingreso y notas de sus
 *  órdenes. Las órdenes quedan, para que los números del taller no cambien. */
export async function anonimizarOrdenesDelContacto(
  organizationId: string,
  contactId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.serviceOrder.updateMany({
    where: { organizationId, contactId },
    data: { damageNotes: null, notes: null },
  });
}

/** Para la zona y la moneda por defecto de la organización. */
export async function findDatosDeLaOrganizacion(organizationId: string, db: Db = prisma) {
  return db.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true, preferredCurrency: true },
  });
}
