import { IngestionStatus, Prisma } from "@prisma/client";
import type { PromotionNote } from "../types/promotion";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Staging de la ingesta (docs/ingestion-architecture.md §1 y §5): una fila por
// intento, con el payload crudo intacto y status PENDING. Nada de promoción
// sincrónica — eso es el worker del ítem 4c.
//
// ESTE ARCHIVO USA SQL CRUDO Y NO ES UNA PREFERENCIA DE ESTILO.
//
// La idempotencia de §4 vive en el índice único PARCIAL
// `ingestion_events_source_external_unique` — `(source_id, external_id) WHERE
// external_id IS NOT NULL`, creado en la migración 20260824120000 porque el DSL
// de Prisma no expresa predicados parciales.
//
// `prisma.ingestionEvent.upsert()` exige que el criterio de conflicto sea un
// único DECLARADO EN EL DSL, y este no lo es ni puede serlo: para Prisma ese
// índice no existe. Es la misma limitación que la nota 9.5 anticipó para la
// promoción a Contact, un nivel más arriba en el mismo pipeline.
//
// La alternativa sin SQL crudo sería SELECT-y-después-INSERT, que no es
// atómico: dos reintentos simultáneos del mismo webhook pasan los dos por el
// SELECT antes de que cualquiera inserte, y el segundo INSERT revienta contra
// el único. El ON CONFLICT hace que la decisión la tome Postgres dentro de la
// misma sentencia, que es donde la garantía tiene que estar.
// ---------------------------------------------------------------------------

export interface InsertPendingEventData {
  organizationId: string;
  sourceId: string;
  // Nunca null por este camino: si la fuente no manda X-External-Id se deriva
  // del contenido (ver utils/externalId.ts). La columna es nullable porque el
  // modelo lo permite, no porque esta ruta lo use.
  externalId: string;
  rawPayload: unknown;
}

export interface InsertPendingEventResult {
  id: string;
  // true = ya existía un evento con ese (sourceId, externalId) y este request
  // no escribió nada. `id` es el del evento PREEXISTENTE.
  duplicate: boolean;
}

interface FilaId {
  id: string;
}

// INSERT ... ON CONFLICT DO NOTHING RETURNING id, y si no vuelve nada, SELECT
// del que ya estaba. Las dos sentencias van en una transacción: sin ella, entre
// el INSERT que no insertó y el SELECT podría correr la purga por retención de
// la nota 9.1 y dejarnos sin fila que devolver.
//
// El predicado del ON CONFLICT repite el del índice palabra por palabra porque
// Postgres infiere el índice a partir de él: `(source_id, external_id) WHERE
// external_id IS NOT NULL`. Si no coincidiera, Postgres respondería
// "no unique or exclusion constraint matching the ON CONFLICT specification" en
// vez de elegir otro índice en silencio — el error es ruidoso, que es lo
// deseable.
//
// organization_id NO forma parte del conflict target, y no puede formarlo: el
// índice no la incluye. El aislamiento acá no lo da un WHERE sino la FK
// compuesta `(organization_id, source_id) -> sources(organization_id, id)`
// (C-3), que hace que un INSERT con la organización de A y una Source de B sea
// rechazado por la base, no por código nuestro. Es la misma garantía en los
// datos que 9.4 describe para la cascada de revocación.
export async function insertPendingIngestionEvent(
  data: InsertPendingEventData,
  db: Db = prisma,
): Promise<InsertPendingEventResult> {
  const ejecutar = async (tx: Db): Promise<InsertPendingEventResult> => {
    const insertadas = await tx.$queryRaw<FilaId[]>`
      INSERT INTO ingestion_events (
        organization_id, source_id, external_id, raw_payload, status,
        created_at, updated_at
      )
      VALUES (
        ${data.organizationId}::uuid,
        ${data.sourceId}::uuid,
        ${data.externalId},
        ${JSON.stringify(data.rawPayload)}::jsonb,
        'PENDING'::"IngestionStatus",
        now(), now()
      )
      ON CONFLICT (source_id, external_id) WHERE external_id IS NOT NULL
      DO NOTHING
      RETURNING id
    `;

    if (insertadas.length > 0) {
      return { id: insertadas[0].id, duplicate: false };
    }

    // organization_id en el WHERE aunque source_id ya la determine vía la FK
    // compuesta: mismo criterio de M4 en toda lectura/escritura del proyecto.
    // Si esta consulta no encuentra la fila que el ON CONFLICT acaba de decir
    // que existe, la única explicación es que pertenece a OTRA organización, y
    // eso sería una violación del aislamiento — se prefiere no devolver nada
    // antes que devolver el id de un evento ajeno.
    const existentes = await tx.$queryRaw<FilaId[]>`
      SELECT id
      FROM ingestion_events
      WHERE organization_id = ${data.organizationId}::uuid
        AND source_id = ${data.sourceId}::uuid
        AND external_id = ${data.externalId}
      LIMIT 1
    `;

    if (existentes.length === 0) {
      throw new Error(
        "insertPendingIngestionEvent: el INSERT no insertó por conflicto pero la fila en conflicto no es de esta organización — revisar el aislamiento de ingestion_events",
      );
    }

    return { id: existentes[0].id, duplicate: true };
  };

  // Si ya viene una transacción (Db es PrismaClient | TransactionClient), se
  // usa esa: anidar $transaction sobre un TransactionClient no es válido.
  return "$transaction" in db
    ? db.$transaction((tx) => ejecutar(tx))
    : ejecutar(db);
}

// ---------------------------------------------------------------------------
// La cola del worker (§5). El índice parcial `(created_at) WHERE status =
// 'PENDING'` de la migración 20260824120000 existe exactamente para esta
// consulta.
// ---------------------------------------------------------------------------

export interface EventoReclamado {
  id: string;
  organizationId: string;
  sourceId: string;
  sourceName: string;
  rawPayload: unknown;
}

interface FilaReclamada {
  id: string;
  organization_id: string;
  source_id: string;
  source_name: string;
  raw_payload: unknown;
}

// Reclama UN evento pendiente y lo deja bloqueado hasta el fin de la
// transacción. Devuelve null si no queda ninguno.
//
// FOR UPDATE SKIP LOCKED ES EL MECANISMO DE EXCLUSIÓN, y evita tener que
// inventar un estado PROCESSING. Un estado nuevo en el enum habría sido una
// migración, un valor más que todo consumidor tiene que entender, y —peor— un
// estado del que un worker que muere deja filas colgadas para siempre. Con el
// lock, si el proceso se cae la transacción se aborta y la fila vuelve a estar
// disponible sola. SKIP LOCKED hace que dos workers nunca se peleen por la
// misma fila: el segundo la saltea en vez de esperarla.
//
// `excluir` es para el drenado de UNA pasada: si la promoción de una fila falla
// por un error de sistema, la transacción se revierte y la fila vuelve a
// PENDING — sin esta lista, el siguiente reclamo de la misma pasada elegiría la
// misma fila (es la más vieja) y el drenado no avanzaría nunca. Es la mitad
// estructural de "una fila mala no aborta el lote" (§5) para el caso de error
// que no es de datos.
//
// `organizationId` acota el drenado a un tenant. En producción se llama sin
// filtro; existe porque un drenado acotado es útil de por sí (reprocesar una
// organización) y porque permite que un test drene de forma determinística sin
// depender de que el resto de la tabla esté vacía.
export async function claimNextPendingEvent(
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

  // El JOIN con sources trae el nombre de la fuente en el mismo round-trip:
  // la promoción lo necesita para Contact.source (ver promotion.service.ts).
  // FOR UPDATE OF e — solo la fila del evento; bloquear también la Source
  // serializaría todos los eventos de una misma fuente contra un único lock,
  // que es justo lo contrario de lo que SKIP LOCKED viene a dar.
  const filas = await db.$queryRaw<FilaReclamada[]>`
    SELECT e.id, e.organization_id, e.source_id, s.name AS source_name,
           e.raw_payload
    FROM ingestion_events e
    JOIN sources s
      ON s.organization_id = e.organization_id AND s.id = e.source_id
    WHERE e.status = 'PENDING'::"IngestionStatus"
    ${filtroOrg}
    ${filtroExcluidos}
    ORDER BY e.created_at
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
    sourceId: fila.source_id,
    sourceName: fila.source_name,
    rawPayload: fila.raw_payload,
  };
}

// organizationId en el WHERE de las dos transiciones, por el invariante de M4:
// la escritura misma es la garantía de aislamiento. `status: PENDING` además
// convierte el UPDATE en un compare-and-swap — redundante mientras el lock de
// claimNextPendingEvent se sostenga, pero es la clase de redundancia que
// sobrevive a que alguien cambie el mecanismo de reclamo.
export function markEventProcessed(
  id: string,
  organizationId: string,
  promotedContactId: string,
  notes: PromotionNote[],
  db: Db = prisma,
) {
  return db.ingestionEvent.updateMany({
    where: { id, organizationId, status: IngestionStatus.PENDING },
    data: {
      status: IngestionStatus.PROCESSED,
      promotedContactId,
      // Sin notas se escribe NULL, no un array vacío: "no hubo nada que
      // registrar" y "hubo cero elementos" se ven distinto en una consulta, y
      // el NULL es más barato en la tabla de mayor volumen del esquema.
      //
      // El cast es el precio de tener un tipo declarado para una columna JSONB.
      // InputJsonValue de Prisma exige una firma de índice de string que una
      // interfaz cerrada como PromotionNote deliberadamente no tiene — es la
      // misma propiedad que hace que la forma esté definida y no sea "cualquier
      // JSON". Se paga acá, en el único punto de persistencia, y no en los
      // llamadores, que siguen tipados contra la unión discriminada.
      promotionNotes:
        notes.length > 0
          ? (notes as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
      // La fila se procesó con éxito: errorMessage tiene que quedar limpio
      // incluso si un intento anterior lo había escrito.
      errorMessage: null,
    },
  });
}

export function markEventFailed(
  id: string,
  organizationId: string,
  errorMessage: string,
  db: Db = prisma,
) {
  return db.ingestionEvent.updateMany({
    where: { id, organizationId, status: IngestionStatus.PENDING },
    data: {
      status: IngestionStatus.FAILED,
      errorMessage,
      // promotedContactId queda en null: no hubo contacto.
    },
  });
}
