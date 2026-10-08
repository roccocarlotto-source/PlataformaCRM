import { Badge } from "../../design-system/Badge";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { MetaConnectionIdentity } from "./MetaConnectionIdentity";
import { useMetaConnection } from "./queries";

// ---------------------------------------------------------------------------
// Conexión de la página de Facebook de la organización (ítem 173; backend en
// los ítems 169-172). Una sección de la configuración de la organización y no
// una pantalla propia: la conexión es UNA por organización, sin sucursal.
//
// SOLO INFORMATIVA DESDE EL 02/10/2026, para todos los roles: conectar y
// desconectar lo hace el equipo de la plataforma desde Plataforma → Página de
// Facebook (el diálogo de Meta le muestra a quien conecta los portfolios y
// negocios de su cuenta de Facebook, y para un cliente es confuso y riesgoso).
// Mismo criterio que el "ID del número de WhatsApp" del agente: se ve, no se
// toca. Qué página y qué Instagram: MetaConnectionIdentity (nombres, o los ids
// si no los hay).
// ---------------------------------------------------------------------------
export function MetaConnectionSection() {
  const connectionQuery = useMetaConnection();
  const conexion = connectionQuery.data ?? null;

  return (
    <Card heading="Facebook e Instagram">
      <p className="ds-hint">
        Con la página conectada, los agentes contestan por Messenger e Instagram.
      </p>

      {connectionQuery.isLoading ? <LoadingState /> : null}

      {connectionQuery.isError ? (
        <ErrorState>
          No pudimos consultar la conexión con Facebook
          {connectionQuery.error instanceof Error ? `: ${connectionQuery.error.message}` : "."}
        </ErrorState>
      ) : null}

      {connectionQuery.isSuccess && conexion?.status === "ACTIVE" ? (
        <>
          <p>
            <Badge variant="success">Conectada</Badge>
          </p>
          <MetaConnectionIdentity conexion={conexion} />
        </>
      ) : null}

      {connectionQuery.isSuccess && conexion?.status === "ERROR" ? (
        <ErrorState>
          La conexión con Facebook dejó de funcionar
          {conexion.lastErrorMessage ? `: ${conexion.lastErrorMessage}` : "."} Avisale al equipo de
          la plataforma para que la vuelva a conectar.
        </ErrorState>
      ) : null}

      {connectionQuery.isSuccess && (!conexion || conexion.status === "REVOKED") ? (
        <p>
          <Badge variant="neutral">Sin conectar</Badge> La conexión con Facebook e Instagram la
          configura el equipo de la plataforma.
        </p>
      ) : null}
    </Card>
  );
}
