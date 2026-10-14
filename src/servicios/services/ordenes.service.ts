import { Prisma, type ServiceOrderStatus } from "@prisma/client";
import { OPCIONES_DE_TRANSACCION_LARGA, prisma } from "../../lib/prisma";
import { filtroDeSedes, type ActorConSedes } from "../../services/permisos";
import { AppError } from "../../utils/AppError";
import { esAbierto, puedePasar } from "../config/estados";
import { formatearNumeroDeOrden, normalizarIdentificador } from "../identificadores";
import { proponerProximoService } from "../proximoService";
import {
  findCustomerVehicleById,
  updateCustomerVehicle,
} from "../repositories/customerVehicle.repository";
import { findJobTypesActivos } from "../repositories/serviceJobType.repository";
import {
  countOrders,
  createApproval,
  createOrder,
  createStatusChange,
  existeUsuarioActivo,
  findDatosDeLaOrganizacion,
  findManyOrders,
  findOrdenEnElTaller,
  findOrderById,
  hayAprobacionDesde,
  setJobTypes,
  ultimaEntradaA,
  updateOrdenAbierta,
  updateSiEstaEn,
  type FilaDeLaFicha,
  type FilaDeLaLista,
} from "../repositories/serviceOrder.repository";
import {
  leerConfiguracionDelTaller,
  tomarNumeroDeOrden,
} from "../repositories/workshopSettings.repository";
import { exigirContacto, exigirSucursal } from "./vehiculos.service";

// ---------------------------------------------------------------------------
// Órdenes de servicio (docs/servicios.md §2.3–§2.5, §3 y §4.2–§4.3; S4a).
//
// Reglas:
//   - Una orden nace en Agendado (con fecha) o en Recibido (con km).
//   - El número es consecutivo por organización (D18), sin huecos.
//   - El mismo auto no puede estar dos veces DENTRO del taller (de Recibido a
//     Listo): lo garantiza un índice único parcial de la base, y su violación
//     es un 409 con la orden que lo ocupa. Agendado queda fuera.
//   - El estado cambia solo por POST /estado, condicional sobre `desde`: si
//     alguien la movió antes, 409. Cada cambio deja su fila en el historial.
//   - Salir de Esperando aprobación exige una aprobación registrada después de
//     entrar a ese estado (§2.5).
//   - Entregado y Cancelado son finales (D11): no se mueven ni se editan.
//   - Los eventos de la orden llegan con S8; las fotos con S5.
// ---------------------------------------------------------------------------

export const ORDEN_NO_ENCONTRADA = "Orden no encontrada";
export const ORDEN_MOVIDA =
  "La orden cambió de estado mientras tanto. Volvé a abrirla para ver cómo está.";
export const ORDEN_FINAL = "La orden ya está entregada o cancelada: no se puede modificar.";
export const VEHICULO_EN_EL_TALLER = "VEHICULO_EN_EL_TALLER";
export const FALTA_REGISTRAR_LA_APROBACION = "FALTA_REGISTRAR_LA_APROBACION";

type Monto = number;

export interface CrearOrdenInput {
  customerVehicleId: string;
  contactId?: string;
  branchId?: string;
  estado: "AGENDADO" | "RECIBIDO";
  scheduledFor?: Date | null;
  mileageIn?: number | null;
  assigneeId?: string | null;
  jobTypeIds?: string[];
  notes?: string | null;
  damageNotes?: string | null;
  amount?: Monto | null;
  currency?: string | null;
}

export interface ActualizarOrdenInput {
  assigneeId?: string | null;
  scheduledFor?: Date | null;
  mileageIn?: number | null;
  damageNotes?: string | null;
  notes?: string | null;
  amount?: Monto | null;
  currency?: string | null;
  jobTypeIds?: string[];
}

export interface CambiarEstadoInput {
  desde: ServiceOrderStatus;
  hacia: ServiceOrderStatus;
  nota?: string | null;
  mileageIn?: number;
  cancelReason?: string;
  // Solo al entregar: la fecha confirmada ("AAAA-MM-DD") o null = sin próximo
  // service. Tiene que venir (no undefined): la persona eligió.
  proximoService?: string | null;
}

export interface AprobacionInput {
  description: string;
  decision: "APROBADO" | "RECHAZADO";
  approverName: string;
  channel: "TELEFONO" | "WHATSAPP" | "PRESENCIAL" | "OTRO";
  decidedAt: Date;
  amount?: Monto | null;
  currency?: string | null;
  sumarAlValor?: boolean;
}

export interface ListarOrdenesParams {
  page: number;
  pageSize: number;
  estados?: ServiceOrderStatus[];
  branchId?: string;
  assigneeId?: string;
  customerVehicleId?: string;
  desde?: Date;
  hasta?: Date;
  q?: string;
}

// --- Respuesta -------------------------------------------------------------

function deFecha(fecha: Date | null): string | null {
  return fecha ? fecha.toISOString().slice(0, 10) : null;
}

function deMonto(monto: Prisma.Decimal | null): string | null {
  return monto === null ? null : monto.toFixed(2);
}

export function aOrdenDeLista(fila: FilaDeLaLista) {
  const { number, amount, statusChanges, customerVehicle, ...resto } = fila;
  return {
    ...resto,
    numero: formatearNumeroDeOrden(number),
    amount: deMonto(amount),
    vehiculo: customerVehicle,
    enEstadoDesde: statusChanges[0]?.changedAt ?? fila.createdAt,
  };
}

async function aFicha(organizationId: string, fila: FilaDeLaFicha) {
  const { number, amount, statusChanges, customerVehicle, jobTypes, approvals, ...resto } = fila;

  let aprobacionPendiente = false;
  if (fila.status === "ESPERANDO_APROBACION") {
    const entrada = await ultimaEntradaA(organizationId, fila.id, "ESPERANDO_APROBACION");
    aprobacionPendiente = !entrada || !(await hayAprobacionDesde(organizationId, fila.id, entrada));
  }

  // La fecha que se propone al entregar (§6.1), calculada como si se entregara
  // hoy. Solo cuando la orden puede entregarse.
  let proximoServicePropuesto: { fecha: string | null; meses: number | null } | null = null;
  if (fila.status === "LISTO_PARA_RETIRAR") {
    const [org, config] = await Promise.all([
      findDatosDeLaOrganizacion(organizationId),
      leerConfiguracionDelTaller(organizationId),
    ]);
    proximoServicePropuesto = proponerProximoService(
      new Date(),
      org.timezone,
      jobTypes.map((t) => t.serviceJobType.nextServiceAfterMonths),
      config.defaultNextServiceMonths,
    );
  }

  return {
    ...resto,
    numero: formatearNumeroDeOrden(number),
    amount: deMonto(amount),
    nextServiceDueOn: deFecha(fila.nextServiceDueOn),
    vehiculo: customerVehicle,
    tipos: jobTypes.map((t) => t.serviceJobType),
    aprobaciones: approvals.map((a) => ({ ...a, amount: deMonto(a.amount) })),
    historial: statusChanges,
    enEstadoDesde: statusChanges[0]?.changedAt ?? fila.createdAt,
    aprobacionPendiente,
    proximoServicePropuesto,
  };
}

// --- Validaciones -----------------------------------------------------------

async function ordenOError(
  organizationId: string,
  id: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const fila = await findOrderById(organizationId, id, db);
  if (!fila) throw new AppError(ORDEN_NO_ENCONTRADA, 404);
  return fila;
}

async function exigirEncargado(organizationId: string, assigneeId: string | null | undefined) {
  if (assigneeId && !(await existeUsuarioActivo(organizationId, assigneeId))) {
    throw new AppError("Encargado no encontrado", 404);
  }
}

/** Los tipos nuevos tienen que ser activos y de la organización. `yaEstaban`:
 *  los que la orden ya tenía siguen valiendo aunque después se desactivaran. */
async function exigirTipos(
  organizationId: string,
  ids: readonly string[],
  yaEstaban: readonly string[] = [],
): Promise<string[]> {
  const unicos = [...new Set(ids)];
  const nuevos = unicos.filter((id) => !yaEstaban.includes(id));
  const validos = await findJobTypesActivos(organizationId, nuevos);
  if (validos.length !== nuevos.length) {
    throw new AppError("Tipo de service no encontrado o inactivo", 404);
  }
  return unicos;
}

/** El Valor (D17): monto y moneda juntos. Sin moneda, la principal de la
 *  organización. `undefined` = no vino. */
async function valorDe(
  organizationId: string,
  amount: Monto | null | undefined,
  currency: string | null | undefined,
): Promise<{ amount?: Monto | null; currency?: string | null }> {
  if (amount === undefined && currency === undefined) return {};
  if (amount === null || amount === undefined) {
    if (currency) throw new AppError("La moneda va con un monto", 400);
    return { amount: null, currency: null };
  }
  if (currency) return { amount, currency };
  const org = await findDatosDeLaOrganizacion(organizationId);
  if (!org.preferredCurrency) throw new AppError("Elegí la moneda del valor", 400);
  return { amount, currency: org.preferredCurrency };
}

/** El P2002 del índice "un auto, una orden dentro del taller" → 409 con la
 *  orden que lo ocupa. Cualquier otro error, tal cual. */
async function traducirAutoEnElTaller(
  err: unknown,
  organizationId: string,
  customerVehicleId: string,
): Promise<never> {
  // Solo el índice del auto en el taller: un choque con el del número de orden
  // (organization_id, number) es otra cosa y sube tal cual.
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    !JSON.stringify(err.meta?.target ?? "").includes("number")
  ) {
    const ocupada = await findOrdenEnElTaller(organizationId, customerVehicleId);
    if (ocupada) {
      throw new AppError(
        `El vehículo ya está en el taller con la orden ${formatearNumeroDeOrden(ocupada.number)}.`,
        409,
        true,
        { code: VEHICULO_EN_EL_TALLER, ordenId: ocupada.id },
      );
    }
  }
  throw err;
}

/** Los km al ingreso suben los del vehículo, nunca los bajan. */
async function actualizarKmDelVehiculo(
  organizationId: string,
  customerVehicleId: string,
  km: number,
  tx: Prisma.TransactionClient,
) {
  await tx.customerVehicle.updateMany({
    where: {
      organizationId,
      id: customerVehicleId,
      OR: [{ mileage: null }, { mileage: { lt: km } }],
    },
    data: { mileage: km },
  });
}

// --- Casos de uso ----------------------------------------------------------

export async function listarOrdenes(
  organizationId: string,
  actor: ActorConSedes,
  params: ListarOrdenesParams,
) {
  const { page, pageSize, q, branchId, ...resto } = params;
  const numero = q ? /^(?:os-?)?0*(\d{1,9})$/i.exec(q.trim()) : null;
  const filtros = {
    ...resto,
    ...filtroDeSedes(actor, branchId),
    ...(q
      ? {
          q: {
            texto: q,
            normalizado: normalizarIdentificador(q),
            numero: numero ? Number(numero[1]) : null,
          },
        }
      : {}),
  };
  const [filas, total] = await Promise.all([
    findManyOrders(organizationId, filtros, { skip: (page - 1) * pageSize, take: pageSize }),
    countOrders(organizationId, filtros),
  ]);
  return {
    data: filas.map(aOrdenDeLista),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

export async function obtenerOrden(organizationId: string, id: string) {
  return aFicha(organizationId, await ordenOError(organizationId, id));
}

export async function crearOrden(organizationId: string, userId: string, input: CrearOrdenInput) {
  const vehiculo = await findCustomerVehicleById(organizationId, input.customerVehicleId);
  if (!vehiculo) throw new AppError("Vehículo no encontrado", 404);
  if (vehiculo.ownershipEndedAt) {
    throw new AppError("Este vehículo ya no es de un cliente: no se le abren órdenes.", 409);
  }
  const contactId = input.contactId ?? vehiculo.contactId;
  await exigirContacto(organizationId, contactId);
  const branchId = input.branchId ?? vehiculo.branchId;
  if (!branchId) throw new AppError("Elegí la sucursal de la orden", 400);
  await exigirSucursal(organizationId, branchId);
  await exigirEncargado(organizationId, input.assigneeId);
  const tipos = await exigirTipos(organizationId, input.jobTypeIds ?? []);
  const valor = await valorDe(organizationId, input.amount, input.currency);

  if (input.estado === "AGENDADO" && !input.scheduledFor) {
    throw new AppError("Una orden agendada lleva la fecha en que se espera el auto", 400);
  }
  if (input.estado === "RECIBIDO" && (input.mileageIn === undefined || input.mileageIn === null)) {
    throw new AppError("Al recibir el auto se cargan los km al ingreso", 400);
  }

  let id: string;
  try {
    id = await prisma.$transaction(async (tx) => {
      const number = await tomarNumeroDeOrden(organizationId, tx);
      const ahora = new Date();
      const creada = await createOrder(
        {
          organizationId,
          number,
          customerVehicleId: vehiculo.id,
          contactId,
          branchId,
          status: input.estado,
          assigneeId: input.assigneeId ?? null,
          scheduledFor: input.scheduledFor ?? null,
          mileageIn: input.mileageIn ?? null,
          receivedAt: input.estado === "RECIBIDO" ? ahora : null,
          notes: input.notes ?? null,
          damageNotes: input.damageNotes ?? null,
          amount: valor.amount ?? null,
          currency: valor.currency ?? null,
          createdById: userId,
        },
        tx,
      );
      await createStatusChange(
        {
          organizationId,
          serviceOrderId: creada.id,
          fromStatus: null,
          toStatus: input.estado,
          changedById: userId,
        },
        tx,
      );
      await setJobTypes(organizationId, creada.id, tipos, tx);
      if (input.estado === "RECIBIDO" && input.mileageIn != null) {
        await actualizarKmDelVehiculo(organizationId, vehiculo.id, input.mileageIn, tx);
      }
      return creada.id;
    }, OPCIONES_DE_TRANSACCION_LARGA);
  } catch (err) {
    return traducirAutoEnElTaller(err, organizationId, vehiculo.id);
  }
  return obtenerOrden(organizationId, id);
}

export async function actualizarOrden(
  organizationId: string,
  id: string,
  input: ActualizarOrdenInput,
) {
  const actual = await ordenOError(organizationId, id);
  if (!esAbierto(actual.status)) throw new AppError(ORDEN_FINAL, 409);
  await exigirEncargado(organizationId, input.assigneeId);
  const tipos =
    input.jobTypeIds === undefined
      ? undefined
      : await exigirTipos(
          organizationId,
          input.jobTypeIds,
          actual.jobTypes.map((t) => t.serviceJobType.id),
        );
  const valor = await valorDe(organizationId, input.amount, input.currency);
  const resto = {
    assigneeId: input.assigneeId,
    scheduledFor: input.scheduledFor,
    mileageIn: input.mileageIn,
    damageNotes: input.damageNotes,
    notes: input.notes,
  };

  await prisma.$transaction(async (tx) => {
    const n = await updateOrdenAbierta(organizationId, id, { ...resto, ...valor }, tx);
    if (n === 0) throw new AppError(ORDEN_FINAL, 409);
    if (tipos) await setJobTypes(organizationId, id, tipos, tx);
  });
  return obtenerOrden(organizationId, id);
}

/** POST /ordenes/:id/estado (§3.2). */
export async function cambiarEstado(
  organizationId: string,
  userId: string,
  id: string,
  input: CambiarEstadoInput,
) {
  const { desde, hacia } = input;
  if (!puedePasar(desde, hacia)) {
    throw new AppError(`No se puede pasar de ${desde} a ${hacia}`, 400);
  }
  const actual = await ordenOError(organizationId, id);
  if (actual.status !== desde) throw new AppError(ORDEN_MOVIDA, 409);

  // Lo que pide cada destino.
  const data: Prisma.ServiceOrderUncheckedUpdateManyInput = { status: hacia };
  const ahora = new Date();
  if (hacia === "RECIBIDO") {
    if (input.mileageIn === undefined) {
      throw new AppError("Al recibir el auto se cargan los km al ingreso", 400);
    }
    data.mileageIn = input.mileageIn;
    data.receivedAt = ahora;
  }
  if (hacia === "EN_TRABAJO") data.workStartedAt = ahora;
  if (hacia === "LISTO_PARA_RETIRAR") data.readyAt = ahora;
  if (hacia === "CANCELADO") {
    if (!input.cancelReason) throw new AppError("Para cancelar hace falta el motivo", 400);
    data.cancelledAt = ahora;
    data.cancelReason = input.cancelReason;
  }
  let proximo: Date | null = null;
  if (hacia === "ENTREGADO") {
    if (input.proximoService === undefined) {
      throw new AppError("Al entregar hay que confirmar el próximo service (o ninguno)", 400);
    }
    proximo = input.proximoService ? new Date(`${input.proximoService}T00:00:00.000Z`) : null;
    data.deliveredAt = ahora;
    data.nextServiceDueOn = proximo;
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (desde === "ESPERANDO_APROBACION") {
        const entrada = await ultimaEntradaA(organizationId, id, desde, tx);
        if (!entrada || !(await hayAprobacionDesde(organizationId, id, entrada, tx))) {
          throw new AppError(
            "Antes de seguir, registrá qué respondió el cliente (Registrar aprobación).",
            409,
            true,
            { code: FALTA_REGISTRAR_LA_APROBACION },
          );
        }
      }
      const n = await updateSiEstaEn(organizationId, id, desde, data, tx);
      if (n === 0) throw new AppError(ORDEN_MOVIDA, 409);
      await createStatusChange(
        {
          organizationId,
          serviceOrderId: id,
          fromStatus: desde,
          toStatus: hacia,
          changedById: userId,
          note: input.nota ?? null,
        },
        tx,
      );
      if (hacia === "RECIBIDO" && input.mileageIn !== undefined) {
        await actualizarKmDelVehiculo(
          organizationId,
          actual.customerVehicleId,
          input.mileageIn,
          tx,
        );
      }
      if (hacia === "ENTREGADO") {
        // La fecha confirmada pasa al vehículo, que es de donde salen los
        // recordatorios (§6.1). "Sin próximo service" también: la fecha vieja
        // quedó superada por este service.
        await updateCustomerVehicle(
          organizationId,
          actual.customerVehicleId,
          { nextServiceDueOn: proximo, nextServiceSetFromOrderId: id },
          tx,
        );
      }
    }, OPCIONES_DE_TRANSACCION_LARGA);
  } catch (err) {
    return traducirAutoEnElTaller(err, organizationId, actual.customerVehicleId);
  }
  return obtenerOrden(organizationId, id);
}

/** POST /ordenes/:id/aprobaciones (§2.5): solo un registro. "Sumar al valor"
 *  suma el monto al de la orden en la misma transacción. */
export async function registrarAprobacion(
  organizationId: string,
  userId: string,
  id: string,
  input: AprobacionInput,
) {
  const actual = await ordenOError(organizationId, id);
  if (!esAbierto(actual.status)) throw new AppError(ORDEN_FINAL, 409);
  const montoDeLaAprobacion =
    input.amount === undefined || input.amount === null
      ? null
      : await valorDe(organizationId, input.amount, input.currency);

  let nuevoValor: { amount: Prisma.Decimal; currency: string } | null = null;
  if (input.sumarAlValor) {
    if (!montoDeLaAprobacion?.amount || !montoDeLaAprobacion.currency) {
      throw new AppError("Para sumar al valor hace falta el monto de la aprobación", 400);
    }
    if (actual.currency && actual.currency !== montoDeLaAprobacion.currency) {
      throw new AppError(
        `El valor de la orden está en ${actual.currency}: el monto tiene que ir en la misma moneda`,
        400,
      );
    }
    nuevoValor = {
      amount: new Prisma.Decimal(actual.amount ?? 0).plus(montoDeLaAprobacion.amount),
      currency: montoDeLaAprobacion.currency,
    };
  }

  await prisma.$transaction(async (tx) => {
    await createApproval(
      {
        organizationId,
        serviceOrderId: id,
        description: input.description,
        decision: input.decision,
        approverName: input.approverName,
        channel: input.channel,
        decidedAt: input.decidedAt,
        amount: montoDeLaAprobacion?.amount ?? null,
        currency: montoDeLaAprobacion?.currency ?? null,
        recordedById: userId,
      },
      tx,
    );
    if (nuevoValor) {
      const n = await updateOrdenAbierta(organizationId, id, nuevoValor, tx);
      if (n === 0) throw new AppError(ORDEN_FINAL, 409);
    }
  });
  return obtenerOrden(organizationId, id);
}
