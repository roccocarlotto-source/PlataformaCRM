import { Prisma } from "@prisma/client";
import { OPCIONES_DE_TRANSACCION_LARGA, prisma } from "../../lib/prisma";
import { findZonaDeLaOrganizacion } from "../../repositories/organization.repository";
import { hoyEnLaZona } from "../../services/opportunityClosing";
import { filtroDeSedes, type ActorConSedes } from "../../services/permisos";
import { AppError } from "../../utils/AppError";
import { textoDelVehiculo } from "../recordatorio/config";
import {
  MARGEN_DEL_RECAMBIO,
  fechaDeAviso,
  fechaDeRecambio,
  sumarDias,
  type ConfigDelRecambio,
} from "./config";
import {
  avisosDeRecambio,
  claveDeAviso,
  configDelRecambioDe,
  crearAvisoDeRecambio,
  vehiculosParaElRecambio,
} from "./repository";
import { crearTareaDelRecambio } from "./tarea";

// ---------------------------------------------------------------------------
// Recambios vencidos sin contactar (docs/servicios.md §7.4, S13): los
// vehículos cuyo aviso de recambio ya quedó afuera de la ventana del barrido
// (sobre todo, las ventas viejas cargadas al activar el módulo). Taller →
// Recambios, paginada de a 50 (decisión de Rocco, 2026-10-15).
//
// Un vehículo vigente con fecha de compra cuenta si:
//   1. su fecha de aviso (compra + meses − días, con la config de la regla o
//      los defaults) es anterior a hoy − 7;
//   2. no tiene un aviso de recambio (automático o manual) para esa fecha;
//   3. su cliente está vigente, sin "sin interés", sin una oportunidad abierta
//      y sin una oportunidad creada después de la fecha de aviso.
//
// "Crear tarea al vendedor" y "Marcar como contactado" registran un aviso
// MANUAL (con quién) y el vehículo sale de la lista.
// ---------------------------------------------------------------------------

export const ACCIONES_DEL_RECAMBIO = ["TAREA", "CONTACTADO"] as const;
export type AccionDelRecambio = (typeof ACCIONES_DEL_RECAMBIO)[number];

export interface RecambioVencido {
  id: string;
  cliente: string;
  vehiculo: string;
  vendedor: string | null;
  // "AAAA-MM-DD"
  compra: string;
  recambio: string;
  aviso: string;
  // Días desde la fecha de aviso.
  vencidoHace: number;
}

const DIA_MS = 24 * 60 * 60 * 1000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Todos los vencidos de la organización, del más viejo al más nuevo. */
async function vencidos(
  organizationId: string,
  sedes: Prisma.CustomerVehicleWhereInput,
  config: ConfigDelRecambio,
  hoy: Date,
): Promise<RecambioVencido[]> {
  const limite = sumarDias(hoy, -MARGEN_DEL_RECAMBIO);
  const filas = await prisma.customerVehicle.findMany({
    where: vehiculosParaElRecambio(organizationId, sedes),
    select: {
      id: true,
      make: true,
      model: true,
      licensePlate: true,
      purchasedOn: true,
      contact: {
        select: {
          firstName: true,
          lastName: true,
          owner: { select: { fullName: true } },
          // La oportunidad más nueva: si se creó después del aviso, ya hubo
          // una conversación comercial.
          opportunities: {
            where: { deletedAt: null },
            select: { createdAt: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });
  const posibles = filas
    .map((v) => ({ v, aviso: fechaDeAviso(v.purchasedOn!, config) }))
    .filter(({ aviso }) => aviso.getTime() < limite.getTime())
    .filter(({ v, aviso }) => {
      const ultima = v.contact.opportunities[0]?.createdAt;
      return !ultima || ultima.getTime() <= aviso.getTime();
    });
  if (posibles.length === 0) return [];
  const yaAvisados = new Set(
    (
      await avisosDeRecambio(
        organizationId,
        posibles.map(({ v }) => v.id),
      )
    ).map((a) => claveDeAviso(a.customerVehicleId, a.dueOn)),
  );
  return posibles
    .map(({ v, aviso }) => ({ v, aviso, recambio: fechaDeRecambio(v.purchasedOn!, config) }))
    .filter(({ v, recambio }) => !yaAvisados.has(claveDeAviso(v.id, recambio)))
    .sort((a, b) => a.aviso.getTime() - b.aviso.getTime() || a.v.id.localeCompare(b.v.id))
    .map(({ v, aviso, recambio }) => ({
      id: v.id,
      cliente: `${v.contact.firstName} ${v.contact.lastName}`.trim(),
      vehiculo: textoDelVehiculo(v),
      vendedor: v.contact.owner?.fullName ?? null,
      compra: iso(v.purchasedOn!),
      recambio: iso(recambio),
      aviso: iso(aviso),
      vencidoHace: Math.round((hoy.getTime() - aviso.getTime()) / DIA_MS),
    }));
}

function deLasSedes(actor: ActorConSedes, branchId?: string): Prisma.CustomerVehicleWhereInput {
  const sedes = filtroDeSedes(actor, branchId);
  if (sedes.branchId) return { branchId: sedes.branchId };
  if (sedes.branchIds) return { branchId: { in: [...sedes.branchIds] } };
  return {};
}

export async function listarRecambiosVencidos(
  organizationId: string,
  actor: ActorConSedes,
  params: { page: number; pageSize: number; branchId?: string },
  ahora: Date = new Date(),
) {
  const [config, zona] = await Promise.all([
    configDelRecambioDe(organizationId),
    findZonaDeLaOrganizacion(organizationId),
  ]);
  const todos = await vencidos(
    organizationId,
    deLasSedes(actor, params.branchId),
    config,
    hoyEnLaZona(zona, ahora),
  );
  const { page, pageSize } = params;
  return {
    data: todos.slice((page - 1) * pageSize, page * pageSize),
    pagination: {
      page,
      pageSize,
      total: todos.length,
      totalPages: todos.length === 0 ? 0 : Math.ceil(todos.length / pageSize),
    },
  };
}

/** Para la tarjeta del resumen. */
export async function contarRecambiosVencidos(
  organizationId: string,
  actor: ActorConSedes,
  branchId: string | undefined,
  ahora: Date = new Date(),
): Promise<number> {
  return (
    await listarRecambiosVencidos(organizationId, actor, { page: 1, pageSize: 1, branchId }, ahora)
  ).pagination.total;
}

/** "Crear tarea al vendedor" o "Marcar como contactado" (§7.4): un aviso
 *  MANUAL para la fecha de recambio de hoy, con quién; con TAREA, además la
 *  tarea de §7.3 con la cadena de ventas. Si ya tenía el aviso, 409. */
export async function registrarAvisoDeRecambio(
  organizationId: string,
  userId: string,
  customerVehicleId: string,
  accion: AccionDelRecambio,
): Promise<{ resultado: "REGISTRADO" }> {
  const v = await prisma.customerVehicle.findFirst({
    where: { id: customerVehicleId, organizationId, deletedAt: null },
    select: { purchasedOn: true, ownershipEndedAt: true },
  });
  if (!v) throw new AppError("Vehículo no encontrado", 404);
  if (v.ownershipEndedAt) throw new AppError("Este vehículo ya no es de un cliente.", 409);
  if (!v.purchasedOn) {
    throw new AppError("El vehículo no tiene fecha de compra: no tiene recambio.", 400);
  }
  const recambio = fechaDeRecambio(v.purchasedOn, await configDelRecambioDe(organizationId));
  try {
    await prisma.$transaction(async (tx) => {
      const aviso = await crearAvisoDeRecambio(
        {
          organizationId,
          customerVehicleId,
          dueOn: recambio,
          source: "MANUAL",
          createdById: userId,
        },
        tx,
      );
      if (accion === "TAREA") {
        const r = await crearTareaDelRecambio(
          { organizationId, customerVehicleId, noticeId: aviso.id },
          tx,
        );
        if (r === "SIN_ASIGNADO") {
          throw new AppError("No hay a quién asignarle la tarea: no hay usuarios activos.", 409);
        }
      }
    }, OPCIONES_DE_TRANSACCION_LARGA);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError("Este recambio ya estaba registrado.", 409);
    }
    throw err;
  }
  return { resultado: "REGISTRADO" };
}
