import { concordancia, type Termino } from "../../auth/vocabulario";
import { ErrorState } from "../../design-system/ErrorState";

// Ver partesDelTurno.ts: lo comparten CreateBookingPanel y NuevoTurnoDialog.
/** El error del backend al crear, tal cual (409, fuera de horario, etc.). */
export function ErrorAlReservar({ reserva, error }: { reserva: Termino; error: unknown }) {
  return (
    <ErrorState>
      No pudimos crear {concordancia(reserva).el} {reserva.singular}
      {error instanceof Error ? `: ${error.message}` : "."}
    </ErrorState>
  );
}
