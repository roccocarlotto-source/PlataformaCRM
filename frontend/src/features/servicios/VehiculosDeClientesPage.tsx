import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CarFront, Plus } from "lucide-react";
import { Badge } from "../../design-system/Badge";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { PageHeader } from "../../design-system/PageHeader";
import { Pagination } from "../../design-system/Pagination";
import { Table } from "../../design-system/Table";
import { AYUDA } from "../guia/anclas";
import { descripcionDe, ETIQUETA_DE_ESTADO, formatearFecha, nombreDe } from "./formato";
import { useVehiculos } from "./queries";

const PAGE_SIZE = 20;

// Taller → Vehículos de clientes (docs/servicios.md §4.5). El buscador es uno
// solo: el backend lo normaliza y busca por prefijo de matrícula o de chasis, y
// por nombre del dueño. Sin resultados, ofrece crear el vehículo con lo que se
// escribió como matrícula.
export function VehiculosDeClientesPage() {
  const [page, setPage] = useState(1);
  const [busqueda, setBusqueda] = useState("");
  const [incluirNoVigentes, setIncluirNoVigentes] = useState(false);
  // S13: desde la tarjeta "Recambios" del resumen llega ya tildado.
  const [searchParams] = useSearchParams();
  const [sinFechaDeCompra, setSinFechaDeCompra] = useState(
    searchParams.get("sinFechaDeCompra") === "1",
  );

  const q = busqueda.trim();
  const vehiculosQuery = useVehiculos({
    page,
    pageSize: PAGE_SIZE,
    q: q || undefined,
    incluirNoVigentes: incluirNoVigentes || undefined,
    sinFechaDeCompra: sinFechaDeCompra || undefined,
  });

  const nuevo = q ? `/taller/vehiculos/nuevo?matricula=${encodeURIComponent(q)}` : null;

  return (
    <div>
      <PageHeader
        help={AYUDA.vehiculosDeClientes}
        title="Vehículos de clientes"
        actions={
          <Link to="/taller/vehiculos/nuevo" className="ds-link-button">
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            Nuevo vehículo
          </Link>
        }
      />

      <div className="ds-list-card">
        <h2 className="ds-filters-title">Filtros</h2>
        <div className="ds-filters">
          <label>
            <span className="ds-sr-only">Buscar</span>
            <input
              type="search"
              placeholder="Buscar por matrícula, chasis o dueño"
              value={busqueda}
              onChange={(event) => {
                setBusqueda(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={incluirNoVigentes}
              onChange={(event) => {
                setIncluirNoVigentes(event.target.checked);
                setPage(1);
              }}
            />{" "}
            Mostrar los que ya no son de un cliente
          </label>
          <label>
            <input
              type="checkbox"
              checked={sinFechaDeCompra}
              onChange={(event) => {
                setSinFechaDeCompra(event.target.checked);
                setPage(1);
              }}
            />{" "}
            Solo los que no tienen fecha de compra
          </label>
        </div>

        {vehiculosQuery.isLoading ? <LoadingState variant="rows" /> : null}

        {vehiculosQuery.isError ? (
          <ErrorState>
            No pudimos cargar los vehículos
            {vehiculosQuery.error instanceof Error ? `: ${vehiculosQuery.error.message}` : "."}
          </ErrorState>
        ) : null}

        {vehiculosQuery.isSuccess && vehiculosQuery.data.data.length === 0 ? (
          <EmptyState
            title={q ? `No hay vehículos que coincidan con "${q}"` : "Todavía no hay vehículos"}
            icon={CarFront}
            action={
              nuevo ? (
                <Link to={nuevo} className="ds-link-button">
                  Crear vehículo con esta matrícula
                </Link>
              ) : undefined
            }
          />
        ) : null}

        {vehiculosQuery.isSuccess && vehiculosQuery.data.data.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>Matrícula</th>
                <th>Vehículo</th>
                <th>Dueño</th>
                <th>Próximo service</th>
                <th>Orden abierta</th>
              </tr>
            </thead>
            <tbody>
              {vehiculosQuery.data.data.map((v) => (
                <tr key={v.id}>
                  <td className="ds-cell-primary">
                    <Link to={`/taller/vehiculos/${v.id}`}>
                      {v.licensePlate ?? "Sin matrícula"}
                    </Link>
                    {v.ownershipEndedAt ? (
                      <>
                        {" "}
                        <Badge>Ya no es del cliente</Badge>
                      </>
                    ) : null}
                  </td>
                  <td>{descripcionDe(v)}</td>
                  <td>{nombreDe(v.contact)}</td>
                  <td className="ds-cell-muted">
                    {v.remindersOptOut ? "No recordar" : formatearFecha(v.nextServiceDueOn) || "—"}
                  </td>
                  <td>
                    {v.ordenAbierta ? (
                      <Badge variant="info">
                        {`${v.ordenAbierta.numero} · ${ETIQUETA_DE_ESTADO[v.ordenAbierta.status]}`}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}

        {vehiculosQuery.isSuccess ? (
          <Pagination
            page={page}
            totalPages={vehiculosQuery.data.pagination.totalPages}
            onPrevious={() => setPage((current) => current - 1)}
            onNext={() => setPage((current) => current + 1)}
          />
        ) : null}
      </div>
    </div>
  );
}
