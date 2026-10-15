import { useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../../design-system/Card";
import { formatRelativeTime } from "../../design-system/detailFormat";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { PageHeader } from "../../design-system/PageHeader";
import { BranchSelect } from "../branch/BranchSelect";
import { AYUDA } from "../guia/anclas";
import { ETIQUETA_DE_ESTADO, formatearFecha } from "./formato";
import { useResumenDelTaller } from "./queries";
import type { EstadoDeOrden, ListaDelResumen, OrdenDelResumen, VehiculoDelResumen } from "./types";

// ---------------------------------------------------------------------------
// Taller → Resumen (docs/servicios.md §4.7, S11). Lo que hay que mirar hoy:
// cuántos autos hay adentro, los que esperan que los retiren o que el cliente
// apruebe, a quién llamar por el service y los agendados con el turno
// cancelado. Cada lista muestra hasta 10 y dice "y N más" si hay más
// (decisión de Rocco, 2026-10-15). Las tarjetas de recambio llegan con S13.
// ---------------------------------------------------------------------------

const EN_EL_TALLER: EstadoDeOrden[] = ["RECIBIDO", "EN_TRABAJO", "ESPERANDO_APROBACION"];

function YMas({ lista }: { lista: ListaDelResumen<unknown> }) {
  const resto = lista.total - lista.items.length;
  return resto > 0 ? <p className="ds-hint">y {resto} más</p> : null;
}

function ListaDeOrdenes({
  lista,
  vacia,
  cuando,
}: {
  lista: ListaDelResumen<OrdenDelResumen>;
  vacia: string;
  cuando: (o: OrdenDelResumen) => string;
}) {
  if (lista.total === 0) return <p className="ds-hint">{vacia}</p>;
  return (
    <>
      <ul className="ds-list">
        {lista.items.map((o) => (
          <li key={o.id}>
            <Link to={`/taller/ordenes/${o.id}`}>{o.numero}</Link> · {o.cliente} · {o.vehiculo}
            {cuando(o) ? ` · ${cuando(o)}` : ""}
          </li>
        ))}
      </ul>
      <YMas lista={lista} />
    </>
  );
}

function ListaDeVehiculos({
  lista,
  vacia,
}: {
  lista: ListaDelResumen<VehiculoDelResumen>;
  vacia: string;
}) {
  if (lista.total === 0) return <p className="ds-hint">{vacia}</p>;
  return (
    <>
      <ul className="ds-list">
        {lista.items.map((v) => (
          <li key={v.id}>
            <Link to={`/taller/vehiculos/${v.id}`}>{v.cliente}</Link> · {v.vehiculo} · service el{" "}
            {formatearFecha(v.fecha)}
          </li>
        ))}
      </ul>
      <YMas lista={lista} />
    </>
  );
}

export function TallerResumenPage() {
  const [sucursal, setSucursal] = useState<string | undefined>(undefined);
  const resumen = useResumenDelTaller(sucursal);

  return (
    <div>
      <PageHeader help={AYUDA.resumenDelTaller} title="Resumen del taller" />
      <div className="ds-stack">
        <div className="ds-filters">
          <BranchSelect
            id="resumen-sucursal"
            label="Sucursal"
            value={sucursal}
            emptyOptionLabel="Todas"
            onChange={(id) => setSucursal(id || undefined)}
          />
        </div>

        {resumen.isLoading ? <LoadingState /> : null}
        {resumen.isError ? (
          <ErrorState>
            No pudimos cargar el resumen
            {resumen.error instanceof Error ? `: ${resumen.error.message}` : "."}
          </ErrorState>
        ) : null}

        {resumen.data ? (
          <div className="ds-card-grid">
            <Card heading={`Autos en el taller: ${String(resumen.data.enElTaller.total)}`}>
              <ul className="ds-list">
                {EN_EL_TALLER.map((estado) => (
                  <li key={estado}>
                    {ETIQUETA_DE_ESTADO[estado]}: {resumen.data.enElTaller.porEstado[estado] ?? 0}
                  </li>
                ))}
              </ul>
            </Card>
            <Card heading={`Listos para retirar: ${String(resumen.data.listosParaRetirar.total)}`}>
              <ListaDeOrdenes
                lista={resumen.data.listosParaRetirar}
                vacia="Ninguno."
                cuando={(o) => (o.desde ? `listo ${formatRelativeTime(o.desde)}` : "")}
              />
            </Card>
            <Card
              heading={`Esperando aprobación hace más de 24 h: ${String(resumen.data.esperandoAprobacion.total)}`}
            >
              <ListaDeOrdenes
                lista={resumen.data.esperandoAprobacion}
                vacia="Ninguna."
                cuando={(o) => (o.desde ? `esperando ${formatRelativeTime(o.desde)}` : "")}
              />
            </Card>
            <Card heading={`Services vencidos: ${String(resumen.data.servicesVencidos.total)}`}>
              <ListaDeVehiculos lista={resumen.data.servicesVencidos} vacia="Ninguno." />
            </Card>
            <Card
              heading={`Services en los próximos 30 días: ${String(resumen.data.servicesEn30Dias.total)}`}
            >
              <ListaDeVehiculos lista={resumen.data.servicesEn30Dias} vacia="Ninguno." />
            </Card>
            <Card
              heading={`Agendados con el turno cancelado: ${String(resumen.data.turnosCancelados.total)}`}
            >
              <ListaDeOrdenes
                lista={resumen.data.turnosCancelados}
                vacia="Ninguno."
                cuando={(o) =>
                  o.desde ? `era para el ${new Date(o.desde).toLocaleDateString()}` : ""
                }
              />
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
