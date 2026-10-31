import { useState, type FormEvent } from "react";
import { PageHeader } from "../../design-system/PageHeader";
import { AYUDA } from "../guia/anclas";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import type { Agent } from "../agent/types";
import { AvisoDelTokenDeWhatsapp } from "./AvisoDelTokenDeWhatsapp";
import { useAssignWhatsappNumber } from "./mutations";
import { AgenteSelect, OrganizacionSelect } from "./SelectoresDeAgente";

interface AgentWhatsappNumberFormValues {
  organizationId: string;
  agentId: string;
  whatsappPhoneNumberId: string;
}

const EMPTY_FORM: AgentWhatsappNumberFormValues = {
  organizationId: "",
  agentId: "",
  whatsappPhoneNumberId: "",
};

// Asignación del número de WhatsApp de un agente — ítem 127 (A-01 de la
// auditoría del 24/09). Desde ese ítem el número lo asigna SOLO un platform
// admin: el formulario del agente lo muestra de solo lectura. Mismo esqueleto
// que NewOrganizationPage (.ds-form + Card + .ds-field-grid).
//
// El agente se elige con los selectores de organización y agente de
// SelectoresDeAgente (antes se pegaba su id a mano). Vaciar el número lo
// libera. Al confirmar se reemplaza el formulario por el resultado, como en el
// alta de organización.
export function AgentWhatsappNumberPage() {
  const assignMutation = useAssignWhatsappNumber();

  const [values, setValues] = useState<AgentWhatsappNumberFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [assigned, setAssigned] = useState<Agent | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    // Una organización sin agentes no muestra el selector (y su `required`).
    if (values.agentId === "") {
      setError("Elegí un agente.");
      return;
    }
    const numero = values.whatsappPhoneNumberId.trim();
    try {
      const agent = await assignMutation.mutateAsync({
        agentId: values.agentId,
        whatsappPhoneNumberId: numero === "" ? null : numero,
      });
      setAssigned(agent);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos asignar el número");
    }
  }

  function handleReset() {
    setAssigned(null);
    setError(null);
    setValues(EMPTY_FORM);
  }

  if (assigned) {
    return (
      <div className="ds-form">
        <PageHeader help={AYUDA.numeroDeWhatsapp} title="Número de WhatsApp actualizado" />
        <div className="ds-stack">
          <Card heading={assigned.name}>
            <p>
              Agente: <code>{assigned.id}</code>
            </p>
            <p>
              Organización: <code>{assigned.organizationId}</code>
            </p>
            <p>
              {assigned.whatsappPhoneNumberId ? (
                <>
                  ID del número de WhatsApp: <code>{assigned.whatsappPhoneNumberId}</code>
                </>
              ) : (
                "Sin número asignado: el número quedó libre."
              )}
            </p>
          </Card>
          <div>
            <Button type="button" onClick={handleReset}>
              Asignar otro número
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="ds-form">
      <PageHeader help={AYUDA.numeroDeWhatsapp} title="Número de WhatsApp de un agente" />
      <AvisoDelTokenDeWhatsapp />
      <div className="ds-stack">
        <Card heading="Asignación">
          <div className="ds-field-grid">
            {/* Otra organización, otros agentes: el elegido deja de valer. */}
            <OrganizacionSelect
              value={values.organizationId}
              onChange={(organizationId) => setValues({ ...values, organizationId, agentId: "" })}
            />
            <AgenteSelect
              organizationId={values.organizationId}
              value={values.agentId}
              onChange={(agentId) => setValues({ ...values, agentId })}
            />
            <FormField label="ID del número de WhatsApp">
              <input
                type="text"
                inputMode="numeric"
                value={values.whatsappPhoneNumberId}
                onChange={(event) =>
                  setValues({ ...values, whatsappPhoneNumberId: event.target.value })
                }
                maxLength={40}
                placeholder="106540352242922"
              />
            </FormField>
          </div>
        </Card>
        {error ? <ErrorState>{error}</ErrorState> : null}
        <div>
          <Button
            type="submit"
            variant="primary"
            disabled={assignMutation.isPending}
            loading={assignMutation.isPending}
          >
            {assignMutation.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </form>
  );
}
