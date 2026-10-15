import { useId, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { DetailList } from "../../design-system/DetailList";
import { formatDateTime } from "../../design-system/detailFormat";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { IntegerInput } from "../../design-system/IntegerInput";
import { LoadingState } from "../../design-system/LoadingState";
import { Modal } from "../../design-system/Modal";
import { Notice } from "../../design-system/Notice";
import { PageHeader } from "../../design-system/PageHeader";
import { AYUDA } from "../guia/anclas";
import { EncargadoSelect, MonedaSelect, TiposDeLaOrden } from "./camposDeLaOrden";
import { accionHacia, esAbierto, TRANSICIONES } from "./estados";
import {
  aInputLocal,
  aMonto,
  deInputLocal,
  descripcionDe,
  ETIQUETA_DE_CANAL,
  ETIQUETA_DE_ESTADO,
  formatearFecha,
  nombreDe,
} from "./formato";
import { useMonedaPorDefecto } from "./monedaPorDefecto";
import { useActualizarOrden } from "./mutations";
import { useOrden } from "./queries";
import { RegistrarAprobacionDialog } from "./RegistrarAprobacionDialog";
import { TransicionDialog } from "./TransicionDialog";
import { AvisoDelTurno, TurnoEnLaFicha } from "./TurnoDeLaOrden";
import type { EstadoDeOrden, FichaDeOrden } from "./types";

// La ficha de la orden (docs/servicios.md §4.3): cabecera con los botones de
// las transiciones permitidas, ingreso, trabajo, aprobaciones e historial.
// Las fotos llegan con S5 y el aviso al cliente con S12.

function valor(o: { amount: string | null; currency: string | null }): string | null {
  return o.amount ? `${o.currency ?? ""} ${o.amount}`.trim() : null;
}

export function OrdenPage() {
  const { id = "" } = useParams<{ id: string }>();
  const orden = useOrden(id);
  if (orden.isLoading) return <LoadingState variant="lines" />;
  if (orden.isError || !orden.data) {
    return (
      <ErrorState>
        No pudimos cargar la orden
        {orden.error instanceof Error ? `: ${orden.error.message}` : "."}
      </ErrorState>
    );
  }
  return <Ficha orden={orden.data} />;
}

function Ficha({ orden }: { orden: FichaDeOrden }) {
  const [hacia, setHacia] = useState<EstadoDeOrden | null>(null);
  const [editando, setEditando] = useState(false);
  const [aprobando, setAprobando] = useState(false);
  const abierta = esAbierto(orden.status);
  const vehiculo = [descripcionDe(orden.vehiculo), orden.vehiculo.licensePlate]
    .filter(Boolean)
    .join(" · ");

  return (
    <div>
      <PageHeader
        help={AYUDA.fichaDeOrden}
        title={`${orden.numero} · ${vehiculo}`}
        actions={
          <>
            {TRANSICIONES[orden.status].map((destino) => {
              // Sin la respuesta del cliente no sale de Esperando aprobación
              // salvo para cancelar (§2.5): el botón lo dice antes de intentar.
              const frenado = orden.aprobacionPendiente && destino !== "CANCELADO";
              return (
                <Button
                  key={destino}
                  type="button"
                  variant={destino === "CANCELADO" ? "danger" : "secondary"}
                  disabled={frenado}
                  title={frenado ? "Primero registrá qué respondió el cliente" : undefined}
                  onClick={() => setHacia(destino)}
                >
                  {accionHacia(destino, { yaEstuvoEnTrabajo: orden.workStartedAt !== null })}
                </Button>
              );
            })}
            {abierta ? (
              <Button type="button" onClick={() => setEditando(true)}>
                Editar
              </Button>
            ) : null}
          </>
        }
      />
      <div className="ds-stack">
        <AvisoDelTurno orden={orden} />
        {orden.aprobacionPendiente ? (
          <Notice tone="warning" alert={false} title="Falta registrar la respuesta del cliente">
            <p>
              Para pasarla a En trabajo o a Listo para retirar, registrá qué respondió el cliente.
              Para cancelarla alcanza con el motivo.
            </p>
            <p>
              <Button type="button" variant="primary" onClick={() => setAprobando(true)}>
                Registrar aprobación
              </Button>
            </p>
          </Notice>
        ) : null}

        <Card heading="Orden">
          <DetailList
            sections={[
              {
                items: [
                  {
                    label: "Estado",
                    value: <Badge variant="info">{ETIQUETA_DE_ESTADO[orden.status]}</Badge>,
                  },
                  {
                    label: "Vehículo",
                    value: <Link to={`/taller/vehiculos/${orden.vehiculo.id}`}>{vehiculo}</Link>,
                  },
                  {
                    label: "Cliente",
                    value: (
                      <Link to={`/contacts/${orden.contact.id}/edit`}>
                        {nombreDe(orden.contact)}
                      </Link>
                    ),
                  },
                  { label: "Sucursal", value: orden.branch.name },
                  { label: "Encargado", value: orden.assignee?.fullName },
                  {
                    label: "Se espera",
                    value: orden.scheduledFor ? formatDateTime(orden.scheduledFor) : null,
                  },
                  { label: "Turno", value: <TurnoEnLaFicha orden={orden} /> },
                  {
                    label: "Creada",
                    value: `${formatDateTime(orden.createdAt)} · ${orden.createdBy.fullName}`,
                  },
                ],
              },
              {
                heading: "Ingreso",
                items: [
                  {
                    label: "Recibido",
                    value: orden.receivedAt ? formatDateTime(orden.receivedAt) : null,
                  },
                  {
                    label: "Km al ingreso",
                    value: orden.mileageIn === null ? null : orden.mileageIn.toLocaleString(),
                  },
                  { label: "Daños al ingreso", value: orden.damageNotes },
                ],
              },
              {
                heading: "Trabajo",
                items: [
                  { label: "Tipos de service", value: orden.tipos.map((t) => t.name).join(", ") },
                  { label: "Notas", value: orden.notes },
                  { label: "Valor", value: valor(orden) },
                ],
              },
              ...(orden.status === "ENTREGADO"
                ? [
                    {
                      heading: "Entrega",
                      items: [
                        {
                          label: "Entregado",
                          value: orden.deliveredAt ? formatDateTime(orden.deliveredAt) : null,
                        },
                        {
                          label: "Próximo service",
                          value: orden.nextServiceDueOn
                            ? formatearFecha(orden.nextServiceDueOn)
                            : "Sin próximo service",
                        },
                      ],
                    },
                  ]
                : []),
              ...(orden.status === "CANCELADO"
                ? [
                    {
                      heading: "Cancelación",
                      items: [
                        {
                          label: "Cancelada",
                          value: orden.cancelledAt ? formatDateTime(orden.cancelledAt) : null,
                        },
                        { label: "Motivo", value: orden.cancelReason },
                      ],
                    },
                  ]
                : []),
            ]}
          />
        </Card>

        <Card heading="Aprobaciones">
          {orden.aprobaciones.length === 0 ? (
            <EmptyState>No hay aprobaciones registradas.</EmptyState>
          ) : (
            <ul className="ds-stack">
              {orden.aprobaciones.map((a) => (
                <li key={a.id}>
                  <strong>
                    {`${a.decision === "APROBADO" ? "Aprobó" : "Rechazó"}: ${a.description}`}
                  </strong>
                  <div className="ds-cell-muted">
                    {`${a.approverName} · ${ETIQUETA_DE_CANAL[a.channel]} · ${formatDateTime(a.decidedAt)}`}
                    {a.amount ? ` · ${valor(a)}` : ""}
                    {` · registró ${a.recordedBy.fullName}`}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {abierta ? (
            <p>
              <Button type="button" onClick={() => setAprobando(true)}>
                Registrar aprobación
              </Button>
            </p>
          ) : null}
        </Card>

        <Card heading="Historial">
          <ul className="ds-stack">
            {orden.historial.map((c) => (
              <li key={c.id}>
                <strong>
                  {c.fromStatus
                    ? `${ETIQUETA_DE_ESTADO[c.fromStatus]} → ${ETIQUETA_DE_ESTADO[c.toStatus]}`
                    : `Alta en ${ETIQUETA_DE_ESTADO[c.toStatus]}`}
                </strong>
                <div className="ds-cell-muted">
                  {`${formatDateTime(c.changedAt)} · ${c.changedBy.fullName}`}
                </div>
                {c.note ? <div>{c.note}</div> : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {hacia ? (
        <TransicionDialog orden={orden} hacia={hacia} onClose={() => setHacia(null)} />
      ) : null}
      {aprobando ? (
        <RegistrarAprobacionDialog
          ordenId={orden.id}
          moneda={orden.currency}
          onClose={() => setAprobando(false)}
        />
      ) : null}
      {editando ? <EditarOrdenDialog orden={orden} onClose={() => setEditando(false)} /> : null}
    </div>
  );
}

function EditarOrdenDialog({ orden, onClose }: { orden: FichaDeOrden; onClose: () => void }) {
  const formId = useId();
  const actualizar = useActualizarOrden(orden.id);
  const [encargado, setEncargado] = useState<string | null>(orden.assigneeId);
  const [fecha, setFecha] = useState(aInputLocal(orden.scheduledFor));
  const [km, setKm] = useState(orden.mileageIn === null ? "" : String(orden.mileageIn));
  const [danos, setDanos] = useState(orden.damageNotes ?? "");
  const [notas, setNotas] = useState(orden.notes ?? "");
  const [tipos, setTipos] = useState(orden.tipos.map((t) => t.id));
  const [monto, setMonto] = useState(orden.amount ?? "");
  const [moneda, setMoneda] = useState(orden.currency ?? "");
  const monedaPorDefecto = useMonedaPorDefecto();
  const monedaElegida = moneda || monedaPorDefecto;
  const [error, setError] = useState<string | null>(null);

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const amount = aMonto(monto);
      await actualizar.mutateAsync({
        assigneeId: encargado,
        notes: notas.trim() || null,
        damageNotes: danos.trim() || null,
        jobTypeIds: tipos,
        amount,
        currency: amount !== null && monedaElegida ? monedaElegida : null,
        ...(orden.status === "AGENDADO"
          ? { scheduledFor: deInputLocal(fecha) }
          : { mileageIn: km === "" ? null : Number(km) }),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardar la orden");
    }
  }

  return (
    <Modal
      variant="dialog"
      title={`Editar ${orden.numero}`}
      closeLabel="Cancelar"
      onClose={onClose}
      primaryAction={{
        label: "Guardar",
        formId,
        disabled: actualizar.isPending,
        loading: actualizar.isPending,
      }}
    >
      <form id={formId} onSubmit={guardar} className="ds-stack">
        <EncargadoSelect value={encargado ?? undefined} onChange={setEncargado} />
        {orden.status === "AGENDADO" ? (
          <FormField label="Se espera">
            <input
              type="datetime-local"
              value={fecha}
              onChange={(event) => setFecha(event.target.value)}
            />
          </FormField>
        ) : (
          <FormField label="Km al ingreso">
            <IntegerInput value={km} onChange={setKm} />
          </FormField>
        )}
        <FormField label="Daños al ingreso">
          <textarea
            rows={2}
            maxLength={4000}
            value={danos}
            onChange={(event) => setDanos(event.target.value)}
          />
        </FormField>
        <TiposDeLaOrden value={tipos} onChange={setTipos} yaTenia={orden.tipos} />
        <FormField label="Notas">
          <textarea
            rows={3}
            maxLength={8000}
            value={notas}
            onChange={(event) => setNotas(event.target.value)}
          />
        </FormField>
        <FormField label="Valor">
          <input
            type="text"
            inputMode="decimal"
            value={monto}
            onChange={(event) => setMonto(event.target.value)}
          />
        </FormField>
        <MonedaSelect id="orden-editar-moneda" value={moneda} onChange={setMoneda} />
        {error ? <ErrorState>{error}</ErrorState> : null}
      </form>
    </Modal>
  );
}
