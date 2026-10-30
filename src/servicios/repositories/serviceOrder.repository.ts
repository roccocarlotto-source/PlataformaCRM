import {
  Prisma,
  type BookingStatus,
  type ServiceOrderApprovalChannel,
  type ServiceOrderApprovalDecision,
  type ServiceOrderStatus,
} from "@prisma/client";
import { prisma, type Db } from "../../lib/prisma";
import { MARCADOR_DE_DATO_BORRADO } from "../../repositories/contact.repository";
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
  // Si ya pasó por En trabajo: el botón dice "Volver a trabajo" o "Pasar a".
  workStartedAt: true,
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
  readyAt: true,
  cancelReason: true,
  nextServiceDueOn: true,
  updatedAt: true,
  createdBy: usuarioResumido,
  // El turno vinculado (§4.4), con su estado y horario ACTUALES: si se canceló
  // en la agenda, la ficha lo dice (los turnos de automotora no avisan).
  booking: {
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      status: true,
      serviceType: { select: { name: true } },
      resource: { select: { name: true } },
    },
  },
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
  // La orden de un turno (el detalle del turno en la agenda, §4.4).
  bookingId?: string;
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
  if (f.bookingId) where.bookingId = f.bookingId;
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

// --- La ficha en una sola consulta -----------------------------------------
//
// Con `select: camposDeLaFicha` Prisma hace una consulta por relación (11), y
// cada una es una ida y vuelta a la base: ~300 ms en producción (prueba de S4a,
// 2026-10-14). Acá va todo en una: la orden y sus relaciones de a uno como
// columnas (el driver devuelve Date y Decimal como Prisma), y las tres listas
// como json_agg, con las fechas en milisegundos y los montos como texto para no
// perder ni la zona ni los centavos. Devuelve exactamente FilaDeLaFicha:
// camposDeLaFicha sigue siendo la forma de referencia, y el test de integración
// compara las dos lecturas campo por campo.

interface CambioCrudo {
  id: string;
  fromStatus: ServiceOrderStatus | null;
  toStatus: ServiceOrderStatus;
  changedAt: number;
  note: string | null;
  changedById: string;
  changedByName: string;
}

interface TipoCrudo {
  id: string;
  name: string;
  nextServiceAfterMonths: number | null;
}

interface AprobacionCruda {
  id: string;
  description: string;
  decision: ServiceOrderApprovalDecision;
  approverName: string;
  channel: ServiceOrderApprovalChannel;
  decidedAt: number;
  amount: string | null;
  currency: string | null;
  createdAt: number;
  recordedById: string;
  recordedByName: string;
}

interface FichaCruda {
  id: string;
  number: number;
  status: ServiceOrderStatus;
  scheduledFor: Date | null;
  createdAt: Date;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  amount: Prisma.Decimal | null;
  currency: string | null;
  customerVehicleId: string;
  contactId: string;
  branchId: string;
  bookingId: string | null;
  assigneeId: string | null;
  mileageIn: number | null;
  damageNotes: string | null;
  notes: string | null;
  receivedAt: Date | null;
  workStartedAt: Date | null;
  readyAt: Date | null;
  cancelReason: string | null;
  nextServiceDueOn: Date | null;
  updatedAt: Date;
  make: string;
  model: string;
  year: number | null;
  licensePlate: string | null;
  firstName: string;
  lastName: string;
  branchName: string;
  assigneeName: string | null;
  createdById: string;
  createdByName: string;
  turnoStartsAt: Date | null;
  turnoEndsAt: Date | null;
  turnoStatus: BookingStatus | null;
  turnoServicio: string | null;
  turnoRecurso: string | null;
  historial: CambioCrudo[];
  tipos: TipoCrudo[];
  aprobaciones: AprobacionCruda[];
}

function aFilaDeLaFicha(f: FichaCruda): FilaDeLaFicha {
  return {
    id: f.id,
    number: f.number,
    status: f.status,
    scheduledFor: f.scheduledFor,
    createdAt: f.createdAt,
    deliveredAt: f.deliveredAt,
    cancelledAt: f.cancelledAt,
    amount: f.amount,
    currency: f.currency,
    customerVehicle: {
      id: f.customerVehicleId,
      make: f.make,
      model: f.model,
      year: f.year,
      licensePlate: f.licensePlate,
    },
    contact: { id: f.contactId, firstName: f.firstName, lastName: f.lastName },
    branch: { id: f.branchId, name: f.branchName },
    assignee:
      f.assigneeId && f.assigneeName !== null
        ? { id: f.assigneeId, fullName: f.assigneeName }
        : null,
    customerVehicleId: f.customerVehicleId,
    contactId: f.contactId,
    branchId: f.branchId,
    bookingId: f.bookingId,
    assigneeId: f.assigneeId,
    mileageIn: f.mileageIn,
    damageNotes: f.damageNotes,
    notes: f.notes,
    receivedAt: f.receivedAt,
    workStartedAt: f.workStartedAt,
    readyAt: f.readyAt,
    cancelReason: f.cancelReason,
    nextServiceDueOn: f.nextServiceDueOn,
    updatedAt: f.updatedAt,
    createdBy: { id: f.createdById, fullName: f.createdByName },
    booking:
      f.bookingId && f.turnoStartsAt && f.turnoEndsAt && f.turnoStatus
        ? {
            id: f.bookingId,
            startsAt: f.turnoStartsAt,
            endsAt: f.turnoEndsAt,
            status: f.turnoStatus,
            serviceType: { name: f.turnoServicio ?? "" },
            resource: { name: f.turnoRecurso ?? "" },
          }
        : null,
    jobTypes: f.tipos.map((t) => ({ serviceJobType: t })),
    approvals: f.aprobaciones.map((a) => ({
      id: a.id,
      description: a.description,
      decision: a.decision,
      approverName: a.approverName,
      channel: a.channel,
      decidedAt: new Date(a.decidedAt),
      amount: a.amount === null ? null : new Prisma.Decimal(a.amount),
      currency: a.currency,
      createdAt: new Date(a.createdAt),
      recordedBy: { id: a.recordedById, fullName: a.recordedByName },
    })),
    statusChanges: f.historial.map((c) => ({
      id: c.id,
      fromStatus: c.fromStatus,
      toStatus: c.toStatus,
      changedAt: new Date(c.changedAt),
      note: c.note,
      changedBy: { id: c.changedById, fullName: c.changedByName },
    })),
  };
}

export async function findOrderById(
  organizationId: string,
  id: string,
  db: Db = prisma,
): Promise<FilaDeLaFicha | null> {
  const filas = await db.$queryRaw<FichaCruda[]>`
    SELECT
      o.id, o.number, o.status::text AS "status", o.scheduled_for AS "scheduledFor",
      o.created_at AS "createdAt", o.delivered_at AS "deliveredAt",
      o.cancelled_at AS "cancelledAt", o.amount, o.currency,
      o.customer_vehicle_id AS "customerVehicleId", o.contact_id AS "contactId",
      o.branch_id AS "branchId", o.booking_id AS "bookingId", o.assignee_id AS "assigneeId",
      o.mileage_in AS "mileageIn", o.damage_notes AS "damageNotes", o.notes,
      o.received_at AS "receivedAt", o.work_started_at AS "workStartedAt",
      o.ready_at AS "readyAt", o.cancel_reason AS "cancelReason",
      o.next_service_due_on AS "nextServiceDueOn", o.updated_at AS "updatedAt",
      v.make, v.model, v.year, v.license_plate AS "licensePlate",
      c.first_name AS "firstName", c.last_name AS "lastName",
      b.name AS "branchName",
      a.full_name AS "assigneeName",
      cb.id AS "createdById", cb.full_name AS "createdByName",
      bk.starts_at AS "turnoStartsAt", bk.ends_at AS "turnoEndsAt",
      bk.status::text AS "turnoStatus", bst.name AS "turnoServicio", br.name AS "turnoRecurso",
      COALESCE((
        SELECT json_agg(json_build_object(
          'id', s.id,
          'fromStatus', s.from_status,
          'toStatus', s.to_status,
          'changedAt', (extract(epoch FROM s.changed_at) * 1000)::bigint,
          'note', s.note,
          'changedById', u.id,
          'changedByName', u.full_name
        ) ORDER BY s.changed_at DESC)
        FROM service_order_status_changes s
        JOIN users u ON u.id = s.changed_by_id
        WHERE s.organization_id = o.organization_id AND s.service_order_id = o.id
      ), '[]'::json) AS "historial",
      COALESCE((
        SELECT json_agg(json_build_object(
          'id', t.id,
          'name', t.name,
          'nextServiceAfterMonths', t.next_service_after_months
        ) ORDER BY ot.created_at ASC)
        FROM service_order_job_types ot
        JOIN service_job_types t ON t.id = ot.service_job_type_id
        WHERE ot.organization_id = o.organization_id AND ot.service_order_id = o.id
      ), '[]'::json) AS "tipos",
      COALESCE((
        SELECT json_agg(json_build_object(
          'id', ap.id,
          'description', ap.description,
          'decision', ap.decision,
          'approverName', ap.approver_name,
          'channel', ap.channel,
          'decidedAt', (extract(epoch FROM ap.decided_at) * 1000)::bigint,
          'amount', ap.amount::text,
          'currency', ap.currency,
          'createdAt', (extract(epoch FROM ap.created_at) * 1000)::bigint,
          'recordedById', r.id,
          'recordedByName', r.full_name
        ) ORDER BY ap.created_at DESC)
        FROM service_order_approvals ap
        JOIN users r ON r.id = ap.recorded_by_id
        WHERE ap.organization_id = o.organization_id AND ap.service_order_id = o.id
      ), '[]'::json) AS "aprobaciones"
    FROM service_orders o
    JOIN customer_vehicles v ON v.id = o.customer_vehicle_id
    JOIN contacts c ON c.id = o.contact_id
    JOIN branches b ON b.id = o.branch_id
    LEFT JOIN users a ON a.id = o.assignee_id
    JOIN users cb ON cb.id = o.created_by_id
    LEFT JOIN bookings bk ON bk.organization_id = o.organization_id AND bk.id = o.booking_id
    LEFT JOIN service_types bst ON bst.organization_id = bk.organization_id AND bst.id = bk.service_type_id
    LEFT JOIN resources br ON br.organization_id = bk.organization_id AND br.id = bk.resource_id
    WHERE o.id = ${id}::uuid AND o.organization_id = ${organizationId}::uuid
  `;
  return filas[0] ? aFilaDeLaFicha(filas[0]) : null;
}

/** La ficha por el camino de Prisma (una consulta por relación). Es la forma
 *  de referencia: el test de integración la compara con findOrderById. */
export async function findOrderByIdConPrisma(
  organizationId: string,
  id: string,
  db: Db = prisma,
): Promise<FilaDeLaFicha | null> {
  return db.serviceOrder.findFirst({ where: { id, organizationId }, select: camposDeLaFicha });
}

/** Lo mínimo para validar una escritura antes de hacerla (una consulta). */
export async function findOrdenParaEscribir(organizationId: string, id: string, db: Db = prisma) {
  return db.serviceOrder.findFirst({
    where: { id, organizationId },
    select: {
      id: true,
      status: true,
      customerVehicleId: true,
      contactId: true,
      // S8: los eventos de la orden llevan la sucursal.
      branchId: true,
      amount: true,
      currency: true,
    },
  });
}

/** Los tipos que la orden ya tiene (ids). */
export async function findIdsDeTiposDeLaOrden(
  organizationId: string,
  serviceOrderId: string,
  db: Db = prisma,
): Promise<string[]> {
  const filas = await db.serviceOrderJobType.findMany({
    where: { organizationId, serviceOrderId },
    select: { serviceJobTypeId: true },
  });
  return filas.map((f) => f.serviceJobTypeId);
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

/** Reemplaza los tipos de la orden por estos. `esNueva`: la orden se acaba de
 *  crear y no tiene tipos que borrar (una consulta menos). */
export async function setJobTypes(
  organizationId: string,
  serviceOrderId: string,
  ids: readonly string[],
  tx: Prisma.TransactionClient,
  { esNueva = false }: { esNueva?: boolean } = {},
): Promise<void> {
  if (!esNueva) {
    await tx.serviceOrderJobType.deleteMany({ where: { organizationId, serviceOrderId } });
  }
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

/** Borrado completo de un contacto (D14, §2.8): el texto de sus órdenes. Las
 *  órdenes quedan, para que los números del taller no cambien.
 *
 *  DAT-03 (docs-privados/auditoria-2026-10-21/informe.md, local): además de
 *  daños y notas, el motivo de cancelación, la nota de cada cambio de estado y
 *  la aprobación (por diseño, `approverName` es el cliente). `description` y
 *  `approverName` son NOT NULL: van al marcador. Los montos y las decisiones
 *  quedan. */
export async function anonimizarOrdenesDelContacto(
  organizationId: string,
  contactId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const deSusOrdenes = { organizationId, serviceOrder: { contactId } };
  await tx.serviceOrder.updateMany({
    where: { organizationId, contactId },
    data: { damageNotes: null, notes: null, cancelReason: null },
  });
  await tx.serviceOrderStatusChange.updateMany({
    where: deSusOrdenes,
    data: { note: null },
  });
  await tx.serviceOrderApproval.updateMany({
    where: deSusOrdenes,
    data: { approverName: MARCADOR_DE_DATO_BORRADO, description: MARCADOR_DE_DATO_BORRADO },
  });
}

/** La zona de la organización. La moneda por defecto ya no sale de acá: es la
 *  del taller (workshop_settings.currency, #12). */
export async function findDatosDeLaOrganizacion(organizationId: string, db: Db = prisma) {
  return db.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });
}

// --- El turno de la agenda (§4.4, S4b) --------------------------------------

/** El turno para vincularlo a una orden, con la fila BLOQUEADA hasta el fin de
 *  la transacción: dos altas simultáneas con el mismo turno se serializan, y
 *  la segunda ve la orden de la primera (findOrdenAbiertaDelTurno). */
export async function lockTurnoParaOrden(
  organizationId: string,
  bookingId: string,
  tx: Prisma.TransactionClient,
) {
  const [fila] = await tx.$queryRaw<
    { id: string; contactId: string; branchId: string; startsAt: Date; status: BookingStatus }[]
  >`
    SELECT id, contact_id AS "contactId", branch_id AS "branchId", starts_at AS "startsAt",
           status::text AS "status"
    FROM bookings
    WHERE organization_id = ${organizationId}::uuid AND id = ${bookingId}::uuid
    FOR UPDATE
  `;
  return fila ?? null;
}

/** La orden ABIERTA vinculada a este turno, si hay (menos `exceptoId`). Una
 *  entregada o cancelada no lo ocupa. */
export async function findOrdenAbiertaDelTurno(
  organizationId: string,
  bookingId: string,
  exceptoId: string | null,
  tx: Prisma.TransactionClient,
) {
  return tx.serviceOrder.findFirst({
    where: {
      organizationId,
      bookingId,
      status: { in: [...ESTADOS_ABIERTOS] },
      ...(exceptoId ? { id: { not: exceptoId } } : {}),
    },
    select: { id: true, number: true },
  });
}

/** Los turnos que se pueden vincular: CONFIRMED y futuros, del contacto, en
 *  las sedes que ve quien pregunta. */
export async function findTurnosVinculables(
  organizationId: string,
  contactId: string,
  sedes: { branchId?: string; branchIds?: readonly string[] },
  desde: Date,
) {
  return prisma.booking.findMany({
    where: {
      organizationId,
      contactId,
      status: "CONFIRMED",
      startsAt: { gte: desde },
      ...(sedes.branchId
        ? { branchId: sedes.branchId }
        : sedes.branchIds
          ? { branchId: { in: [...sedes.branchIds] } }
          : {}),
    },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      branch: { select: { id: true, name: true } },
      serviceType: { select: { name: true } },
      resource: { select: { name: true } },
    },
    orderBy: { startsAt: "asc" },
    take: 50,
  });
}

/** Toma la orden (FOR UPDATE) dentro de una transacción para sumarle el monto
 *  de una aprobación: dos aprobaciones a la vez se suman las dos, en vez de
 *  pisarse con el valor que cada una leyó antes (NEG-TX-1). */
export async function lockOrdenParaSumar(
  organizationId: string,
  id: string,
  tx: Prisma.TransactionClient,
) {
  const [fila] = await tx.$queryRaw<
    { amount: Prisma.Decimal | null; currency: string | null; status: ServiceOrderStatus }[]
  >`
    SELECT amount, currency, status::text AS "status"
    FROM service_orders
    WHERE organization_id = ${organizationId}::uuid AND id = ${id}::uuid
    FOR UPDATE
  `;
  return fila ?? null;
}
