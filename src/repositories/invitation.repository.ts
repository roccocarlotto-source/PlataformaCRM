import type { InvitationStatus, Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

export interface InvitationFilters {
  status?: InvitationStatus;
}

export type InvitationSortBy = "createdAt" | "expiresAt";
export type SortOrder = "asc" | "desc";

function buildWhere(
  organizationId: string,
  filters: InvitationFilters,
): Prisma.InvitationWhereInput {
  return {
    organizationId,
    ...(filters.status ? { status: filters.status } : {}),
  };
}

function buildOrderBy(
  sortBy: InvitationSortBy,
  sortOrder: SortOrder,
): Prisma.InvitationOrderByWithRelationInput {
  switch (sortBy) {
    case "expiresAt":
      return { expiresAt: sortOrder };
    case "createdAt":
    default:
      return { createdAt: sortOrder };
  }
}

export function findManyInvitations(
  organizationId: string,
  filters: InvitationFilters,
  pagination: { skip: number; take: number },
  sort: { sortBy: InvitationSortBy; sortOrder: SortOrder },
  db: Db = prisma,
) {
  return db.invitation.findMany({
    where: buildWhere(organizationId, filters),
    orderBy: buildOrderBy(sort.sortBy, sort.sortOrder),
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countInvitations(
  organizationId: string,
  filters: InvitationFilters,
  db: Db = prisma,
) {
  return db.invitation.count({ where: buildWhere(organizationId, filters) });
}

// Scoped por organización — para revocar / listar detalle, siempre en
// contexto de un ADMIN autenticado.
export function findInvitationById(
  id: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.invitation.findFirst({ where: { id, organizationId } });
}

// Sin scope de organización — usadas únicamente por el flujo de aceptación,
// donde todavía no sabemos a qué organización pertenece quien acepta (no
// tiene fila en public.users todavía). Ver invitation.service.ts.
export function findInvitationByIdUnscoped(id: string, db: Db = prisma) {
  return db.invitation.findUnique({ where: { id } });
}

export function findPendingInvitationsByEmail(email: string, db: Db = prisma) {
  return db.invitation.findMany({ where: { email, status: "PENDING" } });
}

export function findPendingInvitationByOrgAndEmail(
  organizationId: string,
  email: string,
  db: Db = prisma,
) {
  return db.invitation.findFirst({
    where: { organizationId, email, status: "PENDING" },
  });
}

export interface CreateInvitationData {
  organizationId: string;
  email: string;
  roleId: string;
  invitedById: string;
  expiresAt: Date;
}

export function createInvitation(data: CreateInvitationData, db: Db = prisma) {
  return db.invitation.create({ data });
}

// Compare-and-swap: la transición solo se aplica si status sigue siendo
// PENDING en el momento exacto de la escritura — Postgres serializa los
// UPDATE concurrentes sobre la misma fila, así que a lo sumo una de dos
// transiciones concurrentes (revoke vs revoke, accept vs accept, o accept
// vs revoke) puede afectar la fila. `count === 0` significa que otra
// transición ya ganó la carrera; el caller SIEMPRE debe verificar count,
// nunca asumir éxito por la ausencia de excepción. No usar `update` acá:
// `update` no admite una condición adicional en el `where` más allá de la
// clave única, por eso hace falta `updateMany` pese a afectar una sola fila.
export function revokeInvitationConditional(id: string, db: Db = prisma) {
  return db.invitation.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "REVOKED" },
  });
}

export function acceptInvitationRowConditional(id: string, db: Db = prisma) {
  return db.invitation.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "ACCEPTED", acceptedAt: new Date() },
  });
}

// Compensación deliberada de createInvitation cuando falla la llamada a
// Supabase: hard delete, no una transición de estado — esta fila nunca
// llegó a existir funcionalmente (ver invitation.service.ts). No usar para
// ningún otro caso: revocar/expirar son siempre transiciones de status.
export function hardDeleteInvitation(id: string, db: Db = prisma) {
  return db.invitation.delete({ where: { id } });
}

// Transición perezosa PENDING -> EXPIRED, centralizada acá para no
// duplicarla entre services. Se llama ANTES de cualquier operación cuyo
// resultado dependa del estado real de una invitación (crear, listar,
// aceptar, revocar) — así el índice único parcial
// (organization_id, email) WHERE status = 'PENDING' nunca queda bloqueado
// eternamente por una invitación vieja que nadie marcó como vencida.
export function expireDueInvitations(
  where: Prisma.InvitationWhereInput,
  db: Db = prisma,
) {
  return db.invitation.updateMany({
    where: { ...where, status: "PENDING", expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" },
  });
}
