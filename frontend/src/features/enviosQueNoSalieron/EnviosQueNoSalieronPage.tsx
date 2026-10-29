import { useState } from "react";
import { MailWarning } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { esAdmin, puedeVerEnviosQueNoSalieron } from "../../auth/permisos";
import { formatDateTime } from "../../design-system/detailFormat";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { PageHeader } from "../../design-system/PageHeader";
import { Pagination } from "../../design-system/Pagination";
import { Select } from "../../design-system/Select";
import { Table } from "../../design-system/Table";
import { useBranches } from "../branch/queries";
import { AYUDA } from "../guia/anclas";
import { useEnviosQueNoSalieron } from "./queries";
import { ETIQUETA_DEL_TIPO } from "./types";

const PAGE_SIZE = 20;
const SIN_DATO = "—";

// Los mensajes automáticos que agotaron sus reintentos y las automatizaciones
// que fallaron: la lista con cada cliente que acompaña a la tarea agrupada
// "Más … que no salieron el dd/mm: N". ADMIN filtra por sede; Recepción ve
// solo las suyas (lo acota el backend).
export function EnviosQueNoSalieronPage() {
  const { me } = useAuth();
  const admin = esAdmin(me);
  const [page, setPage] = useState(1);
  const [branchId, setBranchId] = useState("");

  const sedes = useBranches({ page: 1, pageSize: 100 }, { enabled: admin });
  const envios = useEnviosQueNoSalieron({
    page,
    pageSize: PAGE_SIZE,
    branchId: branchId || undefined,
  });

  if (!puedeVerEnviosQueNoSalieron(me)) {
    return <Navigate to="/tasks" replace />;
  }

  const listaDeSedes = sedes.data?.data ?? [];

  return (
    <div>
      <PageHeader help={AYUDA.enviosQueNoSalieron} title="Envíos que no salieron" />

      <div className="ds-list-card">
        {admin && listaDeSedes.length > 1 ? (
          <>
            <h2 className="ds-filters-title">Filtros</h2>
            <div className="ds-filters">
              <Select
                label="Sede"
                value={branchId}
                options={listaDeSedes.map((sede) => ({ value: sede.id, label: sede.name }))}
                emptyOption={{ label: "Todas" }}
                onChange={(value) => {
                  setBranchId(value);
                  setPage(1);
                }}
              />
            </div>
          </>
        ) : null}

        {envios.isLoading ? <LoadingState variant="rows" /> : null}

        {envios.isError ? (
          <ErrorState>
            No pudimos cargar los envíos
            {envios.error instanceof Error ? `: ${envios.error.message}` : "."}
          </ErrorState>
        ) : null}

        {envios.isSuccess && envios.data.data.length === 0 ? (
          <EmptyState title="No hay envíos que no hayan salido" icon={MailWarning} />
        ) : null}

        {envios.isSuccess && envios.data.data.length > 0 ? (
          <>
            <Table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo de envío</th>
                  <th>Cliente</th>
                  <th>Sede</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {envios.data.data.map((envio) => (
                  <tr key={`${envio.tipo}-${envio.id}`}>
                    <td>{formatDateTime(envio.fecha)}</td>
                    <td>{ETIQUETA_DEL_TIPO[envio.tipo]}</td>
                    <td>
                      {envio.contacto ? (
                        <Link to={`/contacts/${envio.contacto.id}/edit`}>
                          {envio.contacto.nombre}
                        </Link>
                      ) : (
                        SIN_DATO
                      )}
                    </td>
                    <td>{envio.sede?.nombre ?? SIN_DATO}</td>
                    <td className="ds-cell-truncate" title={envio.motivo}>
                      {envio.motivo}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={page}
              totalPages={envios.data.pagination.totalPages}
              onPrevious={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => p + 1)}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
