import { useState, type FormEvent } from "react";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import type { Agent } from "../agent/types";
import { useAssignFacebookPage } from "./mutations";

interface AgentFacebookPageFormValues {
  agentId: string;
  facebookPageId: string;
}

const EMPTY_FORM: AgentFacebookPageFormValues = { agentId: "", facebookPageId: "" };

// Asignación de la página de Facebook de un agente — ítem 173 (backend del
// ítem 169). Calco de AgentWhatsappNumberPage: la página la asigna SOLO un
// platform admin, y con ella el webhook de Messenger e Instagram sabe de qué
// agente es cada mensaje.
//
// Mínima a propósito, por el mismo motivo: el platform admin no tiene listado
// de agentes de otras organizaciones, así que el agente se identifica por su
// id. Vaciar la página la libera. Al confirmar se reemplaza el formulario por
// el resultado.
export function AgentFacebookPagePage() {
  const assignMutation = useAssignFacebookPage();

  const [values, setValues] = useState<AgentFacebookPageFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [assigned, setAssigned] = useState<Agent | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const pagina = values.facebookPageId.trim();
    try {
      const agent = await assignMutation.mutateAsync({
        agentId: values.agentId.trim(),
        facebookPageId: pagina === "" ? null : pagina,
      });
      setAssigned(agent);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo asignar la página");
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
        <h1>Página de Facebook actualizada</h1>
        <div className="ds-stack">
          <Card heading={assigned.name}>
            <p>
              Agente: <code>{assigned.id}</code>
            </p>
            <p>
              Organización: <code>{assigned.organizationId}</code>
            </p>
            <p>
              {assigned.facebookPageId ? (
                <>
                  ID de la página de Facebook: <code>{assigned.facebookPageId}</code>
                </>
              ) : (
                "Sin página asignada: la página quedó libre."
              )}
            </p>
          </Card>
          <div>
            <Button type="button" onClick={handleReset}>
              Asignar otra página
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="ds-form">
      <h1>Página de Facebook de un agente</h1>
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
            <FormField label="ID de la página de Facebook">
              <input
                type="text"
                inputMode="numeric"
                value={values.facebookPageId}
                onChange={(event) => setValues({ ...values, facebookPageId: event.target.value })}
                maxLength={64}
                placeholder="104857600000001"
              />
            </FormField>
            <p className="ds-hint ds-field-grid--full">
              Es el ID numérico que Meta muestra para la página, no su nombre ni su URL: solo
              dígitos. Vacío libera la página del agente. Si otro agente ya la tiene, hay que
              liberarla primero.
            </p>
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
