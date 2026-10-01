import { useConfirm } from "../../design-system/useConfirm";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { useEffect, useRef } from "react";
import {
  useCompleteMetaConnection,
  useDisconnectMetaConnection,
  useStartMetaConnection,
} from "./mutations";
import { useMetaConnection } from "./queries";
import type { MetaConnectionPendiente } from "./types";

interface MetaConnectionSectionProps {
  // Lo que trajo el callback del backend al volver a esta pantalla: un
  // ?metaError=... o el code y el state por completar (#metaCode/#metaState).
  // Lo lee OrganizationSettingsPage de la URL y lo pasa tal cual.
  resultadoDelCallback?: { error: string | null; pendiente?: MetaConnectionPendiente | null };
}

// ---------------------------------------------------------------------------
// Conexión de la página de Facebook de la organización (ítem 173; backend en
// los ítems 169-172). Una sección de la configuración de la organización y no
// una pantalla propia: la conexión es UNA por organización, sin sucursal.
//
// MÁS SIMPLE QUE GoogleCalendarSection A PROPÓSITO: al conectar se navega ESTA
// pestaña entera a Meta (window.location.href, no window.open), y cuando Meta
// termina el callback del backend redirige de vuelta a /organization con el
// resultado en la URL. No hay un estado "conectando" con "volver a
// consultar": al volver, la pantalla carga de cero.
//
// DESDE A-07 (docs-privados/auditoria-2026-09-30-corta.md, local) la conexión
// se completa ACÁ y no en el callback: el callback vuelve con el code y el
// state, y esta sección los manda con la sesión de quien está logueado. Si no
// es quien tocó "Conectar", o el code venció, el backend responde un mensaje
// que dice qué hacer, y se muestra tal cual.
//
// Tres estados: sin conectar (nunca, o desconectada), conectada (ACTIVE), y
// error (status ERROR, o el ?metaError= de una conexión que nunca llegó a
// guardarse). Se aplica al momento: no pasa por el "Guardar" de la moneda.
// ---------------------------------------------------------------------------
export function MetaConnectionSection({ resultadoDelCallback }: MetaConnectionSectionProps) {
  const confirm = useConfirm();
  const connectionQuery = useMetaConnection();
  const startMutation = useStartMetaConnection();
  const disconnectMutation = useDisconnectMetaConnection();
  const completeMutation = useCompleteMetaConnection();

  // UNA sola vez por montaje, aunque React corra el efecto dos veces (modo
  // estricto): el state es de un solo uso, y un segundo envío respondería
  // "ya se usó" encima de la conexión que acaba de quedar bien.
  // `mutate` de TanStack Query es estable entre renders: tenerlo en las deps
  // no hace que el efecto vuelva a correr.
  const pendiente = resultadoDelCallback?.pendiente ?? null;
  const { mutate: completar } = completeMutation;
  const yaEnviado = useRef(false);
  useEffect(() => {
    if (!pendiente || yaEnviado.current) return;
    yaEnviado.current = true;
    completar(pendiente);
  }, [pendiente, completar]);

  async function handleConectar() {
    try {
      const { authorizationUrl } = await startMutation.mutateAsync();
      window.location.href = authorizationUrl;
    } catch {
      // El error se muestra con el mensaje crudo de la API en su ErrorState.
    }
  }

  async function handleDesconectar() {
    if (
      !(await confirm(
        "¿Desconectar la página de Facebook? Los agentes dejan de contestar por Messenger y por Instagram.",
        { confirmLabel: "Desconectar", danger: true },
      ))
    ) {
      return;
    }
    disconnectMutation.mutate();
  }

  const conexion = connectionQuery.data ?? null;
  const activa = conexion?.status === "ACTIVE";
  // isSuccess de iniciar = la pestaña ya está navegando a Meta: el botón queda
  // deshabilitado para no firmar un segundo state con un doble click.
  const isBusy =
    startMutation.isPending ||
    startMutation.isSuccess ||
    disconnectMutation.isPending ||
    completeMutation.isPending;

  return (
    <Card heading="Facebook e Instagram">
      <p className="ds-hint">
        Con la página de Facebook conectada, los agentes que la tengan asignada contestan por
        Messenger y, si la página tiene una cuenta de Instagram vinculada, por Instagram. Conectar
        te lleva a Facebook y vuelve a esta pantalla. Se aplica al momento, sin tocar Guardar.
      </p>

      {completeMutation.isPending ? (
        <p className="ds-hint" role="status">
          Conectando la página de Facebook…
        </p>
      ) : null}
      {completeMutation.isSuccess ? (
        <p className="ds-hint" role="status">
          La página de Facebook quedó conectada.
        </p>
      ) : null}
      {completeMutation.isError ? (
        <ErrorState>
          No pudimos conectar Facebook
          {completeMutation.error instanceof Error ? `: ${completeMutation.error.message}` : "."}
        </ErrorState>
      ) : null}
      {resultadoDelCallback?.error ? (
        <ErrorState>No pudimos conectar Facebook: {resultadoDelCallback.error}</ErrorState>
      ) : null}

      {connectionQuery.isLoading ? <LoadingState /> : null}

      {connectionQuery.isError ? (
        <ErrorState>
          No pudimos consultar la conexión con Facebook
          {connectionQuery.error instanceof Error ? `: ${connectionQuery.error.message}` : "."}
        </ErrorState>
      ) : null}

      {connectionQuery.isSuccess && activa && conexion ? (
        <>
          <p>
            <Badge variant="success">Conectado</Badge> Página: <strong>{conexion.pageId}</strong>
          </p>
          <p>
            Instagram:{" "}
            {conexion.instagramBusinessAccountId ? (
              <strong>{conexion.instagramBusinessAccountId}</strong>
            ) : (
              "sin cuenta vinculada"
            )}
          </p>
          <div className="ds-card-actions">
            <Button
              variant="danger"
              onClick={handleDesconectar}
              disabled={isBusy}
              loading={disconnectMutation.isPending}
            >
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
          <p>
            <Badge variant="neutral">Sin conectar</Badge>
          </p>
          <div className="ds-card-actions">
            <Button
              variant="primary"
              onClick={() => void handleConectar()}
              disabled={isBusy}
              loading={startMutation.isPending || startMutation.isSuccess}
            >
              {startMutation.isPending || startMutation.isSuccess
                ? "Abriendo Facebook…"
                : "Conectar con Facebook"}
            </Button>
          </div>
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
          No pudimos desconectar la página de Facebook
          {disconnectMutation.error instanceof Error
            ? `: ${disconnectMutation.error.message}`
            : "."}
        </ErrorState>
      ) : null}
    </Card>
  );
}
