import { Prisma, type DeliveryStatus, type VehicleStatus } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import {
  confirmDeliveryConditional,
  createDelivery,
  findDeliveryById,
  findDeliveryByOpportunity,
  reassignPendingDeliveryVehicle,
  updatePendingDelivery,
  type DeliveryChecklistItem,
  type UpdatePendingDeliveryData,
} from "../repositories/delivery.repository";
import { findOpportunityById } from "../repositories/opportunity.repository";
import { lockOrganizationForUpdate } from "../repositories/organization.repository";
import { findVehicleById } from "../repositories/vehicle.repository";
import { AppError } from "../utils/AppError";
import { setVehicleStatusForOpportunityLink } from "./vehicle.service";

// ---------------------------------------------------------------------------
// Entrega (§40 de docs/frontend-cambios-pendientes.md).
//
// "Vendido" y "entregado" son dos eventos distintos. La oportunidad que gana
// pasa la unidad a SOLD (opportunity.service.ts) y, en esa MISMA transacción,
// crea la Delivery en PENDING con el checklist default
// (createDeliveryForSoldVehicle, abajo). No hay POST: nace sola.
//
//   - Mientras está PENDING se edita el checklist (tildar, destildar, agregar
//     y quitar ítems propios de ESTA entrega) y la fecha programada.
//   - "Confirmar entrega" la pasa a DELIVERED, registra quién y cuándo, y
//     mueve la unidad de SOLD a DELIVERED. El checklist es INFORMATIVO: se
//     confirma aunque falten ítems (a veces se entrega igual sin el manual).
//   - Una vez DELIVERED es un registro histórico inmutable (409 al editar),
//     mismo criterio que Quote una vez SENT.
//
// Las piezas de decisión son funciones puras exportadas
// (defaultDeliveryChecklist, normalizeChecklist, assertEditable,
// assertConfirmable) y se prueban sin base en delivery.service.test.ts. La
// aplicación real con filas, locks, carreras y aislamiento está en
// delivery.service.integration-test.ts.
//
// REVERSIÓN (ítem 151 de docs/matriz-de-datos-crm.md; el §40 la había dejado
// fuera de alcance):
//
//   - Con la entrega CONFIRMADA, la oportunidad ya no puede dejar de estar
//     ganada ni cambiar de unidad: 409 ENTREGA_CONFIRMADA_BLOQUEA_CAMBIOS
//     (lo aplica opportunity.service.ts). Antes, pasarla a LOST devolvía una
//     unidad entregada al stock como AVAILABLE, y el agente la volvía a
//     ofrecer.
//   - Con la entrega PENDING, revertir sigue permitido: la entrega queda como
//     está ("Confirmar entrega" da 409 mientras la unidad no esté SOLD), y
//     volver a ganar la REUSA (ensureDeliveryForSoldVehicle) en vez de chocar
//     con el UNIQUE, que dejaba la oportunidad sin poder ganarse nunca más.
// ---------------------------------------------------------------------------

// El default fijo con el que nace cada entrega. Sin catálogo configurable por
// organización o sucursal a propósito (§40, nota de alcance): mismo criterio
// de no sobre-construir que Quote.lines.
export const DEFAULT_DELIVERY_CHECKLIST_LABELS: readonly string[] = [
  "Documentación de transferencia",
  "Manual del vehículo",
  "Llave de repuesto",
  "Kit de herramientas / gato",
  "Service al día",
];

// Copia nueva en cada llamada: cada entrega edita la suya.
export function defaultDeliveryChecklist(): DeliveryChecklistItem[] {
  return DEFAULT_DELIVERY_CHECKLIST_LABELS.map((label) => ({ label, checked: false }));
}

// label ya viene recortado por zod; se vuelve a recortar para que la función
// no dependa de eso (mismo criterio que normalizeLines en quote.service.ts).
// Se reconstruye cada ítem para que no pase ninguna clave extra al JSONB.
export function normalizeChecklist(
  items: readonly DeliveryChecklistItem[],
): DeliveryChecklistItem[] {
  return items.map((item) => ({ label: item.label.trim(), checked: item.checked }));
}

export const ENTREGA_CONFIRMADA_INMUTABLE =
  "Esta entrega ya fue confirmada: el checklist y la fecha no se pueden modificar";

export const ENTREGA_YA_CONFIRMADA = "Esta entrega ya fue confirmada";

export const UNIDAD_NO_VENDIDA =
  "La unidad de esta entrega ya no está vendida: revisá el estado de la oportunidad y de la unidad antes de confirmar";

export const ENTREGA_YA_EXISTE = "La oportunidad ya tiene una entrega registrada";
export const ENTREGA_CONFIRMADA_BLOQUEA_CAMBIOS =
  "La unidad de esta oportunidad ya se entregó: no se puede cambiar el estado de la oportunidad ni su unidad";

// Editar solo mientras está PENDING. 409 y no 400: no es un dato inválido, es
// un conflicto con el estado que la base tiene ahora — mismo criterio que
// SOLO_BORRADOR_EDITABLE en quote.service.ts.
export function assertEditable(delivery: { status: DeliveryStatus }): void {
  if (delivery.status !== "PENDING") {
    throw new AppError(ENTREGA_CONFIRMADA_INMUTABLE, 409);
  }
}

// Confirmar exige la entrega PENDING y la unidad todavía SOLD. `vehicle` es
// la unidad leída bajo el lock de organización (null si no hay unidad o está
// dada de baja). Todos 409: la entrega existe, lo que choca es el estado.
//
// La unidad fuera de SOLD no debería pasar en el flujo normal: es la
// oportunidad revertida a OPEN (RESERVED) o LOST (AVAILABLE), o un cambio a
// mano desde el PATCH de /vehicles/:id. En cualquiera de esos casos pasarla a
// DELIVERED pisaría una decisión tomada por fuera de la entrega.
export function assertConfirmable(
  delivery: { status: DeliveryStatus; vehicleId: string | null },
  vehicle: { status: VehicleStatus } | null,
): void {
  if (delivery.status !== "PENDING") {
    throw new AppError(ENTREGA_YA_CONFIRMADA, 409);
  }
  if (delivery.vehicleId === null || vehicle === null || vehicle.status !== "SOLD") {
    throw new AppError(UNIDAD_NO_VENDIDA, 409);
  }
}

// ---------------------------------------------------------------------------
// Creación — solo desde opportunity.service.ts
// ---------------------------------------------------------------------------

// Dentro de la transacción del caller, que ya movió (o está moviendo) la
// unidad a SOLD con el lock de organización tomado.
//
// Si la oportunidad ya tenía una entrega, el UNIQUE (organization_id,
// opportunity_id) lo rechaza y NO se defiende con lógica previa: en el flujo
// normal no se llega acá dos veces (ver dónde se llama en
// opportunity.service.ts). Los caminos que sí llegan —volver a ganar una
// oportunidad revertida, o cambiarle la unidad a una ganada que ya tenía
// entrega— son el caso de reversión que el §40 deja fuera de alcance. Lo único
// que se hace es traducir el P2002 a un 409 legible en vez del 500 genérico
// del errorHandler (P2002 se traduce por servicio, ver utils/prismaErrors.ts).
export async function createDeliveryForSoldVehicle(
  organizationId: string,
  opportunityId: string,
  vehicleId: string,
  tx: Db,
) {
  try {
    return await createDelivery(
      { organizationId, opportunityId, vehicleId, checklist: defaultDeliveryChecklist() },
      tx,
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError(ENTREGA_YA_EXISTE, 409);
    }
    throw err;
  }
}

// Ítem 151 — la puerta que usa opportunity.service.ts al ganar con unidad.
// Sin entrega previa, la crea (camino de siempre). Con una PENDING de una
// ganancia anterior que se revirtió, la reusa: el checklist y la fecha que ya
// se habían cargado siguen valiendo, y si la unidad cambió se la reasigna. Una
// DELIVERED no puede llegar acá (el guard de opportunity.service.ts corta
// antes); si llegara, 409 y no se toca.
//
// Dentro de la transacción del caller y bajo su lock de organización, el mismo
// que toma confirmDelivery: la entrega no puede confirmarse entre la lectura y
// la reasignación.
export async function ensureDeliveryForSoldVehicle(
  organizationId: string,
  opportunityId: string,
  vehicleId: string,
  tx: Db,
) {
  const existente = await findDeliveryByOpportunity(organizationId, opportunityId, tx);
  if (!existente) {
    return createDeliveryForSoldVehicle(organizationId, opportunityId, vehicleId, tx);
  }
  if (existente.status !== "PENDING") {
    throw new AppError(ENTREGA_CONFIRMADA_BLOQUEA_CAMBIOS, 409);
  }
  if (existente.vehicleId !== vehicleId) {
    const result = await reassignPendingDeliveryVehicle(
      existente.id,
      organizationId,
      vehicleId,
      tx,
    );
    if (result.count === 0) {
      throw new AppError(ENTREGA_CONFIRMADA_BLOQUEA_CAMBIOS, 409);
    }
  }
  return existente;
}

// Ítem 151 — ¿esta oportunidad tiene una entrega ya confirmada? La lee
// opportunity.service.ts bajo el lock de organización antes de revertir o
// cambiar la unidad.
export async function hasConfirmedDelivery(
  organizationId: string,
  opportunityId: string,
  tx: Db,
): Promise<boolean> {
  const existente = await findDeliveryByOpportunity(organizationId, opportunityId, tx);
  return existente?.status === "DELIVERED";
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

async function requireDelivery(organizationId: string, id: string, db: Db = prisma) {
  const delivery = await findDeliveryById(id, organizationId, db);
  if (!delivery) {
    throw new AppError("Entrega no encontrada", 404);
  }
  return delivery;
}

// Una entrega de una oportunidad eliminada deja de ser alcanzable por id, con
// el mismo 404 que un id inexistente — mismo criterio que
// requireReachableQuote.
async function requireReachableDelivery(organizationId: string, id: string, db: Db = prisma) {
  const delivery = await requireDelivery(organizationId, id, db);
  const opportunity = await findOpportunityById(delivery.opportunityId, organizationId, db);
  if (!opportunity) {
    throw new AppError("Entrega no encontrada", 404);
  }
  return delivery;
}

// GET /deliveries?opportunityId= — 0 o 1 resultado. Con la forma { data } de
// un listado para que "no hay entrega" sea una lista vacía y no un 404: una
// oportunidad ganada sin unidad, o todavía abierta, no tiene entrega y eso es
// normal. 404 solo si la oportunidad no existe o está eliminada.
export async function listDeliveriesByOpportunity(organizationId: string, opportunityId: string) {
  const opportunity = await findOpportunityById(opportunityId, organizationId);
  if (!opportunity) {
    throw new AppError("Oportunidad no encontrada", 404);
  }
  const delivery = await findDeliveryByOpportunity(organizationId, opportunityId);
  return { data: delivery ? [delivery] : [] };
}

export function getDeliveryById(organizationId: string, id: string) {
  return requireReachableDelivery(organizationId, id);
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

export interface UpdateDeliveryInput {
  checklist?: DeliveryChecklistItem[];
  scheduledAt?: Date | null;
}

// Pre-check + escritura condicionada, mismo patrón que updateQuoteContent: si
// alguien confirmó la entrega entre la lectura y el UPDATE, count 0 y no se
// pisa. No toma el lock de organización: no toca la unidad, y el CAS sobre
// status = PENDING alcanza para no escribir sobre una DELIVERED (en READ
// COMMITTED el UPDATE espera la fila que "Confirmar entrega" tiene tomada y
// reevalúa el WHERE contra la versión comiteada).
export async function updateDelivery(
  organizationId: string,
  id: string,
  input: UpdateDeliveryInput,
) {
  const delivery = await requireReachableDelivery(organizationId, id);
  assertEditable(delivery);

  const { checklist, ...rest } = input;
  const data: UpdatePendingDeliveryData = {
    ...rest,
    ...(checklist !== undefined ? { checklist: normalizeChecklist(checklist) } : {}),
  };

  const result = await updatePendingDelivery(id, organizationId, data);
  if (result.count === 0) {
    await requireDelivery(organizationId, id);
    throw new AppError(ENTREGA_CONFIRMADA_INMUTABLE, 409);
  }

  return requireDelivery(organizationId, id);
}

// "Confirmar entrega". deliveredById nunca viene del input: lo pasa el
// controller desde req.auth, mismo criterio que createdById en Quote.
//
// TODO en una transacción bajo lockOrganizationForUpdate, y no es opcional:
// es el lock que exige setVehicleStatusForOpportunityLink y el que serializa
// todas las escrituras de Vehicle.status. Con él, "Confirmar entrega" y una
// reversión concurrente de la oportunidad (updateOpportunity, que toma el
// mismo lock antes de mover la unidad) no se pisan: o la reversión comitea
// antes y acá la unidad ya no está SOLD (409), o la confirmación comitea
// antes. Sin el lock, la lectura de la unidad vería SOLD, y el UPDATE de
// setVehicleStatusForOpportunityLink —que no está condicionado al estado—
// pisaría el RESERVED/AVAILABLE recién escrito con DELIVERED.
//
// El CAS sobre la entrega (confirmDeliveryConditional) cubre la otra carrera,
// dos "Confirmar entrega" a la vez; con el lock ya se serializan igual, así
// que el count === 0 queda como la defensa de la fila, no como el camino
// esperado.
export async function confirmDelivery(organizationId: string, actorUserId: string, id: string) {
  await requireReachableDelivery(organizationId, id);

  await prisma.$transaction(async (tx) => {
    await lockOrganizationForUpdate(organizationId, tx);

    // Releída bajo el lock: la oportunidad pudo eliminarse (deleteOpportunity
    // toma el mismo lock) o la entrega confirmarse mientras tanto.
    const delivery = await requireReachableDelivery(organizationId, id, tx);
    const vehicle = delivery.vehicleId
      ? await findVehicleById(delivery.vehicleId, organizationId, tx)
      : null;
    assertConfirmable(delivery, vehicle);

    const result = await confirmDeliveryConditional(
      id,
      organizationId,
      { deliveredById: actorUserId, deliveredAt: new Date() },
      tx,
    );
    if (result.count === 0) {
      throw new AppError(ENTREGA_YA_CONFIRMADA, 409);
    }

    // assertConfirmable ya garantizó vehicleId no nulo y la unidad SOLD.
    await setVehicleStatusForOpportunityLink(
      organizationId,
      actorUserId,
      delivery.vehicleId as string,
      "DELIVERED",
      tx,
    );
  });

  return requireDelivery(organizationId, id);
}
