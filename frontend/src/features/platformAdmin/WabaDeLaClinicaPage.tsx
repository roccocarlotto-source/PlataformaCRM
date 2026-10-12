import { useState, type FormEvent } from "react";
import { PageHeader } from "../../design-system/PageHeader";
import { AYUDA } from "../guia/anclas";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { useConectarWabaDeLaClinica, useDesconectarWabaDeLaClinica } from "./mutations";
import { useWabaDeLaClinica } from "./queries";
import { OrganizacionSelect } from "./SelectoresDeAgente";
import type { AltaDeWabaDeLaClinica } from "./types";

// ---------------------------------------------------------------------------
// La cuenta de WhatsApp (WABA) propia de una clínica
// (docs/whatsapp-alta-clinica.md). Alta manual del platform admin en la v1:
// la clínica ya nos agregó como socio de su WABA y la cuenta está asignada al
// System User de la plataforma. Conectar suscribe la app y pasa las
// plantillas de sus reglas a ese WABA. Una automotora no conecta: sigue con
// el WABA de la plataforma (el backend responde 400).
//
// Mismo esqueleto que Número de WhatsApp: selector de organización arriba,
// después el estado y el formulario.
// ---------------------------------------------------------------------------
export function WabaDeLaClinicaPage() {
  const [organizationId, setOrganizationId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [alta, setAlta] = useState<AltaDeWabaDeLaClinica | null>(null);
  const conexionQuery = useWabaDeLaClinica(organizationId);
  const conectar = useConectarWabaDeLaClinica();
  const desconectar = useDesconectarWabaDeLaClinica();

  function elegirOrganizacion(id: string) {
    setOrganizationId(id);
    setWabaId("");
    setError(null);
    setAlta(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setAlta(null);
    try {
      setAlta(await conectar.mutateAsync({ organizationId, wabaId: wabaId.trim() }));
      setWabaId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos conectar la cuenta de WhatsApp");
    }
  }

  async function handleDesconectar() {
    setError(null);
    setAlta(null);
    try {
      await desconectar.mutateAsync(organizationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos desconectar la cuenta de WhatsApp");
    }
  }

  const conexion = conexionQuery.data ?? null;
  const activa = conexion?.status === "ACTIVE";

  return (
    <form onSubmit={handleSubmit} className="ds-form">
      <PageHeader help={AYUDA.wabaDeLaClinica} title="WhatsApp de una clínica" />
      <div className="ds-stack">
        <Card heading="Clínica">
          <div className="ds-field-grid">
            <OrganizacionSelect value={organizationId} onChange={elegirOrganizacion} />
          </div>
        </Card>

        {organizationId !== "" ? (
          <Card heading="Cuenta de WhatsApp (WABA)">
            <div className="ds-stack">
              {conexionQuery.isLoading ? <LoadingState /> : null}
              {conexionQuery.isError ? (
                <ErrorState>
                  {conexionQuery.error instanceof Error
                    ? conexionQuery.error.message
                    : "No pudimos consultar la cuenta de WhatsApp."}
                </ErrorState>
              ) : null}
              {conexionQuery.isSuccess ? (
                activa ? (
                  <p>
                    <Badge variant="success">Conectada</Badge> WABA <code>{conexion.wabaId}</code>.
                    Sus plantillas se crean en esa cuenta.
                  </p>
                ) : (
                  <p>
                    <Badge variant="neutral">Sin conectar</Badge> Usa la cuenta de la plataforma: no
                    puede activar reglas que mandan WhatsApp.
                  </p>
                )
              ) : null}
              {conexionQuery.isSuccess ? (
                <div className="ds-field-grid">
                  <FormField label="ID de la cuenta de WhatsApp (WABA)">
                    <input
                      type="text"
                      inputMode="numeric"
                      required
                      maxLength={64}
                      placeholder="111111111111111"
                      value={wabaId}
                      onChange={(event) => setWabaId(event.target.value)}
                    />
                  </FormField>
                  <p className="ds-hint ds-field-grid--full">
                    El «WhatsApp Business Account ID» que nos pasó la clínica. Antes, la clínica
                    tiene que habernos agregado como socio de esa cuenta.
                  </p>
                </div>
              ) : null}
            </div>
          </Card>
        ) : null}

        {alta ? (
          <p>
            Cuenta conectada. Plantillas mandadas de nuevo a aprobación: {alta.reglasSincronizadas}.
            {alta.erroresDeSincronizacion.length > 0
              ? ` No se pudieron mandar ${alta.erroresDeSincronizacion.length}: ${alta.erroresDeSincronizacion
                  .map((e) => e.error)
                  .join(" · ")}`
              : ""}
          </p>
        ) : null}
        {error ? <ErrorState>{error}</ErrorState> : null}

        {conexionQuery.isSuccess ? (
          <div>
            <Button
              type="submit"
              variant="primary"
              disabled={conectar.isPending}
              loading={conectar.isPending}
            >
              {conectar.isPending ? "Conectando…" : activa ? "Cambiar la cuenta" : "Conectar"}
            </Button>
            {activa ? (
              <Button
                type="button"
                variant="secondary"
                disabled={desconectar.isPending}
                loading={desconectar.isPending}
                onClick={() => void handleDesconectar()}
              >
                Desconectar
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </form>
  );
}
