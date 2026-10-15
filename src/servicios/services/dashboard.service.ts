import type { Prisma, ServiceOrderStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { findZonaDeLaOrganizacion } from "../../repositories/organization.repository";
import { hoyEnLaZona } from "../../services/opportunityClosing";
import { filtroDeSedes, type ActorConSedes } from "../../services/permisos";
import { formatearNumeroDeOrden } from "../identificadores";
import { textoDelVehiculo } from "../recordatorio/config";
import { ESTADOS_FINALES_DE_ORDEN } from "../repositories/customerVehicle.repository";

// ---------------------------------------------------------------------------
// El resumen del taller (docs/servicios.md §4.7, S11): Taller → Resumen y el
// bloque del inicio. Solo lectura, detrás del gate del módulo.
//
//   - "Hoy" es el de la zona de la organización. next_service_due_on es una
//     fecha sin hora: se compara como fecha (hoyEnLaZona devuelve el día local
//     como medianoche UTC, igual que se guarda una @db.Date).
//   - Los vehículos cuentan solo vigentes, sin orden abierta y sin "No
//     recordar" (§4.7: es la lista para llamar).
//   - Cada lista trae hasta LIMITE elementos y el total: la pantalla dice
//     "y N más" (decisión de Rocco, 2026-10-15).
//   - Respeta las sucursales del usuario (filtroDeSedes), como las órdenes y
//     los vehículos.
//   - Las tarjetas de recambio son de S13.
// ---------------------------------------------------------------------------

export const LIMITE_POR_TARJETA = 10;
export const HORAS_ESPERANDO_APROBACION = 24;
export const DIAS_PROXIMOS_SERVICES = 30;

const ESTADOS_EN_EL_TALLER: ServiceOrderStatus[] = [
  "RECIBIDO",
  "EN_TRABAJO",
  "ESPERANDO_APROBACION",
];

export interface OrdenDelResumen {
  id: string;
  numero: string;
  cliente: string;
  vehiculo: string;
  // Desde cuándo está en ese estado (instante ISO).
  desde: string | null;
}

export interface VehiculoDelResumen {
  id: string;
  cliente: string;
  vehiculo: string;
  // La fecha del próximo service, "AAAA-MM-DD".
  fecha: string;
}

export interface Lista<T> {
  total: number;
  items: T[];
}

export interface ResumenDelTaller {
  hoy: string;
  enElTaller: { total: number; porEstado: Record<string, number> };
  listosParaRetirar: Lista<OrdenDelResumen>;
  esperandoAprobacion: Lista<OrdenDelResumen>;
  servicesVencidos: Lista<VehiculoDelResumen>;
  servicesEn30Dias: Lista<VehiculoDelResumen>;
  turnosCancelados: Lista<OrdenDelResumen>;
}

const nombre = (c: { firstName: string; lastName: string }) =>
  `${c.firstName} ${c.lastName}`.trim();

const camposDeLaOrden = {
  id: true,
  number: true,
  contact: { select: { firstName: true, lastName: true } },
  customerVehicle: { select: { make: true, model: true, licensePlate: true } },
} satisfies Prisma.ServiceOrderSelect;

function aOrden(
  o: Prisma.ServiceOrderGetPayload<{ select: typeof camposDeLaOrden }>,
  desde: Date | null,
): OrdenDelResumen {
  return {
    id: o.id,
    numero: formatearNumeroDeOrden(o.number),
    cliente: nombre(o.contact),
    vehiculo: textoDelVehiculo(o.customerVehicle),
    desde: desde?.toISOString() ?? null,
  };
}

const camposDelVehiculo = {
  id: true,
  make: true,
  model: true,
  licensePlate: true,
  nextServiceDueOn: true,
  contact: { select: { firstName: true, lastName: true } },
} satisfies Prisma.CustomerVehicleSelect;

function aVehiculo(
  v: Prisma.CustomerVehicleGetPayload<{ select: typeof camposDelVehiculo }>,
): VehiculoDelResumen {
  return {
    id: v.id,
    cliente: nombre(v.contact),
    vehiculo: textoDelVehiculo(v),
    fecha: (v.nextServiceDueOn as Date).toISOString().slice(0, 10),
  };
}

function sumarDias(fecha: Date, dias: number): Date {
  return new Date(fecha.getTime() + dias * 24 * 60 * 60 * 1000);
}

export async function resumenDelTaller(
  organizationId: string,
  actor: ActorConSedes,
  branchId?: string,
  ahora: Date = new Date(),
): Promise<ResumenDelTaller> {
  const sedes = filtroDeSedes(actor, branchId);
  const deLaSede: { branchId?: string | { in: string[] } } = sedes.branchId
    ? { branchId: sedes.branchId }
    : sedes.branchIds
      ? { branchId: { in: [...sedes.branchIds] } }
      : {};
  const ordenes = { organizationId, ...deLaSede };
  const hoy = hoyEnLaZona(await findZonaDeLaOrganizacion(organizationId), ahora);

  // Vehículos para llamar: vigentes, sin "No recordar" y sin orden abierta.
  const paraLlamar = {
    organizationId,
    ...deLaSede,
    deletedAt: null,
    ownershipEndedAt: null,
    remindersOptOut: false,
    serviceOrders: { none: { status: { notIn: [...ESTADOS_FINALES_DE_ORDEN] } } },
  } satisfies Prisma.CustomerVehicleWhereInput;
  const vencidos = { ...paraLlamar, nextServiceDueOn: { lt: hoy } };
  const proximos = {
    ...paraLlamar,
    nextServiceDueOn: { gte: hoy, lte: sumarDias(hoy, DIAS_PROXIMOS_SERVICES) },
  };
  const listos = { ...ordenes, status: "LISTO_PARA_RETIRAR" as const };
  const cancelados = {
    ...ordenes,
    status: "AGENDADO" as const,
    booking: { status: "CANCELLED" as const },
  };

  const [
    porEstado,
    listosTotal,
    listosItems,
    esperando,
    vencidosTotal,
    vencidosItems,
    proximosTotal,
    proximosItems,
    canceladosTotal,
    canceladosItems,
  ] = await Promise.all([
    prisma.serviceOrder.groupBy({
      by: ["status"],
      where: { ...ordenes, status: { in: ESTADOS_EN_EL_TALLER } },
      _count: { _all: true },
    }),
    prisma.serviceOrder.count({ where: listos }),
    prisma.serviceOrder.findMany({
      where: listos,
      select: { ...camposDeLaOrden, readyAt: true },
      orderBy: [{ readyAt: "asc" }, { number: "asc" }],
      take: LIMITE_POR_TARJETA,
    }),
    // Desde cuándo espera: su último paso a Esperando aprobación.
    prisma.serviceOrder.findMany({
      where: { ...ordenes, status: "ESPERANDO_APROBACION" },
      select: {
        ...camposDeLaOrden,
        statusChanges: {
          where: { toStatus: "ESPERANDO_APROBACION" },
          select: { changedAt: true },
          orderBy: { changedAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.customerVehicle.count({ where: vencidos }),
    prisma.customerVehicle.findMany({
      where: vencidos,
      select: camposDelVehiculo,
      orderBy: [{ nextServiceDueOn: "asc" }, { id: "asc" }],
      take: LIMITE_POR_TARJETA,
    }),
    prisma.customerVehicle.count({ where: proximos }),
    prisma.customerVehicle.findMany({
      where: proximos,
      select: camposDelVehiculo,
      orderBy: [{ nextServiceDueOn: "asc" }, { id: "asc" }],
      take: LIMITE_POR_TARJETA,
    }),
    prisma.serviceOrder.count({ where: cancelados }),
    prisma.serviceOrder.findMany({
      where: cancelados,
      select: { ...camposDeLaOrden, scheduledFor: true },
      orderBy: [{ scheduledFor: "asc" }, { number: "asc" }],
      take: LIMITE_POR_TARJETA,
    }),
  ]);

  const conteo = Object.fromEntries(ESTADOS_EN_EL_TALLER.map((e) => [e, 0]));
  for (const fila of porEstado) conteo[fila.status] = fila._count._all;

  // Las órdenes esperando aprobación son pocas: el filtro de 24 h va acá.
  const limite = ahora.getTime() - HORAS_ESPERANDO_APROBACION * 60 * 60 * 1000;
  const colgadas = esperando
    .map((o) => ({ o, desde: o.statusChanges[0]?.changedAt ?? null }))
    .filter(({ desde }) => desde !== null && desde.getTime() <= limite)
    .sort((a, b) => a.desde!.getTime() - b.desde!.getTime());

  return {
    hoy: hoy.toISOString().slice(0, 10),
    enElTaller: {
      total: Object.values(conteo).reduce((a, b) => a + b, 0),
      porEstado: conteo,
    },
    listosParaRetirar: {
      total: listosTotal,
      items: listosItems.map((o) => aOrden(o, o.readyAt)),
    },
    esperandoAprobacion: {
      total: colgadas.length,
      items: colgadas.slice(0, LIMITE_POR_TARJETA).map(({ o, desde }) => aOrden(o, desde)),
    },
    servicesVencidos: { total: vencidosTotal, items: vencidosItems.map(aVehiculo) },
    servicesEn30Dias: { total: proximosTotal, items: proximosItems.map(aVehiculo) },
    turnosCancelados: {
      total: canceladosTotal,
      items: canceladosItems.map((o) => aOrden(o, o.scheduledFor)),
    },
  };
}
