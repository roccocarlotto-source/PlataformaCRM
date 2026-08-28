import { IngestionStatus } from "@prisma/client";
import type { Response } from "express";
import { z } from "zod";
import { logAccesoADatosPersonales } from "../lib/accessLog";
import { listIngestionEvents, retryIngestionEvent } from "../services/ingestionEvent.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

const idParamSchema = z.string().uuid("id inválido");

// z.nativeEnum sobre el enum real de Prisma — mismo criterio que
// activity.controller.ts con ActivityType y source.controller.ts con SourceType,
// en vez de duplicar los valores a mano.
//
// ACEPTA DUPLICATE aunque hoy ningún código lo escriba: el enum lo declara
// (prisma/schema.prisma) y los duplicados no crean fila, así que ese estado no
// existe en los datos. Filtrar por él devuelve una página vacía, que es la
// respuesta correcta — restringir el schema a los tres estados "reales" haría
// que el contrato HTTP y el enum de la base divergieran, y eso se paga la
// primera vez que alguien escriba DUPLICATE de verdad.
const statusSchema = z.nativeEnum(IngestionStatus);

const listQuerySchema = z.object({
  // TOPE EXPLÍCITO — hallazgo S2-5 de docs/review-fase2-2026-08-28.md. `page`
  // no tenía `.max()`, a diferencia de `pageSize`, así que `?page=999999999`
  // se aceptaba y llegaba a Postgres como un OFFSET gigante: el motor igual
  // tiene que recorrer y descartar todas esas filas antes de devolver una
  // página vacía. Es trabajo real por un request sin costo para quien lo pide.
  //
  // 10.000 con pageSize=100 son un millón de filas de alcance, muy por encima
  // de cualquier navegación real de este listado, así que no le saca nada a
  // nadie. Es un techo de cordura, no una regla de negocio.
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  sourceId: z.string().uuid("sourceId inválido").optional(),
  status: statusSchema.optional(),
  // batchId sigue soportado aunque el listado ya no lo necesite: es el caso
  // puntual de "ver este lote", y es más barato que traer todo y filtrar.
  batchId: z.string().uuid("batchId inválido").optional(),
  // Un solo valor de sortBy a propósito — ver IngestionEventSortBy en el
  // repositorio: (organization_id, source_id, created_at) es el único índice
  // compuesto de la tabla.
  sortBy: z.enum(["createdAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const listIngestionEventsHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(listQuerySchema, req.query);

    // Registro de acceso — D2-5. Va ANTES de la consulta y no después: lo que
    // el estándar quiere saber es que alguien pidió ver estos datos, y eso ya
    // es cierto acá. Si la consulta falla, el intento igual quedó registrado.
    //
    // Sensitive aunque la proyección deje afuera rawPayload y promotionNotes:
    // el listado dice QUÉ leads existen, con su errorMessage y su link al
    // contacto promovido. La minimización reduce la exposición, no cambia la
    // clase del registro al que se accedió.
    //
    // Solo los filtros que vinieron. page/pageSize quedan afuera a propósito:
    // son paginación, no "qué pidió ver".
    logAccesoADatosPersonales({
      auth: req.auth,
      recurso: "GET /api/ingestion-events",
      clase: "Sensitive",
      detalle: {
        ...(query.sourceId ? { sourceId: query.sourceId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.batchId ? { batchId: query.batchId } : {}),
      },
    });

    const result = await listIngestionEvents(req.auth.organizationId, query);
    res.status(200).json(result);
  },
);

// POST y no PATCH: no se está editando un recurso, se está pidiendo que se
// vuelva a ejecutar un proceso sobre él. El estado resultante es un efecto de
// esa acción, no el cuerpo de la petición.
//
// 200 con el evento actualizado en el body, mismo criterio que
// DELETE /api/api-keys/:id: la respuesta trae el estado nuevo para que el
// caller no tenga que volver a pedirlo. NO es idempotente — un segundo POST
// sobre el mismo evento da 409, porque ya no está en FAILED.
//
// La promoción real NO ocurre acá: el evento queda en PENDING y lo toma el
// worker en su próxima pasada (§5 de docs/ingestion-architecture.md — "la
// promoción no vive en el ciclo del request"). Un 200 de este endpoint
// significa "encolado de nuevo", nunca "promovido".
export const retryIngestionEventHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);

    // Registro de acceso — D2-5. Este endpoint NO devuelve rawPayload, pero
    // identifica qué evento —o sea, de qué lead— tocó una persona, y el
    // criterio del estándar es sobre el acceso al dato, no sobre cuánto de él
    // vuelve en la respuesta.
    logAccesoADatosPersonales({
      auth: req.auth,
      recurso: "POST /api/ingestion-events/:id/retry",
      clase: "Sensitive",
      detalle: { ingestionEventId: id },
    });

    const evento = await retryIngestionEvent(req.auth.organizationId, id);
    res.status(200).json(evento);
  },
);
