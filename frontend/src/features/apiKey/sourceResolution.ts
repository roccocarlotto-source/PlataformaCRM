import { useQueries } from "@tanstack/react-query";
import { getSource } from "../source/api";
import { sourceKeys } from "../source/queries";
import type { Source } from "../source/types";

// Resuelve el NOMBRE de las fuentes de las claves visibles — G-9 de
// docs/research-frontend-ingesta-2026-08-27.md: el listado de ApiKey trae
// `sourceId` y no la relación, así que "clave de Landing de precios" hay que
// armarlo del lado del cliente.
//
// Calcado de useCompaniesByIds (features/contact/companyResolution.ts), que
// existe para el mismo problema en Contact -> Company. Se replica en vez de
// generalizarse: son doce líneas y una abstracción sobre dos casos elegiría mal
// qué parametrizar.
//
// NUNCA UN REQUEST POR FILA. Se deduplica por id, así que una página con veinte
// claves de la misma fuente dispara UNA resolución, no veinte. Y sourceKeys.detail
// es la MISMA queryKey que usa useSource: si esa fuente ya se resolvió en la
// sesión —por el listado de fuentes, o por el select de creación de esta misma
// pantalla— se reutiliza del cache sin ir a la red.
//
// Un fallo individual no rompe el resto: useQueries no falla en bloque, cada
// entrada tiene su propio estado. Esa fuente simplemente no aparece en `byId` y
// el caller decide el fallback.
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
