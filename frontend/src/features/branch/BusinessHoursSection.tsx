import { useState } from "react";
import { useConfirm } from "../../design-system/useConfirm";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { WorkingHoursEditor } from "../resource/WorkingHoursEditor";
import {
  agruparPorDia,
  aplanar,
  validarHorario,
  type HorarioSemanal,
} from "../resource/workingHours";
import { useReplaceBranchBusinessHours } from "./mutations";
import { useBranchBusinessHours } from "./queries";

interface BusinessHoursSectionProps {
  branchId: string;
}

// ---------------------------------------------------------------------------
// Horario de atención de la sucursal: la ventana en la que salen los mensajes
// automáticos (reseñas, cupones). Una sección del formulario de la sucursal,
// solo en edición —cuelga del id, igual que GoogleCalendarSection—, y solo
// para ADMIN porque toda la pantalla está bajo AdminRoute.
//
// REUSA EL EDITOR DEL HORARIO LABORAL DE LOS RECURSOS (resource/
// WorkingHoursEditor + resource/workingHours.ts): mismo formato de franjas,
// mismas validaciones (HH:MM, inicio antes que fin, superposición, tope de 50).
// El editor no valida nada; esta sección corre validarHorario al guardar.
//
// SE GUARDA APARTE DEL "Guardar" DEL FORMULARIO, con su propio botón: es otra
// request (PATCH /branches/:id/business-hours) y ese "Guardar" navega al
// listado. Mismo criterio que Google Calendar: sus botones son type="button" y
// actúan al momento.
//
// SIN HORARIO PROPIO (configured: false) el editor arranca con el de por
// defecto, para que cargar uno sea partir de ahí y ajustar. Volver al de por
// defecto es guardar la semana vacía ([]); por eso guardar el editor sin
// ninguna franja tiene el mismo efecto.
// ---------------------------------------------------------------------------
export function BusinessHoursSection({ branchId }: BusinessHoursSectionProps) {
  const confirm = useConfirm();
  const hoursQuery = useBranchBusinessHours(branchId);
  const replaceMutation = useReplaceBranchBusinessHours(branchId);

  // Borrador atado a la sucursal, mismo motivo que useFormDraft: el router no
  // remonta al pasar de una sucursal a otra. Acá no se usa useFormDraft porque
  // después de guardar hay que DESCARTAR el borrador (volver a derivar de la
  // cache, que la mutación ya actualizó), y ese hook no ofrece reset.
  const [borrador, setBorrador] = useState<{ branchId: string; horario: HorarioSemanal } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<string | null>(null);

  if (hoursQuery.isLoading) {
    return (
      <Card heading="Horario de atención">
        <LoadingState />
      </Card>
    );
  }

  if (hoursQuery.isError || !hoursQuery.data) {
    return (
      <Card heading="Horario de atención">
        <ErrorState>
          No pudimos cargar el horario de atención
          {hoursQuery.error instanceof Error ? `: ${hoursQuery.error.message}` : "."}
        </ErrorState>
      </Card>
    );
  }

  const datos = hoursQuery.data;
  const horario =
    borrador !== null && borrador.branchId === branchId
      ? borrador.horario
      : agruparPorDia(datos.configured ? datos.businessHours : datos.defaultBusinessHours);
  const isSaving = replaceMutation.isPending;

  function cambiar(nuevo: HorarioSemanal) {
    setGuardado(null);
    setBorrador({ branchId, horario: nuevo });
  }

  async function guardar(semana: ReturnType<typeof aplanar>, aviso: string) {
    setError(null);
    setGuardado(null);
    try {
      await replaceMutation.mutateAsync(semana);
      setBorrador(null);
      setGuardado(aviso);
    } catch (err) {
      setError(
        `No pudimos guardar el horario de atención${err instanceof Error ? `: ${err.message}` : "."}`,
      );
    }
  }

  function handleGuardar() {
    const errorDeHorario = validarHorario(horario);
    if (errorDeHorario) {
      setGuardado(null);
      setError(errorDeHorario);
      return;
    }
    void guardar(aplanar(horario), "El horario de atención quedó guardado.");
  }

  async function handleVolverAlDefault() {
    if (
      !(await confirm(
        "¿Volver al horario por defecto? Se borra el horario de atención cargado para esta sucursal.",
        { confirmLabel: "Volver al horario por defecto", danger: true },
      ))
    ) {
      return;
    }
    void guardar([], "La sucursal volvió al horario por defecto.");
  }

  return (
    <Card heading="Horario de atención">
      <div className="ds-stack">
        <p className="ds-hint">
          Los mensajes automáticos (reseñas, cupones) solo se envían dentro de este horario. El
          agente responde a los clientes a cualquier hora.
        </p>

        {datos.configured ? null : (
          <p className="ds-hint">
            Esta sucursal usa el horario por defecto: lunes a sábado de 9:00 a 20:00. Cargar uno
            propio es opcional.
          </p>
        )}

        <WorkingHoursEditor value={horario} onChange={cambiar} disabled={isSaving} />

        {error ? <ErrorState>{error}</ErrorState> : null}
        {guardado ? (
          <p className="ds-hint" role="status">
            {guardado}
          </p>
        ) : null}

        <div className="ds-card-actions">
          <Button variant="primary" onClick={handleGuardar} disabled={isSaving} loading={isSaving}>
            {isSaving ? "Guardando…" : "Guardar horario"}
          </Button>
          {datos.configured ? (
            <Button onClick={handleVolverAlDefault} disabled={isSaving}>
              Volver al horario por defecto
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
