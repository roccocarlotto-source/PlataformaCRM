import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "../../design-system/Button";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Notice } from "../../design-system/Notice";
import { PageHeader } from "../../design-system/PageHeader";
import { Select } from "../../design-system/Select";
import { Table } from "../../design-system/Table";
import { formatDateTime } from "../../design-system/detailFormat";
import { ContactSelect } from "../opportunity/ContactSelect";
import { useCrearSobreturno, useHorariosConSobreturnos } from "./agendaQueries";
import { usePrestaciones } from "./queries";
import { sedesDeQuienEntra } from "./sedes";
import { useVocabularioDeClinica } from "./vocabulario";

// ---------------------------------------------------------------------------
// Sobreturnos (docs/rubros.md §4.4, R6): un turno de más encima de un horario
// completo, para un profesional que los admite (lo habilita un ADMIN en
// Profesionales) y sin pasar su tope del día. Los cargan ADMIN y Recepción;
// el asistente nunca los ofrece.
// ---------------------------------------------------------------------------

function rangoDelDia(fecha: string): { from: string; to: string } {
  const inicio = new Date(`${fecha}T00:00:00`);
  const fin = new Date(inicio.getTime() + 24 * 60 * 60 * 1000);
  return { from: inicio.toISOString(), to: fin.toISOString() };
}

function hoy(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

export function SobreturnosPage() {
  const { me } = useAuth();
  const vocabulario = useVocabularioDeClinica();
  const sedes = sedesDeQuienEntra(me);
  const prestacionesQuery = usePrestaciones();
  const prestaciones = (prestacionesQuery.data?.prestaciones ?? []).filter(
    (p) => sedes === null || sedes.some((s) => s.id === p.branchId),
  );

  const [serviceTypeId, setServiceTypeId] = useState<string | undefined>(undefined);
  const [resourceId, setResourceId] = useState<string | undefined>(undefined);
  const [fecha, setFecha] = useState(hoy);
  const [contactId, setContactId] = useState<string | undefined>(undefined);
  const [cargado, setCargado] = useState<string | null>(null);

  const prestacion = prestaciones.find((p) => p.id === serviceTypeId);
  const consulta =
    serviceTypeId && resourceId ? { serviceTypeId, resourceId, ...rangoDelDia(fecha) } : null;
  const horariosQuery = useHorariosConSobreturnos(consulta);
  const sobreturnos = (horariosQuery.data?.availability ?? []).filter((h) => h.overbooking);
  const crear = useCrearSobreturno();

  function cargar(startsAt: string) {
    if (!serviceTypeId || !resourceId || !contactId) return;
    crear.mutate(
      { serviceTypeId, resourceId, contactId, startsAt },
      { onSuccess: () => setCargado(startsAt) },
    );
  }

  return (
    <div>
      <PageHeader title="Sobreturnos" />
      <div className="ds-list-card">
        <div className="ds-filters">
          <Select
            label={vocabulario.tipoDeServicio.singularTitulo}
            value={serviceTypeId}
            options={prestaciones.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(id) => {
              setServiceTypeId(id || undefined);
              setResourceId(undefined);
            }}
          />
          <Select
            label={vocabulario.recurso.singularTitulo}
            value={resourceId}
            options={(prestacion?.profesionales ?? []).map((r) => ({ value: r.id, label: r.name }))}
            onChange={(id) => setResourceId(id || undefined)}
          />
          <div>
            <label htmlFor="sobreturno-fecha">Día</label>
            <input
              id="sobreturno-fecha"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </div>
        </div>

        <ContactSelect
          id="sobreturno-paciente"
          label={vocabulario.contacto.singularTitulo}
          value={contactId}
          onChange={(id) => setContactId(id || undefined)}
        />

        {prestacionesQuery.isLoading || horariosQuery.isLoading ? (
          <LoadingState variant="rows" />
        ) : null}
        {horariosQuery.isError ? (
          <ErrorState>
            {horariosQuery.error instanceof Error
              ? horariosQuery.error.message
              : "No pudimos cargar los horarios."}
          </ErrorState>
        ) : null}
        {cargado ? (
          <Notice tone="info">Sobreturno cargado para el {formatDateTime(cargado)}.</Notice>
        ) : null}
        {consulta && horariosQuery.isSuccess && sobreturnos.length === 0 ? (
          <EmptyState title="No hay sobreturnos para ese día" icon={CalendarPlus}>
            El {vocabulario.recurso.singular} no admite sobreturnos, ya llegó a su tope del día o
            todavía hay horarios libres para un turno normal.
          </EmptyState>
        ) : null}
        {sobreturnos.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>Horario completo</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {sobreturnos.map((h) => (
                <tr key={h.startsAt}>
                  <td>{formatDateTime(h.startsAt)}</td>
                  <td>
                    <Button
                      variant="primary"
                      disabled={!contactId || crear.isPending}
                      onClick={() => cargar(h.startsAt)}
                    >
                      Cargar sobreturno
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}
        {crear.isError ? (
          <ErrorState>
            {crear.error instanceof Error
              ? crear.error.message
              : "No pudimos cargar el sobreturno."}
          </ErrorState>
        ) : null}
      </div>
    </div>
  );
}
