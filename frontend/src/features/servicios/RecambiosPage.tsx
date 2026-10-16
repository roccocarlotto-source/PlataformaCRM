import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarClock } from "lucide-react";
import { Button } from "../../design-system/Button";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Notice } from "../../design-system/Notice";
import { PageHeader } from "../../design-system/PageHeader";
import { Pagination } from "../../design-system/Pagination";
import { Table } from "../../design-system/Table";
import { useBulkSelection } from "../../lib/useBulkSelection";
import { BranchSelect } from "../branch/BranchSelect";
import { AYUDA } from "../guia/anclas";
import { formatearFecha } from "./formato";
import { useRegistrarAvisosDeRecambio } from "./mutations";
import { useRecambiosVencidos } from "./queries";
import type { AccionDelRecambio } from "./types";

const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Taller → Recambios (docs/servicios.md §7.4, S13): los recambios vencidos sin
// contactar, sobre todo las ventas viejas cargadas al activar el módulo. De a
// 50, del más viejo al más nuevo (decisión de Rocco, 2026-10-15). Cada fila, o
// varias seleccionadas: "Crear tarea al vendedor" o "Marcar como contactado";
// las dos registran un aviso y la fila sale de la lista.
// ---------------------------------------------------------------------------

export function RecambiosPage() {
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [sucursal, setSucursal] = useState<string | undefined>(
    searchParams.get("branchId") ?? undefined,
  );
  const [aviso, setAviso] = useState<{ tono: "info" | "warning"; texto: string } | null>(null);
  const recambios = useRecambiosVencidos({ page, pageSize: PAGE_SIZE, branchId: sucursal });
  const filas = recambios.data?.data ?? [];
  const seleccion = useBulkSelection(filas.map((f) => f.id));
  const registrar = useRegistrarAvisosDeRecambio();

  const aplicar = (vehiculoIds: string[], accion: AccionDelRecambio) => {
    setAviso(null);
    registrar.mutate(
      { vehiculoIds, accion },
      {
        onSuccess: ({ resultados }) => {
          const fallidos = resultados.filter((r) => !r.ok);
          const hechos = resultados.length - fallidos.length;
          seleccion.clear();
          const que = accion === "TAREA" ? "Tarea creada" : "Marcado como contactado";
          setAviso(
            fallidos.length === 0
              ? { tono: "info", texto: hechos === 1 ? `${que}.` : `${que}: ${String(hechos)}.` }
              : {
                  tono: "warning",
                  texto: `${String(hechos)} listos; ${String(fallidos.length)} no se pudieron: ${fallidos[0].error ?? "error"}`,
                },
          );
        },
        onError: (error) =>
          setAviso({
            tono: "warning",
            texto: error instanceof Error ? error.message : "No se pudo registrar.",
          }),
      },
    );
  };

  const seleccionadas = seleccion.selectedIds.length;
  const ocupado = registrar.isPending;

  return (
    <div>
      <PageHeader help={AYUDA.recambios} title="Recambios vencidos sin contactar" />
      <div className="ds-list-card">
        <div className="ds-filters">
          <BranchSelect
            id="recambios-sucursal"
            label="Sucursal"
            value={sucursal}
            emptyOptionLabel="Todas"
            onChange={(id) => {
              setSucursal(id || undefined);
              setPage(1);
              seleccion.clear();
            }}
          />
        </div>

        {aviso ? <Notice tone={aviso.tono}>{aviso.texto}</Notice> : null}

        {recambios.isLoading ? <LoadingState variant="rows" /> : null}
        {recambios.isError ? (
          <ErrorState>
            No pudimos cargar los recambios
            {recambios.error instanceof Error ? `: ${recambios.error.message}` : "."}
          </ErrorState>
        ) : null}

        {recambios.isSuccess && filas.length === 0 ? (
          <EmptyState title="No hay recambios vencidos sin contactar" icon={CalendarClock} />
        ) : null}

        {seleccionadas > 0 ? (
          <div className="ds-bulk-bar">
            <span className="ds-bulk-bar-count">
              {seleccionadas === 1 ? "1 seleccionado" : `${String(seleccionadas)} seleccionados`}
            </span>
            <Button
              variant="primary"
              onClick={() => aplicar(seleccion.selectedIds, "TAREA")}
              disabled={ocupado}
            >
              Crear tarea al vendedor
            </Button>
            <Button onClick={() => aplicar(seleccion.selectedIds, "CONTACTADO")} disabled={ocupado}>
              Marcar como contactado
            </Button>
            <Button onClick={seleccion.clear} disabled={ocupado}>
              Cancelar selección
            </Button>
          </div>
        ) : null}

        {recambios.isSuccess && filas.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th className="ds-cell-pick">
                  <input
                    type="checkbox"
                    checked={seleccion.allSelected}
                    ref={(node) => {
                      if (node) node.indeterminate = seleccion.someSelected;
                    }}
                    disabled={ocupado}
                    onChange={(event) => seleccion.toggleAll(event.target.checked)}
                    aria-label="Seleccionar todos los de esta página"
                  />
                </th>
                <th>Cliente</th>
                <th>Vehículo</th>
                <th>Compra</th>
                <th>Recambio</th>
                <th>Vendedor</th>
                <th>Vencido hace</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td className="ds-cell-pick">
                    <input
                      type="checkbox"
                      checked={seleccion.isSelected(f.id)}
                      disabled={ocupado}
                      onChange={() => seleccion.toggle(f.id)}
                      aria-label={`Seleccionar el recambio de ${f.cliente}`}
                    />
                  </td>
                  <td className="ds-cell-primary">
                    <Link to={`/taller/vehiculos/${f.id}`}>{f.cliente}</Link>
                  </td>
                  <td>{f.vehiculo}</td>
                  <td className="ds-cell-muted">{formatearFecha(f.compra)}</td>
                  <td className="ds-cell-muted">{formatearFecha(f.recambio)}</td>
                  <td>{f.vendedor ?? "—"}</td>
                  <td className="ds-cell-muted">
                    {f.vencidoHace === 1 ? "1 día" : `${String(f.vencidoHace)} días`}
                  </td>
                  <td>
                    <Button onClick={() => aplicar([f.id], "TAREA")} disabled={ocupado}>
                      Crear tarea al vendedor
                    </Button>{" "}
                    <Button onClick={() => aplicar([f.id], "CONTACTADO")} disabled={ocupado}>
                      Marcar como contactado
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}

        {recambios.isSuccess ? (
          <Pagination
            page={page}
            totalPages={recambios.data.pagination.totalPages}
            onPrevious={() => setPage((current) => current - 1)}
            onNext={() => setPage((current) => current + 1)}
          />
        ) : null}
      </div>
    </div>
  );
}
