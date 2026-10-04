import { useEffect, useRef } from "react";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { useConfirm } from "../../design-system/useConfirm";
import { MetaConnectionIdentity } from "../organization/MetaConnectionIdentity";
import {
  useCompleteOrganizationMetaConnection,
  useDisconnectOrganizationMetaConnection,
  useStartOrganizationMetaConnection,
} from "./mutations";
import { useOrganizationMetaConnection } from "./queries";
import type { MetaConnectionPendiente } from "./types";

interface OrganizationMetaConnectionCardProps {
  organizationId: string;
  // Lo que trajo el callback del backend al volver a esta pantalla: un
  // ?metaError=... o el code y el state por completar (#metaCode/#metaState).
  // Lo lee AgentFacebookPagePage de la URL y lo pasa solo a la tarjeta de la
  // organización con la que volvió.
  resultadoDelCallback?: { error: string | null; pendiente: MetaConnectionPendiente | null };
}

// ---------------------------------------------------------------------------
// La página de Facebook de una organización elegida, conectada por el platform
// admin (decisión del 02/10/2026; antes lo hacía el ADMIN del negocio desde
// Configuración → Organización, que ahora solo la muestra). El diálogo de
// Meta le muestra a quien conecta los portfolios y negocios de su cuenta: el
// cliente le da acceso a su página al portfolio de la plataforma y la
// plataforma la conecta desde acá (docs/meta-alta-de-cliente.md).
//
// Al conectar se navega ESTA pestaña entera a Meta (window.location.href), y
// cuando Meta termina, el callback del backend redirige de vuelta a esta
// pantalla con la organización en ?organizationId= y el code y el state en el
// fragmento. Esta tarjeta los manda con la sesión de quien está logueado
// (A-07): si no es quien tocó "Conectar", o es otra organización, o el code
// venció, el backend responde un mensaje que dice qué hacer, y se muestra tal
// cual.
// ---------------------------------------------------------------------------
export function OrganizationMetaConnectionCard({
  organizationId,
  resultadoDelCallback,
}: OrganizationMetaConnectionCardProps) {
  const confirm = useConfirm();
  const connectionQuery = useOrganizationMetaConnection(organizationId);
  const startMutation = useStartOrganizationMetaConnection();
  const disconnectMutation = useDisconnectOrganizationMetaConnection();
  const completeMutation = useCompleteOrganizationMetaConnection();

  // UNA sola vez por montaje, aunque React corra el efecto dos veces (modo
  // estricto): el state es de un solo uso, y un segundo envío respondería
  // "ya se usó" encima de la conexión que acaba de quedar bien.
  const pendiente = resultadoDelCallback?.pendiente ?? null;
  const { mutate: completar } = completeMutation;
  const yaEnviado = useRef(false);
  useEffect(() => {
    if (!pendiente || yaEnviado.current) return;
    yaEnviado.current = true;
    completar({ organizationId, pendiente });
  }, [pendiente, organizationId, completar]);

  async function handleConectar() {
    try {
      const { authorizationUrl } = await startMutation.mutateAsync(organizationId);
      window.location.href = authorizationUrl;
    } catch {
      // El error se muestra con el mensaje crudo de la API en su ErrorState.
    }
  }

  async function handleDesconectar() {
    if (
      !(await confirm(
        "¿Desconectar la página de Facebook de esta organización? Sus agentes dejan de contestar por Messenger y por Instagram.",
        { confirmLabel: "Desconectar", danger: true },
      ))
    ) {
      return;
    }
    disconnectMutation.mutate(organizationId);
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
    <Card heading="Facebook e Instagram de la organización">
      <p className="ds-hint">
        Conectar te lleva a Facebook con tu cuenta y vuelve a esta pantalla. En la pantalla de Meta
        elegí una sola página: la del cliente, compartida con el portfolio de la plataforma.
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
            <Badge variant="success">Conectada</Badge>
          </p>
          <MetaConnectionIdentity conexion={conexion} />
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
