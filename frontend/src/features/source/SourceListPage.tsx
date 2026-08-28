import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Pagination } from "../../design-system/Pagination";
import { Table } from "../../design-system/Table";
import { useDeleteSource } from "./mutations";
import { useSources } from "./queries";
import type { SourceSortBy, SourceType, SortOrder } from "./types";

const PAGE_SIZE = 20;

const ETIQUETA_DE_TIPO: Record<SourceType, string> = {
  WEBHOOK: "Webhook",
  FILE_IMPORT: "Importación de archivo",
  EXTERNAL_DB: "Base externa",
};

// SIN el gate `isAdmin` que usan CompanyListPage/ContactListPage, y no es una
// omisión: en esos módulos la LECTURA es abierta y solo la escritura es
// ADMIN-only, así que ocultar los botones a un USER tiene sentido. Acá las cinco
// rutas de /api/sources son ADMIN-only, lectura incluida (source.routes.ts), y
// esta pantalla vive dentro de AdminRoute — un USER no llega nunca. Un
// `isAdmin ?` acá sería una condición que jamás evalúa a false, o sea código
// muerto que sugiere una posibilidad que no existe. Mismo criterio que
// UserListPage e InvitationListPage.
export function SourceListPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<SourceType | "">("");
  // "" = sin filtro. No se usa `boolean | undefined` en el estado porque el
  // value de un <select> es siempre string; la traducción a boolean ocurre una
  // sola vez, al armar la query.
  const [isActive, setIsActive] = useState<"" | "true" | "false">("");
  const [sortBy, setSortBy] = useState<SourceSortBy>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const sourcesQuery = useSources({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    type: type || undefined,
    isActive: isActive === "" ? undefined : isActive === "true",
    sortBy,
    sortOrder,
  });

  const deleteSourceMutation = useDeleteSource();

  function handleDelete(id: string) {
    // window.confirm, igual que Company/Contact. No hay modal de confirmación en
    // el proyecto y esta pantalla no es el lugar para estrenar uno.
    if (
      !window.confirm(
        "¿Retirar esta fuente? Sus claves de ingesta se revocan y dejan de funcionar.",
      )
    ) {
      return;
    }
    deleteSourceMutation.mutate(id);
  }

  return (
    <div>
      <div className="ds-page-header">
        <h1>Fuentes de ingesta</h1>
        <Link to="/sources/new" className="ds-link-button">
          Nueva fuente
        </Link>
      </div>

      <div className="ds-filters">
        <label>
          Buscar
          <input
            type="search"
            placeholder="Buscar por nombre"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Tipo
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value as SourceType | "");
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            <option value="WEBHOOK">Webhook</option>
            <option value="FILE_IMPORT">Importación de archivo</option>
            <option value="EXTERNAL_DB">Base externa</option>
          </select>
        </label>
        <label>
          Estado
          <select
            value={isActive}
            onChange={(event) => {
              setIsActive(event.target.value as "" | "true" | "false");
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            <option value="true">Activas</option>
            <option value="false">Pausadas</option>
          </select>
        </label>
        <label>
          Ordenar por
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as SourceSortBy)}
          >
            <option value="createdAt">Fecha de creación</option>
            <option value="name">Nombre</option>
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

      {sourcesQuery.isLoading ? <LoadingState /> : null}

      {sourcesQuery.isError ? (
        <ErrorState>
          No pudimos cargar las fuentes
          {sourcesQuery.error instanceof Error ? `: ${sourcesQuery.error.message}` : "."}
        </ErrorState>
      ) : null}

      {deleteSourceMutation.isError ? (
        <ErrorState>
          No pudimos retirar la fuente
          {deleteSourceMutation.error instanceof Error
            ? `: ${deleteSourceMutation.error.message}`
            : "."}
        </ErrorState>
      ) : null}

      {sourcesQuery.isSuccess && sourcesQuery.data.data.length === 0 ? (
        <EmptyState>No hay fuentes para mostrar.</EmptyState>
      ) : null}

      {sourcesQuery.isSuccess && sourcesQuery.data.data.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Tipo</th>
              <th>Estado</th>
              <th>Creada</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {sourcesQuery.data.data.map((source) => (
              <tr key={source.id}>
                <td>{source.name}</td>
                <td>{ETIQUETA_DE_TIPO[source.type]}</td>
                <td>{source.isActive ? "Activa" : "Pausada"}</td>
                {/* toLocaleDateString sin locale explícito: usa el del navegador,
                    mismo criterio que el resto del proyecto para no fijar un
                    formato que no es una decisión de este módulo. */}
                <td>{new Date(source.createdAt).toLocaleDateString()}</td>
                <td>
                  <Link to={`/sources/${source.id}/edit`}>Editar</Link>{" "}
                  {/* Cross-link a las claves de ESTA fuente, con el filtro ya
                      aplicado. El filtro de ApiKeyListPage vive en la URL
                      justamente para que este link pueda armarlo. */}
                  <Link to={`/api-keys?sourceId=${source.id}`}>Ver claves</Link>{" "}
                  {/* Solo en las FILE_IMPORT, a diferencia de "Ver claves":
                      importar contra otro tipo daría un 400 garantizado
                      (import.service.ts), mientras que un listado de claves
                      vacío no es un error sino un resultado válido. */}
                  {source.type === "FILE_IMPORT" ? (
                    <>
                      <Link to={`/sources/${source.id}/import`}>Importar archivo</Link>{" "}
                    </>
                  ) : null}
                  <Button variant="danger" onClick={() => handleDelete(source.id)}>
                    Eliminar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}

      {sourcesQuery.isSuccess ? (
        <Pagination
          page={page}
          totalPages={sourcesQuery.data.pagination.totalPages}
          onPrevious={() => setPage((current) => current - 1)}
          onNext={() => setPage((current) => current + 1)}
        />
      ) : null}
    </div>
  );
}
