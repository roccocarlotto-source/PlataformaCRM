import { useState } from "react";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { Pagination } from "../../design-system/Pagination";
import { Select } from "../../design-system/Select";
import { SortOrderSelect } from "../../design-system/SortOrderSelect";
import { Table } from "../../design-system/Table";
import { BranchSelect } from "../branch/BranchSelect";
import { BRANCHES_PARA_SELECT, useBranches } from "../branch/queries";
import { useContactNames } from "../opportunity/relationResolution";
import { ResourceSelect } from "../resource/ResourceSelect";
import { RESOURCES_PARA_SELECT, useResources } from "../resource/queries";
import { SERVICE_TYPES_PARA_SELECT, useServiceTypes } from "../serviceType/queries";
import {
  BOOKING_STATUS_BADGE,
  BOOKING_STATUS_LABEL,
  BOOKING_STATUS_OPTIONS,
  fechaAInstante,
  formatRangoDeReserva,
  hoyComoFecha,
} from "./format";
import { useCancelBooking } from "./mutations";
import { useBookings } from "./queries";
import type { BookingSortBy, BookingStatus, SortOrder } from "./types";

const PAGE_SIZE = 20;

const SIN_RESOLVER = "—";

// ---------------------------------------------------------------------------
// Reservas de la Agenda (ítem 75): consulta y cancelación. SIN alta manual
// ACÁ — esta es la vista tabular e histórica; reservar a mano desde el CRM se
// hace en el calendario (BookingCalendarPage, ítem 77), además del agente de IA.
//
// VISIBLE PARA AMBOS ROLES, fuera de AdminRoute: GET /api/bookings y
// PATCH /api/bookings/:id/cancel son `authenticate` a secas
// (booking.routes.ts) porque atender el mostrador —ver quién viene y cancelar
// un turno— es la operación cotidiana, no configuración. Recursos y Tipos de
// servicio sí son ADMIN-only; los selects de filtro solo LEEN, y esa lectura
// es abierta.
//
// ARRANCA FILTRANDO DESDE HOY: es una agenda, y lo primero que alguien busca
// es lo que viene. El filtro está a la vista y se puede vaciar para ver el
// historial completo.
//
// Sin filtro por contacto aunque el backend lo acepte (contactId): no hay un
// selector de contacto reutilizable en el proyecto, y un UUID crudo no es un
// control aceptable. Queda para cuando exista ese selector.
// ---------------------------------------------------------------------------
export function BookingListPage() {
  const [page, setPage] = useState(1);
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  const [resourceId, setResourceId] = useState<string | undefined>(undefined);
  const [serviceTypeId, setServiceTypeId] = useState<string>("");
  const [status, setStatus] = useState<BookingStatus | "">("");
  const [desde, setDesde] = useState(() => hoyComoFecha());
  const [hasta, setHasta] = useState("");
  const [sortBy, setSortBy] = useState<BookingSortBy>("startsAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");

  const bookingsQuery = useBookings({
    page,
    pageSize: PAGE_SIZE,
    branchId,
    resourceId,
    serviceTypeId: serviceTypeId || undefined,
    status: status || undefined,
    from: fechaAInstante(desde, false),
    to: fechaAInstante(hasta, true),
    sortBy,
    sortOrder,
  });

  // Las mismas queries que BranchSelect y ResourceSelect (mismo key): cada una
  // alimenta su filtro y la resolución de nombres de las filas con UNA
  // request. La sucursal además aporta la zona horaria en la que se muestra
  // cada reserva.
  const branchesQuery = useBranches(BRANCHES_PARA_SELECT);
  const sucursalPorId = new Map((branchesQuery.data?.data ?? []).map((b) => [b.id, b]));
  const resourcesQuery = useResources(RESOURCES_PARA_SELECT);
  const nombreDeRecurso = new Map((resourcesQuery.data?.data ?? []).map((r) => [r.id, r.name]));
  const serviceTypesQuery = useServiceTypes(SERVICE_TYPES_PARA_SELECT);
  const serviceTypes = serviceTypesQuery.data?.data ?? [];
  const nombreDeServicio = new Map(serviceTypes.map((s) => [s.id, s.name]));

  const bookings = bookingsQuery.data?.data ?? [];
  // Mismo hook que ActivityListPage: una request por contacto distinto de la
  // página, cacheada por contactKeys.detail.
  const contactNames = useContactNames(bookings.map((booking) => booking.contactId));

  const cancelBookingMutation = useCancelBooking();

  function aplicarFiltro(cambio: () => void) {
    cambio();
    setPage(1);
  }

  function handleCancel(id: string) {
    // window.confirm, calcado de "Revocar" en InvitationListPage: es la otra
    // transición de estado sin vuelta atrás del proyecto que no borra nada. Una
    // reserva cancelada no se puede reconfirmar (no existe esa operación), y
    // el turno queda libre para otra persona.
    if (!window.confirm("¿Cancelar esta reserva? El turno queda libre y no se puede deshacer."))
      return;
    cancelBookingMutation.mutate(id);
  }

  return (
    <div>
      <div className="ds-page-header">
        <h1>Reservas</h1>
      </div>

      <div className="ds-list-card">
        <h2 className="ds-filters-title">Filtros</h2>
        <div className="ds-filters">
          <BranchSelect
            id="booking-list-branch"
            label="Sucursal"
            value={branchId}
            emptyOptionLabel="Todas"
            onChange={(nuevo) =>
              aplicarFiltro(() => {
                setBranchId(nuevo || undefined);
                // Lo elegido abajo puede no ser de la sucursal nueva: se limpia
                // en vez de dejar un filtro que ya no se ve en su select.
                setResourceId(undefined);
                setServiceTypeId("");
              })
            }
          />
          <ResourceSelect
            id="booking-list-resource"
            label="Recurso"
            value={resourceId}
            branchId={branchId}
            emptyOptionLabel="Todos"
            onChange={(nuevo) =>
              aplicarFiltro(() => {
                setResourceId(nuevo || undefined);
                setServiceTypeId("");
              })
            }
          />
          <Select
            id="booking-list-service-type"
            label="Tipo de servicio"
            value={serviceTypeId}
            options={serviceTypes
              .filter(
                (s) =>
                  (branchId === undefined || s.branchId === branchId) &&
                  (resourceId === undefined || s.resourceId === resourceId),
              )
              .map((s) => ({ value: s.id, label: s.name }))}
            emptyOption={{ label: "Todos" }}
            onChange={(value) => aplicarFiltro(() => setServiceTypeId(value))}
          />
          <Select
            label="Estado"
            value={status}
            options={BOOKING_STATUS_OPTIONS}
            emptyOption={{ label: "Todos" }}
            onChange={(value) => aplicarFiltro(() => setStatus(value))}
          />
          <FormField label="Desde">
            <input
              type="date"
              value={desde}
              onChange={(event) => aplicarFiltro(() => setDesde(event.target.value))}
            />
          </FormField>
          <FormField label="Hasta">
            <input
              type="date"
              value={hasta}
              onChange={(event) => aplicarFiltro(() => setHasta(event.target.value))}
            />
          </FormField>
          <Select
            label="Ordenar por"
            value={sortBy}
            options={[
              { value: "startsAt", label: "Fecha del turno" },
              { value: "createdAt", label: "Fecha de reserva" },
            ]}
            onChange={(value) => {
              if (value) setSortBy(value);
            }}
          />
          <SortOrderSelect value={sortOrder} onChange={setSortOrder} />
        </div>

        {bookingsQuery.isLoading ? <LoadingState /> : null}

        {bookingsQuery.isError ? (
          <ErrorState>
            No pudimos cargar las reservas
            {bookingsQuery.error instanceof Error ? `: ${bookingsQuery.error.message}` : "."}
          </ErrorState>
        ) : null}

        {cancelBookingMutation.isError ? (
          <ErrorState>
            No pudimos cancelar la reserva
            {cancelBookingMutation.error instanceof Error
              ? `: ${cancelBookingMutation.error.message}`
              : "."}
          </ErrorState>
        ) : null}

        {bookingsQuery.isSuccess && bookings.length === 0 ? (
          <EmptyState>No hay reservas para mostrar.</EmptyState>
        ) : null}

        {bookingsQuery.isSuccess && bookings.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>Turno</th>
                <th>Contacto</th>
                <th>Servicio</th>
                <th>Recurso</th>
                <th>Sucursal</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((booking) => {
                const sucursal = sucursalPorId.get(booking.branchId);
                return (
                  <tr key={booking.id}>
                    <td className="ds-cell-primary">
                      {formatRangoDeReserva(booking.startsAt, booking.endsAt, sucursal?.timezone)}
                    </td>
                    <td>{contactNames.byId.get(booking.contactId) ?? SIN_RESOLVER}</td>
                    <td>{nombreDeServicio.get(booking.serviceTypeId) ?? SIN_RESOLVER}</td>
                    <td>{nombreDeRecurso.get(booking.resourceId) ?? SIN_RESOLVER}</td>
                    <td>{sucursal?.name ?? SIN_RESOLVER}</td>
                    <td>
                      <Badge variant={BOOKING_STATUS_BADGE[booking.status]}>
                        {BOOKING_STATUS_LABEL[booking.status]}
                      </Badge>
                    </td>
                    <td>
                      {/* Solo una CONFIRMED se cancela: el backend rechaza
                          las demás (409 la ya cancelada), y ofrecer el botón
                          sería prometer una acción que no puede terminar bien. */}
                      {booking.status === "CONFIRMED" ? (
                        <Button
                          variant="danger"
                          onClick={() => handleCancel(booking.id)}
                          disabled={cancelBookingMutation.isPending}
                        >
                          Cancelar
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : null}

        {bookingsQuery.isSuccess ? (
          <Pagination
            page={page}
            totalPages={bookingsQuery.data.pagination.totalPages}
            onPrevious={() => setPage((current) => current - 1)}
            onNext={() => setPage((current) => current + 1)}
          />
        ) : null}
      </div>
    </div>
  );
}
