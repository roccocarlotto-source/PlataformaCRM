import { Prisma } from "@prisma/client";
import { OPCIONES_DE_TRANSACCION_LARGA, prisma } from "../../lib/prisma";
import { filtroDeSedes, type ActorConSedes } from "../../services/permisos";
import { AppError } from "../../utils/AppError";
import { exigirContactoConDatos } from "../../utils/contactoBorrado";
import { formatearNumeroDeOrden, normalizarIdentificador } from "../identificadores";
import {
  bloquearVehiculo,
  countCustomerVehicles,
  countOrdenesAbiertasDelVehiculo,
  createCustomerVehicle,
  createOwnerChange,
  existeSucursal,
  findContactoDelVehiculo,
  findCustomerVehicleById,
  findManyCustomerVehicles,
  findOrdenesDelVehiculo,
  findOwnerChanges,
  findVigenteConIdentificador,
  updateCustomerVehicle,
  type FilaDeVehiculo,
} from "../repositories/customerVehicle.repository";

// ---------------------------------------------------------------------------
// Vehículos de clientes (docs/servicios.md §2.2, §2.2.1 y §4.5; S3).
//
// Reglas:
//   - Matrícula y chasis son únicos entre los vehículos VIGENTES de la
//     organización (D16). Un duplicado es un 409 que trae el id del vehículo
//     que ya la tiene, para que la pantalla ofrezca abrirlo. El chequeo previo
//     da el 409 lindo; el índice único parcial de la base es la garantía (dos
//     altas simultáneas), y su violación se traduce al mismo 409.
//   - El dueño no se edita: se cambia con "Cambiar dueño", que deja el registro.
//   - Con una orden abierta no se cambia el dueño ni se borra (409).
//   - Un contacto con los datos personales borrados es de solo lectura: no se
//     le cargan ni editan vehículos (utils/contactoBorrado.ts).
//
// Las fechas sin hora (`@db.Date`: compra y próximo service) viajan como
// "AAAA-MM-DD" en los dos sentidos: no son instantes, y no pasan por zonas.
// ---------------------------------------------------------------------------

export const VEHICULO_NO_ENCONTRADO = "Vehículo no encontrado";
export const VEHICULO_DUPLICADO = "VEHICULO_DUPLICADO";
export const VEHICULO_CON_ORDEN_ABIERTA =
  "El vehículo tiene una orden abierta: primero hay que entregarla o cancelarla.";
export const VEHICULO_NO_VIGENTE = "Este vehículo ya no es de un cliente.";

export interface CamposDelVehiculo {
  branchId: string | null;
  make: string;
  model: string;
  year: number | null;
  licensePlate: string | null;
  vin: string | null;
  mileage: number | null;
  purchasedOn: string | null;
  nextServiceDueOn: string | null;
  remindersOptOut: boolean;
  notes: string | null;
}

export type CrearVehiculoInput = { contactId: string; make: string; model: string } & Partial<
  Omit<CamposDelVehiculo, "make" | "model">
>;

export type ActualizarVehiculoInput = Partial<CamposDelVehiculo>;

export type CambiarDuenoInput =
  | { toContactId: string; nota?: string | null }
  | { fin: "VENDIDO_A_TERCERO" | "OTRO"; nota?: string | null };

export interface ListarVehiculosParams {
  page: number;
  pageSize: number;
  q?: string;
  contactId?: string;
  branchId?: string;
  incluirNoVigentes?: boolean;
}

// --- Fechas sin hora -------------------------------------------------------

function aFecha(texto: string): Date {
  return new Date(`${texto}T00:00:00.000Z`);
}

function deFecha(fecha: Date | null): string | null {
  return fecha ? fecha.toISOString().slice(0, 10) : null;
}

// --- Respuesta -------------------------------------------------------------

export function aVehiculo(fila: FilaDeVehiculo) {
  const { serviceOrders, purchasedOn, nextServiceDueOn, ...resto } = fila;
  const abierta = serviceOrders[0];
  return {
    ...resto,
    purchasedOn: deFecha(purchasedOn),
    nextServiceDueOn: deFecha(nextServiceDueOn),
    ordenAbierta: abierta
      ? { id: abierta.id, numero: formatearNumeroDeOrden(abierta.number), status: abierta.status }
      : null,
  };
}

// --- Identificadores -------------------------------------------------------

interface Identificadores {
  licensePlate?: string | null;
  licensePlateNorm?: string | null;
  vin?: string | null;
}

/** Matrícula (como se escribió y normalizada) y chasis (normalizado). `undefined`
 *  = no vino (no se toca); `null` = se borra. */
function identificadoresDe(input: { licensePlate?: string | null; vin?: string | null }) {
  const salida: Identificadores = {};
  if (input.licensePlate !== undefined) {
    if (input.licensePlate === null) {
      salida.licensePlate = null;
      salida.licensePlateNorm = null;
    } else {
      const norm = normalizarIdentificador(input.licensePlate);
      if (!norm) throw new AppError("La matrícula tiene que tener letras o números", 400);
      if (norm.length > 20) throw new AppError("La matrícula es demasiado larga", 400);
      salida.licensePlate = input.licensePlate;
      salida.licensePlateNorm = norm;
    }
  }
  if (input.vin !== undefined) {
    if (input.vin === null) salida.vin = null;
    else {
      const norm = normalizarIdentificador(input.vin);
      if (!norm) throw new AppError("El chasis tiene que tener letras o números", 400);
      if (norm.length > 30) throw new AppError("El chasis es demasiado largo", 400);
      salida.vin = norm;
    }
  }
  return salida;
}

function errorDeDuplicado(duplicado: { id: string; campo: "licensePlate" | "vin" }): AppError {
  const que = duplicado.campo === "licensePlate" ? "esa matrícula" : "ese chasis";
  return new AppError(`Ya hay un vehículo de cliente con ${que}.`, 409, true, {
    code: VEHICULO_DUPLICADO,
    campo: duplicado.campo,
    vehiculoId: duplicado.id,
  });
}

async function exigirSinDuplicado(
  organizationId: string,
  ids: Identificadores,
  exceptoId?: string,
): Promise<void> {
  const duplicado = await findVigenteConIdentificador(organizationId, ids, exceptoId);
  if (duplicado) throw errorDeDuplicado(duplicado);
}

/** Una escritura que chocó contra el índice único parcial (otra alta ganó la
 *  carrera): el mismo 409 del chequeo previo. Cualquier otro error, tal cual. */
async function traducirChoqueDeUnicidad(
  err: unknown,
  organizationId: string,
  ids: Identificadores,
  exceptoId?: string,
): Promise<never> {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const duplicado = await findVigenteConIdentificador(organizationId, ids, exceptoId);
    if (duplicado) throw errorDeDuplicado(duplicado);
  }
  throw err;
}

export async function exigirContacto(organizationId: string, contactId: string): Promise<void> {
  const contacto = await findContactoDelVehiculo(organizationId, contactId);
  if (!contacto) throw new AppError("Contacto no encontrado", 404);
  exigirContactoConDatos(contacto);
}

export async function exigirSucursal(organizationId: string, branchId: string | null | undefined) {
  if (branchId && !(await existeSucursal(organizationId, branchId))) {
    throw new AppError("Sucursal no encontrada", 404);
  }
}

async function vehiculoOError(organizationId: string, id: string): Promise<FilaDeVehiculo> {
  const fila = await findCustomerVehicleById(organizationId, id);
  if (!fila) throw new AppError(VEHICULO_NO_ENCONTRADO, 404);
  return fila;
}

// --- Casos de uso ----------------------------------------------------------

export async function listarVehiculos(
  organizationId: string,
  actor: ActorConSedes,
  params: ListarVehiculosParams,
) {
  const { page, pageSize, q, branchId, ...resto } = params;
  const filtros = {
    ...resto,
    ...filtroDeSedes(actor, branchId),
    ...(q ? { q: { texto: q, normalizado: normalizarIdentificador(q) } } : {}),
  };
  const [filas, total] = await Promise.all([
    findManyCustomerVehicles(organizationId, filtros, {
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    countCustomerVehicles(organizationId, filtros),
  ]);
  return {
    data: filas.map(aVehiculo),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

/** La ficha: el vehículo y el registro de cambios de dueño. */
export async function obtenerVehiculo(organizationId: string, id: string) {
  const fila = await vehiculoOError(organizationId, id);
  const cambios = await findOwnerChanges(organizationId, id);
  return {
    ...aVehiculo(fila),
    cambiosDeDueno: cambios.map((c) => ({
      ...c,
      previousPurchasedOn: deFecha(c.previousPurchasedOn),
    })),
  };
}

export async function crearVehiculo(organizationId: string, input: CrearVehiculoInput) {
  await exigirContacto(organizationId, input.contactId);
  await exigirSucursal(organizationId, input.branchId);
  const ids = identificadoresDe(input);
  await exigirSinDuplicado(organizationId, ids);

  let creado: { id: string };
  try {
    creado = await createCustomerVehicle({
      organizationId,
      contactId: input.contactId,
      branchId: input.branchId ?? null,
      make: input.make,
      model: input.model,
      year: input.year ?? null,
      mileage: input.mileage ?? null,
      purchasedOn: input.purchasedOn ? aFecha(input.purchasedOn) : null,
      nextServiceDueOn: input.nextServiceDueOn ? aFecha(input.nextServiceDueOn) : null,
      remindersOptOut: input.remindersOptOut ?? false,
      notes: input.notes ?? null,
      licensePlate: ids.licensePlate ?? null,
      licensePlateNorm: ids.licensePlateNorm ?? null,
      vin: ids.vin ?? null,
    });
  } catch (err) {
    return traducirChoqueDeUnicidad(err, organizationId, ids);
  }
  return aVehiculo(await vehiculoOError(organizationId, creado.id));
}

export async function actualizarVehiculo(
  organizationId: string,
  id: string,
  input: ActualizarVehiculoInput,
) {
  const actual = await vehiculoOError(organizationId, id);
  await exigirContacto(organizationId, actual.contactId);
  await exigirSucursal(organizationId, input.branchId);
  const ids = identificadoresDe(input);
  await exigirSinDuplicado(organizationId, ids, id);

  // `ids` pisa licensePlate y vin con su forma normalizada (y suma
  // licensePlateNorm) cada vez que vinieron en el input.
  const { purchasedOn, nextServiceDueOn, ...resto } = input;
  const data: Prisma.CustomerVehicleUncheckedUpdateManyInput = { ...resto, ...ids };
  if (purchasedOn !== undefined) data.purchasedOn = purchasedOn ? aFecha(purchasedOn) : null;
  if (nextServiceDueOn !== undefined) {
    data.nextServiceDueOn = nextServiceDueOn ? aFecha(nextServiceDueOn) : null;
    // Cargada a mano: ya no sale de ninguna orden (§2.2).
    data.nextServiceSetFromOrderId = null;
  }

  try {
    const n = await updateCustomerVehicle(organizationId, id, data);
    if (n === 0) throw new AppError(VEHICULO_NO_ENCONTRADO, 404);
  } catch (err) {
    return traducirChoqueDeUnicidad(err, organizationId, ids, id);
  }
  return aVehiculo(await vehiculoOError(organizationId, id));
}

/** Soft delete (solo ADMIN, lo exige la ruta). Con una orden abierta, 409. */
export async function borrarVehiculo(organizationId: string, id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await bloquearVehiculo(organizationId, id, tx);
    const fila = await findCustomerVehicleById(organizationId, id, tx);
    if (!fila) throw new AppError(VEHICULO_NO_ENCONTRADO, 404);
    if ((await countOrdenesAbiertasDelVehiculo(organizationId, id, tx)) > 0) {
      throw new AppError(VEHICULO_CON_ORDEN_ABIERTA, 409);
    }
    await updateCustomerVehicle(organizationId, id, { deletedAt: new Date() }, tx);
  });
}

/** "Cambiar dueño" (§2.2.1): pasa a otro contacto, o deja de ser de un cliente
 *  nuestro. En una transacción, con su fila en el registro. Limpia la fecha de
 *  compra (la guarda en el registro); pasar a otro contacto conserva el próximo
 *  service. Cancelar los envíos pendientes del dueño anterior llega con la cola
 *  de mensajes (S6/S7): hoy no hay envíos. */
export async function cambiarDueno(
  organizationId: string,
  userId: string,
  id: string,
  input: CambiarDuenoInput,
) {
  if ("toContactId" in input) await exigirContacto(organizationId, input.toContactId);

  await prisma.$transaction(async (tx) => {
    await bloquearVehiculo(organizationId, id, tx);
    const fila = await findCustomerVehicleById(organizationId, id, tx);
    if (!fila) throw new AppError(VEHICULO_NO_ENCONTRADO, 404);
    if (fila.ownershipEndedAt) throw new AppError(VEHICULO_NO_VIGENTE, 409);
    if ((await countOrdenesAbiertasDelVehiculo(organizationId, id, tx)) > 0) {
      throw new AppError(VEHICULO_CON_ORDEN_ABIERTA, 409);
    }

    const comun = {
      organizationId,
      customerVehicleId: id,
      fromContactId: fila.contactId,
      previousPurchasedOn: fila.purchasedOn,
      note: input.nota ?? null,
      changedById: userId,
    };
    if ("toContactId" in input) {
      if (input.toContactId === fila.contactId) {
        throw new AppError("El vehículo ya es de ese contacto", 400);
      }
      await updateCustomerVehicle(
        organizationId,
        id,
        { contactId: input.toContactId, purchasedOn: null },
        tx,
      );
      await createOwnerChange(
        { ...comun, kind: "CAMBIO_DE_DUENO", toContactId: input.toContactId },
        tx,
      );
    } else {
      await updateCustomerVehicle(
        organizationId,
        id,
        { ownershipEndedAt: new Date(), ownershipEndReason: input.fin, purchasedOn: null },
        tx,
      );
      await createOwnerChange({ ...comun, kind: "FIN", endReason: input.fin }, tx);
    }
  }, OPCIONES_DE_TRANSACCION_LARGA);

  return obtenerVehiculo(organizationId, id);
}

/** El historial de órdenes del vehículo (§4.5). Hasta S4, vacío. */
export async function ordenesDelVehiculo(organizationId: string, id: string) {
  await vehiculoOError(organizationId, id);
  const ordenes = await findOrdenesDelVehiculo(organizationId, id);
  return ordenes.map(({ number, jobTypes, amount, ...o }) => ({
    ...o,
    numero: formatearNumeroDeOrden(number),
    amount: amount === null ? null : amount.toString(),
    tipos: jobTypes.map((t) => t.serviceJobType),
  }));
}
