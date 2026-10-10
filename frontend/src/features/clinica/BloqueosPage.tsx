import { useMemo, useState, type FormEvent } from "react";
import { CalendarOff } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { Notice } from "../../design-system/Notice";
import { PageHeader } from "../../design-system/PageHeader";
import { Select } from "../../design-system/Select";
import { Table } from "../../design-system/Table";
import { formatDateTime } from "../../design-system/detailFormat";
import { useCancelBooking } from "../booking/mutations";
import { useResources } from "../resource/queries";
import type { BloqueoCreado } from "./agendaApi";
import { useBloqueos, useBorrarBloqueo, useCrearBloqueo } from "./agendaQueries";
import { sedesDeQuienEntra } from "./sedes";
import { useVocabularioDeClinica } from "./vocabulario";

// ---------------------------------------------------------------------------
// Bloqueos de un profesional (docs/rubros.md §4.5, R6): vacaciones, ausencias,
// reuniones. Los cargan ADMIN y Recepción (de sus sedes). Un bloqueo saca esos
// horarios de la agenda; si ya había turnos adentro, NO se cancelan: se listan
// acá (para cancelarlos o reprogramarlos) y a la recepción de la sede le queda
// una tarea por cada uno.
// ---------------------------------------------------------------------------

const DIAS_A_LA_VISTA = 62;

function aInstante(valorLocal: string): string {
  return new Date(valorLocal).toISOString();
}

export function BloqueosPage() {
  const { me } = useAuth();
  const vocabulario = useVocabularioDeClinica();
  const termino = vocabulario.recurso;
  const sedes = sedesDeQuienEntra(me);

  const recursosQuery = useResources({
    type: "PERSON",
    pageSize: 100,
    sortBy: "name",
    sortOrder: "asc",
  });
  const profesionales = (recursosQuery.data?.data ?? []).filter(
    (r) => sedes === null || sedes.some((s) => s.id === r.branchId),
  );
  const [resourceId, setResourceId] = useState<string | undefined>(undefined);
  const elegido = resourceId ?? profesionales[0]?.id;

  const rango = useMemo(() => {
    const desde = new Date();
    const hasta = new Date(desde.getTime() + DIAS_A_LA_VISTA * 24 * 60 * 60 * 1000);
    return { from: desde.toISOString(), to: hasta.toISOString() };
  }, []);
  const bloqueosQuery = useBloqueos(elegido, rango);
  const borrar = useBorrarBloqueo();

  return (
    <div>
      <PageHeader title="Bloqueos" />
      <div className="ds-list-card">
        <div className="ds-filters">
          <Select
            label={termino.singularTitulo}
            value={elegido}
            options={profesionales.map((r) => ({ value: r.id, label: r.name }))}
            onChange={(id) => setResourceId(id || undefined)}
          />
        </div>

        {recursosQuery.isLoading || bloqueosQuery.isLoading ? (
          <LoadingState variant="rows" />
        ) : null}
        {bloqueosQuery.isError ? (
          <ErrorState>
            No pudimos cargar los bloqueos
            {bloqueosQuery.error instanceof Error ? `: ${bloqueosQuery.error.message}` : "."}
          </ErrorState>
        ) : null}
        {recursosQuery.isSuccess && profesionales.length === 0 ? (
          <EmptyState title={`No hay ${termino.plural} para mostrar`} icon={CalendarOff} />
        ) : null}

        {bloqueosQuery.isSuccess && bloqueosQuery.data.bloqueos.length === 0 ? (
          <EmptyState title="No hay bloqueos en los próximos dos meses" icon={CalendarOff} />
        ) : null}
        {bloqueosQuery.isSuccess && bloqueosQuery.data.bloqueos.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>Desde</th>
                <th>Hasta</th>
                <th>Motivo</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {bloqueosQuery.data.bloqueos.map((b) => (
                <tr key={b.id}>
                  <td>{formatDateTime(b.startsAt)}</td>
                  <td>{formatDateTime(b.endsAt)}</td>
                  <td className="ds-cell-muted">{b.reason ?? "—"}</td>
                  <td>
                    <Button
                      variant="secondary"
                      onClick={() => borrar.mutate(b.id)}
                      disabled={borrar.isPending}
                    >
                      Quitar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}
        {borrar.isError ? (
          <ErrorState>
            {borrar.error instanceof Error ? borrar.error.message : "No pudimos quitar el bloqueo."}
          </ErrorState>
        ) : null}
      </div>

      {elegido ? <NuevoBloqueo key={elegido} resourceId={elegido} /> : null}
    </div>
  );
}

function NuevoBloqueo({ resourceId }: { resourceId: string }) {
  const crear = useCrearBloqueo(resourceId);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [motivo, setMotivo] = useState("");
  const [creado, setCreado] = useState<BloqueoCreado | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    crear.mutate(
      {
        startsAt: aInstante(desde),
        endsAt: aInstante(hasta),
        ...(motivo.trim() ? { reason: motivo.trim() } : {}),
      },
      {
        onSuccess: (resultado) => {
          setCreado(resultado);
          setDesde("");
          setHasta("");
          setMotivo("");
        },
      },
    );
  }

  return (
    <div className="ds-stack">
      <form onSubmit={handleSubmit} className="ds-form">
        <Card heading="Nuevo bloqueo">
          <div className="ds-field-grid">
            <FormField label={<span className="ds-required">Desde</span>}>
              <input
                type="datetime-local"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                required
              />
            </FormField>
            <FormField label={<span className="ds-required">Hasta</span>}>
              <input
                type="datetime-local"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                required
              />
            </FormField>
            <div className="ds-field-grid--full">
              <FormField label="Motivo (interno, el paciente no lo ve)">
                <input
                  type="text"
                  maxLength={200}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                />
              </FormField>
            </div>
          </div>
          <Button
            type="submit"
            variant="primary"
            loading={crear.isPending}
            disabled={crear.isPending}
          >
            Bloquear
          </Button>
          {crear.isError ? (
            <ErrorState>
              {crear.error instanceof Error ? crear.error.message : "No pudimos crear el bloqueo."}
            </ErrorState>
          ) : null}
        </Card>
      </form>
      {creado && creado.turnosAfectados.length > 0 ? <TurnosAfectados resultado={creado} /> : null}
    </div>
  );
}

function TurnosAfectados({ resultado }: { resultado: BloqueoCreado }) {
  const cancelar = useCancelBooking();
  const [cancelados, setCancelados] = useState<string[]>([]);
  return (
    <Card heading="Turnos dentro del bloqueo">
      <Notice tone="warning" alert={false}>
        Estos turnos siguen en pie: no se cancelaron. A la recepción de la sede le quedó una tarea
        por cada uno para avisarle al paciente.
      </Notice>
      <Table>
        <thead>
          <tr>
            <th>Paciente</th>
            <th>Prestación</th>
            <th>Turno</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {resultado.turnosAfectados.map((t) => (
            <tr key={t.bookingId}>
              <td className="ds-cell-primary">{t.paciente.nombre}</td>
              <td>{t.prestacion.name}</td>
              <td>{formatDateTime(t.startsAt)}</td>
              <td>
                {cancelados.includes(t.bookingId) ? (
                  "Cancelado"
                ) : (
                  <Button
                    variant="secondary"
                    disabled={cancelar.isPending}
                    onClick={() =>
                      cancelar.mutate(t.bookingId, {
                        onSuccess: () => setCancelados((c) => [...c, t.bookingId]),
                      })
                    }
                  >
                    Cancelar turno
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
