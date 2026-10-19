import { useId, useState, type FormEvent } from "react";
import { formatDateTime } from "../../design-system/detailFormat";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { IntegerInput } from "../../design-system/IntegerInput";
import { Modal } from "../../design-system/Modal";
import { accionHacia } from "./estados";
import { ETIQUETA_DE_ESTADO, formatearFecha } from "./formato";
import { useCambiarEstado } from "./mutations";
import type { EstadoDeOrden } from "./types";

// El diálogo de una transición (docs/servicios.md §3.2): pide lo que pide el
// destino. Recibido: km al ingreso. Cancelado: el motivo. Entregado: la fecha
// del próximo service, propuesta y editable, o "Sin próximo service" (§6.1).
// Lo abren los botones de la ficha y soltar una tarjeta en el tablero.

export interface OrdenParaTransicion {
  id: string;
  numero: string;
  status: EstadoDeOrden;
  // Si ya pasó por En trabajo: decide "Pasar a En trabajo" o "Volver a trabajo".
  workStartedAt: string | null;
  proximoServicePropuesto?: { fecha: string | null; meses: number | null } | null;
  // El turno vinculado: al cancelar la orden se aclara que el turno sigue.
  turno?: { startsAt: string; status: string } | null;
}

export function TransicionDialog({
  orden,
  hacia,
  onClose,
}: {
  orden: OrdenParaTransicion;
  hacia: EstadoDeOrden;
  onClose: () => void;
}) {
  const formId = useId();
  const cambiar = useCambiarEstado(orden.id);
  const propuesta = orden.proximoServicePropuesto?.fecha ?? "";
  const [km, setKm] = useState("");
  const [motivo, setMotivo] = useState("");
  const [proximo, setProximo] = useState(propuesta);
  const [sinProximo, setSinProximo] = useState(propuesta === "");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function confirmar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (hacia === "RECIBIDO" && km === "") return setError("Cargá los km al ingreso.");
    if (hacia === "CANCELADO" && !motivo.trim()) return setError("Escribí el motivo.");
    if (hacia === "ENTREGADO" && !sinProximo && !proximo) {
      return setError("Elegí la fecha del próximo service, o marcá Sin próximo service.");
    }
    try {
      await cambiar.mutateAsync({
        desde: orden.status,
        hacia,
        nota: nota.trim() || null,
        ...(hacia === "RECIBIDO" ? { mileageIn: Number(km) } : {}),
        ...(hacia === "CANCELADO" ? { cancelReason: motivo.trim() } : {}),
        ...(hacia === "ENTREGADO" ? { proximoService: sinProximo ? null : proximo } : {}),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cambiar el estado");
    }
  }

  const accion = accionHacia(hacia, { yaEstuvoEnTrabajo: orden.workStartedAt !== null });
  return (
    <Modal
      variant="dialog"
      title={`${accion} · ${orden.numero}`}
      // "Cancelar" cierra sin cambiar nada; en el diálogo de cancelar la orden
      // quedaría "Cancelar" al lado de "Cancelar la orden", así que ahí dice
      // otra cosa.
      closeLabel={hacia === "CANCELADO" ? "No cancelar" : "Cancelar"}
      onClose={onClose}
      primaryAction={{
        label: accion,
        formId,
        disabled: cambiar.isPending,
        loading: cambiar.isPending,
        ...(hacia === "CANCELADO" ? { variant: "danger" as const } : {}),
      }}
    >
      <form id={formId} onSubmit={confirmar} className="ds-stack">
        <p>{`${ETIQUETA_DE_ESTADO[orden.status]} → ${ETIQUETA_DE_ESTADO[hacia]}`}</p>
        {hacia === "RECIBIDO" ? (
          <FormField label={<span className="ds-required">Km al ingreso</span>}>
            <IntegerInput value={km} onChange={setKm} />
          </FormField>
        ) : null}
        {hacia === "CANCELADO" && orden.turno?.status === "CONFIRMED" ? (
          <p className="ds-hint">
            {`El turno del ${formatDateTime(orden.turno.startsAt)} sigue en la agenda: cancelalo desde ahí si corresponde.`}
          </p>
        ) : null}
        {hacia === "CANCELADO" ? (
          <FormField label={<span className="ds-required">Motivo</span>}>
            <input
              type="text"
              maxLength={500}
              value={motivo}
              onChange={(event) => setMotivo(event.target.value)}
            />
          </FormField>
        ) : null}
        {hacia === "ENTREGADO" ? (
          <>
            <FormField label="Próximo service">
              <input
                type="date"
                value={proximo}
                disabled={sinProximo}
                onChange={(event) => setProximo(event.target.value)}
              />
            </FormField>
            <p className="ds-hint">
              {orden.proximoServicePropuesto?.meses
                ? `Propuesta: ${formatearFecha(propuesta)}, a los ${orden.proximoServicePropuesto.meses} meses.`
                : "Sin fecha propuesta."}
            </p>
            <label>
              <input
                type="checkbox"
                checked={sinProximo}
                onChange={(event) => setSinProximo(event.target.checked)}
              />{" "}
              Sin próximo service
            </label>
          </>
        ) : null}
        <FormField label="Nota">
          <textarea
            rows={2}
            maxLength={1000}
            value={nota}
            onChange={(event) => setNota(event.target.value)}
          />
        </FormField>
        {error ? <ErrorState>{error}</ErrorState> : null}
      </form>
    </Modal>
  );
}
