import { AYUDA } from "../guia/anclas";
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
import { CONFIRMACION_DEL_REINICIO, esClinicaDemo } from "./clinicaDemo";
import { NOMBRE_DE_EDICION } from "./ediciones";
import {
  useChangeOrganizationEdition,
  useReenviarInvitacionDelAdministrador,
  useReiniciarDatosDeLaDemo,
} from "./mutations";
import { useEsencialOfrecida, usePlatformOrganizations } from "./queries";
import type { PlatformOrganization } from "./types";

// ---------------------------------------------------------------------------
// Plataforma → Organizaciones (docs/ediciones.md §7): las organizaciones
// vigentes con su edición, y "Pasar a edición completa" para las ESENCIAL
// (PATCH /api/admin/organizations/:id/edition). Solo hacia arriba: bajar no
// existe.
//
// Si el backend no ofrece ESENCIAL (ESENCIAL_HABILITADA en false) no puede
// haber ninguna organización que subir, así que la pantalla no se muestra: el
// menú no la lista y la ruta vuelve al inicio. Su "?" apunta a la sección 14
// de la guía (plataforma#organizaciones).
//
// "Reenviar invitación" (prueba de la Clínica Demo, 2026-10-11): en todas las
// filas, porque saber si el administrador ya la aceptó es preguntarle a
// Supabase por cada organización; lo decide el backend al reenviar (409 si ya
// la aceptó).
//
// "Reiniciar datos de demo" (docs/rubros.md §12.3): solo en las filas de una
// Clínica Demo (esClinicaDemo). Borra pacientes, turnos, conversaciones y
// tareas, y vuelve a cargar los de ejemplo; la confirmación dice qué se borra
// y qué queda.
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
  const reenviar = useReenviarInvitacionDelAdministrador();
  const [reenviada, setReenviada] = useState<string | null>(null);
  const reiniciar = useReiniciarDatosDeLaDemo();
  const [reiniciada, setReiniciada] = useState<string | null>(null);

  function limpiarMensajes() {
    setError(null);
    setSubida(null);
    setReenviada(null);
    setReiniciada(null);
  }

  async function reiniciarDemo(org: PlatformOrganization) {
    limpiarMensajes();
    const ok = await confirm(
      `¿Reiniciar los datos de «${org.name}»? ${CONFIRMACION_DEL_REINICIO}`,
      { confirmLabel: "Reiniciar datos", danger: true },
    );
    if (!ok) return;
    try {
      const { cargados } = await reiniciar.mutateAsync(org.id);
      setReiniciada(
        `Reiniciamos «${org.name}»: ${cargados.pacientes} pacientes y ${cargados.turnosProximos} turnos próximos de ejemplo, más ${cargados.turnosAtendidos} atendidos la semana pasada.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos reiniciar los datos de la demo");
    }
  }

  async function reenviarInvitacion(org: PlatformOrganization) {
    limpiarMensajes();
    const ok = await confirm(
      `¿Reenviar la invitación al administrador de «${org.name}»? Le llega de nuevo el mail para elegir su contraseña.`,
      { confirmLabel: "Reenviar" },
    );
    if (!ok) return;
    try {
      const { email } = await reenviar.mutateAsync(org.id);
      setReenviada(`Reenviamos la invitación de «${org.name}» a ${email}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos reenviar la invitación");
    }
  }

  async function pasarACompleta(org: PlatformOrganization) {
    limpiarMensajes();
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
      <PageHeader help={AYUDA.organizaciones} title="Organizaciones" />
      <Card heading="Organizaciones vigentes">
        {organizationsQuery.isLoading ? <LoadingState /> : null}
        {organizationsQuery.isError ? (
          <ErrorState>No pudimos cargar las organizaciones.</ErrorState>
        ) : null}
        {error ? <ErrorState>{error}</ErrorState> : null}
        {subida ? <p role="status">«{subida}» ya tiene la edición completa.</p> : null}
        {reenviada ? <p role="status">{reenviada}</p> : null}
        {reiniciada ? <p role="status">{reiniciada}</p> : null}
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
                      <div className="ds-row-actions">
                        <Button
                          type="button"
                          onClick={() => void reenviarInvitacion(org)}
                          disabled={reenviar.isPending}
                        >
                          Reenviar invitación
                        </Button>
                        {org.edition === "ESENCIAL" ? (
                          <Button
                            type="button"
                            onClick={() => void pasarACompleta(org)}
                            disabled={cambiarEdicion.isPending}
                          >
                            Pasar a edición completa
                          </Button>
                        ) : null}
                        {esClinicaDemo(org) ? (
                          <Button
                            type="button"
                            variant="danger"
                            onClick={() => void reiniciarDemo(org)}
                            disabled={reiniciar.isPending}
                          >
                            Reiniciar datos de demo
                          </Button>
                        ) : null}
                      </div>
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
