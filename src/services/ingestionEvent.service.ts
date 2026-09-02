import { IngestionStatus } from "@prisma/client";
import {
  countIngestionEvents,
  findIngestionEventById,
  findManyIngestionEvents,
  retryIngestionEventConditional,
  type IngestionEventSortBy,
  type SortOrder,
} from "../repositories/ingestionEvent.repository";
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
