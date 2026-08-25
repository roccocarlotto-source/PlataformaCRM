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
