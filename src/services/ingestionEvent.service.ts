import { IngestionStatus } from "@prisma/client";
import {
  countIngestionEvents,
  findIngestionEventById,
  findManyIngestionEvents,
  retryIngestionEventConditional,
  type IngestionEventSortBy,
  type SortOrder,
} from "../repositories/ingestionEvent.repository";
import { findSourceById } from "../repositories/source.repository";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Lectura y reproceso de la cola de ingesta — G-1, G-2 y G-7 de
// docs/research-frontend-ingesta-2026-08-27.md.
//
// Este service NO promueve nada y no toca el worker. El reintento se limita a
// devolver un evento a PENDING; quien lo procesa sigue siendo
// drenarPendientes(), en su propia pasada y fuera del ciclo del request — que
// es el punto que §5 de docs/ingestion-architecture.md subraya y que este
// endpoint no puede aflojar sin volver a meter la promoción adentro de un HTTP
// request.
// ---------------------------------------------------------------------------

export interface ListIngestionEventsParams {
  page: number;
  pageSize: number;
  sourceId?: string;
  status?: IngestionStatus;
  batchId?: string;
  sortBy: IngestionEventSortBy;
  sortOrder: SortOrder;
}

export async function listIngestionEvents(
  organizationId: string,
  params: ListIngestionEventsParams,
) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyIngestionEvents(
      organizationId,
      filters,
      { skip, take: pageSize },
      { sortBy, sortOrder },
    ),
    countIngestionEvents(organizationId, filters),
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

// Devuelve un evento FAILED a PENDING para que el worker lo vuelva a tomar.
//
// LA ESTRUCTURA ES LA DE revokeApiKey, deliberadamente: pre-chequeo para poder
// dar un mensaje específico en el caso común, y una escritura condicional que
// es la ÚNICA fuente de verdad sobre si la operación tuvo éxito.
export async function retryIngestionEvent(organizationId: string, id: string) {
  const evento = await findIngestionEventById(id, organizationId);
  if (!evento) {
    // No existe, o es de otra organización. No se distinguen: mismo criterio
    // que el resto del proyecto para no confirmar la existencia de recursos
    // ajenos.
    throw new AppError("Evento de ingesta no encontrado", 404);
  }

  // Chequeo rápido de UX (mensaje específico en el caso no concurrente) — NO es
  // la defensa real. La defensa es el compare-and-swap de abajo, que solo
  // transiciona si el evento sigue en FAILED en el momento exacto del UPDATE,
  // sin importar lo que este SELECT haya visto un instante antes.
  if (evento.status !== IngestionStatus.FAILED) {
    throw new AppError(`Solo se puede reprocesar un evento FAILED (está en ${evento.status})`, 409);
  }

  // V-9 de docs/auditoria-2026-08-29.md: LA FUENTE TIENE QUE ESTAR ACTIVA Y NO
  // RETIRADA. Este endpoint era el camino sin carrera del hallazgo: un FAILED
  // puede llevar semanas en la cola, y si mientras tanto un ADMIN pausó o
  // retiró la fuente, el retry lo devolvía a PENDING y el worker lo promovía
  // igual (su JOIN con sources no filtraba). Ahora el worker ya no reclama
  // filas de fuentes pausadas/retiradas (claimNextPendingEvent), así que sin
  // este chequeo el retry respondería 200 "encolado de nuevo" sobre una fila
  // que nadie va a tomar nunca — un 200 que miente. Se rechaza acá, con el
  // motivo real: quien pregunta ya está autenticado como ADMIN de la
  // organización, no es el oráculo que ingestAuth.service.ts evita con su
  // RECHAZO genérico.
  //
  // findSourceById ya excluye deletedAt: la FK garantiza que la fuente existe,
  // así que null significa "retirada"; si vuelve, isActive dice si está
  // pausada. 409 y no 404/422: el evento existe y el request está bien
  // formado; lo que hay es un conflicto con el estado actual de un recurso
  // del que la operación depende — mismo tipo de rechazo que el de arriba.
  //
  // ESTE PRE-CHEQUEO NO ENTRA EN EL CAS y no hace falta que entre: si la
  // fuente se pausa entre este SELECT y el UPDATE, la fila queda PENDING sin
  // que el worker la reclame — exactamente lo mismo que le pasa a cualquier
  // PENDING cuya fuente se pausa después de creado. Lo que este chequeo
  // cierra es la respuesta honesta en el caso no concurrente.
  const fuente = await findSourceById(evento.sourceId, organizationId);
  if (!fuente) {
    throw new AppError("No se puede reprocesar: la fuente del evento fue retirada", 409);
  }
  if (!fuente.isActive) {
    throw new AppError("No se puede reprocesar: la fuente del evento está pausada", 409);
  }

  const result = await retryIngestionEventConditional(id, organizationId);

  if (result.count === 0) {
    // El CAS ya decidió — count === 0 es la única fuente de verdad, este
    // re-read NUNCA participa de esa decisión. Perdió una carrera real: otro
    // reintento ganó entre el SELECT de arriba y esta escritura. El re-read es
    // solo para reportar la razón específica.
    const actual = await findIngestionEventById(id, organizationId);
    if (!actual) {
      throw new AppError("Evento de ingesta no encontrado", 404);
    }
    throw new AppError(`Solo se puede reprocesar un evento FAILED (está en ${actual.status})`, 409);
  }

  const actualizado = await findIngestionEventById(id, organizationId);
  if (!actualizado) {
    throw new AppError("Evento de ingesta no encontrado tras el reintento", 500);
  }
  return actualizado;
}
