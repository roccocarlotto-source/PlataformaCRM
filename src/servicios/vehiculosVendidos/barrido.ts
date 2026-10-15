import { Prisma } from "@prisma/client";
import { logger } from "../../lib/logger";
import { OPCIONES_DE_TRANSACCION_LARGA, prisma } from "../../lib/prisma";
import { createActivity } from "../../repositories/activity.repository";
import { normalizarIdentificador } from "../identificadores";
import { diaEnLaZona, sumarMesesAUnaFecha } from "../proximoService";
import { textoDelVehiculo } from "../recordatorio/config";
import { asignadoDeLaTarea } from "../recordatorio/repository";
import {
  bloquearVehiculo,
  countOrdenesAbiertasDelVehiculo,
  createCustomerVehicle,
  createOwnerChange,
  findCustomerVehicleById,
  findVigenteConIdentificador,
  updateCustomerVehicle,
} from "../repositories/customerVehicle.repository";
import { leerConfiguracionDelTaller } from "../repositories/workshopSettings.repository";
import {
  permutas,
  primeraActivacion,
  ventasParaConvertir,
  ventasRevertidas,
  type Permuta,
  type VentaParaConvertir,
  type VentaRevertida,
} from "./repository";

// ---------------------------------------------------------------------------
// De la venta al vehículo del cliente (docs/servicios.md §5, §6.1 y §2.2.1;
// S10). Un barrido cada 15 minutos, solo en organizaciones con el módulo
// Servicios activado. No toca el código de oportunidades ni el del stock: lee
// lo que quedó y, en cada organización, en este orden:
//
//   1. PERMUTAS. Un vehículo de cliente cuya matrícula o chasis entró al stock
//      deja de ser del cliente (PERMUTA), con su fila en el registro y una nota
//      en el contacto. Va primero: si el auto que entró se vende en la misma
//      ventana, el vehículo del dueño anterior ya terminó y el del nuevo se
//      crea sin chocar con la matrícula.
//   2. VENTAS REVERTIDAS. Si la venta deja de estar ganada, el vehículo que
//      creó el barrido se borra (soft) si no tiene órdenes. Si tiene órdenes,
//      o ya estaba cargado antes de la venta, queda, sin el vínculo a la venta,
//      y con una nota en el contacto.
//   3. VENTAS NUEVAS. Cada venta ganada con unidad y contacto es un vehículo
//      de cliente con los datos de la unidad y la fecha de compra. Si ya hay un
//      vehículo vigente del mismo cliente con esa matrícula o ese chasis (lo
//      traía al taller antes), se completa en vez de crear otro. Las ventas
//      desde la primera activación del módulo, en la zona de la organización,
//      nacen con el primer service (fecha de compra + firstServiceAfterMonths).
//
// Idempotente: una venta convertida tiene su vehículo (source_opportunity_id),
// y cada escritura va en su transacción, serializada por organización con un
// advisory lock (dos instancias o dos pasadas a la vez no duplican). El índice
// único parcial de source_vehicle_id y los de matrícula y chasis son la red.
// ---------------------------------------------------------------------------

const POLL_MS = 15 * 60 * 1000;
// Ventas nuevas por organización y pasada: la primera pasada de una
// organización con muchas ventas viejas se reparte en varias.
const VENTAS_POR_PASADA = 200;

export interface ResumenDeVentas {
  organizaciones: number;
  creados: number;
  completados: number;
  // Una venta cuya matrícula o chasis ya es de un vehículo vigente de OTRO
  // cliente: no se toca, lo resuelve una persona con "Cambiar dueño".
  conflictos: number;
  borrados: number;
  desvinculados: number;
  permutas: number;
  fallidas: number;
}

export interface OpcionesDelBarridoDeVentas {
  organizationId?: string;
}

type Tx = Prisma.TransactionClient;

function bloquearOrganizacion(tx: Tx, organizationId: string) {
  return tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`vehiculos-vendidos:${organizationId}`}::text))`;
}

function enTransaccion<T>(organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await bloquearOrganizacion(tx, organizationId);
    return fn(tx);
  }, OPCIONES_DE_TRANSACCION_LARGA);
}

/** Una nota cerrada en el contacto (es un registro, no algo pendiente), de
 *  quien se haría cargo del vehículo. Sin nadie activo en la organización, no
 *  hay nota: lo que cambió queda igual en el vehículo y su registro. */
async function notaEnElContacto(
  tx: Tx,
  organizationId: string,
  v: { customerVehicleId: string; contactId: string; branchId: string | null },
  subject: string,
  body: string,
) {
  const autor = await asignadoDeLaTarea(organizationId, v.customerVehicleId, v.branchId, tx);
  if (!autor) return;
  await createActivity(
    {
      organizationId,
      type: "NOTE",
      authorId: autor,
      assigneeId: null,
      companyId: null,
      contactId: v.contactId,
      opportunityId: null,
      subject: subject.slice(0, 255),
      body,
      completedAt: new Date(),
    },
    tx,
  );
}

// --- 1. Permutas ------------------------------------------------------------

async function aplicarPermuta(organizationId: string, p: Permuta): Promise<boolean> {
  return enTransaccion(organizationId, async (tx) => {
    await bloquearVehiculo(organizationId, p.customerVehicleId, tx);
    const fila = await findCustomerVehicleById(organizationId, p.customerVehicleId, tx);
    if (!fila || fila.ownershipEndedAt) return false;
    // Con una orden abierta no se termina (la regla de "Cambiar dueño"): se
    // reintenta en la próxima pasada, cuando se entregue o se cancele.
    if ((await countOrdenesAbiertasDelVehiculo(organizationId, p.customerVehicleId, tx)) > 0) {
      return false;
    }
    await updateCustomerVehicle(
      organizationId,
      p.customerVehicleId,
      { ownershipEndedAt: new Date(), ownershipEndReason: "PERMUTA", purchasedOn: null },
      tx,
    );
    await createOwnerChange(
      {
        organizationId,
        customerVehicleId: p.customerVehicleId,
        kind: "FIN",
        endReason: "PERMUTA",
        fromContactId: fila.contactId,
        previousPurchasedOn: fila.purchasedOn,
        stockVehicleId: p.stockVehicleId,
        changedById: null,
      },
      tx,
    );
    const vehiculo = textoDelVehiculo(p);
    await notaEnElContacto(
      tx,
      organizationId,
      p,
      `Su ${vehiculo} entró al stock`,
      `Su ${vehiculo} entró al stock (unidad ${p.internalCode}). Deja de ser un vehículo del cliente y no recibe más recordatorios.`,
    );
    return true;
  });
}

// --- 2. Ventas revertidas ---------------------------------------------------

async function aplicarReversa(
  organizationId: string,
  r: VentaRevertida,
): Promise<"BORRADO" | "DESVINCULADO"> {
  return enTransaccion(organizationId, async (tx) => {
    await bloquearVehiculo(organizationId, r.customerVehicleId, tx);
    // ¿Lo creó la venta? El barrido lo crea siempre después de la oportunidad.
    // Uno cargado antes era del cliente: la venta solo lo completó, y queda.
    const delBarrido = r.posteriorALaVenta;
    if (delBarrido && r.ordenes === 0) {
      await updateCustomerVehicle(
        organizationId,
        r.customerVehicleId,
        { deletedAt: new Date() },
        tx,
      );
      return "BORRADO";
    }
    await updateCustomerVehicle(
      organizationId,
      r.customerVehicleId,
      {
        sourceVehicleId: null,
        sourceOpportunityId: null,
        // La fecha de compra la puso la venta que ya no está: se va con ella.
        ...(delBarrido ? { purchasedOn: null } : {}),
      },
      tx,
    );
    const vehiculo = textoDelVehiculo(r);
    const porque =
      r.ordenes > 0
        ? "porque tiene órdenes del taller"
        : "porque ya estaba cargado antes de la venta";
    await notaEnElContacto(
      tx,
      organizationId,
      r,
      `La venta de su ${vehiculo} ya no está ganada`,
      `La venta de su ${vehiculo} ya no está ganada. El vehículo sigue en Vehículos de clientes ${porque}; si ya no es suyo, usá "Cambiar dueño".`,
    );
    return "DESVINCULADO";
  });
}

// --- 3. Ventas nuevas -------------------------------------------------------

/** Matrícula y chasis de la unidad, como los guarda un vehículo de cliente.
 *  Lo que no entra en sus columnas o no tiene letras ni números, no se copia. */
function identificadoresDeLaUnidad(v: VentaParaConvertir) {
  const matricula = v.licensePlate?.trim() ?? "";
  const matriculaNorm = normalizarIdentificador(matricula);
  const chasis = normalizarIdentificador(v.vin ?? "");
  const conMatricula = matriculaNorm !== "" && matriculaNorm.length <= 20 && matricula.length <= 20;
  return {
    licensePlate: conMatricula ? matricula : null,
    licensePlateNorm: conMatricula ? matriculaNorm : null,
    vin: chasis !== "" && chasis.length <= 30 ? chasis : null,
  };
}

interface ContextoDeLaOrganizacion {
  organizationId: string;
  // El día (en la zona) de la primera activación: desde ahí, primer service.
  activadoEl: Date | null;
  primerServiceMeses: number | null;
}

/** El primer service de una venta (§6.1, D6): solo desde la activación. */
function primerService(ctx: ContextoDeLaOrganizacion, venta: VentaParaConvertir): Date | null {
  if (ctx.primerServiceMeses === null || venta.actualCloseDate === null) return null;
  if (ctx.activadoEl === null || venta.actualCloseDate < ctx.activadoEl) return null;
  return sumarMesesAUnaFecha(venta.actualCloseDate, ctx.primerServiceMeses);
}

async function convertirVenta(
  ctx: ContextoDeLaOrganizacion,
  venta: VentaParaConvertir,
): Promise<"CREADO" | "COMPLETADO" | "CONFLICTO" | "NADA"> {
  const { organizationId } = ctx;
  const ids = identificadoresDeLaUnidad(venta);
  const proximo = primerService(ctx, venta);
  try {
    return await enTransaccion(organizationId, async (tx) => {
      const existente = await findVigenteConIdentificador(organizationId, ids, undefined, tx);
      if (existente) {
        await bloquearVehiculo(organizationId, existente.id, tx);
        const fila = await findCustomerVehicleById(organizationId, existente.id, tx);
        if (!fila) return "NADA";
        if (fila.contactId !== venta.contactId) return "CONFLICTO";
        // Se completa lo que falte. Si ya es el origen de otra venta, no se
        // pisa: el vehículo es uno solo y su historia, la que ya tenía.
        const datos: Prisma.CustomerVehicleUncheckedUpdateManyInput = {};
        if (fila.sourceVehicleId === null && fila.sourceOpportunityId === null) {
          datos.sourceVehicleId = venta.stockVehicleId;
          datos.sourceOpportunityId = venta.opportunityId;
        }
        if (fila.purchasedOn === null && venta.actualCloseDate !== null) {
          datos.purchasedOn = venta.actualCloseDate;
        }
        if (fila.nextServiceDueOn === null && proximo !== null) datos.nextServiceDueOn = proximo;
        if (Object.keys(datos).length === 0) return "NADA";
        await updateCustomerVehicle(organizationId, existente.id, datos, tx);
        return "COMPLETADO";
      }
      await createCustomerVehicle(
        {
          organizationId,
          contactId: venta.contactId,
          branchId: venta.branchId,
          make: venta.make.slice(0, 60),
          model: venta.model.slice(0, 80),
          year: venta.year >= 1900 && venta.year <= 2100 ? venta.year : null,
          ...ids,
          mileage: venta.mileage !== null && venta.mileage >= 0 ? venta.mileage : null,
          purchasedOn: venta.actualCloseDate,
          nextServiceDueOn: proximo,
          sourceVehicleId: venta.stockVehicleId,
          sourceOpportunityId: venta.opportunityId,
        },
        tx,
      );
      return "CREADO";
    });
  } catch (err) {
    // Otra escritura ganó la matrícula, el chasis o la unidad entre la lectura
    // y el INSERT: la próxima pasada la ve y decide con el dato nuevo.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "NADA";
    throw err;
  }
}

// --- La pasada --------------------------------------------------------------

async function barrerOrganizacion(ctx: ContextoDeLaOrganizacion, resumen: ResumenDeVentas) {
  const { organizationId } = ctx;
  for (const p of await permutas(organizationId)) {
    if (await aplicarPermuta(organizationId, p)) resumen.permutas++;
  }
  for (const r of await ventasRevertidas(organizationId)) {
    if ((await aplicarReversa(organizationId, r)) === "BORRADO") resumen.borrados++;
    else resumen.desvinculados++;
  }
  for (const venta of await ventasParaConvertir(organizationId, VENTAS_POR_PASADA)) {
    const r = await convertirVenta(ctx, venta);
    if (r === "CREADO") resumen.creados++;
    else if (r === "COMPLETADO") resumen.completados++;
    else if (r === "CONFLICTO") resumen.conflictos++;
  }
}

export async function barrerVehiculosVendidos(
  opciones: OpcionesDelBarridoDeVentas = {},
): Promise<ResumenDeVentas> {
  const resumen: ResumenDeVentas = {
    organizaciones: 0,
    creados: 0,
    completados: 0,
    conflictos: 0,
    borrados: 0,
    desvinculados: 0,
    permutas: 0,
    fallidas: 0,
  };
  const conElModulo = await prisma.organizationModule.findMany({
    where: {
      module: "servicios",
      disabledAt: null,
      organization: { deletedAt: null },
      ...(opciones.organizationId ? { organizationId: opciones.organizationId } : {}),
    },
    select: { organizationId: true, organization: { select: { timezone: true } } },
  });

  for (const { organizationId, organization } of conElModulo) {
    try {
      const activacion = await primeraActivacion(organizationId);
      const config = await leerConfiguracionDelTaller(organizationId);
      resumen.organizaciones++;
      await barrerOrganizacion(
        {
          organizationId,
          activadoEl: activacion ? diaEnLaZona(activacion, organization.timezone) : null,
          primerServiceMeses: config.firstServiceAfterMonths,
        },
        resumen,
      );
    } catch (err) {
      // Una organización que falla no corta la pasada.
      resumen.fallidas++;
      logger.error(
        { err, organizationId },
        "No se pudo barrer las ventas de esta organización; se sigue con las demás",
      );
    }
  }
  return resumen;
}

export function iniciarBarridoDeVehiculosVendidos(
  opciones: { pollMs?: number; barrer?: () => Promise<ResumenDeVentas> } = {},
): () => Promise<void> {
  const pollMs = opciones.pollMs ?? POLL_MS;
  const barrer = opciones.barrer ?? (() => barrerVehiculosVendidos());
  let detenido = false;
  let timer: NodeJS.Timeout | undefined;
  let tickEnCurso: Promise<void> | undefined;

  const tick = async () => {
    if (detenido) return;
    tickEnCurso = (async () => {
      try {
        const r = await barrer();
        // Los conflictos se repiten en cada pasada hasta que alguien los
        // resuelve: solos no ameritan una línea de log cada 15 minutos.
        const { organizaciones, conflictos, ...cambios } = r;
        if (Object.values(cambios).some((n) => n > 0)) {
          logger.info({ organizaciones, conflictos, ...cambios }, "Pasada de vehículos vendidos");
        }
      } catch (err) {
        // Falló la consulta de organizaciones: el bucle no puede morir por eso.
        logger.error({ err }, "Fallo inesperado en la pasada de vehículos vendidos");
      }
    })();
    await tickEnCurso;
    if (!detenido) timer = setTimeout(() => void tick(), pollMs);
  };

  logger.info({ pollMs }, "Barrido de vehículos vendidos iniciado");
  // Primera pasada inmediata: un deploy no corre el reloj 15 minutos.
  timer = setTimeout(() => void tick(), 0);
  return async () => {
    detenido = true;
    if (timer) clearTimeout(timer);
    await tickEnCurso;
  };
}
