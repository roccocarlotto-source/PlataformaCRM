import { useState } from "react";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { useDisconnectGoogleCalendar, useStartGoogleCalendarConnection } from "./mutations";
import { useGoogleCalendarConnection } from "./queries";

interface GoogleCalendarSectionProps {
  branchId: string;
  // Lo que trajo el callback del backend al volver a esta pantalla
  // (?calendarConnected=true / ?calendarError=...). Lo lee BranchFormPage de
  // la URL y lo pasa tal cual.
  resultadoDelCallback?: { conectado: boolean; error: string | null };
}

// ---------------------------------------------------------------------------
// Conexión de la sucursal con Google Calendar (ítem 75). Una sección del
// formulario de la sucursal y no una pantalla propia: es una propiedad de LA
// sucursal, como el vendedor por defecto, y solo existe cuando la sucursal ya
// tiene id.
//
// TRES ESTADOS DE UI:
//   - sin conectar (nunca se conectó, o se desconectó): botón "Conectar".
//   - conectando: se abrió la pestaña de Google y la persona está ahí. No hay
//     aviso en tiempo real hacia esta pestaña —el flujo termina en el callback
//     del backend, en la OTRA—, así que se dice qué hacer y se ofrece volver a
//     consultar. Además la query se refetchea sola al volver el foco.
//   - conectada: el calendario y "Desconectar".
// Un cuarto, ERROR, es una conexión que existía y que Google dejó de aceptar:
// se muestra por qué y se ofrece reconectar.
//
// AL CONECTAR SE ABRE UNA PESTAÑA NUEVA Y NO SE NAVEGA ESTA: el backend
// devuelve la URL de autorización en el cuerpo (no un 302, porque un redirect
// no lleva el header Authorization), y la vuelta de Google cae en el callback,
// que a su vez redirige a este mismo formulario en ESA pestaña. Esta queda
// donde estaba, sin perder nada tipeado en el resto del formulario.
//
// Estas acciones se aplican al momento: no pasan por el "Guardar" del
// formulario, que solo guarda los datos de la sucursal.
// ---------------------------------------------------------------------------
export function GoogleCalendarSection({
  branchId,
  resultadoDelCallback,
}: GoogleCalendarSectionProps) {
  const connectionQuery = useGoogleCalendarConnection(branchId);
  const startMutation = useStartGoogleCalendarConnection(branchId);
  const disconnectMutation = useDisconnectGoogleCalendar(branchId);
  // La URL que se abrió. Mientras exista, la sección está "conectando" (salvo
  // que la conexión ya figure activa). Se guarda para ofrecerla como link por
  // si el navegador bloqueó la pestaña.
  const [urlAbierta, setUrlAbierta] = useState<string | null>(null);

  async function handleConectar() {
    try {
      const { authorizationUrl } = await startMutation.mutateAsync();
      window.open(authorizationUrl, "_blank", "noopener");
      setUrlAbierta(authorizationUrl);
    } catch {
      // El error se muestra con el mensaje crudo de la API en su ErrorState.
    }
  }

  function handleDesconectar() {
    if (
      !window.confirm(
        "¿Desconectar Google Calendar? Las reservas nuevas de esta sucursal dejan de aparecer en el calendario.",
      )
    ) {
      return;
    }
    setUrlAbierta(null);
    disconnectMutation.mutate();
  }

  const conexion = connectionQuery.data ?? null;
  const activa = conexion?.status === "ACTIVE";
  const conectando = urlAbierta !== null && !activa;
  const isBusy = startMutation.isPending || disconnectMutation.isPending;

  return (
    <Card heading="Google Calendar">
      <p className="ds-hint">
        Con Google Calendar conectado, las reservas de esta sucursal se reflejan en ese calendario y
        los eventos que ya tenga ocupan esos horarios. Se aplica al momento, sin tocar Guardar.
      </p>

      {resultadoDelCallback?.conectado ? (
        <p className="ds-hint" role="status">
          Google Calendar quedó conectado.
        </p>
      ) : null}
      {resultadoDelCallback?.error ? (
        <ErrorState>No se pudo conectar Google Calendar: {resultadoDelCallback.error}</ErrorState>
      ) : null}

      {connectionQuery.isLoading ? <LoadingState /> : null}

      {connectionQuery.isError ? (
        <ErrorState>
          No pudimos consultar la conexión con Google Calendar
          {connectionQuery.error instanceof Error ? `: ${connectionQuery.error.message}` : "."}
        </ErrorState>
      ) : null}

      {connectionQuery.isSuccess && activa && conexion ? (
        <>
          <p>
            <Badge variant="success">Conectado</Badge> Calendario:{" "}
            <strong>{conexion.calendarId}</strong>
          </p>
          <div className="ds-card-actions">
            <Button variant="danger" onClick={handleDesconectar} disabled={isBusy}>
              {disconnectMutation.isPending ? "Desconectando…" : "Desconectar"}
            </Button>
          </div>
        </>
      ) : null}

      {connectionQuery.isSuccess && !activa ? (
        <>
          {conexion?.status === "ERROR" ? (
            <ErrorState>
              La conexión dejó de funcionar
              {conexion.lastErrorMessage ? `: ${conexion.lastErrorMessage}` : "."} Volvé a
              conectarla.
            </ErrorState>
          ) : null}

          {conectando ? (
            <>
              <p className="ds-hint" role="status">
                Terminá la autorización en la pestaña de Google que se abrió. Cuando vuelvas,
                consultá el estado.{" "}
                <a href={urlAbierta} target="_blank" rel="noopener noreferrer">
                  Si no se abrió, abrila acá.
                </a>
              </p>
              <div className="ds-card-actions">
                <Button
                  onClick={() => void connectionQuery.refetch()}
                  disabled={connectionQuery.isFetching}
                >
                  {connectionQuery.isFetching ? "Consultando…" : "Volver a consultar"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p>
                <Badge variant="neutral">Sin conectar</Badge>
              </p>
              <div className="ds-card-actions">
                <Button variant="primary" onClick={() => void handleConectar()} disabled={isBusy}>
                  {startMutation.isPending ? "Abriendo Google…" : "Conectar con Google Calendar"}
                </Button>
              </div>
            </>
          )}
        </>
      ) : null}

      {startMutation.isError ? (
        <ErrorState>
          No pudimos iniciar la conexión
          {startMutation.error instanceof Error ? `: ${startMutation.error.message}` : "."}
        </ErrorState>
      ) : null}

      {disconnectMutation.isError ? (
        <ErrorState>
          No pudimos desconectar Google Calendar
          {disconnectMutation.error instanceof Error
            ? `: ${disconnectMutation.error.message}`
            : "."}
        </ErrorState>
      ) : null}
    </Card>
  );
}
