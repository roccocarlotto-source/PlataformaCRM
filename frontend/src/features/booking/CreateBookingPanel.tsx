import { useId, useState, type FormEvent } from "react";
import { DetailList } from "../../design-system/DetailList";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { Modal } from "../../design-system/Modal";
import { Select } from "../../design-system/Select";
import { ContactSelect } from "../opportunity/ContactSelect";
import type { Resource } from "../resource/types";
import type { ServiceType } from "../serviceType/types";
import {
  estaEnLaGrilla,
  formatearMinuto,
  instanteLocal,
  MINUTOS_DEL_DIA,
  type FranjaEnMinutos,
} from "./calendar";
import { useCreateBooking } from "./mutations";

interface CreateBookingPanelProps {
  resource: Resource;
  fecha: string;
  minuto: number;
  zona: string;
  // Las franjas de ESE recurso ese día, para decidir si el turno queda fuera
  // de horario o de la grilla del servicio elegido.
  franjas: readonly FranjaEnMinutos[];
  serviceTypes: readonly ServiceType[];
  isAdmin: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Alta manual de una reserva desde el calendario (ítem 77). El recurso y el
// horario vienen FIJOS del click en la grilla; se eligen el servicio y el
// contacto. Sin oportunidad a propósito: el ítem no la pide.
//
// FORZAR: si el turno —con la duración del servicio elegido— cae fuera del
// horario de trabajo o no coincide con la grilla, un ADMIN ve el checkbox
// "Forzar fuera de horario" y tiene que tildarlo para poder enviar (manda
// force: true). A un USER no se le ofrece: si igual el turno es inválido, el
// backend lo rechaza y se muestra su mensaje. El checkbox es solo UX: el 403
// para un no-ADMIN lo decide el backend contra el rol del JWT.
// ---------------------------------------------------------------------------
export function CreateBookingPanel({
  resource,
  fecha,
  minuto,
  zona,
  franjas,
  serviceTypes,
  isAdmin,
  onClose,
}: CreateBookingPanelProps) {
  const formId = useId();
  const [serviceTypeId, setServiceTypeId] = useState("");
  const [contactId, setContactId] = useState<string | undefined>(undefined);
  const [forzar, setForzar] = useState(false);
  const createBookingMutation = useCreateBooking();

  // Mismo criterio que el select "Tipo de servicio" de BookingListPage: los
  // servicios que provee ESE recurso.
  const servicios = serviceTypes.filter((s) => s.resourceId === resource.id);
  const servicio = servicios.find((s) => s.id === serviceTypeId);

  const fueraDeHorario = servicio ? !estaEnLaGrilla(minuto, servicio.durationMin, franjas) : false;
  const ofrecerForzar = isAdmin && fueraDeHorario;
  const puedeEnviar =
    servicio !== undefined &&
    contactId !== undefined &&
    (!ofrecerForzar || forzar) &&
    !createBookingMutation.isPending;

  const inicio = instanteLocal(fecha, minuto, zona);
  const fechaLegible = new Intl.DateTimeFormat("es-UY", {
    timeZone: zona,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(inicio);
  const hora = servicio
    ? `${formatearMinuto(minuto)}–${formatearMinuto((minuto + servicio.durationMin) % MINUTOS_DEL_DIA)}`
    : formatearMinuto(minuto);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!servicio || !contactId) return;
    createBookingMutation.mutate(
      {
        resourceId: resource.id,
        serviceTypeId: servicio.id,
        contactId,
        startsAt: inicio.toISOString(),
        // Solo cuando el turno lo necesita Y se tildó: un turno válido nunca
        // viaja forzado.
        force: ofrecerForzar && forzar ? true : undefined,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal
      title="Nueva reserva"
      onClose={onClose}
      closeLabel="Cerrar"
      primaryAction={{
        label: createBookingMutation.isPending ? "Reservando…" : "Reservar",
        formId,
        disabled: !puedeEnviar,
        loading: createBookingMutation.isPending,
      }}
    >
      <DetailList
        sections={[
          {
            items: [
              { label: "Recurso", value: resource.name },
              { label: "Fecha", value: fechaLegible },
              { label: "Hora", value: hora },
            ],
          },
        ]}
      />

      <form id={formId} onSubmit={handleSubmit} noValidate>
        <Select
          id={`${formId}-service-type`}
          label="Tipo de servicio"
          value={serviceTypeId}
          options={servicios.map((s) => ({ value: s.id, label: s.name }))}
          emptyOption={{ label: "Elegir servicio…" }}
          required
          onChange={(value) => {
            setServiceTypeId(value);
            setForzar(false);
          }}
        />
        {servicios.length === 0 ? (
          <p className="ds-hint">Este recurso todavía no tiene tipos de servicio.</p>
        ) : null}

        <ContactSelect
          id={`${formId}-contact`}
          label="Contacto"
          value={contactId}
          onChange={setContactId}
        />

        {ofrecerForzar ? (
          <>
            <FormField label="Forzar fuera de horario">
              <input
                type="checkbox"
                checked={forzar}
                onChange={(event) => setForzar(event.target.checked)}
              />
            </FormField>
            <p className="ds-hint">
              Este turno queda fuera del horario de trabajo del recurso o no coincide con sus
              turnos. Como administrador podés reservarlo igual; lo que no se saltea es el cupo: si
              se pisa con otra reserva, se rechaza.
            </p>
          </>
        ) : null}
      </form>

      {createBookingMutation.isError ? (
        <ErrorState>
          No pudimos crear la reserva
          {createBookingMutation.error instanceof Error
            ? `: ${createBookingMutation.error.message}`
            : "."}
        </ErrorState>
      ) : null}
    </Modal>
  );
}
