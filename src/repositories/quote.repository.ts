import type { Prisma, QuoteStatus } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Cotización (§39 de docs/frontend-cambios-pendientes.md). organizationId en
// el WHERE de TODA lectura y escritura, igual que el resto de las entidades:
// la escritura misma es la garantía de aislamiento (M4), no el pre-check del
// service.
// ---------------------------------------------------------------------------

// Lo que la ficha de la oportunidad muestra junto a la cotización: quién la
// armó y por qué unidad se hizo (la FOTO de vehicleId, ver schema.prisma).
// Solo campos de exhibición — nunca los precios internos del vehículo
// (minAcceptablePriceUsd, acquisitionCostUsd).
export const quoteInclude = {
  createdBy: { select: { id: true, fullName: true } },
  vehicle: {
    select: { id: true, internalCode: true, make: true, model: true, trim: true, year: true },
  },
} satisfies Prisma.QuoteInclude;

// Orden del historial: más nueva primero. `id` desempata dos filas con el
// mismo created_at (milisegundos iguales) para que el orden sea estable
// entre dos lecturas.
const newestFirst: Prisma.QuoteOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "desc" }];

export function findQuotesByOpportunity(
  organizationId: string,
  opportunityId: string,
  pagination: { skip: number; take: number },
  db: Db = prisma,
) {
  return db.quote.findMany({
    where: { organizationId, opportunityId },
    include: quoteInclude,
    orderBy: newestFirst,
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countQuotesByOpportunity(
  organizationId: string,
  opportunityId: string,
  db: Db = prisma,
) {
  return db.quote.count({ where: { organizationId, opportunityId } });
}

// "La activa": la más reciente que NO está SUPERSEDED. Se resuelve por
// consulta y no por una columna (ver el comentario del modelo).
export function findActiveQuote(organizationId: string, opportunityId: string, db: Db = prisma) {
  return db.quote.findFirst({
    where: { organizationId, opportunityId, status: { not: "SUPERSEDED" } },
    include: quoteInclude,
    orderBy: newestFirst,
  });
}

export function findQuoteById(id: string, organizationId: string, db: Db = prisma) {
  return db.quote.findFirst({ where: { id, organizationId }, include: quoteInclude });
}

export interface QuoteLineData {
  description: string;
  // String con dos decimales ("-500.00"), la forma en que la API serializa
  // un Decimal — ver el comentario de `lines` en schema.prisma.
  amount: string;
}

export interface CreateQuoteData {
  organizationId: string;
  opportunityId: string;
  vehicleId: string | null;
  createdById: string;
  amount: number;
  currency: string;
  lines: QuoteLineData[];
  validUntil: Date | null;
}

export function createQuote(data: CreateQuoteData, db: Db = prisma) {
  return db.quote.create({
    data: { ...data, lines: data.lines as unknown as Prisma.InputJsonValue },
    include: quoteInclude,
  });
}

// Superar la anterior al crear una nueva (quote.service.ts, createQuote):
// DRAFT o SENT -> SUPERSEDED para TODAS las de la oportunidad. En la
// práctica es a lo sumo una —la activa—, pero condicionar por estado y no por
// id hace que la escritura no dependa de haber leído bien cuál era.
export function supersedeOpenQuotes(organizationId: string, opportunityId: string, db: Db) {
  return db.quote.updateMany({
    where: { organizationId, opportunityId, status: { in: ["DRAFT", "SENT"] } },
    data: { status: "SUPERSEDED" },
  });
}

// Compare-and-swap, mismo contrato que revokeInvitationConditional
// (invitation.repository.ts): la transición solo se aplica si el status
// sigue siendo `from` en el momento exacto del UPDATE. `count === 0`
// significa que otra escritura ganó la carrera; el caller SIEMPRE verifica
// count. updateMany y no update: `update` no admite la condición extra.
export function transitionQuoteConditional(
  id: string,
  organizationId: string,
  from: QuoteStatus,
  to: QuoteStatus,
  db: Db = prisma,
) {
  return db.quote.updateMany({
    where: { id, organizationId, status: from },
    data: { status: to },
  });
}

export interface UpdateQuoteContentData {
  amount?: number;
  currency?: string;
  lines?: QuoteLineData[];
  validUntil?: Date | null;
}

// Editar el contenido: solo mientras sigue en DRAFT, condicionado en la
// escritura misma. Una cotización que alguien mandó entre el pre-check y
// este UPDATE da count 0 y no se pisa — lo que se le mostró al cliente no
// cambia por atrás.
export function updateDraftQuoteContent(
  id: string,
  organizationId: string,
  data: UpdateQuoteContentData,
  db: Db = prisma,
) {
  const { lines, ...rest } = data;
  return db.quote.updateMany({
    where: { id, organizationId, status: "DRAFT" },
    data: {
      ...rest,
      ...(lines !== undefined ? { lines: lines as unknown as Prisma.InputJsonValue } : {}),
    },
  });
}

// Transición perezosa SENT -> EXPIRED, mismo criterio que
// expireDueInvitations: no hay job, se llama antes de cada operación cuyo
// resultado depende del estado real. `today` es la fecha de HOY en la zona
// de la organización a medianoche UTC (quote.service.ts, todayInTimeZone),
// comparable con la columna DATE: valid_until < hoy = ya venció (el día de
// valid_until todavía vale entero). Solo SENT: una DRAFT no se le mostró a
// nadie, así que no hay oferta que venza — se corrige la fecha y listo.
export function expireDueQuotes(
  where: { organizationId: string; opportunityId?: string; id?: string },
  today: Date,
  db: Db = prisma,
) {
  return db.quote.updateMany({
    where: { ...where, status: "SENT", validUntil: { lt: today } },
    data: { status: "EXPIRED" },
  });
}
