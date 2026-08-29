import { OutboxStatus, Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Motor de eventos salientes — acceso a datos.
//
// Calca ingestionEvent.repository.ts a propósito: mismo reclamo con
// FOR UPDATE SKIP LOCKED, mismas transiciones como compare-and-swap con
// organizationId en el WHERE, misma forma de purga. Lo que cambia es la
// dirección del dato (esto sale, aquello entra) y que acá hay reintentos.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// EMISIÓN — el punto entero del patrón outbox
// ---------------------------------------------------------------------------
//
// `tx` NO ES OPCIONAL Y NO TIENE DEFAULT, a diferencia de casi todo el resto de
// este repositorio. Es la única función del proyecto donde eso es una regla de
// diseño y no una comodidad: el evento tiene que escribirse DENTRO de la misma
// transacción que el cambio de negocio que lo origina. O se guardan los dos, o
// no se guarda ninguno.
//
// Sin eso, un proceso que muere entre el commit del negocio y el envío del
// aviso pierde el aviso para siempre, y —peor— no queda ningún rastro de que
// faltó. Una función que abriera su propia transacción no serviría para esto:
// sería exactamente el bug que el patrón viene a evitar.
//
// LÍMITE CONOCIDO DEL TIPO: `Prisma.TransactionClient` se elige por intención,
// pero TypeScript NO puede impedir que alguien pase el `prisma` global — es un
// tipo estructural y PrismaClient tiene todos sus miembros, así que es
// asignable. El tipo documenta; lo que garantiza es la revisión.
export interface EmitOutboxEventInput {
  organizationId: string;
  eventType: string;
  payload: Prisma.InputJsonValue;
}

export function emitOutboxEvent(input: EmitOutboxEventInput, tx: Prisma.TransactionClient) {
  return tx.outboxEvent.create({
    data: {
      organizationId: input.organizationId,
      eventType: input.eventType,
      payload: input.payload,
      // status PENDING y nextAttemptAt NULL por default: reclamable de
      // inmediato, sin que el emisor tenga que saber nada del worker.
    },
  });
}

// ---------------------------------------------------------------------------
// RECLAMO
// ---------------------------------------------------------------------------

export interface EventoReclamado {
  id: string;
  organizationId: string;
  eventType: string;
  payload: unknown;
  attempts: number;
}

interface FilaReclamada {
  id: string;
  organization_id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
}

// Reclama UN evento entregable y lo deja bloqueado hasta el fin de la
// transacción. Devuelve null si no queda ninguno.
//
// FOR UPDATE SKIP LOCKED, igual que claimNextPendingEvent y por el mismo
// motivo: evita tener que inventar un estado PROCESSING —una migración, un
// valor más que todo consumidor tiene que entender, y filas colgadas para
// siempre cuando un worker muere— porque si el proceso se cae la transacción se
// aborta y la fila vuelve a estar disponible sola. SKIP LOCKED hace que dos
// workers nunca se peleen por la misma fila.
//
// LA CONDICIÓN DE ENTREGABLE se escribe con coalesce y no con
// `next_attempt_at IS NULL OR next_attempt_at <= now()`. Las dos son
// equivalentes —el created_at de una fila que existe siempre es <= now()— pero
// solo la primera la puede servir un índice de rango
// (outbox_events_claimable_idx). Y la diferencia importa justo cuando importa:
// durante una caída del destino externo hay miles de PENDING con su próximo
// intento en el futuro y unos pocos vencidos; con el OR, encontrar esos pocos
// cuesta recorrer todos los otros.
//
// `now()` dentro de la consulta es el instante de inicio de la transacción, no
// el de la fila: dos reclamos de la misma transacción ven el mismo corte, que
// es lo que se quiere.
//
// `excluir` y `organizationId` cumplen exactamente el mismo rol que en la cola
// de ingesta: el primero evita que una pasada se quede girando sobre la fila
// que acaba de fallar por un error de sistema; el segundo permite que un test
// drene de forma determinística sin depender de que el resto de la tabla esté
// vacía.
export async function claimNextClaimableEvent(
  db: Db,
  opciones: { organizationId?: string; excluir?: string[] } = {},
): Promise<EventoReclamado | null> {
  const filtroOrg = opciones.organizationId
    ? Prisma.sql`AND e.organization_id = ${opciones.organizationId}::uuid`
    : Prisma.empty;

  const filtroExcluidos =
    opciones.excluir && opciones.excluir.length > 0
      ? Prisma.sql`AND e.id <> ALL(${opciones.excluir}::uuid[])`
      : Prisma.empty;

  const filas = await db.$queryRaw<FilaReclamada[]>`
    SELECT e.id, e.organization_id, e.event_type, e.payload, e.attempts
    FROM outbox_events e
    WHERE e.status = 'PENDING'::"OutboxStatus"
      AND coalesce(e.next_attempt_at, e.created_at) <= now()
    ${filtroOrg}
    ${filtroExcluidos}
    ORDER BY coalesce(e.next_attempt_at, e.created_at)
    FOR UPDATE OF e SKIP LOCKED
    LIMIT 1
  `;

  if (filas.length === 0) {
    return null;
  }

  const fila = filas[0];
  return {
    id: fila.id,
    organizationId: fila.organization_id,
    eventType: fila.event_type,
    payload: fila.payload,
    attempts: fila.attempts,
  };
}

// ---------------------------------------------------------------------------
// TRANSICIONES
//
// organizationId en el WHERE de las tres, por el invariante de M4: la escritura
// misma es la garantía de aislamiento, no el pre-check del caller.
// `status: PENDING` convierte además cada UPDATE en un compare-and-swap —
// redundante mientras el lock del reclamo se sostenga, pero es la clase de
// redundancia que sobrevive a que alguien cambie el mecanismo de reclamo.
// ---------------------------------------------------------------------------

export function markOutboxEventProcessed(id: string, organizationId: string, db: Db = prisma) {
  return db.outboxEvent.updateMany({
    where: { id, organizationId, status: OutboxStatus.PENDING },
    data: {
      status: OutboxStatus.PROCESSED,
      // El error anterior se limpia: un evento entregado no arrastra el
      // diagnóstico de un intento viejo que ya no describe nada.
      lastError: null,
      nextAttemptAt: null,
    },
  });
}

// Un fallo de entrega que TODAVÍA tiene reintentos: sube attempts, guarda el
// error y programa el próximo turno. El evento sigue en PENDING — no hay estado
// intermedio, ver el comentario del enum en schema.prisma.
export function rescheduleOutboxEvent(
  id: string,
  organizationId: string,
  datos: { attempts: number; nextAttemptAt: Date; lastError: string },
  db: Db = prisma,
) {
  return db.outboxEvent.updateMany({
    where: { id, organizationId, status: OutboxStatus.PENDING },
    data: {
      attempts: datos.attempts,
      nextAttemptAt: datos.nextAttemptAt,
      lastError: datos.lastError,
    },
  });
}

// Terminal. Se llega acá por dos caminos distintos y conviene no confundirlos:
// agotar los reintentos (un destino que no responde), o no tener handler para
// el eventType (un bug de configuración, que no gasta ni un reintento porque
// reintentar no hace aparecer un handler). El `lastError` es lo que distingue
// uno del otro cuando alguien mira la fila.
export function markOutboxEventDeadLetter(
  id: string,
  organizationId: string,
  datos: { attempts: number; lastError: string },
  db: Db = prisma,
) {
  return db.outboxEvent.updateMany({
    where: { id, organizationId, status: OutboxStatus.PENDING },
    data: {
      status: OutboxStatus.DEAD_LETTER,
      attempts: datos.attempts,
      lastError: datos.lastError,
      // Deja de tener sentido: nadie va a reclamar esta fila otra vez.
      nextAttemptAt: null,
    },
  });
}

// ---------------------------------------------------------------------------
// PURGA — mismo criterio y misma forma que la de ingestion_events.
// ---------------------------------------------------------------------------

// 90 días, el mismo umbral que DIAS_DE_RETENCION_INGESTION_EVENT. Se mantiene
// igual a propósito: dos retenciones distintas para dos tablas append-only del
// mismo sistema serían dos números que alguien tiene que recordar por separado,
// sin que ninguna característica del dato justifique la diferencia.
export const DIAS_DE_RETENCION_OUTBOX_EVENT = 90;

// DEAD_LETTER se purga junto con PROCESSED, y merece una línea. Es tentador
// conservarlo para siempre "por si alguien lo mira", pero un DEAD_LETTER de
// hace tres meses ya no se puede accionar: el destino cambió, el payload
// describe un estado que no existe. Lo que hay que hacer con un DEAD_LETTER es
// mirarlo dentro de la ventana, no acumularlo.
const ESTADOS_PURGABLES = [OutboxStatus.PROCESSED, OutboxStatus.DEAD_LETTER];

export function fechaDeCorteDeRetencionOutbox(ahora: Date = new Date()): Date {
  const corte = new Date(ahora);
  corte.setUTCDate(corte.getUTCDate() - DIAS_DE_RETENCION_OUTBOX_EVENT);
  return corte;
}

// `organizationId` es OPCIONAL y el script NUNCA lo pasa: la purga real es
// sobre la tabla entera. Existe por el mismo motivo que en la purga de ingesta
// — un test de integración corre contra una base que puede estar compartida, y
// esto no cambia un estado: destruye filas.
export interface PurgaOutboxScope {
  organizationId?: string;
}

function buildPurgaWhere(corte: Date, scope: PurgaOutboxScope): Prisma.OutboxEventWhereInput {
  return {
    createdAt: { lt: corte },
    status: { in: ESTADOS_PURGABLES },
    ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
  };
}

// Cuánto borraría la purga sin borrarlo. Es lo que consume `--dry-run`.
export function countOutboxEventsPurgables(
  corte: Date,
  scope: PurgaOutboxScope = {},
  db: Db = prisma,
) {
  return db.outboxEvent.count({ where: buildPurgaWhere(corte, scope) });
}

// El borrado real. Devuelve cuántas filas murieron: una purga que no dice
// cuánto borró no deja rastro de haberse cumplido.
export function purgeOutboxEvents(corte: Date, scope: PurgaOutboxScope = {}, db: Db = prisma) {
  return db.outboxEvent.deleteMany({ where: buildPurgaWhere(corte, scope) });
}
