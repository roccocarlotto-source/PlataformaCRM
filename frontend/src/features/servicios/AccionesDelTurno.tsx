import { Link } from "react-router-dom";
import { InlineLoading } from "../../design-system/LoadingState";
import type { Booking } from "../booking/types";
import { esAbierto } from "./estados";
import { ETIQUETA_DE_ESTADO } from "./formato";
import { useOrdenes } from "./queries";

// ---------------------------------------------------------------------------
// Lo del taller en el detalle de un turno de la agenda (docs/servicios.md
// §4.4, S4b). Solo lo monta la agenda de una automotora con el módulo
// Servicios (BookingCalendarPage): sin el módulo, el detalle del turno no
// cambia ni pide nada a /api/servicios.
//
// Las órdenes del turno, con su link; y si no tiene una abierta y el turno
// sigue confirmado, "Crear orden de servicio", que abre Nueva orden con el
// turno (contacto, sucursal y fecha salen de él).
// ---------------------------------------------------------------------------

export function AccionesDelTurno({ booking }: { booking: Booking }) {
  const ordenes = useOrdenes({ bookingId: booking.id, pageSize: 10 });
  if (ordenes.isLoading) return <InlineLoading />;
  if (!ordenes.isSuccess) return null;
  const delTurno = ordenes.data.data;
  const hayAbierta = delTurno.some((o) => esAbierto(o.status));
  return (
    <div className="ds-stack">
      {delTurno.map((o) => (
        <p key={o.id}>
          {"Orden de servicio: "}
          <Link to={`/taller/ordenes/${o.id}`}>{o.numero}</Link>
          {` (${ETIQUETA_DE_ESTADO[o.status]})`}
        </p>
      ))}
      {!hayAbierta && booking.status === "CONFIRMED" ? (
        <p>
          <Link
            to={`/taller/ordenes/nueva?turnoId=${booking.id}`}
            className="ds-button ds-button--secondary"
          >
            Crear orden de servicio
          </Link>
        </p>
      ) : null}
    </div>
  );
}
