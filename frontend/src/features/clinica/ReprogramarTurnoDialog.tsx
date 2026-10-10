import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getAccessToken } from "../../auth/getAccessToken";
import { ErrorState } from "../../design-system/ErrorState";
import { InlineLoading } from "../../design-system/LoadingState";
import { Modal } from "../../design-system/Modal";
import { Select } from "../../design-system/Select";
import { formatDateTime } from "../../design-system/detailFormat";
import { request } from "../../lib/api";
import { bookingKeys } from "../booking/queries";
import type { Booking } from "../booking/types";
import { useHorariosConSobreturnos } from "./agendaQueries";
import { usePrestaciones } from "./queries";
import { useVocabularioDeClinica } from "./vocabulario";

// ---------------------------------------------------------------------------
// Reprogramar un turno de clínica (docs/rubros.md §4.7, R9). Lo usan ADMIN y
// Recepción (en sus sedes). Ofrece los horarios con la misma disponibilidad que
// al agendar (bloqueos, el calendario de Google del profesional) y, si el
// profesional lo permite, los sobreturnos. Se puede cambiar de profesional
// dentro de la prestación. Mismo turno: queda la nota con el horario anterior.
// ---------------------------------------------------------------------------

function fechaLocal(iso: string): string {
  const d = new Date(iso);
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function rangoDelDia(fecha: string): { from: string; to: string } {
  const inicio = new Date(`${fecha}T00:00:00`);
  return {
    from: inicio.toISOString(),
    to: new Date(inicio.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export function ReprogramarTurnoDialog({
  booking,
  onClose,
}: {
  booking: Booking;
  onClose: () => void;
}) {
  const vocabulario = useVocabularioDeClinica();
  const prestacion = usePrestaciones().data?.prestaciones.find(
    (p) => p.id === booking.serviceTypeId,
  );
  const [resourceId, setResourceId] = useState(booking.resourceId);
  const [fecha, setFecha] = useState(() => fechaLocal(booking.startsAt));
  const [elegido, setElegido] = useState<{ startsAt: string; sobreturno: boolean } | null>(null);
  const horarios = useHorariosConSobreturnos({
    serviceTypeId: booking.serviceTypeId,
    resourceId,
    ...rangoDelDia(fecha),
  });

  const queryClient = useQueryClient();
  const reprogramar = useMutation({
    mutationFn: (body: { startsAt: string; resourceId: string; isOverbooking?: boolean }) =>
      request(`/bookings/${booking.id}/reschedule`, { method: "PATCH", body, getAccessToken }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bookingKeys.lists() });
      onClose();
    },
  });

  const opciones = (horarios.data?.availability ?? []).map((h) => ({
    value: h.startsAt,
    label: `${formatDateTime(h.startsAt)}${h.overbooking ? " (sobreturno)" : ""}`,
  }));

  return (
    <Modal
      variant="dialog"
      title="Reprogramar turno"
      onClose={onClose}
      closeLabel="Volver"
      primaryAction={{
        label: "Reprogramar",
        disabled: elegido === null,
        loading: reprogramar.isPending,
        onClick: () => {
          if (!elegido) return;
          reprogramar.mutate({
            startsAt: elegido.startsAt,
            resourceId,
            ...(elegido.sobreturno ? { isOverbooking: true } : {}),
          });
        },
      }}
    >
      <p className="ds-hint">Ahora: {formatDateTime(booking.startsAt)}</p>
      <Select
        label={vocabulario.recurso.singularTitulo}
        value={resourceId}
        options={(prestacion?.profesionales ?? []).map((r) => ({ value: r.id, label: r.name }))}
        onChange={(id) => {
          if (id) {
            setResourceId(id);
            setElegido(null);
          }
        }}
      />
      <div>
        <label htmlFor="reprogramar-fecha">Día</label>
        <input
          id="reprogramar-fecha"
          type="date"
          value={fecha}
          onChange={(e) => {
            setFecha(e.target.value);
            setElegido(null);
          }}
        />
      </div>
      {horarios.isLoading ? <InlineLoading /> : null}
      {horarios.isSuccess && opciones.length === 0 ? (
        <p className="ds-hint">No hay horarios libres ese día.</p>
      ) : null}
      {opciones.length > 0 ? (
        <Select
          label="Horario nuevo"
          value={elegido?.startsAt}
          options={opciones}
          onChange={(valor) => {
            const h = horarios.data?.availability.find((x) => x.startsAt === valor);
            setElegido(h ? { startsAt: h.startsAt, sobreturno: h.overbooking === true } : null);
          }}
        />
      ) : null}
      {reprogramar.isError ? (
        <ErrorState>
          {reprogramar.error instanceof Error
            ? reprogramar.error.message
            : "No pudimos reprogramar el turno."}
        </ErrorState>
      ) : null}
    </Modal>
  );
}
