import { useState } from "react";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Modal } from "../../design-system/Modal";
import { Pagination } from "../../design-system/Pagination";
import { fieldLabel } from "./labels";
import { useVehicleChangeLog } from "./queries";

const PAGE_SIZE = 20;

export interface VehicleChangeLogDialogProps {
  vehicleId: string;
  onClose: () => void;
}

// Historial de cambios de una unidad: GET /vehicles/:id/change-log paginado,
// en el Modal del design-system (mismo componente que QrImageDialog). Una
// fila por campo que cambió, más reciente primero, con "antes → después" y
// quién lo hizo. Los valores se muestran tal cual los guarda el backend
// (serializeChangeLogValue: texto, fecha como YYYY-MM-DD, Decimal como
// texto); "—" para un valor vacío.
export function VehicleChangeLogDialog({ vehicleId, onClose }: VehicleChangeLogDialogProps) {
  const [page, setPage] = useState(1);
  const changeLogQuery = useVehicleChangeLog(vehicleId, { page, pageSize: PAGE_SIZE });

  return (
    <Modal title="Historial de cambios" onClose={onClose} closeLabel="Cerrar">
      {changeLogQuery.isLoading ? <LoadingState /> : null}
      {changeLogQuery.isError ? (
        <ErrorState>
          No pudimos cargar el historial
          {changeLogQuery.error instanceof Error ? `: ${changeLogQuery.error.message}` : "."}
        </ErrorState>
      ) : null}
      {changeLogQuery.isSuccess && changeLogQuery.data.data.length === 0 ? (
        <EmptyState>Esta unidad todavía no tiene cambios registrados.</EmptyState>
      ) : null}
      {changeLogQuery.isSuccess && changeLogQuery.data.data.length > 0 ? (
        <ul className="ds-list">
          {changeLogQuery.data.data.map((entry) => (
            <li key={entry.id} className="ds-list-row">
              <span className="ds-list-main">
                <span className="ds-list-primary">
                  {fieldLabel(entry.fieldName)}: {entry.oldValue ?? "—"} → {entry.newValue ?? "—"}
                </span>
                <span className="ds-list-secondary">
                  {new Date(entry.changedAt).toLocaleString()} · {entry.changedBy.fullName}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {changeLogQuery.isSuccess ? (
        <Pagination
          page={page}
          totalPages={changeLogQuery.data.pagination.totalPages}
          onPrevious={() => setPage((current) => current - 1)}
          onNext={() => setPage((current) => current + 1)}
        />
      ) : null}
    </Modal>
  );
}
