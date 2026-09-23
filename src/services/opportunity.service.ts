import type {
  OpportunityFinancingType,
  OpportunityLeadSource,
  OpportunityStatus,
  Prisma,
  VehicleStatus,
} from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { findCompanyById } from "../repositories/company.repository";
import { findContactById, markContactAsCustomer } from "../repositories/contact.repository";
import {
  countOpportunities,
  countOpportunitiesWhere,
  createOpportunity as createOpportunityRepo,
  findManyOpportunities,
  findOpportunityById,
  lockOpportunityForUpdate,
  softDeleteOpportunity,
  sumOpportunityAmount,
  updateOpportunity as updateOpportunityRepo,
  type OpportunityAggregateWhere,
  type OpportunitySortBy,
  type SortOrder,
} from "../repositories/opportunity.repository";
import {
  findOrganizationById,
  lockOrganizationForUpdate,
} from "../repositories/organization.repository";
import { emitOutboxEvent } from "../repositories/outboxEvent.repository";
import { findPipelineById } from "../repositories/pipeline.repository";
import {
  findStageById,
  findStagesByPipeline,
  lockStageForUpdate,
} from "../repositories/stage.repository";
import { findVehicleById } from "../repositories/vehicle.repository";
import { AppError } from "../utils/AppError";
import { lastMonthsUTC, monthWindowUTC } from "../utils/utcMonth";
import { dayWindowUTC, lastDaysUTC, lastWeeksUTC, weekWindowUTC } from "../utils/utcWindow";
import { TRIGGER_OPPORTUNITY_WON } from "./automationTriggers";
import {
  createDeliveryForSoldVehicle,
  ENTREGA_CONFIRMADA_BLOQUEA_CAMBIOS,
  ensureDeliveryForSoldVehicle,
  hasConfirmedDelivery,
} from "./delivery.service";
import {
  hoyEnLaZona,
  resolverCamposDeCierre,
  resolverEstadoYEtapa,
  type EtapaConMarca,
} from "./opportunityClosing";
import { resolveOwnerId } from "./ownership.service";
import { setVehicleStatusForOpportunityLink } from "./vehicle.service";

// ---------------------------------------------------------------------------
// Trigger `opportunity.won` del motor de automatizaciones
// (docs/automations-architecture.md §7). Es el PRIMER evento que este
// repositorio emite al outbox: hasta acá el motor de eventos salientes estaba
// construido sin ningún productor.
//
// La detección es pura y exportada para probarla sin base: WON alcanzado
// desde cualquier otro estado dispara; WON -> WON (un PATCH que manda
// status: "WON" sobre una ya ganada, o que no toca el status) NO dispara;
// cualquier transición que no termine en WON tampoco.
// ---------------------------------------------------------------------------
export function transicionaAGanada(previo: OpportunityStatus, efectivo: OpportunityStatus) {
  return previo !== "WON" && efectivo === "WON";
}

// Payload mínimo: la acción resuelve el resto leyendo la oportunidad si lo
// necesita. ownerId es el dueño EFECTIVO después del cambio. Opportunity.ownerId
// es NOT NULL, así que no hay caso "sin owner".
function emitOpportunityWon(
  organizationId: string,
  datos: { opportunityId: string; ownerId: string },
  tx: Prisma.TransactionClient,
) {
  return emitOutboxEvent(
    {
      organizationId,
      eventType: TRIGGER_OPPORTUNITY_WON,
      payload: { opportunityId: datos.opportunityId, ownerId: datos.ownerId },
    },
    tx,
  );
}

export interface ListOpportunitiesParams {
  page: number;
  pageSize: number;
  search?: string;
  companyId?: string;
  contactId?: string;
  ownerId?: string;
  pipelineId?: string;
  stageId?: string;
  status?: OpportunityStatus;
  currency?: string;
  minAmount?: number;
  maxAmount?: number;
  sortBy: OpportunitySortBy;
  sortOrder: SortOrder;
}

export async function listOpportunities(organizationId: string, params: ListOpportunitiesParams) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyOpportunities(organizationId, filters, { skip, take: pageSize }, { sortBy, sortOrder }),
    countOpportunities(organizationId, filters),
  ]);

  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

export async function getOpportunityById(organizationId: string, id: string) {
  const opportunity = await findOpportunityById(id, organizationId);
  if (!opportunity) {
    throw new AppError("Oportunidad no encontrada", 404);
  }
  return opportunity;
}

async function validateCompanyId(
  organizationId: string,
  companyId: string | undefined,
): Promise<string | null> {
  if (!companyId) {
    return null;
  }
  const company = await findCompanyById(companyId, organizationId);
  if (!company) {
    throw new AppError(
      "El companyId indicado no existe, no pertenece a tu organización, o está eliminada",
      400,
    );
  }
  return company.id;
}

async function validateContactId(
  organizationId: string,
  contactId: string | undefined,
): Promise<string | null> {
  if (!contactId) {
    return null;
  }
  const contact = await findContactById(contactId, organizationId);
  if (!contact) {
    throw new AppError(
      "El contactId indicado no existe, no pertenece a tu organización, o está eliminado",
      400,
    );
  }
  return contact.id;
}

async function validatePipelineId(organizationId: string, pipelineId: string) {
  const pipeline = await findPipelineById(pipelineId, organizationId);
  if (!pipeline) {
    throw new AppError("El pipelineId indicado no existe o no pertenece a tu organización", 400);
  }
  return pipeline;
}

// El stage tiene que existir en la organización Y pertenecer al pipeline
// indicado — evita la inconsistencia "pipeline A + stage de pipeline B".
//
// `db` explícito para poder revalidar DENTRO de la transacción, con el lock de
// la fila del Stage ya sostenido (ALTO-8). El default es el pre-check rápido.
async function validateStageId(
  organizationId: string,
  stageId: string,
  pipelineId: string,
  db: Db = prisma,
) {
  const stage = await findStageById(stageId, organizationId, db);
  if (!stage) {
    throw new AppError("El stageId indicado no existe o no pertenece a tu organización", 400);
  }
  if (stage.pipelineId !== pipelineId) {
    throw new AppError("El stageId indicado no pertenece al pipeline especificado", 400);
  }
  return stage;
}

// ---------------------------------------------------------------------------
// Vínculo con una unidad del stock (Fase 2c del módulo de vehículos). "Al
// vincular una unidad, la oportunidad toma su precio y su estado": el estado
// de la unidad (Vehicle.status) es quien manda, y la disponibilidad
// (status === AVAILABLE) es el mecanismo de exclusión — mientras una
// oportunidad la tiene reservada ninguna otra puede vincularla. No hay campo
// "reservada por": quién la tiene se sabe recorriendo qué Opportunity lleva
// ese vehicleId.
//
// Todo cambio de estado de la unidad pasa por setVehicleStatusForOpportunityLink
// (vehicle.service.ts), dentro de la transacción de la oportunidad y bajo
// lockOrganizationForUpdate — el MISMO lock que serializa todas las escrituras
// de Vehicle: sin él, dos oportunidades creándose a la vez con el mismo
// vehicleId podrían las dos leer AVAILABLE y las dos "ganar".
// ---------------------------------------------------------------------------

// Mismo molde que validateCompanyId/validateContactId. `db` explícito para
// revalidar DENTRO de la transacción con el lock tomado; el default es el
// pre-check rápido.
async function validateVehicleId(organizationId: string, vehicleId: string, db: Db = prisma) {
  const vehicle = await findVehicleById(vehicleId, organizationId, db);
  if (!vehicle) {
    throw new AppError(
      "El vehicleId indicado no existe, no pertenece a tu organización, o está eliminado",
      400,
    );
  }
  return vehicle;
}

export const UNIDAD_NO_DISPONIBLE =
  "La unidad indicada no está disponible para vincularse a una oportunidad";

// 409 y no 400: no es un dato inválido, es un conflicto con el estado que la
// base tiene en este instante.
function assertVehicleAvailable(vehicle: { status: VehicleStatus }) {
  if (vehicle.status !== "AVAILABLE") {
    throw new AppError(UNIDAD_NO_DISPONIBLE, 409);
  }
}

// El estado en que queda la unidad según el de la oportunidad que la tiene
// vinculada: abierta la reserva, ganada la vende, perdida no reserva nada.
// Nunca devuelve DELIVERED: a ese estado no se llega por la oportunidad sino
// por "Confirmar entrega" (delivery.service.ts, §40). Exportada para probarla
// sin base.
export function vehicleStatusForOpportunityStatus(status: OpportunityStatus): VehicleStatus {
  switch (status) {
    case "WON":
      return "SOLD";
    case "LOST":
      return "AVAILABLE";
    case "OPEN":
    default:
      return "RESERVED";
  }
}

export interface PriceFromVehicle {
  amount?: number;
  currency?: string;
}

// El precio que la oportunidad toma de la unidad. USD manda si está cargado.
// Si solo hay precio local: priceListLocal NO lleva su propia moneda en el
// schema (ver el comentario del campo), así que se asume la moneda de
// preferencia de la organización — y si ésta no está configurada no hay forma
// de saber en qué moneda está ese número, y la función devuelve {} para que
// el vendedor lo complete a mano, como hoy. No es una decisión cómoda, es la
// que no inventa datos: guardar un monto con una moneda adivinada sería peor
// que no guardar ninguno. Exportada para probarla sin base.
export function priceFromVehicle(
  vehicle: {
    priceListUsd: Prisma.Decimal | number | null;
    priceListLocal: Prisma.Decimal | number | null;
  },
  organization: { preferredCurrency: string | null },
): PriceFromVehicle {
  if (vehicle.priceListUsd !== null) {
    return { amount: Number(vehicle.priceListUsd), currency: "USD" };
  }
  if (vehicle.priceListLocal !== null && organization.preferredCurrency) {
    return { amount: Number(vehicle.priceListLocal), currency: organization.preferredCurrency };
  }
  return {};
}

// Lee la organización bajo el mismo tx y calcula el precio de la unidad.
async function priceFromVehicleInTx(
  organizationId: string,
  vehicle: Parameters<typeof priceFromVehicle>[0],
  tx: Db,
): Promise<PriceFromVehicle> {
  const organization = await findOrganizationById(organizationId, tx);
  return priceFromVehicle(vehicle, { preferredCurrency: organization?.preferredCurrency ?? null });
}

// Ítem 154: el "hoy" de la organización para la fecha de cierre automática.
async function hoyDeLaOrganizacion(organizationId: string, db: Db = prisma): Promise<Date> {
  const organization = await findOrganizationById(organizationId, db);
  return hoyEnLaZona(organization?.timezone ?? "UTC");
}

export interface CreateOpportunityInput {
  title: string;
  amount?: number;
  currency?: string;
  expectedCloseDate?: Date;
  actualCloseDate?: Date;
  status?: OpportunityStatus;
  lostReason?: string;
  companyId?: string;
  contactId?: string;
  pipelineId: string;
  stageId: string;
  ownerId?: string;
  vehicleId?: string;
  financingType?: OpportunityFinancingType;
  leadSource?: OpportunityLeadSource;
  // Detalle de financiación (§42): pasan tal cual, sin regla de negocio.
  financingLender?: string;
  financingDownPayment?: number;
  financingInstallmentCount?: number;
  financingInstallmentAmount?: number;
}

export async function createOpportunity(
  organizationId: string,
  actorUserId: string,
  input: CreateOpportunityInput,
) {
  const [ownerId, companyId, contactId] = await Promise.all([
    resolveOwnerId(organizationId, actorUserId, input.ownerId),
    validateCompanyId(organizationId, input.companyId),
    validateContactId(organizationId, input.contactId),
  ]);

  // Pre-checks rápidos, fuera de la transacción — 400 inmediato en el caso
  // común sin abrir una. No son la defensa: la lectura que decide es la de
  // adentro, con el lock ya tomado.
  await validatePipelineId(organizationId, input.pipelineId);
  const etapa = await validateStageId(organizationId, input.stageId, input.pipelineId);
  if (input.vehicleId) {
    await validateVehicleId(organizationId, input.vehicleId);
  }

  // Ítem 154: el estado sale de la etapa, y los campos de cierre del estado.
  const { status } = resolverEstadoYEtapa({
    etapa,
    etapaCambia: true,
    creando: true,
    statusPedido: input.status,
    statusActual: undefined,
    etapasDelPipeline: await findStagesByPipeline(input.pipelineId),
  });
  const cierre = resolverCamposDeCierre({
    status,
    previo: undefined,
    body: { actualCloseDate: input.actualCloseDate, lostReason: input.lostReason },
    actual: { actualCloseDate: null, lostReason: null },
    hoy: await hoyDeLaOrganizacion(organizationId),
  });

  return prisma.$transaction(async (tx) => {
    // ALTO-8 — la otra mitad del RESTRICT de deleteStage. Ese borrado decide
    // sobre un conteo de oportunidades activas; sin este lock, dos requests
    // concurrentes —uno creando la oportunidad, otro borrando el stage— pasan
    // los dos su chequeo y la oportunidad queda en un stage borrado, invisible
    // en el tablero pero contada en los totales.
    await lockStageForUpdate(input.stageId, organizationId, tx);

    // Revalida con el lock sostenido. Alcanza con el stage: no hace falta
    // revalidar el pipeline porque deletePipeline exige cero stages activos, y
    // este stage está vivo y lockeado — el pipeline no puede haberse borrado
    // debajo mientras eso sea cierto.
    await validateStageId(organizationId, input.stageId, input.pipelineId, tx);

    // El precio de la unidad es el default; el body explícito gana (mismo
    // criterio que applyConsignmentRule en vehicle.service.ts).
    let precioDeLaUnidad: PriceFromVehicle = {};
    if (input.vehicleId) {
      await lockOrganizationForUpdate(organizationId, tx);
      const vehicle = await validateVehicleId(organizationId, input.vehicleId, tx);
      assertVehicleAvailable(vehicle);
      precioDeLaUnidad = await priceFromVehicleInTx(organizationId, vehicle, tx);
    }

    const created = await createOpportunityRepo(
      {
        organizationId,
        companyId,
        contactId,
        ownerId,
        pipelineId: input.pipelineId,
        stageId: input.stageId,
        title: input.title,
        amount: input.amount ?? precioDeLaUnidad.amount,
        currency: input.currency ?? precioDeLaUnidad.currency,
        expectedCloseDate: input.expectedCloseDate,
        actualCloseDate: cierre.actualCloseDate ?? undefined,
        status,
        lostReason: cierre.lostReason ?? undefined,
        vehicleId: input.vehicleId,
        financingType: input.financingType,
        leadSource: input.leadSource,
        financingLender: input.financingLender,
        financingDownPayment: input.financingDownPayment,
        financingInstallmentCount: input.financingInstallmentCount,
        financingInstallmentAmount: input.financingInstallmentAmount,
      },
      tx,
    );

    if (input.vehicleId) {
      await setVehicleStatusForOpportunityLink(
        organizationId,
        actorUserId,
        input.vehicleId,
        vehicleStatusForOpportunityStatus(created.status),
        tx,
      );
      // Entrega (§40): creada directamente como ganada, la unidad pasa de
      // AVAILABLE (assertVehicleAvailable, arriba) a SOLD, y en la misma
      // transacción nace su entrega pendiente. La oportunidad es nueva, así
      // que no puede tener una entrega previa.
      if (created.status === "WON") {
        await createDeliveryForSoldVehicle(organizationId, created.id, input.vehicleId, tx);
      }
    }

    // Ítem 157: ganar la venta hace CUSTOMER a su contacto, en la misma
    // transacción.
    if (created.status === "WON" && created.contactId) {
      await markContactAsCustomer(created.contactId, organizationId, tx);
    }

    // Creada directamente como ganada: el evento va en el MISMO tx, lo último
    // de la transacción, cuando la fila y la unidad ya están escritas. O
    // comitean los dos, o ninguno.
    if (created.status === "WON") {
      await emitOpportunityWon(
        organizationId,
        { opportunityId: created.id, ownerId: created.ownerId },
        tx,
      );
    }

    return created;
  });
}

export interface UpdateOpportunityInput {
  title?: string;
  amount?: number;
  currency?: string;
  expectedCloseDate?: Date | null;
  actualCloseDate?: Date | null;
  status?: OpportunityStatus;
  lostReason?: string | null;
  companyId?: string;
  contactId?: string;
  pipelineId?: string;
  stageId?: string;
  ownerId?: string;
  // null = desvincular explícito, mismo patrón que expectedCloseDate/lostReason.
  vehicleId?: string | null;
  financingType?: OpportunityFinancingType | null;
  leadSource?: OpportunityLeadSource | null;
  // null = vaciar; no disparan nada (ni automatizaciones ni la unidad).
  financingLender?: string | null;
  financingDownPayment?: number | null;
  financingInstallmentCount?: number | null;
  financingInstallmentAmount?: number | null;
}

export async function updateOpportunity(
  organizationId: string,
  actorUserId: string,
  id: string,
  input: UpdateOpportunityInput,
) {
  // 404 si no existe, no es de esta organización, o ya está borrada.
  const opportunity = await getOpportunityById(organizationId, id);

  const data: UpdateOpportunityInput = { ...input };

  if (input.ownerId) {
    data.ownerId = await resolveOwnerId(organizationId, actorUserId, input.ownerId);
  }

  if (input.companyId) {
    data.companyId = (await validateCompanyId(organizationId, input.companyId)) ?? undefined;
  }

  if (input.contactId) {
    data.contactId = (await validateContactId(organizationId, input.contactId)) ?? undefined;
  }

  // Mover de stage: el nuevo stage tiene que pertenecer al pipeline actual
  // de la oportunidad, salvo que el pipeline también se esté cambiando en
  // esta misma operación — nunca se cambia el pipeline "solo" implícito por
  // mover el stage.
  if (input.pipelineId && !input.stageId) {
    throw new AppError(
      "Si cambiás el pipeline, indicá también el nuevo stageId en la misma operación",
      400,
    );
  }

  if (input.pipelineId) {
    await validatePipelineId(organizationId, input.pipelineId);
  }

  const effectivePipelineId = input.pipelineId ?? opportunity.pipelineId;
  let nuevoStageId = input.stageId;

  let etapaPedida: EtapaConMarca | undefined;
  if (nuevoStageId) {
    etapaPedida = await validateStageId(organizationId, nuevoStageId, effectivePipelineId);
  }

  // Ítem 154 de docs/matriz-de-datos-crm.md: la etapa manda sobre el estado
  // (la regla del §51, que hasta acá vivía solo en el frontend), y la fecha de
  // cierre y el motivo acompañan al estado. Solo si el PATCH toca alguno de
  // los cuatro: un cambio de título no revisa nada.
  if (
    input.status !== undefined ||
    input.stageId !== undefined ||
    input.actualCloseDate !== undefined ||
    input.lostReason !== undefined
  ) {
    const etapaActual = (await findStageById(opportunity.stageId, organizationId)) ?? {
      id: opportunity.stageId,
      isWon: false,
      isLost: false,
    };
    const resuelto = resolverEstadoYEtapa({
      etapa: etapaPedida ?? etapaActual,
      etapaCambia: etapaPedida !== undefined && etapaPedida.id !== opportunity.stageId,
      creando: false,
      statusPedido: input.status,
      statusActual: opportunity.status,
      etapasDelPipeline: await findStagesByPipeline(effectivePipelineId),
    });
    if (resuelto.status !== opportunity.status || input.status !== undefined) {
      data.status = resuelto.status;
    }
    if (resuelto.stageId !== (etapaPedida ?? etapaActual).id) {
      // Solo cambió el estado: se mueve a la etapa que lo significa, igual que
      // arrastrarla en el embudo. Pasa por el mismo lock y revalidación de
      // stage que cualquier cambio de etapa (abajo).
      data.stageId = resuelto.stageId;
      nuevoStageId = resuelto.stageId;
    }
    Object.assign(
      data,
      resolverCamposDeCierre({
        status: resuelto.status,
        previo: opportunity.status,
        body: { actualCloseDate: input.actualCloseDate, lostReason: input.lostReason },
        actual: {
          actualCloseDate: opportunity.actualCloseDate,
          lostReason: opportunity.lostReason,
        },
        hoy: await hoyDeLaOrganizacion(organizationId),
      }),
    );
  }

  // Vínculo con la unidad: qué queda vinculado y si hay que sincronizar su
  // estado. Se sincroniza cuando cambia la unidad (vincular, desvincular,
  // reemplazar) o cuando, con una unidad vinculada, cambia el estado de la
  // oportunidad (OPEN → WON vende la unidad).
  const oldVehicleId = opportunity.vehicleId;
  const vehicleIdTouched = input.vehicleId !== undefined;
  const newVehicleId = vehicleIdTouched ? (input.vehicleId ?? null) : oldVehicleId;
  const vehicleChanged = newVehicleId !== oldVehicleId;
  const effectiveStatus = data.status ?? opportunity.status;
  const needsVehicleSync =
    vehicleChanged || (newVehicleId !== null && effectiveStatus !== opportunity.status);

  // Pre-check rápido de la unidad nueva, fuera de la transacción; la lectura
  // que decide es la de adentro, con el lock tomado.
  if (vehicleChanged && newVehicleId) {
    await validateVehicleId(organizationId, newVehicleId);
  }

  // ¿Pide ganar? Solo un PATCH que manda status: "WON" puede producir la
  // transición a ganada; si la produce DE VERDAD se decide adentro de la
  // transacción, con la fila bloqueada (ver lockOpportunityForUpdate) — el
  // `opportunity.status` leído arriba, sin lock, no alcanza: dos PATCH
  // concurrentes a WON leerían OPEN los dos y emitirían dos eventos. El owner
  // del payload es el efectivo después del cambio: si el mismo PATCH reasigna
  // y gana, el seguimiento va al dueño nuevo.
  // Ítem 154: "pedir" ganar incluye moverla a una etapa ganada sin mandar
  // status — el estado ya salió de la etapa, arriba.
  const pideGanada = data.status === "WON";
  const ownerIdEfectivo = data.ownerId ?? opportunity.ownerId;

  // La escritura va en transacción SOLO cuando cambia el stage, hay que
  // sincronizar la unidad o el PATCH pide ganar, y es deliberado: son los
  // únicos casos con un invariante que defender —el RESTRICT de deleteStage,
  // la exclusión de la unidad, la atomicidad del evento saliente con el cambio
  // que lo origina— y por lo tanto los únicos que necesitan la transacción. Un
  // UPDATE que no toca ninguno de los tres no compite con nadie, y envolverlo
  // igual costaría un BEGIN y un COMMIT de más en el camino más frecuente.
  const dataRepo = {
    ...data,
    vehicleId: vehicleIdTouched ? newVehicleId : undefined,
  };

  if (nuevoStageId || needsVehicleSync || pideGanada) {
    await prisma.$transaction(async (tx) => {
      if (nuevoStageId) {
        await lockStageForUpdate(nuevoStageId, organizationId, tx);
        // Revalida con el lock sostenido: entre el pre-check de arriba y este
        // punto, deleteStage pudo haber borrado el stage de destino. Sin esto,
        // su RESTRICT sería evitable simplemente por llegar primero.
        await validateStageId(organizationId, nuevoStageId, effectivePipelineId, tx);
      }

      if (needsVehicleSync) {
        // Después del lock de stage, en el mismo orden que createOpportunity.
        await lockOrganizationForUpdate(organizationId, tx);

        // Ítem 151: una unidad ENTREGADA es historia. Con la entrega
        // confirmada, la oportunidad no puede dejar de estar ganada ni
        // cambiar de unidad — sin esto, pasarla a LOST devolvía al stock
        // (AVAILABLE, y publicada) un auto que el cliente ya se llevó. Se lee
        // bajo el lock de organización, el mismo que toma confirmDelivery.
        if (
          (effectiveStatus !== "WON" || vehicleChanged) &&
          (await hasConfirmedDelivery(organizationId, id, tx))
        ) {
          throw new AppError(ENTREGA_CONFIRMADA_BLOQUEA_CAMBIOS, 409);
        }

        if (vehicleChanged && oldVehicleId) {
          // Se libera la unidad anterior SOLO si sigue reservada por este
          // vínculo. Si ya está SOLD, o alguien la pasó a mano a
          // IN_PREPARATION/IN_TRANSIT desde el PATCH directo de /vehicles/:id,
          // no se toca: el vínculo no tiene por qué pisar una decisión
          // operativa tomada por fuera de él — misma clase de cuidado que
          // applyConsignmentRule.
          const previo = await findVehicleById(oldVehicleId, organizationId, tx);
          if (previo && previo.status === "RESERVED") {
            await setVehicleStatusForOpportunityLink(
              organizationId,
              actorUserId,
              oldVehicleId,
              "AVAILABLE",
              tx,
            );
          }
        }

        if (newVehicleId) {
          const vehicle = await validateVehicleId(organizationId, newVehicleId, tx);
          if (vehicleChanged) {
            // Vínculo nuevo: la unidad tiene que estar libre. Si es la misma
            // de siempre y solo cambia el estado de la oportunidad, ya es "de
            // esta oportunidad" y no hay nada que exigir.
            assertVehicleAvailable(vehicle);
            if (data.amount === undefined && data.currency === undefined) {
              const precio = await priceFromVehicleInTx(organizationId, vehicle, tx);
              dataRepo.amount = precio.amount;
              dataRepo.currency = precio.currency;
            }
          }
        }
      }

      // La detección REAL de la transición a ganada, sobre el status leído bajo
      // el lock de la fila. Se toma DESPUÉS del lock de stage y del de
      // organización, en el mismo orden relativo en que el UPDATE de abajo
      // tomaría el lock de esta misma fila: deleteOpportunity lockea la
      // organización y después escribe la oportunidad, así que tomar la fila
      // antes que la organización acá sería la receta de un deadlock.
      let pasaAWon = false;
      if (pideGanada) {
        const bloqueada = await lockOpportunityForUpdate(id, organizationId, tx);
        if (!bloqueada) {
          throw new AppError("Oportunidad no encontrada", 404);
        }
        pasaAWon = transicionaAGanada(bloqueada.status, "WON");
      }

      const result = await updateOpportunityRepo(id, organizationId, dataRepo, tx);
      if (result.count === 0) {
        throw new AppError("Oportunidad no encontrada", 404);
      }

      if (needsVehicleSync && newVehicleId) {
        await setVehicleStatusForOpportunityLink(
          organizationId,
          actorUserId,
          newVehicleId,
          vehicleStatusForOpportunityStatus(effectiveStatus),
          tx,
        );

        // Entrega (§40), en la misma transacción que deja la unidad SOLD.
        // Nace en dos casos: la oportunidad PASA a ganada con la unidad
        // vinculada (pasaAWon), o a una ganada se le vincula una unidad
        // (vehicleChanged).
        //
        // NO alcanza con "el destino de la unidad es SOLD". needsVehicleSync
        // se decide sobre el status leído SIN lock: dos PATCH a WON
        // concurrentes entran los dos a este bloque, y el segundo —que hoy es
        // un no-op sobre una unidad ya SOLD— reventaría el UNIQUE de la
        // entrega con un 409. pasaAWon sale de la fila bloqueada, así que solo
        // el primero la crea (carrera probada en
        // delivery.service.integration-test.ts).
        //
        // Ítem 151: ensure y no create. Una oportunidad que ganó, se reabrió y
        // vuelve a ganar ya tiene su entrega PENDING: se reusa en vez de
        // chocar con el UNIQUE (antes, 409 ENTREGA_YA_EXISTE y la oportunidad
        // quedaba sin poder ganarse nunca más).
        if (effectiveStatus === "WON" && (pasaAWon || vehicleChanged)) {
          await ensureDeliveryForSoldVehicle(organizationId, id, newVehicleId, tx);
        }
      }

      // Después de que el UPDATE confirmó count === 1 (una oportunidad que
      // desapareció entre el pre-check y la escritura dio 404 arriba y no
      // llega acá) y después de la unidad, como en createOpportunity: el
      // evento es lo último de la transacción. No existe camino por el que el
      // cambio a WON comitee sin el evento, ni el evento sin el cambio.
      // Ítem 157 de docs/matriz-de-datos-crm.md: ganar la venta hace CUSTOMER
      // a su contacto (el que queda después de este PATCH). Antes, un LEAD
      // seguía LEAD después de comprar: nada derivaba lifecycleStage de las
      // oportunidades. Solo en la transición real (pasaAWon, leída bajo el
      // lock de la fila) y nunca hacia atrás: reabrir o perder no lo degrada,
      // porque ser cliente es un hecho que ya pasó.
      const contactoEfectivo = data.contactId ?? opportunity.contactId;
      if (pasaAWon && contactoEfectivo) {
        await markContactAsCustomer(contactoEfectivo, organizationId, tx);
      }

      if (pasaAWon) {
        await emitOpportunityWon(
          organizationId,
          { opportunityId: id, ownerId: ownerIdEfectivo },
          tx,
        );
      }
    });
  } else {
    const result = await updateOpportunityRepo(id, organizationId, dataRepo);
    if (result.count === 0) {
      throw new AppError("Oportunidad no encontrada", 404);
    }
  }

  return getOpportunityById(organizationId, id);
}

export async function deleteOpportunity(organizationId: string, actorUserId: string, id: string) {
  const opportunity = await getOpportunityById(organizationId, id);

  // Sin unidad vinculada no hay nada que sincronizar: el camino de siempre,
  // sin transacción.
  if (!opportunity.vehicleId) {
    const result = await softDeleteOpportunity(id, organizationId);
    if (result.count === 0) {
      throw new AppError("Oportunidad no encontrada", 404);
    }
    return;
  }

  // Con unidad: se libera si sigue reservada por este vínculo (mismo criterio
  // que al desvincular en updateOpportunity), y el soft delete va en la misma
  // transacción bajo el lock de organización.
  const vehicleId = opportunity.vehicleId;
  await prisma.$transaction(async (tx) => {
    await lockOrganizationForUpdate(organizationId, tx);
    const vehicle = await findVehicleById(vehicleId, organizationId, tx);
    if (vehicle && vehicle.status === "RESERVED") {
      await setVehicleStatusForOpportunityLink(
        organizationId,
        actorUserId,
        vehicleId,
        "AVAILABLE",
        tx,
      );
    }
    const result = await softDeleteOpportunity(id, organizationId, tx);
    if (result.count === 0) {
      throw new AppError("Oportunidad no encontrada", 404);
    }
  });
}

// ---------------------------------------------------------------------------
// Resumen comercial del Dashboard (§30 de docs/frontend-cambios-pendientes.md,
// rediseñado en el §35). Es el primer agregado (SUM) que expone la API de
// Opportunity: hasta el §30 el Dashboard solo podía contar vía
// pagination.total de un listado.
//
// Todos los montos van en UNA sola moneda, la preferida de la organización
// (USD si no está configurada): las oportunidades en otra moneda quedan
// fuera de los totales en $, pero NO de los conteos (openCount, los de Win
// Rate) — decisión tomada con el dueño del proyecto, distinta a propósito del
// criterio por moneda de formatAmountTotals en el frontend. Los Decimal se
// serializan como string con dos decimales, nunca Number.
//
// Desde el §35 el resumen YA NO es siempre mensual: recibe la misma
// granularidad que la serie de ingresos. El §35 devolvía DOS juegos de
// ventanas —uno siempre mensual para "Valor del pipeline" y otro según
// `granularity` para el resto—; desde el §36, que sacó esa card del
// Dashboard, hay UN solo juego: createdThisPeriod/createdLastPeriod,
// wonThisPeriod/wonLastPeriod y lostCountThisPeriod/lostCountLastPeriod, la
// ventana que pide `granularity`, una por cada una de las tres cards que
// quedaron. El par siempre-mensual se fue con su único consumidor.
//
// Los límites de las ventanas son UTC (ver utils/utcMonth.ts por qué). `now`
// y `db` son inyectables para probar los bordes sin depender del reloj ni de
// una base (opportunity.service.test.ts); el default es el camino real.
// `granularity` NO tiene default a propósito: quien llama siempre sabe cuál
// quiere, y un default acá escondería un bug — el mismo criterio que el
// schema Zod de la ruta.
// ---------------------------------------------------------------------------

// Compartida por el resumen y por la serie de ingresos (§33): desde el §35 las
// dos respuestas se piden con la misma granularidad y las dos la declaran en
// su respuesta.
export type RevenueGranularity = "month" | "week" | "day";

export const DASHBOARD_DEFAULT_CURRENCY = "USD";

export interface DashboardFigures {
  count: number;
  // SUM(amount) en la moneda de la organización, "0.00" si no hay filas.
  value: string;
}

export interface DashboardSummary {
  currency: string;
  // Eco de lo pedido, igual que RevenueSeries: el frontend rotula las cards
  // con ESTA granularidad y no con la de su propio estado, así los rótulos
  // nunca describen números de otra ventana.
  granularity: RevenueGranularity;
  // status=OPEN ahora mismo, sin ninguna ventana. El conteo no filtra por
  // moneda. Los dos quedaron sin consumidor en el frontend (openCount desde el
  // §35, openValue desde el §36, que sacó "Valor del pipeline" del Dashboard)
  // y se mantienen igual: son dos agregados baratos sobre el mismo índice y
  // son la aserción de los tests de aislamiento multi-tenant
  // (opportunityDashboard.integration-test.ts).
  openCount: number;
  // SUM(amount) de las OPEN en la moneda de la organización, ahora mismo.
  openValue: string;
  // Oportunidades CREADAS (createdAt, inmutable) en la ventana de
  // `granularity`: el valor Y la variación de la card "Oportunidades creadas".
  createdThisPeriod: DashboardFigures;
  createdLastPeriod: DashboardFigures;
  // WON con actualCloseDate dentro de la ventana del período: count para Win
  // Rate, value para "Ganado".
  wonThisPeriod: DashboardFigures;
  wonLastPeriod: DashboardFigures;
  // LOST con actualCloseDate dentro de la ventana: el resto del denominador
  // de Win Rate.
  lostCountThisPeriod: number;
  lostCountLastPeriod: number;
}

function serializeAmount(sum: Prisma.Decimal | null): string {
  return sum === null ? "0.00" : sum.toFixed(2);
}

function inWindow(window: { start: Date; end: Date }) {
  return { gte: window.start, lt: window.end };
}

// La ventana "en curso" (offset 0) o "anterior" (offset -1) de la granularidad
// pedida. Es el único lugar donde el resumen elige entre mes, semana y día:
// las tres funciones ya existían desde el §33 y devuelven el mismo
// {start, end}, así que acá no se calcula ninguna fecha nueva.
function periodWindow(
  granularity: RevenueGranularity,
  now: Date,
  offset: number,
): { start: Date; end: Date } {
  if (granularity === "month") return monthWindowUTC(now, offset);
  return granularity === "week" ? weekWindowUTC(now, offset) : dayWindowUTC(now, offset);
}

// La moneda en la que se reportan TODOS los agregados de la organización.
// Compartida por el resumen y por la serie de ingresos (§33) para que las dos
// respondan lo mismo: la preferida de la organización, o USD si no configuró
// ninguna.
async function resolveReportingCurrency(organizationId: string, db: Db): Promise<string> {
  const organization = await findOrganizationById(organizationId, db);
  return organization?.preferredCurrency ?? DASHBOARD_DEFAULT_CURRENCY;
}

export async function getDashboardSummary(
  organizationId: string,
  {
    granularity,
    now = new Date(),
    db = prisma,
  }: { granularity: RevenueGranularity; now?: Date; db?: Db },
): Promise<DashboardSummary> {
  const currency = await resolveReportingCurrency(organizationId, db);

  const thisPeriod = periodWindow(granularity, now, 0);
  const lastPeriod = periodWindow(granularity, now, -1);

  const count = (where: OpportunityAggregateWhere) =>
    countOpportunitiesWhere(organizationId, where, db);
  const sum = (where: OpportunityAggregateWhere) =>
    sumOpportunityAmount(organizationId, { ...where, currency }, db);

  // Todas las consultas son independientes entre sí: un solo Promise.all, la
  // misma forma de "N consultas en paralelo" que usa getRevenueSeries. Desde
  // el §35 "ganado" ya NO se deriva de las dos últimas entradas de una serie
  // de 6 meses (que se fue junto con revenueByMonth): es su propio SUM sobre
  // la ventana del período, que puede ser una semana o un día.
  const [
    openCount,
    openValue,
    createdThisPeriodCount,
    createdThisPeriodValue,
    createdLastPeriodCount,
    createdLastPeriodValue,
    wonThisPeriodCount,
    wonThisPeriodValue,
    wonLastPeriodCount,
    wonLastPeriodValue,
    lostCountThisPeriod,
    lostCountLastPeriod,
  ] = await Promise.all([
    count({ status: "OPEN" }),
    sum({ status: "OPEN" }),
    count({ createdAt: inWindow(thisPeriod) }),
    sum({ createdAt: inWindow(thisPeriod) }),
    count({ createdAt: inWindow(lastPeriod) }),
    sum({ createdAt: inWindow(lastPeriod) }),
    count({ status: "WON", actualCloseDate: inWindow(thisPeriod) }),
    sum({ status: "WON", actualCloseDate: inWindow(thisPeriod) }),
    count({ status: "WON", actualCloseDate: inWindow(lastPeriod) }),
    sum({ status: "WON", actualCloseDate: inWindow(lastPeriod) }),
    count({ status: "LOST", actualCloseDate: inWindow(thisPeriod) }),
    count({ status: "LOST", actualCloseDate: inWindow(lastPeriod) }),
  ]);

  return {
    currency,
    granularity,
    openCount,
    openValue: serializeAmount(openValue),
    createdThisPeriod: {
      count: createdThisPeriodCount,
      value: serializeAmount(createdThisPeriodValue),
    },
    createdLastPeriod: {
      count: createdLastPeriodCount,
      value: serializeAmount(createdLastPeriodValue),
    },
    wonThisPeriod: { count: wonThisPeriodCount, value: serializeAmount(wonThisPeriodValue) },
    wonLastPeriod: { count: wonLastPeriodCount, value: serializeAmount(wonLastPeriodValue) },
    lostCountThisPeriod,
    lostCountLastPeriod,
  };
}

// ---------------------------------------------------------------------------
// Serie de ingresos por período (§33 de docs/frontend-cambios-pendientes.md).
//
// Endpoint APARTE del resumen, y sigue siéndolo después del §35: aunque ahora
// los dos reciben la MISMA granularidad, una serie de N buckets y un puñado de
// agregados de dos ventanas son dos respuestas de tamaño y de ritmo distintos,
// y el frontend las cachea por separado. Los dos comparten el patrón (una
// ventana por bucket, un SUM por ventana en paralelo) y la moneda de reporte
// (resolveReportingCurrency), no el request.
//
// El último bucket de cualquier granularidad es SIEMPRE el período en curso,
// sin cerrar — lastMonthsUTC/lastWeeksUTC/lastDaysUTC comparten ese contrato,
// y es lo que habilita al frontend a dibujar el último tramo punteado.
// ---------------------------------------------------------------------------

// Cuántos buckets trae cada granularidad: 6 meses (los del §30, cuando el
// resumen traía una serie mensual propia), 8 semanas son ~2 meses de detalle
// semanal y 30 días un mes de detalle diario. Ajustables sin tocar nada más.
export const REVENUE_SERIES_BUCKET_COUNT: Record<RevenueGranularity, number> = {
  month: 6,
  week: 8,
  day: 30,
};

export interface RevenueSeries {
  currency: string;
  granularity: RevenueGranularity;
  // En orden cronológico, el período en curso al final. `label` es "YYYY-MM"
  // para meses y "YYYY-MM-DD" (la fecha de inicio de la ventana) para semanas
  // y días: la clave cruda, que el frontend formatea.
  points: Array<{ label: string; value: string }>;
}

function revenueWindows(
  granularity: RevenueGranularity,
  now: Date,
): Array<{ label: string; start: Date; end: Date }> {
  const count = REVENUE_SERIES_BUCKET_COUNT[granularity];
  if (granularity === "month") {
    // lastMonthsUTC rotula con `month`; el resto ya rotula con `label`.
    return lastMonthsUTC(now, count).map((window) => ({
      label: window.month,
      start: window.start,
      end: window.end,
    }));
  }
  return granularity === "week" ? lastWeeksUTC(now, count) : lastDaysUTC(now, count);
}

export async function getRevenueSeries(
  organizationId: string,
  granularity: RevenueGranularity,
  { now = new Date(), db = prisma }: { now?: Date; db?: Db } = {},
): Promise<RevenueSeries> {
  const currency = await resolveReportingCurrency(organizationId, db);
  const windows = revenueWindows(granularity, now);

  // El mismo patrón que el resumen: N consultas independientes, una por
  // ventana, todas en paralelo.
  const sums = await Promise.all(
    windows.map((window) =>
      sumOpportunityAmount(
        organizationId,
        { status: "WON", actualCloseDate: inWindow(window), currency },
        db,
      ),
    ),
  );

  return {
    currency,
    granularity,
    points: windows.map((window, index) => ({
      label: window.label,
      value: serializeAmount(sums[index]),
    })),
  };
}
