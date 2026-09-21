import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "../../design-system/Button";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { BranchSelect } from "../branch/BranchSelect";
import { BRANCHES_PARA_SELECT, useBranches } from "../branch/queries";
import { useContactNames } from "../opportunity/relationResolution";
import { ResourceSelect } from "../resource/ResourceSelect";
import { RESOURCES_PARA_SELECT, useResources, useWorkingHours } from "../resource/queries";
import type { Resource } from "../resource/types";
import { SERVICE_TYPES_PARA_SELECT, useServiceTypes } from "../serviceType/queries";
import type { ServiceType } from "../serviceType/types";
import { BookingDetailDialog } from "./BookingDetailDialog";
import {
  estaAbierto,
  formatearMinuto,
  franjasDelDia,
  instanteLocal,
  MINUTOS_DEL_DIA,
  MINUTOS_POR_RENGLON,
  minutoDelDia,
  sumarDias,
  type FranjaEnMinutos,
} from "./calendar";
import { CreateBookingPanel } from "./CreateBookingPanel";
import { hoyComoFecha } from "./format";
import { useBookings } from "./queries";
import type { Booking } from "./types";

const SIN_RESOLVER = "—";

const RENGLONES = Array.from(
  { length: MINUTOS_DEL_DIA / MINUTOS_POR_RENGLON },
  (_, i) => i * MINUTOS_POR_RENGLON,
);

// La hora a la que arranca el scroll: la grilla es el día entero (un ADMIN
// puede forzar a cualquier hora), pero lo que se busca primero es la mañana.
const HORA_INICIAL_DEL_SCROLL = "07:00";

// Posición vertical en la grilla: la unidad es la altura de un renglón, que
// vive en el CSS (--ds-calendar-row), no acá.
function enRenglones(minuto: number): string {
  return `calc(var(--ds-calendar-row) * ${minuto / MINUTOS_POR_RENGLON})`;
}

interface NuevaReserva {
  resource: Resource;
  minuto: number;
  franjas: FranjaEnMinutos[];
}

interface ReservaAbierta {
  booking: Booking;
  resource: Resource;
  contactName: string;
}

// ---------------------------------------------------------------------------
// Calendario de la Agenda (ítem 77): la vista operativa de "qué pasa hoy y
// agendar ahora". Reservas (BookingListPage) sigue siendo la vista tabular e
// histórica, intacta.
//
// UN DÍA, UNA SUCURSAL, UNA COLUMNA POR RECURSO (o uno solo, con el filtro).
// Sin semana ni mes. Cada columna pide su horario de trabajo y sus reservas
// CONFIRMED del día: el backend no tiene un endpoint "agenda del día", y
// componer las dos lecturas existentes por recurso es más chico que crearlo.
//
// VISIBLE PARA AMBOS ROLES, fuera de AdminRoute, como /bookings: GET
// /api/bookings, /api/resources y /api/resources/:id/working-hours son de
// lectura abierta y POST /api/bookings es `authenticate` a secas.
//
// FUERA DEL HORARIO, la grilla está cerrada para un USER. Para un ADMIN sigue
// siendo clickeable (rayada, para que se note que es forzar): el backend acepta
// force solo de un ADMIN. Lo que ya empezó no es clickeable para nadie —el
// backend no acepta el pasado ni forzado—.
// ---------------------------------------------------------------------------
export function BookingCalendarPage() {
  const { me } = useAuth();
  const isAdmin = me?.role === "ADMIN";

  const [branchIdElegida, setBranchIdElegida] = useState<string | undefined>(undefined);
  const [resourceId, setResourceId] = useState<string | undefined>(undefined);
  const [fecha, setFecha] = useState(() => hoyComoFecha());
  // El "ahora" para decidir qué ya pasó. Se toma una vez por página: el
  // backend es quien decide al final, y un turno que pasa mientras la página
  // está abierta lo rechaza con su mensaje.
  const [ahora] = useState(() => Date.now());
  const [nueva, setNueva] = useState<NuevaReserva | null>(null);
  const [abierta, setAbierta] = useState<ReservaAbierta | null>(null);

  const branchesQuery = useBranches(BRANCHES_PARA_SELECT);
  const sucursales = branchesQuery.data?.data ?? [];
  // Sin elección todavía, la primera sucursal: un calendario vacío que pide
  // "elegí una sucursal" es un paso de más para la organización de una sola.
  const branchId = branchIdElegida ?? sucursales[0]?.id;
  const sucursal = sucursales.find((b) => b.id === branchId);

  const resourcesQuery = useResources(RESOURCES_PARA_SELECT);
  const recursos = (resourcesQuery.data?.data ?? []).filter(
    (r) => r.branchId === branchId && (resourceId === undefined || r.id === resourceId),
  );

  const serviceTypesQuery = useServiceTypes(SERVICE_TYPES_PARA_SELECT);
  const serviceTypes = serviceTypesQuery.data?.data ?? [];

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroll = scrollRef.current;
    const marca = scroll?.querySelector<HTMLElement>(`[data-hora="${HORA_INICIAL_DEL_SCROLL}"]`);
    const encabezado = scroll?.querySelector<HTMLElement>(".ds-calendar-header");
    const cuerpo = scroll?.querySelector<HTMLElement>(".ds-calendar-body");
    // Se descuenta también el padding-top del cuerpo: es el lugar que la
    // etiqueta de la hora usa arriba de su línea, y sin él quedaría medio
    // tapada por el encabezado sticky (ítem 78).
    const margen = cuerpo ? parseFloat(getComputedStyle(cuerpo).paddingTop) || 0 : 0;
    if (scroll && marca) {
      scroll.scrollTop = marca.offsetTop - (encabezado?.offsetHeight ?? 0) - margen;
    }
  }, [branchId, recursos.length]);

  return (
    <div>
      <div className="ds-page-header">
        <h1>Calendario</h1>
      </div>

      <div className="ds-list-card">
        <h2 className="ds-filters-title">Filtros</h2>
        <div className="ds-filters">
          <BranchSelect
            id="booking-calendar-branch"
            label="Sucursal"
            value={branchId}
            onChange={(nuevo) => {
              setBranchIdElegida(nuevo || undefined);
              setResourceId(undefined);
            }}
          />
          <ResourceSelect
            id="booking-calendar-resource"
            label="Recurso"
            value={resourceId}
            branchId={branchId}
            emptyOptionLabel="Todos"
            onChange={(nuevo) => setResourceId(nuevo || undefined)}
          />
          <Button onClick={() => setFecha((actual) => sumarDias(actual, -1))}>Día anterior</Button>
          <FormField label="Fecha">
            <input
              type="date"
              value={fecha}
              onChange={(event) => {
                if (event.target.value) setFecha(event.target.value);
              }}
            />
          </FormField>
          <Button onClick={() => setFecha((actual) => sumarDias(actual, 1))}>Día siguiente</Button>
          <Button onClick={() => setFecha(hoyComoFecha())}>Hoy</Button>
        </div>

        {branchesQuery.isLoading || resourcesQuery.isLoading ? <LoadingState /> : null}

        {resourcesQuery.isError ? (
          <ErrorState>
            No pudimos cargar los recursos
            {resourcesQuery.error instanceof Error ? `: ${resourcesQuery.error.message}` : "."}
          </ErrorState>
        ) : null}

        {branchesQuery.isSuccess && sucursales.length === 0 ? (
          <EmptyState>Todavía no hay sucursales.</EmptyState>
        ) : null}

        {sucursal && resourcesQuery.isSuccess && recursos.length === 0 ? (
          <EmptyState>Esta sucursal todavía no tiene recursos.</EmptyState>
        ) : null}

        {sucursal && recursos.length > 0 ? (
          <div
            ref={scrollRef}
            className="ds-calendar"
            style={{ "--ds-calendar-columns": recursos.length } as CSSProperties}
          >
            <div className="ds-calendar-header">
              <div className="ds-calendar-corner" />
              {recursos.map((resource) => (
                <div key={resource.id} className="ds-calendar-resource-name">
                  {resource.name}
                </div>
              ))}
            </div>
            <div className="ds-calendar-body">
              <div className="ds-calendar-gutter" aria-hidden="true">
                {RENGLONES.map((minuto) => (
                  <div
                    key={minuto}
                    className="ds-calendar-hour"
                    data-hora={formatearMinuto(minuto)}
                  >
                    {minuto % 60 === 0 ? formatearMinuto(minuto) : ""}
                  </div>
                ))}
              </div>
              {recursos.map((resource) => (
                <CalendarColumn
                  key={resource.id}
                  resource={resource}
                  fecha={fecha}
                  zona={sucursal.timezone}
                  ahora={ahora}
                  isAdmin={isAdmin}
                  serviceTypes={serviceTypes}
                  onSlotClick={(minuto, franjas) => setNueva({ resource, minuto, franjas })}
                  onBookingClick={(booking, contactName) =>
                    setAbierta({ booking, resource, contactName })
                  }
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {nueva && sucursal ? (
        <CreateBookingPanel
          resource={nueva.resource}
          fecha={fecha}
          minuto={nueva.minuto}
          zona={sucursal.timezone}
          franjas={nueva.franjas}
          serviceTypes={serviceTypes}
          isAdmin={isAdmin}
          onClose={() => setNueva(null)}
        />
      ) : null}

      {abierta && sucursal ? (
        <BookingDetailDialog
          booking={abierta.booking}
          contactName={abierta.contactName}
          serviceName={
            serviceTypes.find((s) => s.id === abierta.booking.serviceTypeId)?.name ?? SIN_RESOLVER
          }
          resourceName={abierta.resource.name}
          zona={sucursal.timezone}
          onClose={() => setAbierta(null)}
        />
      ) : null}
    </div>
  );
}

interface CalendarColumnProps {
  resource: Resource;
  fecha: string;
  zona: string;
  ahora: number;
  isAdmin: boolean;
  serviceTypes: readonly ServiceType[];
  onSlotClick: (minuto: number, franjas: FranjaEnMinutos[]) => void;
  onBookingClick: (booking: Booking, contactName: string) => void;
}

function CalendarColumn({
  resource,
  fecha,
  zona,
  ahora,
  isAdmin,
  serviceTypes,
  onSlotClick,
  onBookingClick,
}: CalendarColumnProps) {
  const workingHoursQuery = useWorkingHours(resource.id);
  // `from`/`to` filtran sobre startsAt: una reserva que empezó el día anterior
  // y cruza la medianoche no aparece acá. Con el horario de un mostrador no
  // pasa; queda anotado por si alguna vez sí.
  const bookingsQuery = useBookings({
    resourceId: resource.id,
    status: "CONFIRMED",
    from: instanteLocal(fecha, 0, zona).toISOString(),
    to: instanteLocal(fecha, MINUTOS_DEL_DIA, zona).toISOString(),
    pageSize: 100,
    sortBy: "startsAt",
    sortOrder: "asc",
  });

  const franjas = franjasDelDia(workingHoursQuery.data?.workingHours ?? [], fecha);
  const bookings = bookingsQuery.data?.data ?? [];
  const contactNames = useContactNames(bookings.map((b) => b.contactId));
  const bloques = ubicarEnCarriles(bookings, fecha, zona);

  return (
    <div className="ds-calendar-column">
      {workingHoursQuery.isError || bookingsQuery.isError ? (
        <ErrorState>No pudimos cargar la agenda de {resource.name}.</ErrorState>
      ) : null}

      {RENGLONES.map((minuto) => {
        const hora = formatearMinuto(minuto);
        const abierto = estaAbierto(minuto, minuto + MINUTOS_POR_RENGLON, franjas);
        const yaEmpezo = instanteLocal(fecha, minuto, zona).getTime() < ahora;
        const clickeable = workingHoursQuery.isSuccess && !yaEmpezo && (abierto || isAdmin);
        const clase = [
          "ds-calendar-slot",
          abierto ? "ds-calendar-slot--open" : "ds-calendar-slot--closed",
          clickeable && !abierto ? "ds-calendar-slot--forced" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return clickeable ? (
          <button
            key={minuto}
            type="button"
            className={clase}
            aria-label={
              abierto
                ? `Reservar ${resource.name} a las ${hora}`
                : `Forzar reserva de ${resource.name} a las ${hora}`
            }
            onClick={() => onSlotClick(minuto, franjas)}
          />
        ) : (
          <div key={minuto} className={clase} />
        );
      })}

      {bloques.map(({ booking, inicio, fin, carril, carriles }) => {
        const contactName = contactNames.byId.get(booking.contactId) ?? SIN_RESOLVER;
        const servicio = serviceTypes.find((s) => s.id === booking.serviceTypeId)?.name;
        const style: CSSProperties = {
          top: enRenglones(inicio),
          height: enRenglones(Math.max(fin - inicio, MINUTOS_POR_RENGLON / 2)),
          left: `${(carril / carriles) * 100}%`,
          width: `${100 / carriles}%`,
        };
        return (
          <button
            key={booking.id}
            type="button"
            className="ds-calendar-booking"
            style={style}
            onClick={() => onBookingClick(booking, contactName)}
          >
            <span className="ds-calendar-booking-time">
              {formatearMinuto(inicio)}–{formatearMinuto(fin)}
            </span>{" "}
            <span className="ds-calendar-booking-contact">{contactName}</span>
            {servicio ? <span className="ds-calendar-booking-service"> · {servicio}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

// Reservas que se pisan (un servicio con cupo mayor a 1) van lado a lado en
// vez de taparse: cada una toma el primer carril libre, y todas las de la
// columna se dividen el ancho por la cantidad de carriles.
function ubicarEnCarriles(bookings: readonly Booking[], fecha: string, zona: string) {
  const finDeCarril: number[] = [];
  const ubicados = bookings.map((booking) => {
    const inicio = minutoDelDia(booking.startsAt, fecha, zona);
    const fin = minutoDelDia(booking.endsAt, fecha, zona);
    let carril = finDeCarril.findIndex((finPrevio) => finPrevio <= inicio);
    if (carril === -1) carril = finDeCarril.length;
    finDeCarril[carril] = fin;
    return { booking, inicio, fin, carril };
  });
  return ubicados.map((u) => ({ ...u, carriles: Math.max(finDeCarril.length, 1) }));
}
