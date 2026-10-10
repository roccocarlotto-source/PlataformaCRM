import { useState } from "react";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { useConfiguracionDeSede, useGuardarConfiguracionDeSede } from "./queries";

// ---------------------------------------------------------------------------
// R11 (docs/rubros.md §5.1, D10): el plazo mínimo para que el asistente
// reprograme o cancele un turno por chat. Una sección del formulario de la
// sede, solo en edición y solo en una clínica (la pantalla entera es de ADMIN).
// Sin valor por defecto: vacío = sin plazo. Se guarda con su propio botón, como
// el horario de atención.
// ---------------------------------------------------------------------------

const AYUDA_DEL_PLAZO =
  "Horas mínimas de anticipación para que el asistente reprograme o cancele un turno. Con menos tiempo, deriva a Recepción.";

export function PlazoDeCambioSection({ branchId }: { branchId: string }) {
  const configuracion = useConfiguracionDeSede(branchId);
  const guardar = useGuardarConfiguracionDeSede(branchId);
  // null = sin tocar: se muestra lo guardado.
  const [borrador, setBorrador] = useState<{ branchId: string; valor: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  if (configuracion.isLoading) {
    return (
      <Card heading="Turnos por chat">
        <LoadingState />
      </Card>
    );
  }
  if (configuracion.isError || !configuracion.data) {
    return (
      <Card heading="Turnos por chat">
        <ErrorState>
          No pudimos cargar la configuración de turnos por chat
          {configuracion.error instanceof Error ? `: ${configuracion.error.message}` : "."}
        </ErrorState>
      </Card>
    );
  }

  const guardadoEnLaSede = configuracion.data.minHoursToChangeBooking;
  const valor =
    borrador !== null && borrador.branchId === branchId
      ? borrador.valor
      : guardadoEnLaSede === null
        ? ""
        : String(guardadoEnLaSede);

  async function handleGuardar() {
    setError(null);
    setGuardado(false);
    const texto = valor.trim();
    const horas = texto === "" ? null : Number(texto);
    if (horas !== null && (!Number.isInteger(horas) || horas < 0)) {
      setError("Ingresá un número entero de horas, 0 o más. Dejalo vacío para no poner plazo.");
      return;
    }
    try {
      await guardar.mutateAsync({ minHoursToChangeBooking: horas });
      setBorrador(null);
      setGuardado(true);
    } catch (err) {
      setError(`No pudimos guardar el plazo${err instanceof Error ? `: ${err.message}` : "."}`);
    }
  }

  return (
    <Card heading="Turnos por chat">
      <div className="ds-stack">
        <FormField label="Anticipación mínima para cambiar un turno (horas)">
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={valor}
            placeholder="Sin plazo"
            onChange={(e) => {
              setGuardado(false);
              setBorrador({ branchId, valor: e.target.value });
            }}
            disabled={guardar.isPending}
          />
        </FormField>
        <p className="ds-hint">{AYUDA_DEL_PLAZO}</p>
        <p className="ds-hint">Vacío: sin plazo, el asistente puede cambiarlo hasta que empieza.</p>

        {error ? <ErrorState>{error}</ErrorState> : null}
        {guardado ? (
          <p className="ds-hint" role="status">
            El plazo quedó guardado.
          </p>
        ) : null}

        <div className="ds-card-actions">
          <Button
            variant="primary"
            onClick={() => void handleGuardar()}
            disabled={guardar.isPending}
            loading={guardar.isPending}
          >
            {guardar.isPending ? "Guardando…" : "Guardar plazo"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
