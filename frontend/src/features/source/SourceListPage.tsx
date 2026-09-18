import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { ActionsMenu } from "../../design-system/ActionsMenu";
import { DetailList } from "../../design-system/DetailList";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Modal } from "../../design-system/Modal";
import { Pagination } from "../../design-system/Pagination";
import { Select } from "../../design-system/Select";
import { SortOrderSelect } from "../../design-system/SortOrderSelect";
import { Table } from "../../design-system/Table";
import { useDeleteSource } from "./mutations";
import { useSources } from "./queries";
import { ETIQUETA_DE_CAMPO } from "./types";
import type { FieldMapping, SourceSortBy, SourceType, SortOrder } from "./types";

const PAGE_SIZE = 20;

const ETIQUETA_DE_TIPO: Record<SourceType, string> = {
  WEBHOOK: "Webhook",
  FILE_IMPORT: "Importación de archivo",
  EXTERNAL_DB: "Base externa",
};

// El mapeo de columnas del formulario (FieldMappingEditor), en solo lectura:
// una línea por columna, "encabezado del archivo → campo de Contact" con la
// misma etiqueta que el editor muestra en su <select>. Sin filas, vacío (y
// DetailList lo dibuja como "—").
function describirMapeo(fieldMapping: FieldMapping | null): string {
  if (!fieldMapping) return "";
  return Object.entries(fieldMapping)
    .map(([encabezado, campo]) => `${encabezado} → ${ETIQUETA_DE_CAMPO[campo]}`)
    .join("\n");
}

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
  // Id de la fila cuyo pop up "Ver detalle" está abierto (§28). Estado local y
  // no una ruta: el detalle no tiene URL propia, decisión tomada en el ítem.
  const [detalleAbierto, setDetalleAbierto] = useState<string | null>(null);

  const sourcesQuery = useSources({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    type: type || undefined,
    isActive: isActive === "" ? undefined : isActive === "true",
    sortBy,
    sortOrder,
  });

  // La fila del detalle sale del array ya cargado, sin un GET aparte: el
  // listado trae el objeto Source completo, fieldMapping incluido (§28). Si
  // la fila desaparece (se retiró, cambió la página) el pop up se cierra solo.
  const detalle = sourcesQuery.data?.data.find((source) => source.id === detalleAbierto);

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
          <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
          Nueva fuente
        </Link>
      </div>

      <div className="ds-list-card">
        <h2 className="ds-filters-title">Filtros</h2>
        <div className="ds-filters">
          <label>
            {/* Solo para lectores de pantalla: el placeholder ya dice "Buscar…" y el
                rótulo visible lo repetía (docs/frontend-cambios-pendientes.md §4.b). */}
            <span className="ds-sr-only">Buscar</span>
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
          <Select
            label="Tipo"
            value={type}
            options={[
              { value: "WEBHOOK", label: "Webhook" },
              { value: "FILE_IMPORT", label: "Importación de archivo" },
              { value: "EXTERNAL_DB", label: "Base externa" },
            ]}
            emptyOption={{ label: "Todos" }}
            onChange={(value) => {
              setType(value);
              setPage(1);
            }}
          />
          <Select
            label="Estado"
            value={isActive}
            options={[
              { value: "true", label: "Activas" },
              { value: "false", label: "Pausadas" },
            ]}
            emptyOption={{ label: "Todos" }}
            onChange={(value) => {
              setIsActive(value);
              setPage(1);
            }}
          />
          <Select
            label="Ordenar por"
            value={sortBy}
            options={[
              { value: "createdAt", label: "Fecha de creación" },
              { value: "name", label: "Nombre" },
            ]}
            onChange={(value) => {
              if (value) setSortBy(value);
            }}
          />
          <SortOrderSelect value={sortOrder} onChange={setSortOrder} />
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
                    <ActionsMenu
                      actions={[
                        // Primero "Ver detalle": la acción de consulta, antes
                        // que las de escritura y los cross-links (§28).
                        {
                          label: "Ver detalle",
                          onClick: () => setDetalleAbierto(source.id),
                        },
                        { label: "Editar", to: `/sources/${source.id}/edit` },
                        // Cross-link a las claves de ESTA fuente, con el filtro ya
                        // aplicado. El filtro de ApiKeyListPage vive en la URL
                        // justamente para que este link pueda armarlo.
                        { label: "Ver claves", to: `/api-keys?sourceId=${source.id}` },
                        // Solo en las FILE_IMPORT, a diferencia de "Ver claves":
                        // importar contra otro tipo daría un 400 garantizado
                        // (import.service.ts), mientras que un listado de claves
                        // vacío no es un error sino un resultado válido.
                        ...(source.type === "FILE_IMPORT"
                          ? [{ label: "Importar archivo", to: `/sources/${source.id}/import` }]
                          : []),
                        // Sin condicionar por tipo, a diferencia de "Importar
                        // archivo": CUALQUIER fuente puede tener eventos — un
                        // webhook los genera de a uno, una FILE_IMPORT por lote — así
                        // que el listado filtrado siempre tiene sentido, aunque
                        // devuelva vacío.
                        { label: "Ver eventos", to: `/ingestion-events?sourceId=${source.id}` },
                        {
                          label: "Eliminar",
                          onClick: () => handleDelete(source.id),
                          destructive: true,
                        },
                      ]}
                    />
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

      {/* Los mismos campos que SourceFormPage, en solo lectura: el mapeo de
          columnas solo en las FILE_IMPORT, como el editor del formulario (el
          backend lo rechaza en cualquier otro tipo), y la fecha de creación
          con el mismo formato que la columna "Creada". */}
      {detalle ? (
        <Modal
          variant="dialog"
          title="Detalle de la fuente"
          onClose={() => setDetalleAbierto(null)}
        >
          <DetailList
            sections={[
              {
                items: [
                  { label: "Nombre", value: detalle.name },
                  { label: "Tipo", value: ETIQUETA_DE_TIPO[detalle.type] },
                  { label: "Estado", value: detalle.isActive ? "Activa" : "Pausada" },
                  ...(detalle.type === "FILE_IMPORT"
                    ? [{ label: "Mapeo de columnas", value: describirMapeo(detalle.fieldMapping) }]
                    : []),
                  { label: "Creada", value: new Date(detalle.createdAt).toLocaleDateString() },
                ],
              },
            ]}
          />
        </Modal>
      ) : null}
    </div>
  );
}
