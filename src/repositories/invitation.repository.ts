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
export function findInvitationById(id: string, organizationId: string, db: Db = prisma) {
  return db.invitation.findFirst({ where: { id, organizationId } });
}

// Sin scope de organización — usadas únicamente por el flujo de aceptación,
// donde todavía no sabemos a qué organización pertenece quien acepta (no
// tiene fila en public.users todavía). Ver invitation.service.ts.
export function findInvitationByIdUnscoped(id: string, db: Db = prisma) {
  return db.invitation.findUnique({ where: { id } });
}

// Todas las invitaciones de un email, sin filtrar por status, ordenadas
// createdAt DESC de forma explícita (nunca depende del orden implícito de
// Postgres) — usada por el camino sin invitationId de acceptInvitation
// para poder reportar el estado real de la más reciente cuando ninguna
// está PENDING, en vez de tratarlas como si nunca hubieran existido.
export function findInvitationsByEmail(email: string, db: Db = prisma) {
  return db.invitation.findMany({
    where: { email },
    orderBy: { createdAt: "desc" },
  });
}

// La invitación PENDIENTE de un email, en CUALQUIER organización — a
// diferencia de findPendingInvitationByOrgAndEmail, que responde la pregunta
// acotada a una. La usa el onboarding (ALTO-2): un email con invitación
// pendiente ya está hablado, y registrarle una organización propia lo dejaría
// sin poder aceptarla nunca (un User pertenece a exactamente una organización).
//
// No filtra por expiresAt: la transición a EXPIRED es perezosa en este modelo
// (ver el enum InvitationStatus en schema.prisma) y agregarle acá un criterio
// de tiempo propio sería una segunda definición de "vencida" conviviendo con
// expireDueInvitations.
export function findPendingInvitationByEmail(email: string, db: Db = prisma) {
  return db.invitation.findFirst({
    where: { email, status: "PENDING" },
  });
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
// organizationId en el WHERE (M4): a diferencia de acceptInvitationRowConditional
// (que corre antes de que exista ningún organizationId legítimo fuera de la
// propia fila), acá el actor es un ADMIN autenticado con organizationId real
// en req.auth — la escritura debe exigirlo igual que el resto de las
// entidades, no solo confiar en el pre-check de revokeInvitation.
export function revokeInvitationConditional(id: string, organizationId: string, db: Db = prisma) {
  return db.invitation.updateMany({
    where: { id, organizationId, status: "PENDING" },
    data: { status: "REVOKED" },
  });
}

// expiresAt > now() en el propio WHERE (B-18 de docs/auditoria-2026-08-29.md):
// el CAS es ahora también la defensa real contra la carrera de VENCIMIENTO,
// no solo contra accept-vs-accept / accept-vs-revoke. Sin esto, una fila que
// cruzaba expiresAt entre el pre-check del service (Date.now() de JS) y esta
// escritura seguía en PENDING —nadie había corrido expireDueInvitations sobre
// ella todavía— y el CAS la aceptaba igual. La ventana es de milisegundos,
// pero es exactamente lo que "la escritura misma es la garantía, no el
// pre-check" viene a cerrar. Cuando el CAS falla por este motivo, el caller
// (acceptInvitation) distingue el caso PENDING-pero-vencida y responde el 410
// de vencimiento, expirando la fila de paso.
// SQL crudo con clock_timestamp() y no updateMany con new Date(), y la
// diferencia es el punto entero de B-18: un Date de JS se evalúa AL LLAMAR la
// función, así que un CAS que queda bloqueado esperando el lock de otra
// transacción compararía expires_at contra un reloj viejo y aceptaría una
// fila ya vencida al liberarse — se comprobó empíricamente al escribir el
// test. clock_timestamp() se evalúa en el momento de la EJECUCIÓN del UPDATE
// (a diferencia de now(), que es el inicio de transacción), así que la
// escritura misma decide con el reloj real, sin ninguna ventana.
//
// LÍMITE CONOCIDO, verificado empíricamente al escribir el test: NINGUNA
// guarda en el WHERE cubre al caso en que este UPDATE queda bloqueado detrás
// de una transacción que NO modifica la fila (un SELECT FOR UPDATE pelado):
// Postgres evalúa el qual ANTES de bloquear, y sin una versión nueva de la
// fila no hay re-evaluación al liberarse — el UPDATE aplica con la decisión
// vieja. Ese caso no existe en producción: los únicos que compiten por esta
// fila (accept, revoke, expire) SÍ la modifican, y una fila modificada
// dispara la re-evaluación (EvalPlanQual) sobre la versión nueva, donde
// clock_timestamp() —volátil— vuelve a ejecutarse fresco. Es exactamente lo
// que el test determinístico de B-18 fuerza con un "touch".
export async function acceptInvitationRowConditional(
  id: string,
  db: Db = prisma,
): Promise<{ count: number }> {
  const count = await db.$executeRaw`
    UPDATE invitations
    SET status = 'ACCEPTED'::"InvitationStatus", accepted_at = now(), updated_at = now()
    WHERE id = ${id}::uuid
      AND status = 'PENDING'::"InvitationStatus"
      AND expires_at > clock_timestamp()
  `;
  return { count };
}

// Compensación deliberada de createInvitation cuando falla la llamada a
// Supabase: hard delete, no una transición de estado — esta fila nunca
// llegó a existir funcionalmente (ver invitation.service.ts). No usar para
// ningún otro caso: revocar/expirar son siempre transiciones de status.
//
// organizationId en el WHERE (B-12/B-13 de docs/auditoria-2026-08-29.md), con
// el alcance honesto: el único caller borra la fila que él mismo acaba de
// insertar en el mismo request, así que hoy no existe ningún camino real por
// el que llegue un id ajeno — es consistencia con el resto de las escrituras
// del proyecto y defensa en profundidad, no la corrección de una fuga.
//
// deleteMany + count !== 1 -> throw, y no delete(): delete() lanzaba P2025 si
// la fila no existía y ESE lanzamiento es lo que el catch del caller loguea
// como "requiere limpieza manual"; deleteMany devuelve { count: 0 } en
// silencio, así que sin este chequeo la compensación fallida dejaría de ser
// ruidosa. Mismo patrón que reindexStages/shiftUpFrom/shiftDownAfter (B-12).
export async function hardDeleteInvitation(id: string, organizationId: string, db: Db = prisma) {
  const result = await db.invitation.deleteMany({ where: { id, organizationId } });
  if (result.count !== 1) {
    throw new Error(
      `hardDeleteInvitation: la invitación ${id} no existe en la organización ${organizationId}`,
    );
  }
  return result;
}

// Transición perezosa PENDING -> EXPIRED, centralizada acá para no
// duplicarla entre services. Se llama ANTES de cualquier operación cuyo
// resultado dependa del estado real de una invitación (crear, listar,
// aceptar, revocar) — así el índice único parcial
// (organization_id, email) WHERE status = 'PENDING' nunca queda bloqueado
// eternamente por una invitación vieja que nadie marcó como vencida.
export function expireDueInvitations(where: Prisma.InvitationWhereInput, db: Db = prisma) {
  return db.invitation.updateMany({
    where: { ...where, status: "PENDING", expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" },
  });
}
