import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { formatDateTime } from "../../design-system/detailFormat";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Modal } from "../../design-system/Modal";
import { Notice } from "../../design-system/Notice";
import { useConfirm } from "../../design-system/useConfirm";
import { esAbierto } from "./estados";
import { useActualizarOrden } from "./mutations";
import { useTurnosVinculables } from "./queries";
import type { FichaDeOrden, TurnoDeLaOrden } from "./types";

// ---------------------------------------------------------------------------
// El turno de la agenda en la ficha de la orden (docs/servicios.md §4.4, S4b).
//
// Sin sincronización de estados: los turnos de una automotora no emiten
// eventos, así que si el turno se cancela (o el cliente no vino) la orden no se
// entera sola. La ficha lee el estado ACTUAL del turno y lo avisa, con lo que
// se puede hacer: vincular otro, desvincularlo o cancelar la orden.
// ---------------------------------------------------------------------------

const ESTADO_DEL_TURNO: Record<TurnoDeLaOrden["status"], string> = {
  CONFIRMED: "Confirmado",
  CANCELLED: "Cancelado",
  COMPLETED: "Atendido",
  NO_SHOW: "No vino",
};

/** El valor de "Turno" en la ficha, con Vincular / Desvincular. */
export function TurnoEnLaFicha({ orden }: { orden: FichaDeOrden }) {
  const [vinculando, setVinculando] = useState(false);
  const desvincular = useDesvincular(orden);
  const abierta = esAbierto(orden.status);
  const { turno } = orden;
  return (
    <>
      {turno ? (
        <span>
          <Link to="/agenda">{formatDateTime(turno.startsAt)}</Link>
          {` · ${turno.servicio} · ${turno.recurso}`}
          {turno.status !== "CONFIRMED" ? (
            <>
              {" "}
              <Badge variant="danger">{ESTADO_DEL_TURNO[turno.status]}</Badge>
            </>
          ) : null}
        </span>
      ) : (
        <span className="ds-cell-muted">Sin turno</span>
      )}
      {abierta ? (
        <span>
          {" "}
          {turno ? (
            <button type="button" className="ds-linklike" onClick={desvincular.ejecutar}>
              Desvincular
            </button>
          ) : (
            <button type="button" className="ds-linklike" onClick={() => setVinculando(true)}>
              Vincular turno
            </button>
          )}
        </span>
      ) : null}
      {desvincular.error ? <ErrorState>{desvincular.error}</ErrorState> : null}
      {vinculando ? (
        <VincularTurnoDialog orden={orden} onClose={() => setVinculando(false)} />
      ) : null}
    </>
  );
}

/** Arriba de la ficha, si el turno vinculado ya no es el que se esperaba. */
export function AvisoDelTurno({ orden }: { orden: FichaDeOrden }) {
  const [vinculando, setVinculando] = useState(false);
  const desvincular = useDesvincular(orden);
  const { turno } = orden;
  if (!turno || !esAbierto(orden.status)) return null;

  let titulo: string | null = null;
  let texto = "";
  if (turno.status === "CANCELLED") {
    titulo = "El turno vinculado fue cancelado";
  } else if (turno.status === "NO_SHOW") {
    titulo = "El cliente no vino al turno";
  } else if (
    turno.status === "CONFIRMED" &&
    orden.scheduledFor &&
    new Date(orden.scheduledFor).getTime() !== new Date(turno.startsAt).getTime()
  ) {
    titulo = "El turno cambió de horario";
    texto = `El turno es el ${formatDateTime(turno.startsAt)}; la orden esperaba el auto el ${formatDateTime(orden.scheduledFor)}.`;
  }
  if (!titulo) return null;

  return (
    <Notice tone="warning" alert={false} title={titulo}>
      {texto ? <p>{texto}</p> : null}
      <p>
        <Button type="button" variant="secondary" onClick={() => setVinculando(true)}>
          Vincular otro turno
        </Button>{" "}
        <Button type="button" variant="secondary" onClick={desvincular.ejecutar}>
          Desvincular
        </Button>
      </p>
      {desvincular.error ? <ErrorState>{desvincular.error}</ErrorState> : null}
      {vinculando ? (
        <VincularTurnoDialog orden={orden} onClose={() => setVinculando(false)} />
      ) : null}
    </Notice>
  );
}

function useDesvincular(orden: FichaDeOrden) {
  const confirm = useConfirm();
  const actualizar = useActualizarOrden(orden.id);
  const [error, setError] = useState<string | null>(null);
  async function ejecutar() {
    setError(null);
    const ok = await confirm(
      "¿Desvincular el turno? El turno sigue en la agenda y la orden conserva su fecha.",
      { confirmLabel: "Desvincular", cancelLabel: "Cancelar" },
    );
    if (!ok) return;
    try {
      await actualizar.mutateAsync({ bookingId: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos desvincular el turno");
    }
  }
  return { ejecutar, error };
}

/** Los turnos confirmados y futuros del cliente, para elegir uno. */
function VincularTurnoDialog({ orden, onClose }: { orden: FichaDeOrden; onClose: () => void }) {
  const turnos = useTurnosVinculables(orden.contactId, true);
  const actualizar = useActualizarOrden(orden.id);
  const [error, setError] = useState<string | null>(null);

  async function vincular(bookingId: string) {
    setError(null);
    try {
      await actualizar.mutateAsync({ bookingId });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos vincular el turno");
    }
  }

  const disponibles = (turnos.data ?? []).filter((t) => t.id !== orden.turno?.id);
  return (
    <Modal
      variant="dialog"
      title={`Vincular turno · ${orden.numero}`}
      closeLabel="Cancelar"
      onClose={onClose}
    >
      <div className="ds-stack">
        {turnos.isLoading ? <LoadingState variant="lines" /> : null}
        {turnos.isError ? <ErrorState>No pudimos cargar los turnos.</ErrorState> : null}
        {turnos.isSuccess && disponibles.length === 0 ? (
          <p>El cliente no tiene turnos confirmados por delante.</p>
        ) : null}
        {disponibles.length > 0 ? (
          <>
            <ul className="ds-stack">
              {disponibles.map((t) => (
                <li key={t.id}>
                  {`${formatDateTime(t.startsAt)} · ${t.servicio} · ${t.recurso} · ${t.branch.name}`}{" "}
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={actualizar.isPending}
                    onClick={() => vincular(t.id)}
                  >
                    Vincular
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {error ? <ErrorState>{error}</ErrorState> : null}
      </div>
    </Modal>
  );
}
