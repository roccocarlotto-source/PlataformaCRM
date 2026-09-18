import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { ActionsMenu } from "../../design-system/ActionsMenu";
import { Badge } from "../../design-system/Badge";
import { DetailList } from "../../design-system/DetailList";
import { yesNo } from "../../design-system/detailFormat";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Modal } from "../../design-system/Modal";
import { Pagination } from "../../design-system/Pagination";
import { Table } from "../../design-system/Table";
import { useDeletePipeline } from "./mutations";
import { usePipelines } from "./queries";
import type { PipelineSortBy, SortOrder } from "./types";

const PAGE_SIZE = 20;

// Esta pantalla no tiene diseño de referencia entre las 17 exportadas
// ("Pipeline CRM" es un Kanban de oportunidades, otra cosa): restyle genérico
// con el sistema de diseño, mismas columnas y mismo orden que antes.
export function PipelineListPage() {
  const { me } = useAuth();
  // Ocultar acciones de escritura para no-ADMIN es cortesía de UX: la
  // autorización real la sigue aplicando authorize("ADMIN") en el backend.
  const isAdmin = me?.role === "ADMIN";

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<PipelineSortBy>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  // Id de la fila cuyo pop up "Ver detalle" está abierto (§28). Estado local y
  // no una ruta: el detalle no tiene URL propia, decisión tomada en el ítem.
  const [detalleAbierto, setDetalleAbierto] = useState<string | null>(null);

  const pipelinesQuery = usePipelines({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    sortBy,
    sortOrder,
  });

  // La fila del detalle sale del array ya cargado, sin un GET aparte: el
  // listado trae el objeto Pipeline completo (§28). Si la fila desaparece
  // (se eliminó, cambió la página) el pop up se cierra solo.
  const detalle = pipelinesQuery.data?.data.find((pipeline) => pipeline.id === detalleAbierto);

  const deletePipelineMutation = useDeletePipeline();

  function handleDelete(id: string) {
    if (!window.confirm("¿Eliminar este proceso de venta?")) return;
    deletePipelineMutation.mutate(id);
  }

  return (
    <div>
      <div className="ds-page-header">
        <h1>Procesos de venta</h1>
        {isAdmin ? (
          <Link to="/pipelines/new" className="ds-link-button">
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            Nuevo proceso de venta
          </Link>
        ) : null}
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
          <label>
            Ordenar por
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as PipelineSortBy)}
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

        {pipelinesQuery.isLoading ? <LoadingState /> : null}

        {pipelinesQuery.isError ? (
          <ErrorState>
            No pudimos cargar los procesos de venta
            {pipelinesQuery.error instanceof Error ? `: ${pipelinesQuery.error.message}` : "."}
          </ErrorState>
        ) : null}

        {deletePipelineMutation.isError ? (
          <ErrorState>
            No pudimos eliminar el proceso de venta
            {deletePipelineMutation.error instanceof Error
              ? `: ${deletePipelineMutation.error.message}`
              : "."}
          </ErrorState>
        ) : null}

        {pipelinesQuery.isSuccess && pipelinesQuery.data.data.length === 0 ? (
          <EmptyState>No hay procesos de venta para mostrar.</EmptyState>
        ) : null}

        {pipelinesQuery.isSuccess && pipelinesQuery.data.data.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Default</th>
                <th>Etapas</th>
                {isAdmin ? <th>Acciones</th> : null}
              </tr>
            </thead>
            <tbody>
              {pipelinesQuery.data.data.map((pipeline) => (
                <tr key={pipeline.id}>
                  <td>{pipeline.name}</td>
                  {/* Sin badge inventado cuando no es default: reflejar
                    fielmente que puede haber cero defaults (ver types.ts). */}
                  <td>{pipeline.isDefault ? <Badge variant="neutral">Default</Badge> : null}</td>
                  <td>
                    <Link to={`/pipelines/${pipeline.id}/stages`}>Ver etapas</Link>
                  </td>
                  {isAdmin ? (
                    <td>
                      <ActionsMenu
                        actions={[
                          // Primero "Ver detalle": la acción de consulta,
                          // antes que las de escritura (§28).
                          {
                            label: "Ver detalle",
                            onClick: () => setDetalleAbierto(pipeline.id),
                          },
                          { label: "Editar", to: `/pipelines/${pipeline.id}/edit` },
                          {
                            label: "Eliminar",
                            onClick: () => handleDelete(pipeline.id),
                            destructive: true,
                          },
                        ]}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}

        {pipelinesQuery.isSuccess ? (
          <Pagination
            page={page}
            totalPages={pipelinesQuery.data.pagination.totalPages}
            onPrevious={() => setPage((current) => current - 1)}
            onNext={() => setPage((current) => current + 1)}
          />
        ) : null}
      </div>

      {/* Los mismos campos que la tarjeta "Datos del proceso de venta" de
          PipelineFormPage, en solo lectura. Las etapas no son un campo del
          pipeline (el editor integrado del formulario es otra entidad) y
          tienen su propia pantalla, "Ver etapas". */}
      {detalle ? (
        <Modal
          variant="dialog"
          title="Detalle del proceso de venta"
          onClose={() => setDetalleAbierto(null)}
        >
          <DetailList
            sections={[
              {
                items: [
                  { label: "Nombre", value: detalle.name },
                  { label: "Default", value: yesNo(detalle.isDefault) },
                ],
              },
            ]}
          />
        </Modal>
      ) : null}
    </div>
  );
}
