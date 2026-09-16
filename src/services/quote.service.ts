import type { QuoteStatus } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import {
  findOpportunityById,
  lockOpportunityForUpdate,
} from "../repositories/opportunity.repository";
import { findOrganizationById } from "../repositories/organization.repository";
import {
  countQuotesByOpportunity,
  createQuote as createQuoteRepo,
  expireDueQuotes,
  findActiveQuote,
  findQuoteById,
  findQuotesByOpportunity,
  supersedeOpenQuotes,
  transitionQuoteConditional,
  updateDraftQuoteContent,
  type QuoteLineData,
  type UpdateQuoteContentData,
} from "../repositories/quote.repository";
import { AppError } from "../utils/AppError";
import { esZonaHorariaValida } from "../utils/timezone";

// ---------------------------------------------------------------------------
// Cotización (§39 de docs/frontend-cambios-pendientes.md).
//
// Cada oportunidad tiene, en un momento dado, a lo sumo UNA cotización activa:
// la más reciente que no está SUPERSEDED. Las reglas:
//
//   - Crear con la activa en DRAFT o SENT: la anterior pasa a SUPERSEDED en
//     la misma transacción (el vendedor "le baja el precio").
//   - Crear con la activa en ACCEPTED: 409. La aceptada es con la que se
//     cierra la venta; volver a cotizar sobre ella es una decisión de negocio
//     que este ítem no cubre.
//   - Crear con la activa en REJECTED o EXPIRED, o sin ninguna: siempre.
//   - Estado: DRAFT -> SENT -> ACCEPTED | REJECTED, solo hacia adelante y
//     como compare-and-swap (transitionQuoteConditional), mismo criterio que
//     Invitation. SENT -> EXPIRED es perezosa (expireDueQuotes).
//   - Contenido (monto, moneda, líneas, validez): editable solo en DRAFT.
//     Corregir el precio de una ya enviada es crear una nueva, así el
//     historial es honesto: lo que se le mostró al cliente no cambia.
//
// Sin efectos sobre la oportunidad: aceptar o rechazar no la mueve de etapa
// ni la marca ganada/perdida. Eso lo decide el vendedor.
//
// Las piezas de decisión son funciones puras exportadas (todayInTimeZone,
// assertCanCreateOver, transitionSourceStatus, assertSendable,
// transitionConflictError, normalizeLines) y se prueban sin base en
// quote.service.test.ts, mismo criterio que activity.service.ts. La
// aplicación real con filas, carreras y aislamiento está en
// quote.service.integration-test.ts.
// ---------------------------------------------------------------------------

// Las transiciones que un PATCH puede pedir. EXPIRED y SUPERSEDED no están: a
// esas no se llega a mano.
export type QuoteTransitionTarget = "SENT" | "ACCEPTED" | "REJECTED";

// Desde qué estado es válida cada transición. Uno solo por destino: aceptar o
// rechazar exige que la cotización se haya enviado (una DRAFT no se le mostró
// a nadie, no hay nada que el cliente pueda aceptar).
const TRANSITION_SOURCE: Record<QuoteTransitionTarget, QuoteStatus> = {
  SENT: "DRAFT",
  ACCEPTED: "SENT",
  REJECTED: "SENT",
};

export function transitionSourceStatus(target: QuoteTransitionTarget): QuoteStatus {
  return TRANSITION_SOURCE[target];
}

// ---------------------------------------------------------------------------
// "Hoy" para el vencimiento. valid_until es una fecha (DATE) —"válida hasta
// el 30"—, así que "venció" se decide contra la fecha de HOY en la zona de la
// organización, no contra un instante UTC. Devuelve esa fecha a medianoche
// UTC, que es como Prisma representa una columna DATE y lo que se compara en
// expireDueQuotes.
//
// Organization.timezone tiene default "UTC" y hoy ningún flujo lo cambia, así
// que en la práctica el día termina a la medianoche UTC. Una zona inválida
// (dato a mano) cae a UTC en vez de tirar: el vencimiento no es motivo para
// que la ficha de una oportunidad dé 500.
// ---------------------------------------------------------------------------
export function todayInTimeZone(now: Date, timeZone: string): Date {
  const zone = esZonaHorariaValida(timeZone) ? timeZone : "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00.000Z`);
}

async function todayForOrganization(organizationId: string, db: Db = prisma): Promise<Date> {
  const organization = await findOrganizationById(organizationId, db);
  return todayInTimeZone(new Date(), organization?.timezone ?? "UTC");
}

// Crear sobre una activa ACCEPTED está bloqueado (ver la cabecera). 409 y no
// 400: no es un dato inválido, es un conflicto con el estado que la base
// tiene ahora — mismo criterio que UNIDAD_NO_DISPONIBLE
// (opportunity.service.ts) y que los conflictos de Invitation.
export const COTIZACION_ACEPTADA_BLOQUEA =
  "La oportunidad ya tiene una cotización aceptada: no se puede crear una nueva";

export function assertCanCreateOver(active: { status: QuoteStatus } | null): void {
  if (active?.status === "ACCEPTED") {
    throw new AppError(COTIZACION_ACEPTADA_BLOQUEA, 409);
  }
}

// Enviar una cotización cuya validez ya pasó la dejaría vencida en la próxima
// lectura: se frena antes, con un mensaje que dice qué corregir. Solo aplica
// a SENT — aceptar/rechazar parten de una SENT que expireDueQuotes ya habría
// vencido.
export function assertSendable(quote: { validUntil: Date | null }, today: Date): void {
  if (quote.validUntil !== null && quote.validUntil < today) {
    throw new AppError(
      "La fecha de validez de la cotización ya pasó: corregila antes de enviarla",
      409,
    );
  }
}

// El error de una transición pedida desde un estado que no corresponde.
// Compartido entre el pre-check y la traducción post-CAS, como
// revokeConflictError en invitation.service.ts: misma semántica en los dos
// casos. Todos 409 — la cotización existe y es legible, lo que choca es su
// estado.
export function transitionConflictError(
  target: QuoteTransitionTarget,
  current: QuoteStatus,
): AppError {
  switch (current) {
    case "SUPERSEDED":
      return new AppError("Esta cotización fue reemplazada por una más nueva", 409);
    case "EXPIRED":
      return new AppError("Esta cotización venció", 409);
    case "ACCEPTED":
      return new AppError("Esta cotización ya fue aceptada", 409);
    case "REJECTED":
      return new AppError("Esta cotización ya fue rechazada", 409);
    case "SENT":
      // El único destino que no parte de SENT es SENT mismo.
      return new AppError("Esta cotización ya fue enviada", 409);
    case "DRAFT":
      return new AppError(
        target === "SENT"
          ? "Esta cotización no se puede enviar"
          : "Una cotización en borrador tiene que enviarse antes de marcarse aceptada o rechazada",
        409,
      );
    default:
      return new AppError("La cotización ya no admite ese cambio de estado", 409);
  }
}

export const SOLO_BORRADOR_EDITABLE =
  "Solo se puede editar una cotización en borrador: para cambiar una ya enviada, creá una nueva";

export interface QuoteLineInput {
  description: string;
  amount: number;
}

// Las líneas se guardan con su importe como string de dos decimales, la
// forma en que la API serializa un Decimal (ver schema.prisma). toFixed(2)
// redondea igual que Decimal(14, 2) redondearía el monto principal.
// description ya viene recortada por zod; se vuelve a recortar para que la
// función no dependa de eso.
export function normalizeLines(lines: readonly QuoteLineInput[]): QuoteLineData[] {
  return lines.map((line) => ({
    description: line.description.trim(),
    amount: line.amount.toFixed(2),
  }));
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

// 404 si la oportunidad no existe, es de otra organización o está eliminada.
// Las cotizaciones son un sub-recurso de la oportunidad: sin ella no hay
// historial que mostrar.
async function requireOpportunity(organizationId: string, opportunityId: string, db: Db = prisma) {
  const opportunity = await findOpportunityById(opportunityId, organizationId, db);
  if (!opportunity) {
    throw new AppError("Oportunidad no encontrada", 404);
  }
  return opportunity;
}

async function requireQuote(organizationId: string, id: string, db: Db = prisma) {
  const quote = await findQuoteById(id, organizationId, db);
  if (!quote) {
    throw new AppError("Cotización no encontrada", 404);
  }
  return quote;
}

// Una cotización de una oportunidad eliminada deja de ser alcanzable por id,
// igual que no aparece en ningún historial (listQuotesByOpportunity exige la
// oportunidad viva): el mismo 404 que un id inexistente.
async function requireReachableQuote(organizationId: string, id: string) {
  const quote = await requireQuote(organizationId, id);
  const opportunity = await findOpportunityById(quote.opportunityId, organizationId);
  if (!opportunity) {
    throw new AppError("Cotización no encontrada", 404);
  }
  return quote;
}

export function getActiveQuote(organizationId: string, opportunityId: string, db: Db = prisma) {
  return findActiveQuote(organizationId, opportunityId, db);
}

export interface ListQuotesParams {
  opportunityId: string;
  page: number;
  pageSize: number;
}

// El historial completo de una oportunidad (más nueva primero) y cuál de
// esas es la activa. activeQuoteId sale de la misma regla que usa
// createQuote, así el frontend no la reimplementa.
export async function listQuotesByOpportunity(organizationId: string, params: ListQuotesParams) {
  const { opportunityId, page, pageSize } = params;
  await requireOpportunity(organizationId, opportunityId);

  const today = await todayForOrganization(organizationId);
  await expireDueQuotes({ organizationId, opportunityId }, today);

  const skip = (page - 1) * pageSize;
  const [data, total, active] = await Promise.all([
    findQuotesByOpportunity(organizationId, opportunityId, { skip, take: pageSize }),
    countQuotesByOpportunity(organizationId, opportunityId),
    getActiveQuote(organizationId, opportunityId),
  ]);

  return {
    data,
    activeQuoteId: active?.id ?? null,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

export async function getQuoteById(organizationId: string, id: string) {
  const today = await todayForOrganization(organizationId);
  await expireDueQuotes({ organizationId, id }, today);
  return requireReachableQuote(organizationId, id);
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

export interface CreateQuoteInput {
  opportunityId: string;
  amount: number;
  currency: string;
  lines: QuoteLineInput[];
  validUntil?: Date | null;
}

// createdById nunca viene del input: lo pasa el controller desde req.auth,
// mismo criterio que authorId en createActivity.
//
// TODO en una transacción bajo lockOpportunityForUpdate. Sin el lock, dos
// "Nueva cotización" simultáneas sobre la misma oportunidad leerían la misma
// activa, la superarían las dos y dejarían DOS cotizaciones nuevas no
// superadas — dos activas. Con el lock, la segunda espera, ve la primera como
// activa y la supera.
//
// updateQuoteStatus toma EL MISMO lock, y no es redundante con su CAS: el CAS
// protege la fila de la cotización, pero la regla "no se crea sobre una
// ACCEPTED" se decide leyendo la activa. Sin el lock en los dos lados, un
// "Marcar aceptada" que comitea entre esa lectura y supersedeOpenQuotes
// (que ya no la toca: filtra DRAFT/SENT) dejaría una cotización nueva encima
// de una aceptada. Con el lock, o el ACCEPTED comitea antes y la lectura lo
// ve (409), o la creación comitea antes y el CAS encuentra SUPERSEDED (409).
export async function createQuote(
  organizationId: string,
  actorUserId: string,
  input: CreateQuoteInput,
) {
  return prisma.$transaction(async (tx) => {
    const locked = await lockOpportunityForUpdate(input.opportunityId, organizationId, tx);
    if (!locked) {
      throw new AppError(
        "El opportunityId indicado no existe, no pertenece a tu organización, o está eliminada",
        400,
      );
    }

    const today = await todayForOrganization(organizationId, tx);
    await expireDueQuotes({ organizationId, opportunityId: input.opportunityId }, today, tx);

    const active = await findActiveQuote(organizationId, input.opportunityId, tx);
    assertCanCreateOver(active);

    // Releída bajo el lock: vehicleId es una FOTO del vínculo en el momento
    // de cotizar (ver schema.prisma).
    const opportunity = await requireOpportunity(organizationId, input.opportunityId, tx);

    await supersedeOpenQuotes(organizationId, input.opportunityId, tx);

    return createQuoteRepo(
      {
        organizationId,
        opportunityId: input.opportunityId,
        vehicleId: opportunity.vehicleId,
        createdById: actorUserId,
        amount: input.amount,
        currency: input.currency,
        lines: normalizeLines(input.lines),
        validUntil: input.validUntil ?? null,
      },
      tx,
    );
  });
}

// Cambio de estado. El pre-check da el mensaje específico en el caso común;
// la defensa real de la fila es el CAS, y count === 0 es la única fuente de
// verdad sobre si la transición ocurrió. El re-read posterior solo explica
// por qué no. Bajo lockOpportunityForUpdate, por la carrera contra
// createQuote que explica su comentario.
export async function updateQuoteStatus(
  organizationId: string,
  id: string,
  target: QuoteTransitionTarget,
) {
  const initial = await requireReachableQuote(organizationId, id);

  await prisma.$transaction(async (tx) => {
    const locked = await lockOpportunityForUpdate(initial.opportunityId, organizationId, tx);
    if (!locked) {
      // La oportunidad se eliminó: sus cotizaciones dejan de ser alcanzables.
      throw new AppError("Cotización no encontrada", 404);
    }

    const today = await todayForOrganization(organizationId, tx);
    await expireDueQuotes({ organizationId, id }, today, tx);

    const quote = await requireQuote(organizationId, id, tx);
    const source = transitionSourceStatus(target);
    if (quote.status !== source) {
      throw transitionConflictError(target, quote.status);
    }
    if (target === "SENT") {
      assertSendable(quote, today);
    }

    const result = await transitionQuoteConditional(id, organizationId, source, target, tx);
    if (result.count === 0) {
      const current = await requireQuote(organizationId, id, tx);
      throw transitionConflictError(target, current.status);
    }
  });

  return requireQuote(organizationId, id);
}

export interface UpdateQuoteContentInput {
  amount?: number;
  currency?: string;
  lines?: QuoteLineInput[];
  validUntil?: Date | null;
}

// Edición del contenido de una DRAFT. Mismo patrón pre-check + escritura
// condicionada: si alguien la envió entre la lectura y el UPDATE, count 0 y
// no se pisa.
export async function updateQuoteContent(
  organizationId: string,
  id: string,
  input: UpdateQuoteContentInput,
) {
  const quote = await requireReachableQuote(organizationId, id);
  if (quote.status !== "DRAFT") {
    throw new AppError(SOLO_BORRADOR_EDITABLE, 409);
  }

  const { lines, ...rest } = input;
  const data: UpdateQuoteContentData = {
    ...rest,
    ...(lines !== undefined ? { lines: normalizeLines(lines) } : {}),
  };

  const result = await updateDraftQuoteContent(id, organizationId, data);
  if (result.count === 0) {
    await requireQuote(organizationId, id);
    throw new AppError(SOLO_BORRADOR_EDITABLE, 409);
  }

  return requireQuote(organizationId, id);
}
