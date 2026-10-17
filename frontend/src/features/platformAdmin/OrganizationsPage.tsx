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
import { previaDeActivacion } from "./api";
import { NOMBRE_DE_EDICION } from "./ediciones";
import {
  useCambiarModulo,
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
// "Módulos" (docs/servicios.md §1.5): los activables vigentes de cada
// organización, y "Activar Servicios" / "Desactivar Servicios" con
// confirmación. Activar solo se ofrece en una AUTOMOTORA: el backend responde
// 400 a cualquier otro rubro. Antes de confirmar la activación se pide la
// previa (S10): cuántas ventas ganadas se van a convertir en vehículos de
// clientes. Si la previa falla, se confirma igual, sin el número.
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
  const cambiarModulo = useCambiarModulo();
  const [moduloCambiado, setModuloCambiado] = useState<string | null>(null);

  function limpiarMensajes() {
    setError(null);
    setSubida(null);
    setReenviada(null);
    setReiniciada(null);
    setModuloCambiado(null);
  }

  async function cambiarServicios(org: PlatformOrganization, activo: boolean) {
    limpiarMensajes();
    let ventas = "";
    if (activo) {
      try {
        const { ventasAConvertir: n } = await previaDeActivacion(org.id, "servicios");
        if (n > 0) {
          ventas =
            n === 1
              ? " Se va a crear 1 vehículo de cliente a partir de una venta anterior."
              : ` Se van a crear ${String(n)} vehículos de clientes a partir de ventas anteriores.`;
        }
      } catch {
        // Sin la previa se confirma igual: el número es informativo.
      }
    }
    const ok = await confirm(
      activo
        ? `¿Activar Servicios en «${org.name}»? Sus usuarios van a ver el módulo Taller.${ventas} Se puede desactivar y los datos se conservan.`
        : `¿Desactivar Servicios en «${org.name}»? Sus usuarios dejan de verlo enseguida. Los datos se conservan y vuelven si se reactiva.`,
      { confirmLabel: activo ? "Activar" : "Desactivar", danger: !activo },
    );
    if (!ok) return;
    try {
      await cambiarModulo.mutateAsync({ organizationId: org.id, modulo: "servicios", activo });
      setModuloCambiado(`Servicios ${activo ? "activado" : "desactivado"} en «${org.name}».`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cambiar el módulo");
    }
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
      const { email, reenviadas, sinEnviar } = await reenviar.mutateAsync(org.id);
      // En una demo (docs/taller-demo.md) el reenvío cubre a todos los
      // usuarios que no abrieron el mail; el correo tiene un cupo por hora.
      const destinos = reenviadas && reenviadas.length > 1 ? reenviadas.join(", ") : email;
      const pendientes =
        sinEnviar && sinEnviar.length > 0
          ? ` No salió el mail de ${sinEnviar.join(", ")} (el correo tiene un cupo por hora): probá de nuevo más tarde.`
          : "";
      setReenviada(`Reenviamos la invitación de «${org.name}» a ${destinos}.${pendientes}`);
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
        {moduloCambiado ? <p role="status">{moduloCambiado}</p> : null}
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
                  <th>Módulos</th>
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
                      {org.modulosActivados.includes("servicios") ? (
                        <Badge variant="info">Servicios</Badge>
                      ) : (
                        "—"
                      )}
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
                        {org.industry === "AUTOMOTORA" ? (
                          <Button
                            type="button"
                            onClick={() =>
                              void cambiarServicios(
                                org,
                                !org.modulosActivados.includes("servicios"),
                              )
                            }
                            disabled={cambiarModulo.isPending}
                          >
                            {org.modulosActivados.includes("servicios")
                              ? "Desactivar Servicios"
                              : "Activar Servicios"}
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
