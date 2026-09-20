import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, RefreshCw } from "lucide-react";
import { ActionsMenu } from "../../design-system/ActionsMenu";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { BulkSelectionBar } from "../../design-system/BulkSelectionBar";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Pagination } from "../../design-system/Pagination";
import { Select } from "../../design-system/Select";
import { SortOrderSelect } from "../../design-system/SortOrderSelect";
import { Table } from "../../design-system/Table";
import { deleteInBulk } from "../../lib/bulkDelete";
import { useBulkSelection } from "../../lib/useBulkSelection";
import { BranchSelect } from "../branch/BranchSelect";
import { BRANCHES_PARA_SELECT, useBranches } from "../branch/queries";
import { useDeleteKnowledgeBaseEntry, useSyncKnowledgeBaseVehicles } from "./mutations";
import { useKnowledgeBaseEntries } from "./queries";
import type { KnowledgeBaseSortBy, SortOrder } from "./types";

const PAGE_SIZE = 20;

// Lo que se muestra cuando una sucursal no se pudo resolver (fuera de las
// primeras 100, o un fallo puntual de esa request) — mismo criterio que
// AgentListPage y QrListPage.
const SIN_RESOLVER = "—";

// Ítem 70 — lo que se pregunta antes de sincronizar. window.confirm, igual que
// el borrado: la sincronización REESCRIBE el contenido de las entradas
// generadas y da de baja las de las unidades que ya no califican, y eso no se
// deshace desde ningún lado.
const CONFIRMAR_SINCRONIZAR =
  "Se van a crear, actualizar y dar de baja entradas de esta sucursal según el stock " +
  "publicado. Las entradas escritas a mano no se tocan. ¿Seguimos?";

// El resumen de una corrida, en una frase. Los tres números son de ENTRADAS,
// no de vehículos, y por eso no se suman en un total: una unidad puede no
// haber generado ningún cambio.
function textoDelResultado(resultado: {
  creadas: number;
  actualizadas: number;
  dadasDeBaja: number;
}): string {
  const { creadas, actualizadas, dadasDeBaja } = resultado;
  if (creadas === 0 && actualizadas === 0 && dadasDeBaja === 0) {
    return "El stock de esta sucursal ya estaba al día: no hubo cambios.";
  }
  return (
    `Stock sincronizado: ${creadas} ${creadas === 1 ? "entrada nueva" : "entradas nuevas"}, ` +
    `${actualizadas} ${actualizadas === 1 ? "actualizada" : "actualizadas"} y ` +
    `${dadasDeBaja} ${dadasDeBaja === 1 ? "dada de baja" : "dadas de baja"}.`
  );
}

// SIN el gate `isAdmin` que usan CompanyListPage/ContactListPage, mismo
// criterio que AgentListPage y BranchListPage: la pantalla entera vive dentro
// de AdminRoute (ver app/router.tsx), así que un `isAdmin ?` sería una
// condición que nunca evalúa a false. GET /api/knowledge-base sí es de lectura
// abierta a cualquier autenticado, pero hoy no hay ninguna pantalla que le
// muestre estas entradas a un USER — quien las "lee" de verdad es el agente,
// del lado del backend.
//
// SIN columna de contenido: son hasta 10.000 caracteres por entrada y un
// recorte en la tabla no dice nada que el título no diga mejor. Para leerlo
// está el formulario.
//
// Ítem 64 — selección múltiple: la casilla va en la PRIMERA COLUMNA, que es
// donde la espera cualquiera que haya usado una tabla con selección (en la
// galería de fotos del vehículo va al lado de la foto, porque ahí lo que se
// tilda es una miniatura, no una fila). La del encabezado tilda lo que está a
// la vista y nada más: la selección no cruza páginas, y el backend borra de a
// uno.
export function KnowledgeBaseListPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  const [isActive, setIsActive] = useState<"" | "true" | "false">("");
  const [sortBy, setSortBy] = useState<KnowledgeBaseSortBy>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const entriesQuery = useKnowledgeBaseEntries({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    branchId,
    isActive: isActive === "" ? undefined : isActive === "true",
    sortBy,
    sortOrder,
  });

  // Exactamente la misma query que BranchSelect (mismo key): una sola request
  // alimenta el filtro y la resolución de nombres de las filas, igual que en
  // AgentListPage.
  const branchesQuery = useBranches(BRANCHES_PARA_SELECT);
  const nombreDeSucursal = new Map(
    (branchesQuery.data?.data ?? []).map((branch) => [branch.id, branch.name]),
  );

  const deleteEntryMutation = useDeleteKnowledgeBaseEntry();
  const syncMutation = useSyncKnowledgeBaseVehicles();
  // El resumen de la última corrida. Se queda a la vista hasta la próxima (no
  // es un toast que se va solo): son tres números que alguien puede querer
  // leer dos veces, y el cambio que describen no se ve entero en la tabla.
  const [resultadoSync, setResultadoSync] = useState<string | null>(null);

  const entries = entriesQuery.data?.data ?? [];
  const seleccion = useBulkSelection(entries.map((entry) => entry.id));
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const isBusy = deleteEntryMutation.isPending || isBulkDeleting || syncMutation.isPending;

  // Cambiar de página o de filtro deja fuera de la vista lo que estaba
  // tildado. La selección se limpia junto con la navegación en vez de
  // arrastrarse: volver a la página anterior y encontrarla todavía marcada
  // sorprendería, y peor aún sería un botón "Eliminar seleccionadas" que
  // cuente filas que no se ven.
  function irAPagina(nueva: number) {
    setPage(nueva);
    seleccion.clear();
  }

  function aplicarFiltro(cambio: () => void) {
    cambio();
    setPage(1);
    seleccion.clear();
  }

  function handleDelete(id: string) {
    // window.confirm, igual que Agent/Branch/Source. El borrado es lógico; lo
    // que se dice acá es la consecuencia que no se ve en la pantalla: los
    // agentes de esa sucursal dejan de tener esa información.
    if (
      !window.confirm(
        "¿Eliminar esta entrada? Los agentes de esa sucursal dejan de usarla para responder.",
      )
    ) {
      return;
    }
    deleteEntryMutation.mutate(id);
  }

  // -------------------------------------------------------------------------
  // Sincronizar el stock de la sucursal elegida (ítem 70).
  //
  // EXIGE UNA SUCURSAL porque la operación es por sucursal: la base de
  // conocimiento cuelga de una, el stock también, y el agente que la lee
  // también. Sin sucursal elegida el botón está deshabilitado y el hint dice
  // qué falta, en vez de sincronizar "todas" —que sería otra operación, con
  // otro costo y otra confirmación.
  //
  // El listado se refetchea solo: la mutation invalida las listas del módulo.
  // -------------------------------------------------------------------------
  async function handleSync() {
    if (!branchId) return;
    if (!window.confirm(CONFIRMAR_SINCRONIZAR)) return;

    setResultadoSync(null);
    try {
      const resultado = await syncMutation.mutateAsync(branchId);
      setResultadoSync(textoDelResultado(resultado));
    } catch {
      // El error se muestra con el mensaje crudo de la API en su propio
      // ErrorState, igual que el del borrado; acá solo hay que asegurarse de
      // no dejar colgado el resumen de una corrida anterior.
      setResultadoSync(null);
    }
  }

  async function handleBulkDelete() {
    const ids = seleccion.selectedIds;
    if (ids.length === 0) return;
    // La misma consecuencia que nombra el borrado individual, en plural: las
    // entradas seleccionadas pueden ser de sucursales distintas.
    const pregunta =
      ids.length === 1
        ? "¿Eliminar la entrada seleccionada? Los agentes de esa sucursal dejan de usarla para responder."
        : `¿Eliminar las ${ids.length} entradas seleccionadas? Los agentes de esas sucursales dejan de usarlas para responder.`;
    if (!window.confirm(pregunta)) return;

    setBulkError(null);
    setIsBulkDeleting(true);
    const { failed } = await deleteInBulk(ids, (id) => deleteEntryMutation.mutateAsync(id));
    setIsBulkDeleting(false);

    // Las que fallaron quedan tildadas para reintentar; las demás ya no están
    // en la lista.
    seleccion.select(failed);
    setBulkError(
      failed.length > 0
        ? `No se pudieron eliminar ${failed.length} de ${ids.length} ${
            ids.length === 1 ? "entrada" : "entradas"
          }. Siguen seleccionadas para reintentar.`
        : null,
    );
  }

  const seleccionadas = seleccion.selectedIds.length;

  return (
    <div>
      <div className="ds-page-header">
        <h1>Base de conocimiento</h1>
        {/* Dos acciones en el header por primera vez en el proyecto. El
            envoltorio reusa .ds-card-actions —un flex con wrap y gap que ya
            existe y que usan la galería de fotos y el formulario de vehículo—
            en vez de sumar una clase nueva al design system para acomodar dos
            botones. */}
        <div className="ds-card-actions">
          <Button onClick={() => void handleSync()} disabled={!branchId || isBusy}>
            <RefreshCw size={16} strokeWidth={1.5} aria-hidden="true" />
            {syncMutation.isPending ? "Sincronizando…" : "Sincronizar stock"}
          </Button>
          <Link to="/knowledge-base/new" className="ds-link-button">
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            Nueva entrada
          </Link>
        </div>
      </div>

      <div className="ds-list-card">
        <h2 className="ds-filters-title">Filtros</h2>
        <div className="ds-filters">
          <label>
            {/* Solo para lectores de pantalla: el placeholder ya dice qué
                busca (docs/frontend-cambios-pendientes.md §4.b). */}
            <span className="ds-sr-only">Buscar</span>
            <input
              type="search"
              placeholder="Buscar por título"
              value={search}
              onChange={(event) => aplicarFiltro(() => setSearch(event.target.value))}
            />
          </label>
          <BranchSelect
            id="knowledge-base-list-branch"
            label="Sucursal"
            value={branchId}
            emptyOptionLabel="Todas"
            onChange={(nuevo) => aplicarFiltro(() => setBranchId(nuevo || undefined))}
          />
          <Select
            label="Estado"
            value={isActive}
            options={[
              { value: "true", label: "Activas" },
              { value: "false", label: "Inactivas" },
            ]}
            emptyOption={{ label: "Todas" }}
            onChange={(value) => aplicarFiltro(() => setIsActive(value))}
          />
          <Select
            label="Ordenar por"
            value={sortBy}
            options={[
              { value: "createdAt", label: "Fecha de creación" },
              { value: "title", label: "Título" },
            ]}
            onChange={(value) => {
              if (value) setSortBy(value);
              seleccion.clear();
            }}
          />
          <SortOrderSelect
            value={sortOrder}
            onChange={(value) => {
              setSortOrder(value);
              seleccion.clear();
            }}
          />
        </div>

        {/* El porqué del botón deshabilitado, al lado del filtro que lo
            habilita y no arriba junto al botón: lo que falta elegir es
            justamente esta Sucursal. */}
        {!branchId ? (
          <p className="ds-hint">Elegí una sucursal para sincronizar su stock.</p>
        ) : null}

        {/* role="status" para que un lector de pantalla anuncie el resultado:
            la corrida no navega a ningún lado y el cambio en la tabla puede
            ser de una fila entre veinte. */}
        {resultadoSync ? (
          <p className="ds-hint" role="status">
            {resultadoSync}
          </p>
        ) : null}

        {syncMutation.isError ? (
          <ErrorState>
            No pudimos sincronizar el stock
            {syncMutation.error instanceof Error ? `: ${syncMutation.error.message}` : "."}
          </ErrorState>
        ) : null}

        {entriesQuery.isLoading ? <LoadingState /> : null}

        {entriesQuery.isError ? (
          <ErrorState>
            No pudimos cargar la base de conocimiento
            {entriesQuery.error instanceof Error ? `: ${entriesQuery.error.message}` : "."}
          </ErrorState>
        ) : null}

        {deleteEntryMutation.isError ? (
          <ErrorState>
            No pudimos eliminar la entrada
            {deleteEntryMutation.error instanceof Error
              ? `: ${deleteEntryMutation.error.message}`
              : "."}
          </ErrorState>
        ) : null}

        {/* Aparte del error de arriba, que muestra el mensaje crudo del último
            DELETE que falló: este dice cuántas del lote no se pudieron
            borrar. */}
        {bulkError ? <ErrorState>{bulkError}</ErrorState> : null}

        {seleccionadas > 0 ? (
          <BulkSelectionBar
            label={
              seleccionadas === 1
                ? "1 entrada seleccionada"
                : `${seleccionadas} entradas seleccionadas`
            }
            onDelete={handleBulkDelete}
            onCancel={seleccion.clear}
            disabled={isBusy}
          />
        ) : null}

        {entriesQuery.isSuccess && entries.length === 0 ? (
          <EmptyState>No hay entradas para mostrar.</EmptyState>
        ) : null}

        {entriesQuery.isSuccess && entries.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th className="ds-cell-pick">
                  {/* El <th> queda sin texto a propósito: el nombre accesible
                      lo pone el aria-label de la casilla, y así cellByHeader
                      (test/cellByHeader.ts) sigue ubicando las demás columnas
                      por su rótulo. `indeterminate` no es un atributo de HTML,
                      solo una propiedad del DOM: se escribe por ref. */}
                  <input
                    type="checkbox"
                    checked={seleccion.allSelected}
                    ref={(node) => {
                      if (node) node.indeterminate = seleccion.someSelected;
                    }}
                    disabled={isBusy}
                    onChange={(event) => seleccion.toggleAll(event.target.checked)}
                    aria-label="Seleccionar todas las de esta página"
                  />
                </th>
                <th>Título</th>
                <th>Sucursal</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="ds-cell-pick">
                    <input
                      type="checkbox"
                      checked={seleccion.isSelected(entry.id)}
                      disabled={isBusy}
                      onChange={() => seleccion.toggle(entry.id)}
                      aria-label={`Seleccionar la entrada "${entry.title}"`}
                    />
                  </td>
                  <td className="ds-cell-primary">
                    {entry.title}{" "}
                    {/* Ítem 70 — una entrada generada por "Sincronizar stock"
                        se distingue de una escrita a mano, porque la próxima
                        corrida la va a reescribir. El dato es el
                        sourceVehicleId, no el título ni el texto. */}
                    {entry.sourceVehicleId !== null ? <Badge variant="info">Stock</Badge> : null}
                  </td>
                  <td>{nombreDeSucursal.get(entry.branchId) ?? SIN_RESOLVER}</td>
                  <td>
                    {/* Estado real y editable: una entrada inactiva existe,
                        se puede volver a activar, y simplemente no entra al
                        prompt de ningún agente de la sucursal. */}
                    <Badge variant={entry.isActive ? "success" : "neutral"}>
                      {entry.isActive ? "Activa" : "Inactiva"}
                    </Badge>
                  </td>
                  <td>
                    <ActionsMenu
                      actions={[
                        { label: "Editar", to: `/knowledge-base/${entry.id}/edit` },
                        {
                          label: "Eliminar",
                          onClick: () => handleDelete(entry.id),
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

        {entriesQuery.isSuccess ? (
          <Pagination
            page={page}
            totalPages={entriesQuery.data.pagination.totalPages}
            onPrevious={() => irAPagina(page - 1)}
            onNext={() => irAPagina(page + 1)}
          />
        ) : null}
      </div>
    </div>
  );
}
