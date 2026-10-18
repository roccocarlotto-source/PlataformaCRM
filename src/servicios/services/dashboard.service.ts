import { Prisma, type ServiceOrderStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { findZonaDeLaOrganizacion } from "../../repositories/organization.repository";
import { hoyEnLaZona } from "../../services/opportunityClosing";
import { filtroDeSedes, type ActorConSedes } from "../../services/permisos";
import { formatearNumeroDeOrden } from "../identificadores";
import { textoDelVehiculo } from "../recordatorio/config";
import { ESTADOS_FINALES_DE_ORDEN } from "../repositories/customerVehicle.repository";
import { fechaDeRecambio } from "../recambio/config";
import {
  avisosDeRecambio,
  claveDeAviso,
  configDelRecambioDe,
  vehiculosParaElRecambio,
} from "../recambio/repository";
import { avisoSiEstaVencido, contarRecambiosVencidos } from "../recambio/lista.service";

// S13 (§7): los recambios próximos son los de los próximos 90 días.
export const DIAS_RECAMBIOS_PROXIMOS = 90;

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
  // S13: los recambios de los próximos 90 días, y cuántos vehículos no tienen
  // fecha de compra (no tienen recambio: hay que completarla, D12).
  recambiosProximos: { total: number; sinFechaDeCompra: number };
  // S13 (§7.4): el total de la lista de vencidos sin contactar.
  recambiosVencidos: { total: number };
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

// ---------------------------------------------------------------------------
// MENOS CONSULTAS (ensayo de la demo del 2026-10-17): el Resumen del taller
// tardaba 8-9 s en producción con 31 consultas. Prisma resuelve cada relación
// de un `select` (el contacto y el vehículo de cada tarjeta) en una consulta
// aparte, y la zona y la regla del recambio se leían dos veces. Ahora:
//
//   1. la zona de la organización;
//   2. TODAS las órdenes que cuentan (en el taller, listas, y agendadas con el
//      turno cancelado), con cliente, vehículo y desde cuándo esperan
//      aprobación: los conteos y las listas salen de esas filas;
//   3. los vehículos de services vencidos y de los próximos 30 días, hasta
//      LIMITE_POR_TARJETA de cada grupo con su total (row_number y count
//      sobre la partición);
//   4-7. la regla del recambio, los vehículos con fecha de compra (una sola
//      vez, para los próximos y los vencidos), los avisos de los candidatos y
//      los que no tienen fecha de compra.
//
// La lectura de antes queda como resumenDelTallerConPrisma: los tests
// comparan las dos, campo por campo (como la ficha de la orden, #519).
// ---------------------------------------------------------------------------

interface OrdenCruda {
  id: string;
  number: number;
  status: ServiceOrderStatus;
  readyAt: Date | null;
  scheduledFor: Date | null;
  bookingCancelado: boolean;
  esperandoDesde: Date | null;
  firstName: string;
  lastName: string;
  make: string;
  model: string;
  licensePlate: string | null;
}

interface VehiculoCrudo {
  grupo: "vencidos" | "proximos";
  total: bigint;
  id: string;
  make: string;
  model: string;
  licensePlate: string | null;
  nextServiceDueOn: Date;
  firstName: string;
  lastName: string;
}

type DeLaSede = { branchId?: string | { in: string[] } };

const fechaTexto = (d: Date) => d.toISOString().slice(0, 10);

function filtroDeSedeEnSql(columna: Prisma.Sql, deLaSede: DeLaSede): Prisma.Sql {
  const sede = deLaSede.branchId;
  if (sede === undefined) return Prisma.empty;
  if (typeof sede === "string") return Prisma.sql`AND ${columna} = ${sede}::uuid`;
  return Prisma.sql`AND ${columna} = ANY(${sede.in}::uuid[])`;
}

// Ascendente con los null al final y desempate por número: el orderBy de
// Prisma en Postgres.
function porFechaYNumero(
  fecha: (o: OrdenCruda) => Date | null,
): (a: OrdenCruda, b: OrdenCruda) => number {
  return (a, b) => {
    const fa = fecha(a);
    const fb = fecha(b);
    if (fa && fb && fa.getTime() !== fb.getTime()) return fa.getTime() - fb.getTime();
    if (fa && !fb) return -1;
    if (!fa && fb) return 1;
    return a.number - b.number;
  };
}

function aOrdenCruda(o: OrdenCruda, desde: Date | null): OrdenDelResumen {
  return {
    id: o.id,
    numero: formatearNumeroDeOrden(o.number),
    cliente: nombre(o),
    vehiculo: textoDelVehiculo(o),
    desde: desde?.toISOString() ?? null,
  };
}

function deLaSedeDe(actor: ActorConSedes, branchId?: string): DeLaSede {
  const sedes = filtroDeSedes(actor, branchId);
  return sedes.branchId
    ? { branchId: sedes.branchId }
    : sedes.branchIds
      ? { branchId: { in: [...sedes.branchIds] } }
      : {};
}

export async function resumenDelTaller(
  organizationId: string,
  actor: ActorConSedes,
  branchId?: string,
  ahora: Date = new Date(),
): Promise<ResumenDelTaller> {
  const deLaSede = deLaSedeDe(actor, branchId);
  const hoy = hoyEnLaZona(await findZonaDeLaOrganizacion(organizationId), ahora);
  const hasta = sumarDias(hoy, DIAS_PROXIMOS_SERVICES);

  const [ordenesCrudas, vehiculosCrudos, recambios] = await Promise.all([
    prisma.$queryRaw<OrdenCruda[]>`
      SELECT
        o.id, o.number, o.status::text AS "status", o.ready_at AS "readyAt",
        o.scheduled_for AS "scheduledFor",
        COALESCE(b.status = 'CANCELLED', false) AS "bookingCancelado",
        CASE WHEN o.status = 'ESPERANDO_APROBACION' THEN (
          SELECT max(s.changed_at) FROM service_order_status_changes s
          WHERE s.organization_id = o.organization_id AND s.service_order_id = o.id
            AND s.to_status = 'ESPERANDO_APROBACION'
        ) END AS "esperandoDesde",
        c.first_name AS "firstName", c.last_name AS "lastName",
        v.make, v.model, v.license_plate AS "licensePlate"
      FROM service_orders o
      JOIN contacts c ON c.id = o.contact_id
      JOIN customer_vehicles v ON v.id = o.customer_vehicle_id
      LEFT JOIN bookings b ON b.id = o.booking_id
      WHERE o.organization_id = ${organizationId}::uuid
        ${filtroDeSedeEnSql(Prisma.sql`o.branch_id`, deLaSede)}
        AND (
          o.status IN ('RECIBIDO', 'EN_TRABAJO', 'ESPERANDO_APROBACION', 'LISTO_PARA_RETIRAR')
          OR (o.status = 'AGENDADO' AND b.status = 'CANCELLED')
        )
    `,
    prisma.$queryRaw<VehiculoCrudo[]>`
      WITH para_llamar AS (
        SELECT
          CASE WHEN v.next_service_due_on < ${fechaTexto(hoy)}::date
            THEN 'vencidos' ELSE 'proximos' END AS grupo,
          v.id, v.make, v.model, v.license_plate AS "licensePlate",
          v.next_service_due_on AS "nextServiceDueOn",
          c.first_name AS "firstName", c.last_name AS "lastName"
        FROM customer_vehicles v
        JOIN contacts c ON c.id = v.contact_id
        WHERE v.organization_id = ${organizationId}::uuid
          ${filtroDeSedeEnSql(Prisma.sql`v.branch_id`, deLaSede)}
          AND v.deleted_at IS NULL
          AND v.ownership_ended_at IS NULL
          AND v.reminders_opt_out = false
          AND v.next_service_due_on <= ${fechaTexto(hasta)}::date
          AND NOT EXISTS (
            SELECT 1 FROM service_orders o
            WHERE o.organization_id = v.organization_id AND o.customer_vehicle_id = v.id
              AND o.status NOT IN ('ENTREGADO', 'CANCELADO')
          )
      ), numerados AS (
        SELECT para_llamar.*,
          row_number() OVER (PARTITION BY grupo ORDER BY "nextServiceDueOn", id) AS n,
          count(*) OVER (PARTITION BY grupo) AS total
        FROM para_llamar
      )
      SELECT grupo, total, id, make, model, "licensePlate", "nextServiceDueOn",
        "firstName", "lastName"
      FROM numerados
      WHERE n <= ${LIMITE_POR_TARJETA}
      ORDER BY grupo, n
    `,
    recambiosEnPocasConsultas(organizationId, deLaSede, hoy),
  ]);

  const conteo = Object.fromEntries(ESTADOS_EN_EL_TALLER.map((e) => [e, 0]));
  for (const o of ordenesCrudas) if (o.status in conteo) conteo[o.status]++;

  const listos = ordenesCrudas
    .filter((o) => o.status === "LISTO_PARA_RETIRAR")
    .sort(porFechaYNumero((o) => o.readyAt));
  const cancelados = ordenesCrudas
    .filter((o) => o.status === "AGENDADO" && o.bookingCancelado)
    .sort(porFechaYNumero((o) => o.scheduledFor));
  // El filtro de 24 h, como en la lectura de antes.
  const limite = ahora.getTime() - HORAS_ESPERANDO_APROBACION * 60 * 60 * 1000;
  const colgadas = ordenesCrudas
    .filter((o) => o.status === "ESPERANDO_APROBACION")
    .filter((o) => o.esperandoDesde !== null && o.esperandoDesde.getTime() <= limite)
    .sort((a, b) => a.esperandoDesde!.getTime() - b.esperandoDesde!.getTime());

  const delGrupo = (grupo: VehiculoCrudo["grupo"]): Lista<VehiculoDelResumen> => {
    const filas = vehiculosCrudos.filter((v) => v.grupo === grupo);
    return {
      total: filas.length === 0 ? 0 : Number(filas[0].total),
      items: filas.map((v) => ({
        id: v.id,
        cliente: nombre(v),
        vehiculo: textoDelVehiculo(v),
        fecha: fechaTexto(v.nextServiceDueOn),
      })),
    };
  };

  return {
    hoy: fechaTexto(hoy),
    enElTaller: {
      total: Object.values(conteo).reduce((a, b) => a + b, 0),
      porEstado: conteo,
    },
    listosParaRetirar: {
      total: listos.length,
      items: listos.slice(0, LIMITE_POR_TARJETA).map((o) => aOrdenCruda(o, o.readyAt)),
    },
    esperandoAprobacion: {
      total: colgadas.length,
      items: colgadas.slice(0, LIMITE_POR_TARJETA).map((o) => aOrdenCruda(o, o.esperandoDesde)),
    },
    servicesVencidos: delGrupo("vencidos"),
    servicesEn30Dias: delGrupo("proximos"),
    turnosCancelados: {
      total: cancelados.length,
      items: cancelados.slice(0, LIMITE_POR_TARJETA).map((o) => aOrdenCruda(o, o.scheduledFor)),
    },
    ...recambios,
  };
}

/** Las dos tarjetas de recambio con la regla leída una vez y los vehículos
 *  con fecha de compra traídos una vez: los mismos números que
 *  recambiosDelResumen (la lista de vencidos, §7.4, y los próximos 90 días). */
async function recambiosEnPocasConsultas(
  organizationId: string,
  deLaSede: DeLaSede,
  hoy: Date,
): Promise<Pick<ResumenDelTaller, "recambiosProximos" | "recambiosVencidos">> {
  const [config, conCompra, sinFechaDeCompra] = await Promise.all([
    configDelRecambioDe(organizationId),
    // Los de vehiculosParaElRecambio (recambio/repository.ts), con la fecha de
    // la oportunidad más nueva del cliente.
    prisma.$queryRaw<{ id: string; purchasedOn: Date; ultimaOportunidad: Date | null }[]>`
      SELECT v.id, v.purchased_on AS "purchasedOn",
        (SELECT max(op.created_at) FROM opportunities op
          WHERE op.organization_id = v.organization_id AND op.contact_id = v.contact_id
            AND op.deleted_at IS NULL) AS "ultimaOportunidad"
      FROM customer_vehicles v
      JOIN contacts c ON c.id = v.contact_id
      WHERE v.organization_id = ${organizationId}::uuid
        ${filtroDeSedeEnSql(Prisma.sql`v.branch_id`, deLaSede)}
        AND v.deleted_at IS NULL
        AND v.ownership_ended_at IS NULL
        AND v.purchased_on IS NOT NULL
        AND c.deleted_at IS NULL
        AND c.no_interest_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM opportunities op
          WHERE op.organization_id = v.organization_id AND op.contact_id = v.contact_id
            AND op.status = 'OPEN' AND op.deleted_at IS NULL
        )
    `,
    prisma.customerVehicle.count({
      where: {
        organizationId,
        ...deLaSede,
        deletedAt: null,
        ownershipEndedAt: null,
        purchasedOn: null,
      },
    }),
  ]);

  const hastaElRecambio = sumarDias(hoy, DIAS_RECAMBIOS_PROXIMOS).getTime();
  let proximos = 0;
  const candidatos: { id: string; recambio: Date }[] = [];
  for (const v of conCompra) {
    const recambio = fechaDeRecambio(v.purchasedOn, config);
    if (recambio.getTime() >= hoy.getTime() && recambio.getTime() <= hastaElRecambio) proximos++;
    if (avisoSiEstaVencido(v.purchasedOn, v.ultimaOportunidad, config, hoy)) {
      candidatos.push({ id: v.id, recambio });
    }
  }
  const yaAvisados = new Set(
    candidatos.length === 0
      ? []
      : (
          await avisosDeRecambio(
            organizationId,
            candidatos.map((c) => c.id),
          )
        ).map((a) => claveDeAviso(a.customerVehicleId, a.dueOn)),
  );
  return {
    recambiosProximos: { total: proximos, sinFechaDeCompra },
    recambiosVencidos: {
      total: candidatos.filter((c) => !yaAvisados.has(claveDeAviso(c.id, c.recambio))).length,
    },
  };
}

/** La lectura de antes, con Prisma: queda solo para que los tests comparen
 *  (resumenDelTaller tiene que dar lo mismo, campo por campo). */
export async function resumenDelTallerConPrisma(
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
    ...(await recambiosDelResumen(organizationId, actor, branchId, deLaSede, hoy, ahora)),
  };
}

async function recambiosDelResumen(
  organizationId: string,
  actor: ActorConSedes,
  branchId: string | undefined,
  deLaSede: { branchId?: string | { in: string[] } },
  hoy: Date,
  ahora: Date,
): Promise<Pick<ResumenDelTaller, "recambiosProximos" | "recambiosVencidos">> {
  const config = await configDelRecambioDe(organizationId);
  const [conCompra, sinFechaDeCompra, vencidos] = await Promise.all([
    prisma.customerVehicle.findMany({
      where: vehiculosParaElRecambio(organizationId, deLaSede),
      select: { purchasedOn: true },
    }),
    prisma.customerVehicle.count({
      where: {
        organizationId,
        ...deLaSede,
        deletedAt: null,
        ownershipEndedAt: null,
        purchasedOn: null,
      },
    }),
    contarRecambiosVencidos(organizationId, actor, branchId, ahora),
  ]);
  const hasta = sumarDias(hoy, DIAS_RECAMBIOS_PROXIMOS).getTime();
  const proximos = conCompra.filter(({ purchasedOn }) => {
    const recambio = fechaDeRecambio(purchasedOn!, config).getTime();
    return recambio >= hoy.getTime() && recambio <= hasta;
  }).length;
  return {
    recambiosProximos: { total: proximos, sinFechaDeCompra },
    recambiosVencidos: { total: vencidos },
  };
}
