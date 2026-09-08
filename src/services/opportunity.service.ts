import type {
  OpportunityFinancingType,
  OpportunityLeadSource,
  OpportunityStatus,
  Prisma,
  VehicleStatus,
} from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { findCompanyById } from "../repositories/company.repository";
import { findContactById } from "../repositories/contact.repository";
import {
  countOpportunities,
  createOpportunity as createOpportunityRepo,
  findManyOpportunities,
  findOpportunityById,
  softDeleteOpportunity,
  updateOpportunity as updateOpportunityRepo,
  type OpportunitySortBy,
  type SortOrder,
} from "../repositories/opportunity.repository";
import {
  findOrganizationById,
  lockOrganizationForUpdate,
} from "../repositories/organization.repository";
import { findPipelineById } from "../repositories/pipeline.repository";
import { findStageById, lockStageForUpdate } from "../repositories/stage.repository";
import { findVehicleById } from "../repositories/vehicle.repository";
import { AppError } from "../utils/AppError";
import { resolveOwnerId } from "./ownership.service";
import { setVehicleStatusForOpportunityLink } from "./vehicle.service";

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
// Exportada para probarla sin base.
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
  await validateStageId(organizationId, input.stageId, input.pipelineId);
  if (input.vehicleId) {
    await validateVehicleId(organizationId, input.vehicleId);
  }

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
        actualCloseDate: input.actualCloseDate,
        status: input.status,
        lostReason: input.lostReason,
        vehicleId: input.vehicleId,
        financingType: input.financingType,
        leadSource: input.leadSource,
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
  const nuevoStageId = input.stageId;

  if (nuevoStageId) {
    await validateStageId(organizationId, nuevoStageId, effectivePipelineId);
  }

  // Vínculo con la unidad: qué queda vinculado y si hay que sincronizar su
  // estado. Se sincroniza cuando cambia la unidad (vincular, desvincular,
  // reemplazar) o cuando, con una unidad vinculada, cambia el estado de la
  // oportunidad (OPEN → WON vende la unidad).
  const oldVehicleId = opportunity.vehicleId;
  const vehicleIdTouched = input.vehicleId !== undefined;
  const newVehicleId = vehicleIdTouched ? (input.vehicleId ?? null) : oldVehicleId;
  const vehicleChanged = newVehicleId !== oldVehicleId;
  const effectiveStatus = input.status ?? opportunity.status;
  const needsVehicleSync =
    vehicleChanged || (newVehicleId !== null && effectiveStatus !== opportunity.status);

  // Pre-check rápido de la unidad nueva, fuera de la transacción; la lectura
  // que decide es la de adentro, con el lock tomado.
  if (vehicleChanged && newVehicleId) {
    await validateVehicleId(organizationId, newVehicleId);
  }

  // La escritura va en transacción SOLO cuando cambia el stage o hay que
  // sincronizar la unidad, y es deliberado: son los únicos casos con un
  // invariante que defender —el RESTRICT de deleteStage, la exclusión de la
  // unidad— y por lo tanto los únicos que necesitan un lock. Un UPDATE que no
  // toca ninguno de los dos no compite con nadie, y envolverlo igual costaría
  // un BEGIN y un COMMIT de más en el camino más frecuente.
  const dataRepo = {
    ...data,
    vehicleId: vehicleIdTouched ? newVehicleId : undefined,
  };

  if (nuevoStageId || needsVehicleSync) {
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
