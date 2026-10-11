import { useId, useState, type FormEvent } from "react";
import { concordancia, type VocabularioCompleto } from "../../auth/vocabulario";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { Modal } from "../../design-system/Modal";
import { Select } from "../../design-system/Select";
import { formatearMinuto, instanteLocal, minutoDelDia, MINUTOS_DEL_DIA } from "../booking/calendar";
import { ErrorAlReservar } from "../booking/ErrorAlReservar";
import { accionDeReservar } from "../booking/partesDelTurno";
import { ContactSelect } from "../opportunity/ContactSelect";
import { useCrearTurnoDeClinica, useDisponibilidadDeClinica } from "./agendaQueries";
import { usePrestaciones } from "./queries";

interface NuevoTurnoDialogProps {
  vocabulario: VocabularioCompleto;
  // La sede y el día que muestra la agenda.
  branchId: string;
  zona: string;
  fecha: string;
  onClose: () => void;
}

interface Horario {
  startsAt: string;
  profesionales: { id: string; name: string }[];
}

// ---------------------------------------------------------------------------
// "Nuevo turno" de la agenda de una clínica (docs/rubros.md §4.3): la
// prestación, el día y un horario libre de CUALQUIERA de sus profesionales.
// El profesional arranca en "El primero libre": sin resourceId, el backend
// (POST /api/clinica/turnos) le da el turno al que tiene menos turnos ese día
// y, si otro pedido se lo gana, prueba con el siguiente. También se puede
// elegir a uno de los que están libres a esa hora.
//
// El click en la grilla (CreateBookingPanel) sigue igual: ahí el profesional
// ya viene elegido. El botón y el error son los mismos (partesDelTurno).
// ---------------------------------------------------------------------------
export function NuevoTurnoDialog({
  vocabulario,
  branchId,
  zona,
  fecha: fechaInicial,
  onClose,
}: NuevoTurnoDialogProps) {
  const formId = useId();
  const { reserva, recurso, tipoDeServicio, contacto } = vocabulario;
  const [serviceTypeId, setServiceTypeId] = useState("");
  const [fecha, setFecha] = useState(fechaInicial);
  const [startsAt, setStartsAt] = useState("");
  // "" = el primero libre.
  const [resourceId, setResourceId] = useState("");
  const [contactId, setContactId] = useState<string | undefined>(undefined);

  const prestaciones = (usePrestaciones().data?.prestaciones ?? []).filter(
    (p) => p.branchId === branchId,
  );

  const desde = instanteLocal(fecha, 0, zona);
  const hasta = instanteLocal(fecha, MINUTOS_DEL_DIA, zona);
  const consulta =
    serviceTypeId && !Number.isNaN(desde.getTime())
      ? { serviceTypeId, from: desde.toISOString(), to: hasta.toISOString() }
      : null;
  const disponibilidadQuery = useDisponibilidadDeClinica(consulta);
  const horarios = agruparPorHorario(disponibilidadQuery.data?.availability ?? []);
  const horario = horarios.find((h) => h.startsAt === startsAt);

  const crear = useCrearTurnoDeClinica();
  const puedeEnviar = horario !== undefined && contactId !== undefined && !crear.isPending;

  // La hora en la zona de la sede, como la grilla de la agenda (24 h).
  const hora = (instante: string) => formatearMinuto(minutoDelDia(instante, fecha, zona));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!horario || !contactId) return;
    crear.mutate(
      {
        serviceTypeId,
        contactId,
        startsAt: horario.startsAt,
        ...(resourceId ? { resourceId } : {}),
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal
      title={`${concordancia(reserva).Nuevo} ${reserva.singular}`}
      onClose={onClose}
      closeLabel="Cerrar"
      primaryAction={accionDeReservar({ formId, puedeEnviar, enviando: crear.isPending })}
    >
      <form id={formId} onSubmit={handleSubmit} noValidate>
        <Select
          id={`${formId}-prestacion`}
          label={tipoDeServicio.singularTitulo}
          value={serviceTypeId}
          options={prestaciones.map((p) => ({ value: p.id, label: p.name }))}
          emptyOption={{ label: `Elegir ${tipoDeServicio.singular}…` }}
          required
          onChange={(value) => {
            setServiceTypeId(value);
            setStartsAt("");
            setResourceId("");
          }}
        />

        <FormField label="Día">
          <input
            type="date"
            value={fecha}
            onChange={(event) => {
              setFecha(event.target.value);
              setStartsAt("");
              setResourceId("");
            }}
          />
        </FormField>

        {consulta && disponibilidadQuery.isLoading ? <LoadingState variant="rows" /> : null}
        {disponibilidadQuery.isError ? (
          <ErrorState>
            No pudimos cargar los horarios
            {disponibilidadQuery.error instanceof Error
              ? `: ${disponibilidadQuery.error.message}`
              : "."}
          </ErrorState>
        ) : null}
        {consulta && disponibilidadQuery.isSuccess && horarios.length === 0 ? (
          <EmptyState title="No hay horarios libres ese día" />
        ) : null}

        {horarios.length > 0 ? (
          <Select
            id={`${formId}-horario`}
            label="Horario"
            value={startsAt}
            options={horarios.map((h) => ({
              value: h.startsAt,
              label: `${hora(h.startsAt)} · ${String(h.profesionales.length)} ${
                h.profesionales.length === 1 ? "libre" : "libres"
              }`,
            }))}
            emptyOption={{ label: "Elegir horario…" }}
            required
            onChange={(value) => {
              setStartsAt(value);
              setResourceId("");
            }}
          />
        ) : null}

        {horario ? (
          <Select
            id={`${formId}-profesional`}
            label={recurso.singularTitulo}
            value={resourceId}
            options={horario.profesionales.map((r) => ({ value: r.id, label: r.name }))}
            emptyOption={{ label: "El primero libre" }}
            onChange={setResourceId}
          />
        ) : null}

        <ContactSelect
          id={`${formId}-paciente`}
          label={contacto.singularTitulo}
          value={contactId}
          onChange={setContactId}
        />
      </form>

      {crear.isError ? <ErrorAlReservar reserva={reserva} error={crear.error} /> : null}
    </Modal>
  );
}

// Un horario por inicio, con los profesionales libres en él, en orden.
function agruparPorHorario(
  disponibilidad: readonly { startsAt: string; resource: { id: string; name: string } }[],
): Horario[] {
  const porInicio = new Map<string, Horario>();
  for (const turno of disponibilidad) {
    const horario = porInicio.get(turno.startsAt) ?? {
      startsAt: turno.startsAt,
      profesionales: [],
    };
    if (!horario.profesionales.some((r) => r.id === turno.resource.id)) {
      horario.profesionales.push(turno.resource);
    }
    porInicio.set(turno.startsAt, horario);
  }
  return [...porInicio.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
