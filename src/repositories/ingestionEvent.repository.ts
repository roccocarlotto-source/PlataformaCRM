import { IngestionStatus, Prisma, type SourceType } from "@prisma/client";
import type { PromotionNote } from "../types/promotion";
import { prisma, type Db } from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { MARCADOR_DE_DATO_BORRADO } from "./contact.repository";

// ---------------------------------------------------------------------------
// El carácter NUL (U+0000) y jsonb — M-16 de docs/auditoria-2026-08-29.md.
//
// Postgres no admite U+0000 dentro de un jsonb (error 22P05, "unsupported
// Unicode escape sequence"), y nada antes de este archivo lo filtra:
// JSON.parse acepta el escape de NUL como string válido, esObjetoJson solo
// mira el tipo, y csv-parse conserva el byte en la celda. Sin este chequeo,
// el INSERT revienta con el error crudo de Postgres —que no es AppError— y el
// emisor recibe un 500 por algo que mandó él.
//
// SE RECHAZA, NO SE SANITIZA. Guardar el payload "tal cual llegó, sin
// normalizar nada" es el principio de ingestEvent (§1); borrar el byte en
// silencio lo rompería, y es el mismo criterio que M-15 (rechazar, no truncar).
//
// El recorrido es sobre el VALOR YA DECODIFICADO, comparando el carácter real.
// No se busca el escape como sub-cadena dentro de JSON.stringify(payload): un
// string legítimo que contenga ese escape escrito como texto plano (alguien
// pega una regex o documentación) se reserializa con el backslash duplicado,
// y la cadena resultante contiene el patrón buscado a partir del segundo
// backslash — falso positivo sobre un payload que no tiene ningún NUL real.
// Un NUL real en el string decodificado no se confunde con seis caracteres
// de texto.
//
// Vive acá y no en los services porque los dos INSERT de jsonb están en este
// archivo: un solo chequeo cubre /api/ingest y /api/imports a la vez.
// ---------------------------------------------------------------------------

const NUL = String.fromCharCode(0);

function contieneNul(value: unknown): boolean {
  if (typeof value === "string") {
    return value.includes(NUL);
  }
  if (Array.isArray(value)) {
    return value.some(contieneNul);
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(
      ([clave, val]) => clave.includes(NUL) || contieneNul(val),
    );
  }
  return false;
}

const MENSAJE_NUL = "no puede contener el carácter NUL (U+0000)";

function assertSinNul(rawPayload: unknown): void {
  if (contieneNul(rawPayload)) {
    throw new AppError(`El payload ${MENSAJE_NUL}`, 400);
  }
}

// ---------------------------------------------------------------------------
// Staging de la ingesta (docs/ingestion-architecture.md §1 y §5): una fila por
// intento, con el payload crudo intacto y status PENDING. Nada de promoción
// sincrónica — eso es el worker (§5, workers/ingestionWorker.ts).
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
  assertSinNul(data.rawPayload);

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
  return "$transaction" in db ? db.$transaction((tx) => ejecutar(tx)) : ejecutar(db);
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
  // El ítem 5 los necesita para decidir si la fila hay que TRADUCIR antes de
  // validarla (FILE_IMPORT con fieldMapping) o validarla directo (WEBHOOK).
  // Vienen del mismo JOIN que ya traía sourceName: la decisión de traducir se
  // toma por evento, así que preguntarlo aparte sería una consulta extra por
  // cada fila de cada lote.
  sourceType: SourceType;
  fieldMapping: unknown;
  rawPayload: unknown;
}

interface FilaReclamada {
  id: string;
  organization_id: string;
  source_id: string;
  source_name: string;
  source_type: SourceType;
  field_mapping: unknown;
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
    SELECT e.id, e.organization_id, e.source_id,
           s.name AS source_name, s.type AS source_type,
           s.field_mapping AS field_mapping,
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
    sourceType: fila.source_type,
    fieldMapping: fila.field_mapping,
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
        notes.length > 0 ? (notes as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
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

// ---------------------------------------------------------------------------
// Escritura en lote (ítem 5 — importación de archivo).
//
// POR QUÉ NO SE REUSA insertPendingIngestionEvent EN UN BUCLE: un archivo de
// 5.000 filas serían 5.000 round-trips, cada uno con su propia transacción. El
// parseo y la escritura a staging ocurren DENTRO del request (§5 solo prohíbe
// que la PROMOCIÓN viva ahí), así que ese costo se lo come el ADMIN que sube el
// archivo, esperando.
//
// Un solo INSERT multi-fila por tanda hace el mismo trabajo en un round-trip, y
// conserva la misma garantía: ON CONFLICT DO NOTHING sobre el mismo índice
// parcial, así que subir dos veces el mismo archivo sigue sin duplicar (§4,
// "un Excel que se sube dos veces").
//
// SE TROCEA en tandas en vez de mandar todo en una sentencia. Postgres acepta
// como máximo 65535 parámetros por sentencia y acá van 6 por fila, así que sin
// trocear el techo real sería ~10.900 filas y el fallo aparecería como un error
// de protocolo incomprensible al cruzarlo. La tanda también acota cuánta memoria
// ocupa la sentencia armada.
// ---------------------------------------------------------------------------

const FILAS_POR_TANDA = 500;

export interface FilaDeLote {
  externalId: string;
  rawPayload: unknown;
}

export interface InsertBatchResult {
  // Filas que efectivamente crearon un IngestionEvent bajo este batchId.
  insertados: number;
  // Filas cuyo (sourceId, externalId) ya existía: no se escribió nada y NO
  // quedan asociadas a este lote, porque pertenecen al lote anterior que las
  // trajo. Es el número que hace visible "este archivo ya se había subido".
  duplicados: number;
}

export async function insertPendingEventsBatch(
  data: {
    organizationId: string;
    sourceId: string;
    batchId: string;
    filas: FilaDeLote[];
  },
  db: Db = prisma,
): Promise<InsertBatchResult> {
  // TODAS las filas se validan ANTES de la primera tanda, no tanda por tanda:
  // si la fila 2.900 de 3.000 trae un NUL, no tiene que haber quedado nada de
  // las 2.800 anteriores. Es la única forma de garantizar "cero filas
  // insertadas" sin depender de la atomicidad entre tandas (M-17).
  //
  // `i + 1` es el mismo número de fila que lleva el externalId (ver
  // filasParaStaging en utils/spreadsheet.ts): 1-based y contando solo filas
  // de datos. Es el único dato que el usuario tiene para ubicar la fila en su
  // archivo.
  data.filas.forEach((fila, i) => {
    if (contieneNul(fila.rawPayload)) {
      throw new AppError(
        `La fila ${i + 1} del archivo (contando solo filas de datos, sin el encabezado) ${MENSAJE_NUL}`,
        400,
      );
    }
  });

  let insertados = 0;

  for (let i = 0; i < data.filas.length; i += FILAS_POR_TANDA) {
    const tanda = data.filas.slice(i, i + FILAS_POR_TANDA);

    const valores = tanda.map(
      (fila) => Prisma.sql`(
        ${data.organizationId}::uuid,
        ${data.sourceId}::uuid,
        ${data.batchId}::uuid,
        ${fila.externalId},
        ${JSON.stringify(fila.rawPayload)}::jsonb,
        'PENDING'::"IngestionStatus",
        now(), now()
      )`,
    );

    // Dos filas del MISMO archivo nunca colisionan entre sí, y no por suerte:
    // el externalId de una fila de archivo incluye su número de fila (ver
    // utils/spreadsheet.ts), así que dos filas idénticas del mismo archivo
    // producen externalId distintos. Sin eso, dos filas iguales colapsarían en
    // una y se perdería un lead sin que nada lo dijera.
    const insertadas = await db.$queryRaw<FilaId[]>`
      INSERT INTO ingestion_events (
        organization_id, source_id, batch_id, external_id, raw_payload, status,
        created_at, updated_at
      )
      VALUES ${Prisma.join(valores)}
      ON CONFLICT (source_id, external_id) WHERE external_id IS NOT NULL
      DO NOTHING
      RETURNING id
    `;

    insertados += insertadas.length;
  }

  return { insertados, duplicados: data.filas.length - insertados };
}

// ---------------------------------------------------------------------------
// El resultado de un lote — §5, literal: "cuántos entraron, cuántos se
// promovieron, cuántos fallaron y por qué. Sin esto la importación es una caja
// negra y el usuario no puede corregir nada."
//
// Los contadores se DERIVAN con un GROUP BY, no se persisten. Ver el
// razonamiento en la migración 20260825160000: un contador guardado es un
// segundo lugar donde vive un número derivable, y puede desincronizarse; un
// GROUP BY no.
// ---------------------------------------------------------------------------

// SIN `rawPayload`, y es deliberado — hallazgo D2-2 de
// docs/review-fase2-2026-08-28.md. Esta respuesta viajaba con hasta 100 filas
// crudas de planilla (nombre, email y teléfono de personas reales) hacia una
// pantalla que solo renderiza `errorMessage` y no las lee nunca: datos
// personales cruzando la frontera HTTP sin que nadie los consuma.
//
// Si alguna vez hace falta ver la fila que falló, el crudo sigue intacto en
// IngestionEvent.rawPayload y lo que corresponde es un endpoint de detalle que
// lo exponga a propósito, no que se cuele de arrastre en un resumen.
export interface FallaDeLote {
  id: string;
  errorMessage: string | null;
}

export interface ResumenDeLote {
  batchId: string;
  total: number;
  pendientes: number;
  promovidos: number;
  fallidos: number;
  fallas: FallaDeLote[];
  fallasOmitidas: number;
}

// Tope de fallas devueltas. Un archivo mal mapeado puede fallar en sus 5.000
// filas, y devolverlas todas convertiría una consulta de diagnóstico en una
// descarga. Se devuelve una muestra y se dice explícitamente cuántas quedaron
// afuera — nunca se trunca en silencio.
export const MAX_FALLAS_DEVUELTAS = 100;

export async function getResumenDeLote(
  organizationId: string,
  batchId: string,
  db: Db = prisma,
): Promise<ResumenDeLote | null> {
  // organizationId en el WHERE de las dos consultas: es una LECTURA, pero el
  // aislamiento se aplica igual — un batchId es un UUID y adivinarlo es
  // impracticable, pero la garantía no puede depender de eso.
  const porEstado = await db.ingestionEvent.groupBy({
    by: ["status"],
    where: { organizationId, batchId },
    _count: { _all: true },
  });

  const total = porEstado.reduce((suma, fila) => suma + fila._count._all, 0);

  if (total === 0) {
    // Ningún evento con ese batchId en esta organización: o no existe, o es de
    // otra. Las dos dan 404 y no se distinguen, mismo criterio que el resto del
    // proyecto para no confirmar la existencia de recursos ajenos.
    return null;
  }

  const contar = (estado: IngestionStatus) =>
    porEstado.find((fila) => fila.status === estado)?._count._all ?? 0;

  const fallidos = contar(IngestionStatus.FAILED);

  const fallas =
    fallidos > 0
      ? await db.ingestionEvent.findMany({
          where: {
            organizationId,
            batchId,
            status: IngestionStatus.FAILED,
          },
          select: { id: true, errorMessage: true },
          // Desempate por id, mismo motivo que en findManyIngestionEvents: una
          // importación escribe el lote entero con el `now()` de una sola
          // transacción, así que estas filas comparten created_at al
          // microsegundo. Sin segunda clave, el `take` puede devolver una
          // muestra distinta en cada consulta sobre el mismo bloque de empates.
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: MAX_FALLAS_DEVUELTAS,
        })
      : [];

  return {
    batchId,
    total,
    pendientes: contar(IngestionStatus.PENDING),
    promovidos: contar(IngestionStatus.PROCESSED),
    fallidos,
    fallas,
    fallasOmitidas: Math.max(0, fallidos - fallas.length),
  };
}

// ---------------------------------------------------------------------------
// Listado de eventos — G-1 y G-2 de docs/research-frontend-ingesta-2026-08-27.md.
//
// Hasta acá lo ÚNICO que salía de esta tabla por HTTP eran los contadores
// agregados de un lote (getResumenDeLote), y solo si ya se conocía su batchId.
// Los eventos del webhook quedaban invisibles por completo: su batch_id es NULL
// para siempre, así que ninguna consulta existente los alcanzaba.
// ---------------------------------------------------------------------------

// LA PROYECCIÓN DEL LISTADO, Y LO QUE DELIBERADAMENTE DEJA AFUERA.
//
// No incluye `rawPayload` ni `promotionNotes`, y no es un olvido: son las dos
// columnas JSONB de la tabla de mayor volumen del esquema. `rawPayload` puede
// tener hasta 64 KB por fila en el webhook (INGEST_MAX_BODY_BYTES) o una fila
// entera de planilla en una importación; con pageSize=100 una sola página
// podría pesar megabytes, para un listado cuyo propósito es ver ESTADOS.
//
// Dónde sigue estando disponible el crudo: SOLO en la tabla. Ninguna respuesta
// HTTP lo expone hoy — `getResumenDeLote` lo devolvía hasta el hallazgo D2-2 de
// docs/review-fase2-2026-08-28.md, y se lo sacó por ser un dato personal que
// nadie consumía. Que un evento fallido —de webhook o de importación— pueda
// verse fila por fila sigue siendo la pregunta abierta del endpoint de detalle,
// que no se construyó acá porque no se pidió.
//
// `errorMessage` SÍ va: es el dato que hace diagnosticable una fila fallida sin
// traer el crudo, y es exactamente lo que faltaba para el webhook.
const INGESTION_EVENT_PUBLIC_SELECT = {
  id: true,
  organizationId: true,
  sourceId: true,
  batchId: true,
  externalId: true,
  status: true,
  errorMessage: true,
  promotedContactId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.IngestionEventSelect;

export type PublicIngestionEvent = Prisma.IngestionEventGetPayload<{
  select: typeof INGESTION_EVENT_PUBLIC_SELECT;
}>;

export interface IngestionEventFilters {
  sourceId?: string;
  status?: IngestionStatus;
  batchId?: string;
}

// Un solo valor, y es a propósito: (organization_id, source_id, created_at) es
// el único índice compuesto de la tabla, así que ordenar por cualquier otra
// columna degeneraría en un sort de toda la tabla de mayor volumen del esquema.
// Se declara como enum igual que en los otros tres listados para que la forma de
// la query sea la misma, y para que agregar un orden nuevo obligue a agregar
// primero el índice que lo sostiene.
export type IngestionEventSortBy = "createdAt";

// Declarado acá y no importado de otro repositorio: source.repository.ts y
// apiKey.repository.ts ya declaran el suyo propio, cada uno para su módulo.
// Compartirlo crearía una dependencia entre repositorios que hoy no existe.
export type SortOrder = "asc" | "desc";

// IngestionEvent no tiene deletedAt: su ciclo de vida ya está representado por
// `status` (misma decisión que Invitation, ver docs/project-overview.md §9). El
// filtro base es solo organizationId.
function buildIngestionEventWhere(
  organizationId: string,
  filters: IngestionEventFilters,
): Prisma.IngestionEventWhereInput {
  return {
    organizationId,
    ...(filters.sourceId ? { sourceId: filters.sourceId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.batchId ? { batchId: filters.batchId } : {}),
  };
}

export function findManyIngestionEvents(
  organizationId: string,
  filters: IngestionEventFilters,
  pagination: { skip: number; take: number },
  sort: { sortBy: IngestionEventSortBy; sortOrder: SortOrder },
  db: Db = prisma,
) {
  return db.ingestionEvent.findMany({
    where: buildIngestionEventWhere(organizationId, filters),
    select: INGESTION_EVENT_PUBLIC_SELECT,
    // DESEMPATE POR ID, y no es cosmético — hallazgo E2-1 de
    // docs/review-fase2-2026-08-28.md. Una importación inserta hasta 500 filas
    // por sentencia con el `now()` de una sola transacción, que en Postgres es
    // constante dentro de ella: el lote entero comparte created_at al
    // microsegundo. Con una sola clave de orden el desempate lo elige el plan y
    // puede cambiar entre consultas, así que dos páginas consecutivas del mismo
    // OFFSET pueden repetir filas y —peor— saltearse otras: una fila fallida
    // podía no aparecer en NINGUNA página.
    //
    // `id` es la clave primaria, así que el orden queda total y determinista.
    // Va en el mismo sentido que createdAt para que el recorrido sea coherente.
    orderBy: [{ createdAt: sort.sortOrder }, { id: sort.sortOrder }],
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countIngestionEvents(
  organizationId: string,
  filters: IngestionEventFilters,
  db: Db = prisma,
) {
  return db.ingestionEvent.count({ where: buildIngestionEventWhere(organizationId, filters) });
}

export function findIngestionEventById(id: string, organizationId: string, db: Db = prisma) {
  return db.ingestionEvent.findFirst({
    where: { id, organizationId },
    select: INGESTION_EVENT_PUBLIC_SELECT,
  });
}

// ---------------------------------------------------------------------------
// Reproceso de una fila fallida — G-7 del mismo relevamiento.
//
// §1 promete que se puede "corregir un mapeo y volver a correrlo", y el diseño
// lo permite (rawPayload queda intacto), pero no había forma de pedirlo: el
// worker solo reclama PENDING (claimNextPendingEvent), así que FAILED era
// terminal.
//
// Compare-and-swap, calcado de revokeApiKeyConditional: la transición solo se
// aplica si el evento sigue en FAILED en el momento exacto de la escritura.
// `count === 0` significa que otro reintento ganó la carrera, que el evento
// nunca estuvo en FAILED, o que la fila no es de esta organización — el caller
// SIEMPRE debe verificar count, nunca asumir éxito por ausencia de excepción
// (mismo invariante que exigirTransicion en promotion.service.ts).
//
// organizationId en el WHERE por el invariante de M4: la escritura misma es la
// garantía de aislamiento, nunca el pre-chequeo del service.
//
// errorMessage SE LIMPIA. La columna significa una sola cosa —por qué falló el
// intento vigente— y una fila PENDING todavía no falló: dejarle el mensaje
// anterior sería un estado que la UI tendría que explicar, y que ninguna
// consulta puede interpretar sin saber de qué intento habla. Es además el mismo
// criterio que ya aplica markEventProcessed, que lo limpia al pasar a PROCESSED.
// Si el reintento vuelve a fallar, markEventFailed escribe el mensaje nuevo. Un
// historial real de intentos necesitaría una columna o una tabla aparte, o sea
// una migración, que este cambio deliberadamente no hace.
export function retryIngestionEventConditional(
  id: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.ingestionEvent.updateMany({
    where: { id, organizationId, status: IngestionStatus.FAILED },
    data: {
      status: IngestionStatus.PENDING,
      errorMessage: null,
    },
  });
}

// ---------------------------------------------------------------------------
// PURGA DE RETENCIÓN — hallazgo D2-3 de docs/review-fase2-2026-08-28.md (y D-3
// de la ronda anterior: el mismo hueco sin cerrar por segunda vez).
//
// La política vive en docs/data-classification.md §5.1: 90 días desde
// created_at, solo PROCESSED y DUPLICATE, borrado FÍSICO. La consulta es
// exactamente la que §9.1 de docs/ingestion-architecture.md ya especificaba
// hace meses; lo que faltaba era algo que la corriera.
//
// POR QUÉ SOLO ESOS DOS ESTADOS, y no es una optimización: un PENDING es
// trabajo sin hacer, y un FAILED es el ÚNICO lugar donde vive el dato que no se
// pudo promover a Contact. Borrarlos por edad sería perder información que
// nadie recuperó todavía — un evento viejo y fallido es justamente el que hay
// que mirar, no el que hay que borrar. Vale sin importar la antigüedad.
//
// POR QUÉ ACÁ Y NO ADENTRO DEL SCRIPT: para que el `where` sea UNO SOLO. El
// dry-run cuenta y el borrado destruye; si cada uno armara su propio filtro,
// podrían divergir y el número que alguien mira antes de ejecutar no sería el
// de lo que se va a borrar. Además deja la purga testeable sin invocar un
// proceso aparte.
//
// SIN organizationId, a diferencia de todo el resto de este archivo: no es una
// operación de un tenant sobre sus datos, es mantenimiento del operador del
// sistema sobre la tabla entera. No hay ningún request ni AuthContext detrás.
// ---------------------------------------------------------------------------

export const DIAS_DE_RETENCION_INGESTION_EVENT = 90;

const ESTADOS_PURGABLES = [IngestionStatus.PROCESSED, IngestionStatus.DUPLICATE];

export function fechaDeCorteDeRetencion(ahora: Date = new Date()): Date {
  const corte = new Date(ahora);
  corte.setUTCDate(corte.getUTCDate() - DIAS_DE_RETENCION_INGESTION_EVENT);
  return corte;
}

// `organizationId` es OPCIONAL y el script NUNCA lo pasa: la purga real es
// sobre la tabla entera. Existe por la misma razón que el parámetro de
// drenarPendientes({ organizationId }) — el test de integración corre contra
// una base que puede estar compartida, y un DELETE sin acotar borraría datos
// de otras organizaciones de verdad. Acá el riesgo es mayor que en el worker,
// porque esto no cambia un estado: destruye filas.
export interface PurgaScope {
  organizationId?: string;
}

function buildPurgaWhere(corte: Date, scope: PurgaScope): Prisma.IngestionEventWhereInput {
  return {
    createdAt: { lt: corte },
    status: { in: ESTADOS_PURGABLES },
    ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
  };
}

// Cuánto borraría la purga sin borrarlo. Es lo que consume `--dry-run`.
export function countIngestionEventsPurgables(
  corte: Date,
  scope: PurgaScope = {},
  db: Db = prisma,
) {
  return db.ingestionEvent.count({ where: buildPurgaWhere(corte, scope) });
}

// El borrado real. Devuelve cuántas filas murieron: el estándar pide que el
// borrado sea verificable, y sin ese número no queda rastro de haberse
// cumplido.
export function purgeIngestionEvents(corte: Date, scope: PurgaScope = {}, db: Db = prisma) {
  return db.ingestionEvent.deleteMany({ where: buildPurgaWhere(corte, scope) });
}

// ---------------------------------------------------------------------------
// Anonimización del crudo de los eventos que promovieron a un contacto —
// segunda mitad de D2-4 (ver erasePersonalDataFromContact).
//
// `rawPayload` es NOT NULL, así que no puede ir a NULL: se reemplaza por un
// marcador explícito. Que diga `erased` y no quede un `{}` ambiguo importa —
// un objeto vacío se lee como "el formulario no mandó nada", que es un estado
// real y distinto.
//
// `promotionNotes` SE REDACTA, NO SE BORRA — y ahí está la decisión.
//
// Una NotaConflicto guarda los VALORES de firstName/lastName/phone/jobTitle
// que la promoción descartó (ver src/types/promotion.ts): dato personal de la
// misma persona, en la misma fila que se está limpiando. Pero borrar la
// columna entera destruiría el registro que §4 de
// docs/ingestion-architecture.md exige — "nunca sobrescribir en silencio".
//
// La tensión se resuelve separando las dos cosas que esa columna guarda: QUÉ
// PASÓ y CON QUÉ VALOR. Se conserva la estructura —`tipo`, `campo`, `motivo`—
// y se reemplazan solo los valores. Después de un borrado sigue siendo cierto
// y consultable que hubo un conflicto en `phone`; lo que ya no se puede leer
// es qué teléfono era. No se está sobrescribiendo el registro en silencio: se
// está borrando el dato personal que ese registro contenía, a pedido de su
// titular y dejando el registro en pie.
//
// LO QUE ESTA FUNCIÓN SIGUE SIN LIMPIAR, porque el nombre del endpoint promete
// más de lo que ninguna función puede hacer sola:
//
//   - `errorMessage`, sin garantía formal de no transportar el valor que falló.
//     Desde D2-7 hay tests que fijan que ningún mensaje de validación haga eco
//     del valor recibido, así que hoy no lo transporta; la clase de ese campo
//     describe qué pasaría si esa garantía se rompiera.
//   - `externalId`, que si lo proveyó la fuente por X-External-Id puede ser el
//     email del lead.
//   - Los eventos de esa persona que NUNCA se promovieron (FAILED, PENDING):
//     no tienen promotedContactId, así que este WHERE no los alcanza.
//
// Está escrito acá y en docs/data-classification.md §5.2.
// ---------------------------------------------------------------------------

export const RAW_PAYLOAD_BORRADO = { erased: true } as const;

// Redacta los valores de dato personal de `promotionNotes` conservando la
// estructura. Recibe el valor crudo tal como sale de Prisma, que es JSONB: no
// hay ninguna garantía de que tenga la forma de PromotionNote, porque una
// escritura directa a la base puede dejar ahí cualquier cosa — el mismo
// razonamiento por el que traducirConMapeo revalida el fieldMapping.
//
// FAIL-CLOSED ANTE UNA FORMA DESCONOCIDA: si el valor no es un array, o si
// alguno de sus elementos no es una de las tres notas declaradas, la columna
// entera se va a NULL. En una función de borrado, "no reconozco esto" no puede
// significar "lo dejo como está": significaría dejar dato personal sin redactar
// justo en la operación que existe para destruirlo.
export function redactPromotionNotes(
  valor: Prisma.JsonValue,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  // NULL se mantiene NULL: un evento sin conflictos no tiene nada que redactar,
  // y escribirle un array vacío inventaría un estado que la promoción nunca
  // produce (ver markEventProcessed).
  if (valor === null) return Prisma.DbNull;
  if (!Array.isArray(valor)) return Prisma.DbNull;

  const redactadas: Prisma.JsonValue[] = [];

  for (const nota of valor) {
    if (typeof nota !== "object" || nota === null || Array.isArray(nota)) return Prisma.DbNull;

    const objeto = nota as Record<string, Prisma.JsonValue>;

    switch (objeto.tipo) {
      case "conflicto":
        // `crm` es el valor que ganó y `entrante` el que se descartó. Los dos
        // son datos de la persona: el primero además sigue vivo en Contact
        // hasta que erasePersonalDataFromContact lo borra en esta misma
        // transacción, así que dejarlo acá sería conservar una copia de lo que
        // se acaba de destruir al lado.
        redactadas.push({
          ...objeto,
          crm: MARCADOR_DE_DATO_BORRADO,
          entrante: MARCADOR_DE_DATO_BORRADO,
        });
        break;
      case "ignorado":
        // `motivo` explica por qué se ignoró y `campo` cuál era; ninguno de los
        // dos es un valor. Solo `entrante` lo es.
        redactadas.push({ ...objeto, entrante: MARCADOR_DE_DATO_BORRADO });
        break;
      case "revision_manual":
        // No tiene ningún campo de valor: `motivo` es una explicación fija
        // escrita por el código, no algo que haya llegado del formulario.
        redactadas.push(objeto);
        break;
      default:
        return Prisma.DbNull;
    }
  }

  // El cast es el mismo precio que paga markEventProcessed: InputJsonValue
  // exige una firma de índice que JsonValue no ofrece en la posición de array.
  return redactadas as unknown as Prisma.InputJsonValue;
}

// NO ES UN updateMany, y no puede serlo: la redacción de `promotionNotes`
// depende del contenido de CADA fila, así que hay que leer antes de escribir.
// `rawPayload` sí es un valor estático, pero separarlo en dos pasadas dejaría
// una ventana en la que una fila tiene el crudo borrado y las notas intactas.
//
// Todo corre sobre el `db` que recibe, que en producción es el `tx` de
// erasePersonalData: la lectura y las escrituras son parte de la misma
// transacción que anonimiza el Contact.
//
// Devuelve `{ count }` como antes —contando las filas que trajo el findMany—
// para que contact.service.ts no tenga que cambiar cómo la llama.
export async function anonymizeIngestionEventsOfContact(
  contactId: string,
  organizationId: string,
  db: Db = prisma,
): Promise<{ count: number }> {
  const eventos = await db.ingestionEvent.findMany({
    where: { organizationId, promotedContactId: contactId },
    select: { id: true, promotionNotes: true },
  });

  for (const evento of eventos) {
    await db.ingestionEvent.update({
      where: { id: evento.id },
      data: {
        rawPayload: RAW_PAYLOAD_BORRADO,
        promotionNotes: redactPromotionNotes(evento.promotionNotes),
      },
    });
  }

  return { count: eventos.length };
}
