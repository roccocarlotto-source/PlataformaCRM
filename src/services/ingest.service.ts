import { IngestionStatus } from "@prisma/client";
import { insertPendingIngestionEvent } from "../repositories/ingestionEvent.repository";
import type { IngestContext } from "../types/ingest";
import { AppError } from "../utils/AppError";
import { deriveExternalId } from "../utils/externalId";

// ---------------------------------------------------------------------------
// La mitad de staging de la ingesta (docs/ingestion-architecture.md §5): valida
// la clave (ya hecho por authenticateApiKey), escribe UNA fila en
// IngestionEvent con status PENDING y el payload crudo, y responde 202.
//
// LO QUE ESTE SERVICE NO HACE, Y NO ES UNA OMISIÓN:
//   - No lee, no crea y no modifica ningún Contact. La promoción vive en el
//     worker (§5, services/promotion.service.ts), fuera del ciclo del request.
//   - No valida la forma del payload más allá de que sea un objeto JSON. Una
//     fila mala no debe rechazarse acá: se marca FAILED con su errorMessage
//     cuando el worker la mire, y el resto del lote sigue (§5). Rechazar en el
//     borde convertiría cada campo faltante en un 400 para el emisor, que no
//     tiene forma de arreglarlo.
//   - No manda nada hacia afuera: ni mails, ni webhooks salientes, ni llamadas
//     a terceros.
//   - No aplica fieldMapping, y sigue sin aplicarlo después del ítem 5: esa
//     columna la consumen solo las fuentes FILE_IMPORT, y la traducción ocurre
//     al promover, no al escribir a staging. El webhook tiene contrato fijo.
// ---------------------------------------------------------------------------

export interface IngestEventResult {
  id: string;
  status: IngestionStatus;
  // true = este request no escribió nada; `id` es el del evento que ya estaba.
  // Ver el comentario sobre el 202 más abajo.
  duplicate: boolean;
}

// El payload tiene que ser un OBJETO JSON. Un array es el caso de lote, que es
// el ítem 5 (importación de Excel/CSV) y necesita su propio contrato: un lote
// no puede tener un solo externalId ni un solo status, y responder 202 con un
// id único para 5.000 filas sería mentir sobre lo que se guardó. Se rechaza
// explícitamente en vez de guardarlo como un evento raro que el worker no sabrá
// interpretar.
//
// Los escalares (`3`, `"hola"`, `true`) no llegan hasta acá: express.json corre
// en modo strict y solo acepta objetos y arrays.
function esObjetoJson(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function ingestEvent(
  ctx: IngestContext,
  payload: unknown,
  externalIdProvisto?: string,
): Promise<IngestEventResult> {
  if (!esObjetoJson(payload)) {
    throw new AppError(
      "El payload debe ser un objeto JSON. Los lotes son el ítem 5 y todavía no están soportados.",
      400,
    );
  }

  // Provisto por la fuente o derivado del contenido — §4 y §8, que advierte
  // explícitamente contra confiar en que venga siempre. El derivado se calcula
  // sobre el JSON canónico; ver utils/externalId.ts para por qué canónico y qué
  // consecuencia tiene.
  const externalId = externalIdProvisto ?? deriveExternalId(payload);

  // `payload` entra tal cual llegó: sin mapear, sin renombrar, sin recortar
  // campos desconocidos, sin normalizar nada. Es el principio rector de §1 —
  // sin el crudo intacto no hay reproceso posible, y cada error de mapeo sería
  // irreversible. Ojo: NO se guarda el JSON canónico, que existe solo para
  // derivar el externalId.
  const { id, duplicate } = await insertPendingIngestionEvent({
    organizationId: ctx.organizationId,
    sourceId: ctx.sourceId,
    externalId,
    rawPayload: payload,
  });

  return { id, status: IngestionStatus.PENDING, duplicate };
}
