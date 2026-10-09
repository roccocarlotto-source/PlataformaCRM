import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { PageHeader } from "../../design-system/PageHeader";
import { Table } from "../../design-system/Table";
import { useConfirm } from "../../design-system/useConfirm";
import { NOMBRE_DE_EDICION } from "./ediciones";
import { useChangeOrganizationEdition } from "./mutations";
import { useEsencialOfrecida, usePlatformOrganizations } from "./queries";
import type { PlatformOrganization } from "./types";

// ---------------------------------------------------------------------------
// Plataforma → Organizaciones (docs/ediciones.md §7): las organizaciones
// vigentes con su edición, y "Pasar a edición completa" para las ESENCIAL
// (PATCH /api/admin/organizations/:id/edition). Solo hacia arriba: bajar no
// existe.
//
// Mientras el backend no ofrezca ESENCIAL (ESENCIAL_HABILITADA en false) no
// puede haber ninguna organización que subir, así que la pantalla no se
// muestra: el menú no la lista y la ruta vuelve al inicio. El "?" de ayuda
// llega con la sección 14 de la guía, en el PR que habilita ESENCIAL.
// ---------------------------------------------------------------------------

export function OrganizationsPage() {
  const esencial = useEsencialOfrecida();
  if (esencial.isLoading) return <LoadingState />;
  if (!esencial.ofrecida) return <Navigate to="/" replace />;
  return <ListaDeOrganizaciones />;
}

function ListaDeOrganizaciones() {
  const organizationsQuery = usePlatformOrganizations();
  const cambiarEdicion = useChangeOrganizationEdition();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [subida, setSubida] = useState<string | null>(null);

  async function pasarACompleta(org: PlatformOrganization) {
    setError(null);
    setSubida(null);
    const ok = await confirm(
      `¿Pasar «${org.name}» a la edición completa? Va a tener todos los módulos. No se puede volver a la edición esencial.`,
      { confirmLabel: "Pasar a completa" },
    );
    if (!ok) return;
    try {
      await cambiarEdicion.mutateAsync(org.id);
      setSubida(org.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cambiar la edición");
    }
  }

  return (
    <>
      <PageHeader title="Organizaciones" />
      <Card heading="Organizaciones vigentes">
        {organizationsQuery.isLoading ? <LoadingState /> : null}
        {organizationsQuery.isError ? (
          <ErrorState>No pudimos cargar las organizaciones.</ErrorState>
        ) : null}
        {error ? <ErrorState>{error}</ErrorState> : null}
        {subida ? <p role="status">«{subida}» ya tiene la edición completa.</p> : null}
        {organizationsQuery.isSuccess ? (
          organizationsQuery.data.length === 0 ? (
            <EmptyState>No hay organizaciones vigentes.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Organización</th>
                  <th>Identificador</th>
                  <th>Edición</th>
                  <th>
                    <span className="ds-sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {organizationsQuery.data.map((org) => (
                  <tr key={org.id}>
                    <td>{org.name}</td>
                    <td>
                      <code>{org.slug}</code>
                    </td>
                    <td>
                      <Badge variant={org.edition === "ESENCIAL" ? "info" : "neutral"}>
                        {NOMBRE_DE_EDICION[org.edition]}
                      </Badge>
                    </td>
                    <td>
                      {org.edition === "ESENCIAL" ? (
                        <Button
                          type="button"
                          onClick={() => void pasarACompleta(org)}
                          disabled={cambiarEdicion.isPending}
                        >
                          Pasar a edición completa
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        ) : null}
      </Card>
    </>
  );
}
