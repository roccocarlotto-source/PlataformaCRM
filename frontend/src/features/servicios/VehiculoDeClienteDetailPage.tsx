import { useState } from "react";
import { formatMoney } from "../../design-system/currencyFormat";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { DetailList } from "../../design-system/DetailList";
import { conPuntoFinal, formatDateTime, yesNo } from "../../design-system/detailFormat";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Notice } from "../../design-system/Notice";
import { PageHeader } from "../../design-system/PageHeader";
import { Table } from "../../design-system/Table";
import { useConfirm } from "../../design-system/useConfirm";
import { AYUDA } from "../guia/anclas";
import { CambiarDuenoDialog } from "./CambiarDuenoDialog";
import {
  descripcionDe,
  ETIQUETA_DE_ESTADO,
  ETIQUETA_DE_MOTIVO,
  formatearFecha,
  nombreDe,
} from "./formato";
import { useBorrarVehiculo } from "./mutations";
import { useOrdenesDelVehiculo, useVehiculo } from "./queries";
import type { CambioDeDueno, FichaDeVehiculo } from "./types";

// La ficha de un vehículo de cliente (docs/servicios.md §4.5): datos y dueño,
// próximo service, compra y origen, cambios de dueño e historial de órdenes.
// Los recordatorios enviados se suman con S7, cuando existan.
export function VehiculoDeClienteDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const vehiculoQuery = useVehiculo(id);

  if (vehiculoQuery.isLoading) return <LoadingState variant="lines" />;
  if (vehiculoQuery.isError || !vehiculoQuery.data) {
    return (
      <ErrorState>
        No pudimos cargar el vehículo
        {vehiculoQuery.error instanceof Error ? `: ${vehiculoQuery.error.message}` : "."}
      </ErrorState>
    );
  }
  return <Ficha vehiculo={vehiculoQuery.data} />;
}

function Ficha({ vehiculo }: { vehiculo: FichaDeVehiculo }) {
  const { me } = useAuth();
  const isAdmin = me?.role === "ADMIN";
  const navigate = useNavigate();
  const confirm = useConfirm();
  const borrar = useBorrarVehiculo();
  const [cambiandoDueno, setCambiandoDueno] = useState(false);
  const vigente = vehiculo.ownershipEndedAt === null;

  async function eliminar() {
    const ok = await confirm("¿Eliminar este vehículo? Se pierde su historial en el taller.", {
      confirmLabel: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    borrar.mutate(vehiculo.id, { onSuccess: () => navigate("/taller/vehiculos") });
  }

  const titulo = [descripcionDe(vehiculo), vehiculo.licensePlate].filter(Boolean).join(" · ");

  return (
    <div>
      <PageHeader
        help={AYUDA.fichaDeVehiculoDeCliente}
        title={titulo}
        tituloDePestana="Vehículo de cliente"
        actions={
          <>
            <Link to={`/taller/vehiculos/${vehiculo.id}/editar`} className="ds-link-button">
              Editar
            </Link>
            {vigente ? (
              <Link
                to={`/taller/ordenes/nueva?vehiculoId=${vehiculo.id}`}
                className="ds-link-button"
              >
                Nueva orden
              </Link>
            ) : null}
            {vigente ? (
              <Button type="button" onClick={() => setCambiandoDueno(true)}>
                Cambiar dueño
              </Button>
            ) : null}
            {isAdmin ? (
              <Button type="button" variant="danger" onClick={eliminar} disabled={borrar.isPending}>
                Eliminar
              </Button>
            ) : null}
          </>
        }
      />
      <div className="ds-stack">
        {vigente ? null : (
          <Notice tone="warning" alert={false} title="Ya no es del cliente">
            {vehiculo.ownershipEndReason ? ETIQUETA_DE_MOTIVO[vehiculo.ownershipEndReason] : null}
            {vehiculo.ownershipEndedAt
              ? conPuntoFinal(`, desde el ${formatDateTime(vehiculo.ownershipEndedAt)}`)
              : "."}{" "}
            No recibe avisos del taller.
          </Notice>
        )}
        {borrar.isError ? (
          <ErrorState>
            No pudimos eliminar el vehículo
            {borrar.error instanceof Error ? `: ${borrar.error.message}` : "."}
          </ErrorState>
        ) : null}

        <Card heading="Datos">
          <DetailList
            sections={[
              {
                items: [
                  {
                    label: "Dueño",
                    value: (
                      <Link to={`/contacts/${vehiculo.contact.id}/edit`}>
                        {nombreDe(vehiculo.contact)}
                      </Link>
                    ),
                  },
                  { label: "Marca", value: vehiculo.make },
                  { label: "Modelo", value: vehiculo.model },
                  { label: "Año", value: vehiculo.year },
                  { label: "Matrícula", value: vehiculo.licensePlate },
                  { label: "Chasis", value: vehiculo.vin },
                  {
                    label: "Kilómetros",
                    value: vehiculo.mileage === null ? null : vehiculo.mileage.toLocaleString(),
                  },
                  { label: "Sucursal de referencia", value: vehiculo.branch?.name },
                  { label: "Notas", value: vehiculo.notes },
                ],
              },
              {
                heading: "Service",
                items: [
                  { label: "Próximo service", value: formatearFecha(vehiculo.nextServiceDueOn) },
                  { label: "No recordar", value: yesNo(vehiculo.remindersOptOut) },
                  {
                    label: "Orden abierta",
                    value: vehiculo.ordenAbierta
                      ? `${vehiculo.ordenAbierta.numero} · ${ETIQUETA_DE_ESTADO[vehiculo.ordenAbierta.status]}`
                      : null,
                  },
                ],
              },
              {
                heading: "Compra",
                items: [
                  { label: "Fecha de compra", value: formatearFecha(vehiculo.purchasedOn) },
                  {
                    label: "Origen",
                    value: vehiculo.sourceOpportunityId ? (
                      <Link to={`/opportunities/${vehiculo.sourceOpportunityId}/edit`}>
                        Vendido por nosotros
                      </Link>
                    ) : (
                      "Cargado a mano"
                    ),
                  },
                ],
              },
            ]}
          />
        </Card>

        <Card heading="Cambios de dueño">
          {vehiculo.cambiosDeDueno.length === 0 ? (
            <EmptyState>No tuvo cambios de dueño.</EmptyState>
          ) : (
            <ul className="ds-stack">
              {vehiculo.cambiosDeDueno.map((c) => (
                <li key={c.id}>
                  <CambioRegistrado cambio={c} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <HistorialDeOrdenes vehiculoId={vehiculo.id} />
      </div>
      {cambiandoDueno ? (
        <CambiarDuenoDialog vehiculoId={vehiculo.id} onClose={() => setCambiandoDueno(false)} />
      ) : null}
    </div>
  );
}

function CambioRegistrado({ cambio }: { cambio: CambioDeDueno }) {
  const que =
    cambio.kind === "CAMBIO_DE_DUENO" && cambio.toContact
      ? `De ${nombreDe(cambio.fromContact)} a ${nombreDe(cambio.toContact)}`
      : `${nombreDe(cambio.fromContact)}: ya no es del cliente (${
          cambio.endReason ? ETIQUETA_DE_MOTIVO[cambio.endReason] : ""
        })`;
  return (
    <div>
      <strong>{que}</strong>
      <div className="ds-cell-muted">
        {formatDateTime(cambio.changedAt)}
        {cambio.changedBy ? ` · ${cambio.changedBy.fullName}` : " · automático"}
        {cambio.previousPurchasedOn
          ? ` · fecha de compra anterior: ${formatearFecha(cambio.previousPurchasedOn)}`
          : null}
      </div>
      {cambio.note ? <div>{cambio.note}</div> : null}
    </div>
  );
}

function HistorialDeOrdenes({ vehiculoId }: { vehiculoId: string }) {
  const ordenesQuery = useOrdenesDelVehiculo(vehiculoId);
  return (
    <Card heading="Historial de órdenes">
      {ordenesQuery.isLoading ? <LoadingState variant="rows" /> : null}
      {ordenesQuery.isError ? <ErrorState>No pudimos cargar las órdenes.</ErrorState> : null}
      {ordenesQuery.isSuccess && ordenesQuery.data.length === 0 ? (
        <EmptyState>Todavía no tiene órdenes.</EmptyState>
      ) : null}
      {ordenesQuery.isSuccess && ordenesQuery.data.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <th>Número</th>
              <th>Estado</th>
              <th>Entregada</th>
              <th>Tipos</th>
              <th>Km al ingreso</th>
              <th>Valor</th>
              <th>Encargado</th>
            </tr>
          </thead>
          <tbody>
            {ordenesQuery.data.map((o) => (
              <tr key={o.id}>
                <td className="ds-cell-primary">
                  <Link to={`/taller/ordenes/${o.id}`}>{o.numero}</Link>
                </td>
                <td>
                  <Badge>{ETIQUETA_DE_ESTADO[o.status]}</Badge>
                </td>
                <td className="ds-cell-muted">
                  {o.deliveredAt ? formatDateTime(o.deliveredAt) : "—"}
                </td>
                <td>{o.tipos.map((t) => t.name).join(", ") || "—"}</td>
                <td>{o.mileageIn === null ? "—" : o.mileageIn.toLocaleString()}</td>
                <td>{o.amount ? formatMoney(o.amount, o.currency ?? "").trim() : "—"}</td>
                <td>{o.assignee?.fullName ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
    </Card>
  );
}
