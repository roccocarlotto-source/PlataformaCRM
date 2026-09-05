import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Pagination } from "../../design-system/Pagination";
import { Table } from "../../design-system/Table";
import { useSources } from "../source/queries";
import { useRetryIngestionEvent } from "./mutations";
import { useIngestionEvents } from "./queries";
import { useSourcesByIds } from "./sourceResolution";
import { ESTADOS, ETIQUETA_DE_ESTADO, type IngestionStatus, type SortOrder } from "./types";

const PAGE_SIZE = 20;

// Mismo tope que ApiKeyListPage: se pide el máximo del backend de una sola vez
// para el select de fuentes. Si una organización superara las 100, la pantalla
// lo dice en vez de truncar en silencio.
const SOURCES_PARA_SELECT = 100;

const SIN_RESOLVER = "—";

export function IngestionEventListPage() {
  // sourceId y batchId viven en la URL, no en estado local: es lo que permite
  // que los cross-links de SourceListPage ("Ver eventos") y de ImportPage ("Ver
  // estas filas") los precarguen, y de paso hace que el link sea compartible y
  // que el botón "atrás" funcione.
  const [searchParams, setSearchParams] = useSearchParams();
  const sourceIdFiltro = searchParams.get("sourceId") ?? "";
  const batchIdFiltro = searchParams.get("batchId") ?? "";

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<IngestionStatus | "">("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const sourcesQuery = useSources({ page: 1, pageSize: SOURCES_PARA_SELECT });
  const eventsQuery = useIngestionEvents({
    page,
    pageSize: PAGE_SIZE,
    sourceId: sourceIdFiltro || undefined,
    batchId: batchIdFiltro || undefined,
    status: status || undefined,
    sortOrder,
  });

  const retryMutation = useRetryIngestionEvent();

  // La lista que alimenta el <select> de filtro. Ya está en memoria.
  const fuentes = sourcesQuery.data?.data ?? [];

  // ---------------------------------------------------------------------
  // RESOLUCIÓN DE NOMBRES EN DOS PASOS — hallazgo E2-3 de
  // docs/review-fase2-2026-08-28.md.
  //
  // Hasta acá se le pasaban a useSourcesByIds TODOS los sourceId visibles, sin
  // mirar antes `fuentes` — que ya tiene hasta 100 fuentes cargadas para el
  // <select> de arriba. Una página con veinte eventos de veinte fuentes
  // distintas disparaba hasta veinte GET /sources/:id para resolver nombres que
  // ya estaban en memoria.
  //
  // Es el patrón que ApiKeyListPage ya aplicaba del otro lado
  // (nombreDeFuenteElegida busca en `fuentes` primero); acá faltaba.
  //
  // EL HOOK NO SE ELIMINA, y es el punto: `fuentes` trae las primeras
  // SOURCES_PARA_SELECT. La fuente número 101 no está ahí, así que sigue
  // necesitando el fallback por red. Lo que cambia es que deja de ser el
  // PRIMER recurso y pasa a ser el único para lo que realmente falta.
  // ---------------------------------------------------------------------
  const fuentesEnMemoria = new Map(fuentes.map((source) => [source.id, source.name]));

  const sourceIdsVisibles = eventsQuery.data?.data.map((evento) => evento.sourceId) ?? [];
  const sourceIdsSinResolver = sourceIdsVisibles.filter((id) => !fuentesEnMemoria.has(id));

  // Con la lista cargada y todas las fuentes adentro, esto recibe [] y
  // useQueries no dispara ningún request.
  const sourceResolution = useSourcesByIds(sourceIdsSinResolver);

  function nombreDeFuente(sourceId: string): string {
    // Memoria primero, red después. El orden es el arreglo.
    return (
      fuentesEnMemoria.get(sourceId) ?? sourceResolution.byId.get(sourceId)?.name ?? SIN_RESOLVER
    );
  }

  function cambiarFiltroDeFuente(nuevo: string) {
    // Se conserva el batchId si estaba: son dos filtros independientes y cambiar
    // uno no debería descartar el otro.
    const params = new URLSearchParams(searchParams);
    if (nuevo) {
      params.set("sourceId", nuevo);
    } else {
      params.delete("sourceId");
    }
    setSearchParams(params);
    setPage(1);
  }

  function limpiarFiltroDeLote() {
    const params = new URLSearchParams(searchParams);
    params.delete("batchId");
    setSearchParams(params);
    setPage(1);
  }

  return (
    <div>
      <div className="ds-page-header">
        <h1>Eventos de ingesta</h1>
      </div>

      {/* El batchId no tiene control para tipearlo: es un filtro de "llegué acá
          desde un link", no algo que alguien escriba. Pero si está aplicado hay
          que decirlo, o la lista parece incompleta sin explicación. */}
      {batchIdFiltro ? (
        <p className="ds-hint">
          Mostrando solo las filas del lote <code>{batchIdFiltro}</code>.{" "}
          <Button onClick={limpiarFiltroDeLote}>Ver todos los eventos</Button>
        </p>
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
              setStatus(event.target.value as IngestionStatus | "");
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            {ESTADOS.map((estado) => (
              <option key={estado} value={estado}>
                {ETIQUETA_DE_ESTADO[estado]}
              </option>
            ))}
          </select>
        </label>
        {/* Sin selector de "Ordenar por": el backend solo acepta createdAt. Un
            select con una sola opción sería ofrecer una elección que no existe. */}
        <label>
          Orden
          <select
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value as SortOrder)}
          >
            <option value="desc">Más recientes primero</option>
            <option value="asc">Más antiguos primero</option>
          </select>
        </label>
      </div>

      {sourcesQuery.isSuccess && sourcesQuery.data.pagination.total > SOURCES_PARA_SELECT ? (
        <p className="ds-hint">
          Se muestran las primeras {SOURCES_PARA_SELECT} fuentes de{" "}
          {sourcesQuery.data.pagination.total} en el filtro.
        </p>
      ) : null}

      {eventsQuery.isLoading ? <LoadingState /> : null}

      {eventsQuery.isError ? (
        <ErrorState>
          No pudimos cargar los eventos
          {eventsQuery.error instanceof Error ? `: ${eventsQuery.error.message}` : "."}
        </ErrorState>
      ) : null}

      {retryMutation.isError ? (
        <ErrorState>
          No pudimos reprocesar el evento
          {retryMutation.error instanceof Error ? `: ${retryMutation.error.message}` : "."}
        </ErrorState>
      ) : null}

      {eventsQuery.isSuccess && eventsQuery.data.data.length === 0 ? (
        <EmptyState>No hay eventos para mostrar.</EmptyState>
      ) : null}

      {eventsQuery.isSuccess && eventsQuery.data.data.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <th>Fuente</th>
              <th>Estado</th>
              <th>Motivo</th>
              <th>Creado</th>
              <th>Actualizado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {eventsQuery.data.data.map((evento) => (
              <tr key={evento.id}>
                <td>{nombreDeFuente(evento.sourceId)}</td>
                <td>{ETIQUETA_DE_ESTADO[evento.status]}</td>
                {/* errorMessage solo tiene contenido en FAILED: en el resto es
                    null y no hay nada que decir. */}
                <td className="ds-cell-truncate" title={evento.errorMessage ?? undefined}>
                  {evento.errorMessage ?? SIN_RESOLVER}
                </td>
                <td>{new Date(evento.createdAt).toLocaleString()}</td>
                <td>{new Date(evento.updatedAt).toLocaleString()}</td>
                <td>
                  {/* Cierra el círculo: esta fila se convirtió en este contacto.
                      Solo cuando hay uno — promotedContactId es null salvo en
                      PROCESSED. La ruta de edición ya existe. */}
                  {evento.promotedContactId ? (
                    <Link to={`/contacts/${evento.promotedContactId}/edit`}>Ver contacto</Link>
                  ) : null}{" "}
                  {/* Reintentar SOLO en FAILED, mismo criterio que "Revocar" en
                      ApiKeyListPage: el backend rechaza con 409 cualquier otro
                      estado, y ofrecer una acción que solo puede fallar es peor
                      que no ofrecerla.

                      SIN window.confirm, a diferencia de revocar o eliminar:
                      reintentar no es destructivo. Como mucho vuelve a fallar, y
                      el motivo anterior no se pierde para siempre — se reescribe
                      con el del intento nuevo. */}
                  {evento.status === "FAILED" ? (
                    /* SOLO LA FILA EN VUELO — hallazgo E2-4 de
                       docs/review-fase2-2026-08-28.md. `isPending` es un solo
                       booleano para toda la mutación, así que reintentar una
                       fila deshabilitaba el botón de las otras diecinueve.
                       `variables` es el argumento del mutate() en curso, o sea
                       el id del evento que realmente se está reintentando. */
                    <Button
                      disabled={retryMutation.isPending && retryMutation.variables === evento.id}
                      onClick={() => retryMutation.mutate(evento.id)}
                    >
                      Reintentar
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}

      {eventsQuery.isSuccess ? (
        <Pagination
          page={page}
          totalPages={eventsQuery.data.pagination.totalPages}
          onPrevious={() => setPage((current) => current - 1)}
          onNext={() => setPage((current) => current + 1)}
        />
      ) : null}
    </div>
  );
}
