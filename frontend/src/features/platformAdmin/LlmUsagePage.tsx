import { PageHeader } from "../../design-system/PageHeader";
import { AYUDA } from "../guia/anclas";
import { Card } from "../../design-system/Card";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Table } from "../../design-system/Table";
import { ENTEROS, formatoDeCosto } from "./llmUsageFormat";
import { useLlmUsage } from "./queries";

// ---------------------------------------------------------------------------
// Uso de IA (B4): el gasto en el modelo por organización en los últimos 30
// días, de GET /api/admin/llm-usage (una fila por turno en llm_turn_usages).
// Solo platform admin: va bajo PlatformAdminRoute en el grupo "Plataforma".
// Una vista simple, de lectura: una tabla, sin filtros ni fechas. El tope
// diario por organización todavía no existe (decisión de Rocco, 06/10/2026).
// ---------------------------------------------------------------------------

export function LlmUsagePage() {
  const usageQuery = useLlmUsage();

  return (
    <>
      <PageHeader help={AYUDA.usoDeIa} title="Uso de IA" />
      <Card heading="Gasto por organización">
        {usageQuery.isLoading ? <LoadingState /> : null}
        {usageQuery.isError ? (
          <ErrorState>
            No pudimos cargar el uso de IA
            {usageQuery.error instanceof Error ? `: ${usageQuery.error.message}` : "."}
          </ErrorState>
        ) : null}
        {usageQuery.isSuccess ? (
          <>
            <p className="ds-hint">
              Últimos {usageQuery.data.dias} días, una fila por turno del agente. El costo es el que
              informa el proveedor; «—» cuando no lo informó.
            </p>
            {usageQuery.data.organizaciones.length === 0 ? (
              <EmptyState>No hay organizaciones vigentes.</EmptyState>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>Organización</th>
                    <th>Turnos</th>
                    <th>Tokens de entrada</th>
                    <th>Tokens de salida</th>
                    <th>Costo (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {usageQuery.data.organizaciones.map((org) => (
                    <tr key={org.organizationId}>
                      <td>{org.organizationName}</td>
                      <td>{ENTEROS.format(org.turnos)}</td>
                      <td>{ENTEROS.format(org.promptTokens)}</td>
                      <td>{ENTEROS.format(org.completionTokens)}</td>
                      <td>{formatoDeCosto(org.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </>
        ) : null}
      </Card>
    </>
  );
}
