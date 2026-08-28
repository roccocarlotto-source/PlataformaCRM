import { useQueries } from "@tanstack/react-query";
import { getSource } from "../source/api";
import { sourceKeys } from "../source/queries";
import type { Source } from "../source/types";

// Resuelve el NOMBRE de las fuentes de los eventos visibles: el listado de
// IngestionEvent trae `sourceId` y no la relación, igual que el de ApiKey.
//
// REPLICADO de features/apiKey/sourceResolution.ts, no importado desde ahí, y
// es el criterio deliberado del proyecto — el mismo que dejó escrito aquel
// archivo cuando se replicó de contact/companyResolution.ts: son doce líneas, y
// una abstracción sobre dos o tres casos elegiría mal qué parametrizar. El día
// que aparezca una diferencia real entre los consumidores, cada copia la absorbe
// sin arrastrar a las otras.
//
// NUNCA UN REQUEST POR FILA. Se deduplica por id, así que una página con veinte
// eventos de la misma fuente dispara UNA resolución. Y usa la misma
// sourceKeys.detail que useSource, así que reutiliza el cache si esa fuente ya
// se resolvió en la sesión — por el listado de fuentes, por el select de filtro
// de esta misma pantalla, o por la pantalla de claves.
//
// Un fallo individual no rompe el resto: useQueries no falla en bloque. Esa
// fuente no aparece en `byId` y el caller decide el fallback.
export function useSourcesByIds(ids: readonly string[]) {
  const uniqueIds = Array.from(new Set(ids));

  const results = useQueries({
    queries: uniqueIds.map((id) => ({
      queryKey: sourceKeys.detail(id),
      queryFn: () => getSource(id),
    })),
  });

  const byId = new Map<string, Source>();
  uniqueIds.forEach((id, index) => {
    const data = results[index]?.data;
    if (data) {
      byId.set(id, data);
    }
  });

  return {
    byId,
    isLoading: results.some((result) => result.isLoading),
  };
}
