import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Pagination } from "../../design-system/Pagination";
import { Table } from "../../design-system/Table";
import { useSources } from "../source/queries";
import { ApiKeySecretDialog } from "./ApiKeySecretDialog";
import { useCreateApiKey, useRevokeApiKey } from "./mutations";
import { useApiKeys } from "./queries";
import { useSourcesByIds } from "./sourceResolution";
import { estadoDeClave, type ApiKeySortBy, type ApiKeyStatus, type SortOrder } from "./types";

const PAGE_SIZE = 20;

// Tope del backend para pageSize. Se pide el máximo de una sola vez para el
// select de creación: una organización con más de 100 fuentes de ingesta no es
// un escenario que exista hoy, y paginar un <select> sería resolver un problema
// que nadie tiene. Si alguna vez pasa, se nota — ver la nota de abajo.
const SOURCES_PARA_SELECT = 100;

// Lo que se muestra cuando una fuente no se pudo resolver (borrada después de
// crearse la clave, o un fallo puntual de esa request). Es lo mismo que hace
// ContactListPage con una Company que no resuelve.
const SIN_RESOLVER = "—";

interface SecretoVisible {
  key: string;
  sourceName: string;
}

export function ApiKeyListPage() {
  // El sourceId puede venir preseleccionado en la URL: es el cross-link "Ver
  // claves" de SourceListPage. Vive en la URL y no en estado local justamente
  // para que ese link pueda armarlo.
  const [searchParams, setSearchParams] = useSearchParams();
  const sourceIdFiltro = searchParams.get("sourceId") ?? "";

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ApiKeyStatus | "">("");
  const [sortBy, setSortBy] = useState<ApiKeySortBy>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  // Fuente elegida en el control de creación. Arranca en la del filtro si vino
  // por el cross-link: quien llegó desde una fuente concreta casi seguro quiere
  // crear una clave PARA esa fuente.
  const [sourceIdNueva, setSourceIdNueva] = useState(sourceIdFiltro);
  const [secreto, setSecreto] = useState<SecretoVisible | null>(null);

  const sourcesQuery = useSources({ page: 1, pageSize: SOURCES_PARA_SELECT });
  const apiKeysQuery = useApiKeys({
    page,
    pageSize: PAGE_SIZE,
    sourceId: sourceIdFiltro || undefined,
    status: status || undefined,
    sortBy,
    sortOrder,
  });

  // Las fuentes que alimentan los dos <select> de la pantalla. Se declara acá
  // arriba, antes de los handlers, porque handleCreate la necesita — ver
  // nombreDeFuenteElegida.
  const fuentes = sourcesQuery.data?.data ?? [];

  // Solo los sourceId de las claves visibles en ESTA página — nunca "todas las
  // fuentes". Deduplicado dentro del hook.
  const sourceIdsVisibles = apiKeysQuery.data?.data.map((apiKey) => apiKey.sourceId) ?? [];
  const sourceResolution = useSourcesByIds(sourceIdsVisibles);

  const createApiKeyMutation = useCreateApiKey();
  const revokeApiKeyMutation = useRevokeApiKey();

  // Para las FILAS DE LA TABLA: resuelve contra los nombres traídos por
  // useSourcesByIds, que son exactamente los de las claves visibles.
  function nombreDeFuente(sourceId: string): string {
    return sourceResolution.byId.get(sourceId)?.name ?? SIN_RESOLVER;
  }

  // Para la fuente RECIÉN ELEGIDA en el control de creación, que es un problema
  // distinto y no se puede resolver con el hook de arriba.
  //
  // sourceResolution solo conoce las fuentes de las claves que YA están en la
  // página visible del listado. La fuente que alguien acaba de elegir no tiene
  // por qué estar entre esas — el caso más común es justamente crear la PRIMERA
  // clave de una fuente recién dada de alta, que no tiene ninguna fila todavía.
  // Buscar ahí devolvía "—" aunque el nombre estuviera cargado en memoria.
  //
  // `fuentes` es la lista que alimenta el propio <select>, así que sourceIdNueva
  // es por construcción uno de sus elementos: el nombre siempre está, sin ir a
  // la red.
  function nombreDeFuenteElegida(sourceId: string): string {
    return fuentes.find((source) => source.id === sourceId)?.name ?? SIN_RESOLVER;
  }

  function cambiarFiltroDeFuente(nuevo: string) {
    // Se reescribe la URL en vez de guardar el filtro en estado: así el link es
    // compartible y el botón "atrás" del navegador funciona.
    if (nuevo) {
      setSearchParams({ sourceId: nuevo });
    } else {
      setSearchParams({});
    }
    setPage(1);
  }

  async function handleCreate() {
    if (!sourceIdNueva) return;
    try {
      const creada = await createApiKeyMutation.mutateAsync({ sourceId: sourceIdNueva });
      // El secreto vive ACÁ y en ningún otro lado. Al cerrar el modal se pone en
      // null y desaparece del árbol; no se guarda en cache ni se persiste.
      setSecreto({ key: creada.key, sourceName: nombreDeFuenteElegida(creada.sourceId) });
    } catch {
      // El error ya queda en createApiKeyMutation.isError y se muestra abajo —
      // no hace falta duplicarlo en estado local. El catch existe para que la
      // promesa rechazada no quede sin manejar.
    }
  }

  function handleRevoke(id: string) {
    if (
      !window.confirm(
        "¿Revocar esta clave? Deja de funcionar de inmediato y no se puede volver atrás.",
      )
    ) {
      return;
    }
    revokeApiKeyMutation.mutate(id);
  }

  return (
    <div>
      <div className="ds-page-header">
        <h1>Claves de ingesta</h1>
      </div>

      {/* CREACIÓN SIN PANTALLA APARTE: es un solo campo. Un formulario en su
          propia ruta sería una pantalla entera para elegir una fuente. */}
      <div className="ds-filters">
        <label>
          Fuente para la clave nueva
          <select
            value={sourceIdNueva}
            onChange={(event) => setSourceIdNueva(event.target.value)}
            disabled={createApiKeyMutation.isPending}
          >
            <option value="">Elegir fuente…</option>
            {fuentes.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="primary"
          disabled={!sourceIdNueva || createApiKeyMutation.isPending}
          onClick={() => void handleCreate()}
        >
          {createApiKeyMutation.isPending ? "Creando…" : "Crear clave"}
        </Button>
      </div>

      {sourcesQuery.isSuccess && sourcesQuery.data.pagination.total > SOURCES_PARA_SELECT ? (
        <p className="ds-hint">
          Se muestran las primeras {SOURCES_PARA_SELECT} fuentes de{" "}
          {sourcesQuery.data.pagination.total}.
        </p>
      ) : null}

      {createApiKeyMutation.isError ? (
        <ErrorState>
          No pudimos crear la clave
          {createApiKeyMutation.error instanceof Error
            ? `: ${createApiKeyMutation.error.message}`
            : "."}
        </ErrorState>
      ) : null}

      <div className="ds-filters">
        <label>
          Fuente
          <select
            value={sourceIdFiltro}
            onChange={(event) => cambiarFiltroDeFuente(event.target.value)}
          >
            <option value="">Todas</option>
            {fuentes.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Estado
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as ApiKeyStatus | "");
              setPage(1);
            }}
          >
            <option value="">Todas</option>
            <option value="ACTIVE">Activas</option>
            <option value="REVOKED">Revocadas</option>
          </select>
        </label>
        <label>
          Ordenar por
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as ApiKeySortBy)}
          >
            <option value="createdAt">Fecha de creación</option>
            <option value="lastUsedAt">Último uso</option>
          </select>
        </label>
        <label>
          Orden
          <select
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value as SortOrder)}
          >
            <option value="desc">Descendente</option>
            <option value="asc">Ascendente</option>
          </select>
        </label>
      </div>

      {apiKeysQuery.isLoading ? <LoadingState /> : null}

      {apiKeysQuery.isError ? (
        <ErrorState>
          No pudimos cargar las claves
          {apiKeysQuery.error instanceof Error ? `: ${apiKeysQuery.error.message}` : "."}
        </ErrorState>
      ) : null}

      {revokeApiKeyMutation.isError ? (
        <ErrorState>
          No pudimos revocar la clave
          {revokeApiKeyMutation.error instanceof Error
            ? `: ${revokeApiKeyMutation.error.message}`
            : "."}
        </ErrorState>
      ) : null}

      {apiKeysQuery.isSuccess && apiKeysQuery.data.data.length === 0 ? (
        <EmptyState>No hay claves para mostrar.</EmptyState>
      ) : null}

      {apiKeysQuery.isSuccess && apiKeysQuery.data.data.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <th>Fuente</th>
              <th>Prefijo</th>
              <th>Estado</th>
              <th>Último uso</th>
              <th>Creada</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {apiKeysQuery.data.data.map((apiKey) => {
              const estado = estadoDeClave(apiKey);
              return (
                <tr key={apiKey.id}>
                  <td>{nombreDeFuente(apiKey.sourceId)}</td>
                  <td>
                    <code>{apiKey.keyPrefix}…</code>
                  </td>
                  <td>{estado === "ACTIVE" ? "Activa" : "Revocada"}</td>
                  <td>
                    {apiKey.lastUsedAt ? new Date(apiKey.lastUsedAt).toLocaleString() : "Nunca"}
                  </td>
                  <td>{new Date(apiKey.createdAt).toLocaleDateString()}</td>
                  <td>
                    {/* Una clave revocada no ofrece revocar de nuevo. El backend
                        lo maneja con un 409, pero ofrecer una acción que solo
                        puede fallar es peor que no ofrecerla. */}
                    {estado === "ACTIVE" ? (
                      <Button variant="danger" onClick={() => handleRevoke(apiKey.id)}>
                        Revocar
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : null}

      {apiKeysQuery.isSuccess ? (
        <Pagination
          page={page}
          totalPages={apiKeysQuery.data.pagination.totalPages}
          onPrevious={() => setPage((current) => current - 1)}
          onNext={() => setPage((current) => current + 1)}
        />
      ) : null}

      {secreto ? (
        <ApiKeySecretDialog
          apiKey={secreto.key}
          sourceName={secreto.sourceName}
          onClose={() => setSecreto(null)}
        />
      ) : null}
    </div>
  );
}
