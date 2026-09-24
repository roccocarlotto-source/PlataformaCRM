import { useState, type FormEvent } from "react";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import type { Agent } from "../agent/types";
import { useAssignWhatsappNumber } from "./mutations";

interface AgentWhatsappNumberFormValues {
  agentId: string;
  whatsappPhoneNumberId: string;
}

const EMPTY_FORM: AgentWhatsappNumberFormValues = { agentId: "", whatsappPhoneNumberId: "" };

// Asignación del número de WhatsApp de un agente — ítem 127 (A-01 de la
// auditoría del 24/09). Desde ese ítem el número lo asigna SOLO un platform
// admin: el formulario del agente lo muestra de solo lectura. Mismo esqueleto
// que NewOrganizationPage (.ds-form + Card + .ds-field-grid).
//
// Mínima a propósito: el platform admin no tiene listado de agentes de otras
// organizaciones, así que el agente se identifica por su id (el de la URL
// /agents/:id/edit del negocio). Vaciar el número lo libera. Al confirmar se
// reemplaza el formulario por el resultado, como en el alta de organización.
export function AgentWhatsappNumberPage() {
  const assignMutation = useAssignWhatsappNumber();

  const [values, setValues] = useState<AgentWhatsappNumberFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [assigned, setAssigned] = useState<Agent | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const numero = values.whatsappPhoneNumberId.trim();
    try {
      const agent = await assignMutation.mutateAsync({
        agentId: values.agentId.trim(),
        whatsappPhoneNumberId: numero === "" ? null : numero,
      });
      setAssigned(agent);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo asignar el número");
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
        <h1>Número de WhatsApp actualizado</h1>
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
      <h1>Número de WhatsApp de un agente</h1>
      <div className="ds-stack">
        <Card heading="Asignación">
          <div className="ds-field-grid">
            <FormField label={<span className="ds-required">ID del agente</span>}>
              <input
                type="text"
                value={values.agentId}
                onChange={(event) => setValues({ ...values, agentId: event.target.value })}
                required
              />
            </FormField>
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
            <p className="ds-hint ds-field-grid--full">
              Es el «Phone number ID» que muestra Meta, no el teléfono: solo dígitos. Vacío libera
              el número del agente. Si otro agente ya lo tiene, hay que liberarlo primero.
            </p>
          </div>
        </Card>
        {error ? <ErrorState>{error}</ErrorState> : null}
        <div>
          <Button type="submit" variant="primary" disabled={assignMutation.isPending}>
            {assignMutation.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </form>
  );
}
