import { useState } from "react";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { Select } from "../../design-system/Select";
import { useConfiguracionDeSede, useGuardarConfiguracionDeSede } from "./queries";
import type { PoliticaDeTurnoTardio } from "./types";

// ---------------------------------------------------------------------------
// R13 (docs/rubros.md §6.2): el recordatorio de turno de la sede. Una sección
// del formulario de la sede, solo en edición y solo en una clínica (la
// pantalla entera es de ADMIN). Se guarda con su propio botón.
// ---------------------------------------------------------------------------

const OPCIONES_DE_TURNO_TARDIO: { value: PoliticaDeTurnoTardio; label: string }[] = [
  { value: "NO_ENVIAR", label: "No mandar recordatorio" },
  { value: "EN_EL_MOMENTO", label: "Mandarlo en el momento" },
  { value: "HORAS_ANTES", label: "Mandarlo unas horas antes del turno" },
];

interface Borrador {
  branchId: string;
  horas: string;
  tardio: PoliticaDeTurnoTardio;
  horasTardio: string;
}

function enteroEn(texto: string, min: number, max: number): number | null {
  const n = Number(texto.trim());
  return texto.trim() !== "" && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export function RecordatoriosSection({ branchId }: { branchId: string }) {
  const configuracion = useConfiguracionDeSede(branchId);
  const guardar = useGuardarConfiguracionDeSede(branchId);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  if (configuracion.isLoading) {
    return (
      <Card heading="Recordatorios">
        <LoadingState />
      </Card>
    );
  }
  if (configuracion.isError || !configuracion.data) {
    return (
      <Card heading="Recordatorios">
        <ErrorState>
          No pudimos cargar la configuración de los recordatorios
          {configuracion.error instanceof Error ? `: ${configuracion.error.message}` : "."}
        </ErrorState>
      </Card>
    );
  }

  const datos = configuracion.data;
  const valores: Borrador =
    borrador !== null && borrador.branchId === branchId
      ? borrador
      : {
          branchId,
          horas: String(datos.reminderHoursBefore),
          tardio: datos.lateBookingReminder,
          horasTardio: String(datos.lateBookingHoursBefore),
        };

  function cambiar(parcial: Partial<Borrador>) {
    setGuardado(false);
    setBorrador({ ...valores, ...parcial });
  }

  async function handleGuardar() {
    setError(null);
    setGuardado(false);
    const horas = enteroEn(valores.horas, 1, 72);
    if (horas === null) {
      setError("Las horas de anticipación del recordatorio tienen que ser un entero de 1 a 72.");
      return;
    }
    const horasTardio = enteroEn(valores.horasTardio, 1, 23);
    if (valores.tardio === "HORAS_ANTES" && horasTardio === null) {
      setError("Las horas antes del turno tienen que ser un entero de 1 a 23.");
      return;
    }
    try {
      await guardar.mutateAsync({
        reminderHoursBefore: horas,
        lateBookingReminder: valores.tardio,
        ...(valores.tardio === "HORAS_ANTES" && horasTardio !== null
          ? { lateBookingHoursBefore: horasTardio }
          : {}),
      });
      setBorrador(null);
      setGuardado(true);
    } catch (err) {
      setError(
        `No pudimos guardar los recordatorios${err instanceof Error ? `: ${err.message}` : "."}`,
      );
    }
  }

  return (
    <Card heading="Recordatorios">
      <div className="ds-stack">
        <p className="ds-hint">
          Antes de cada turno, el paciente recibe un WhatsApp para confirmar o cancelar. Hace falta
          una regla activa «Recordatorio antes del turno» en Automatizaciones.
        </p>
        <FormField label="Horas de anticipación del recordatorio">
          <input
            type="number"
            min={1}
            max={72}
            step={1}
            inputMode="numeric"
            value={valores.horas}
            onChange={(e) => cambiar({ horas: e.target.value })}
            disabled={guardar.isPending}
          />
        </FormField>
        <Select<PoliticaDeTurnoTardio>
          id="recordatorio-turno-tardio"
          label="Si el turno se da con menos anticipación"
          value={valores.tardio}
          options={OPCIONES_DE_TURNO_TARDIO}
          onChange={(tardio) => {
            if (tardio) cambiar({ tardio });
          }}
          disabled={guardar.isPending}
        />
        {valores.tardio === "HORAS_ANTES" ? (
          <FormField label="Horas antes del turno">
            <input
              type="number"
              min={1}
              max={23}
              step={1}
              inputMode="numeric"
              value={valores.horasTardio}
              onChange={(e) => cambiar({ horasTardio: e.target.value })}
              disabled={guardar.isPending}
            />
          </FormField>
        ) : null}
        <p className="ds-hint">Cambiarlo no mueve los recordatorios que ya están programados.</p>

        {error ? <ErrorState>{error}</ErrorState> : null}
        {guardado ? (
          <p className="ds-hint" role="status">
            Los recordatorios quedaron guardados.
          </p>
        ) : null}

        <div className="ds-card-actions">
          <Button
            variant="primary"
            onClick={() => void handleGuardar()}
            disabled={guardar.isPending}
            loading={guardar.isPending}
          >
            {guardar.isPending ? "Guardando…" : "Guardar recordatorios"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
