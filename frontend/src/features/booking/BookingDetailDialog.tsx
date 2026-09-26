import { Button } from "../../design-system/Button";
import { DetailList } from "../../design-system/DetailList";
import { ErrorState } from "../../design-system/ErrorState";
import { Modal } from "../../design-system/Modal";
import { formatRangoDeReserva } from "./format";
import { useCancelBooking } from "./mutations";
import type { Booking } from "./types";

interface BookingDetailDialogProps {
  booking: Booking;
  contactName: string;
  serviceName: string;
  resourceName: string;
  zona: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Detalle de una reserva del calendario (ítem 77), con la única acción que el
// modelo admite sobre una reserva existente: cancelarla. Reprogramar no existe
// (booking.service.ts): el camino es cancelar y crear otra.
//
// Diálogo DESCARTABLE (variant="dialog") y no panel: no hay nada que perder al
// cerrarlo. "Cancelar reserva" va en el cuerpo porque el diálogo no tiene
// acción principal en el pie, y con el mismo window.confirm que la tabla de
// Reservas.
// ---------------------------------------------------------------------------
export function BookingDetailDialog({
  booking,
  contactName,
  serviceName,
  resourceName,
  zona,
  onClose,
}: BookingDetailDialogProps) {
  const cancelBookingMutation = useCancelBooking();

  function handleCancel() {
    if (!window.confirm("¿Cancelar esta reserva? El turno queda libre y no se puede deshacer."))
      return;
    cancelBookingMutation.mutate(booking.id, { onSuccess: onClose });
  }

  return (
    <Modal variant="dialog" title="Reserva" onClose={onClose}>
      <DetailList
        sections={[
          {
            items: [
              { label: "Contacto", value: contactName },
              { label: "Servicio", value: serviceName },
              { label: "Recurso", value: resourceName },
              {
                label: "Horario",
                value: formatRangoDeReserva(booking.startsAt, booking.endsAt, zona),
              },
            ],
          },
        ]}
      />

      {cancelBookingMutation.isError ? (
        <ErrorState>
          No pudimos cancelar la reserva
          {cancelBookingMutation.error instanceof Error
            ? `: ${cancelBookingMutation.error.message}`
            : "."}
        </ErrorState>
      ) : null}

      <Button
        variant="danger"
        onClick={handleCancel}
        disabled={cancelBookingMutation.isPending}
        loading={cancelBookingMutation.isPending}
      >
        Cancelar reserva
      </Button>
    </Modal>
  );
}
