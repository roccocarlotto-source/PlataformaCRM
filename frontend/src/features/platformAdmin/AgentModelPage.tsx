import { useState, type FormEvent } from "react";
import { PageHeader } from "../../design-system/PageHeader";
import { AYUDA } from "../guia/anclas";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { useAssignAgentModel, useAssignInternalAgentModel } from "./mutations";

// Modelo de IA de un agente — B-05 de la auditoría del 24/09. El modelo lo
// elige SOLO la plataforma (es la que paga el proveedor): el formulario del
// agente lo muestra de solo lectura para el ADMIN del cliente. Mismo esqueleto
// que AgentWhatsappNumberPage.
//
// Dos formularios porque son dos cosas distintas: un agente de atención a
// clientes se identifica por su id (el de /agents/:id/edit del negocio), y el
// agente interno es uno por organización, así que se identifica por el id de
// la organización. El resultado queda escrito debajo del botón.

interface Resultado {
  texto: string;
}

function mensajeDeError(err: unknown, porDefecto: string): string {
  return err instanceof Error ? err.message : porDefecto;
}

function ModeloDeAgenteCard() {
  const mutation = useAssignAgentModel();
  const [agentId, setAgentId] = useState("");
  const [modelName, setModelName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResultado(null);
    try {
      const agente = await mutation.mutateAsync({
        agentId: agentId.trim(),
        modelName: modelName.trim(),
      });
      setResultado({ texto: `${agente.name} ahora usa ${agente.modelName}.` });
    } catch (err) {
      setError(mensajeDeError(err, "No pudimos cambiar el modelo"));
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card heading="Agente de atención a clientes">
        <div className="ds-field-grid">
          <FormField label={<span className="ds-required">ID del agente</span>}>
            <input
              type="text"
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              required
            />
          </FormField>
          <FormField label={<span className="ds-required">Modelo</span>}>
            <input
              type="text"
              value={modelName}
              maxLength={100}
              placeholder="openai/gpt-4o-mini"
              onChange={(event) => setModelName(event.target.value)}
              required
            />
          </FormField>
          <p className="ds-hint ds-field-grid--full">
            El nombre del modelo tal cual lo publica OpenRouter. Un modelo inexistente no falla acá:
            falla al usarlo, y el agente deriva a una persona.
          </p>
        </div>
        {error ? <ErrorState>{error}</ErrorState> : null}
        {resultado ? <p className="ds-hint">{resultado.texto}</p> : null}
        <div className="ds-card-actions">
          <Button
            type="submit"
            variant="primary"
            disabled={mutation.isPending}
            loading={mutation.isPending}
          >
            {mutation.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </Card>
    </form>
  );
}

function ModeloDeAgenteInternoCard() {
  const mutation = useAssignInternalAgentModel();
  const [organizationId, setOrganizationId] = useState("");
  const [modelName, setModelName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResultado(null);
    try {
      const agente = await mutation.mutateAsync({
        organizationId: organizationId.trim(),
        modelName: modelName.trim(),
      });
      setResultado({ texto: `${agente.name} ahora usa ${agente.modelName}.` });
    } catch (err) {
      setError(mensajeDeError(err, "No pudimos cambiar el modelo"));
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card heading="Agente interno de una organización">
        <div className="ds-field-grid">
          <FormField label={<span className="ds-required">ID de la organización</span>}>
            <input
              type="text"
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
              required
            />
          </FormField>
          <FormField label={<span className="ds-required">Modelo</span>}>
            <input
              type="text"
              value={modelName}
              maxLength={100}
              placeholder="openai/gpt-4o-mini"
              onChange={(event) => setModelName(event.target.value)}
              required
            />
          </FormField>
          <p className="ds-hint ds-field-grid--full">
            La organización tiene que haber configurado su agente interno antes.
          </p>
        </div>
        {error ? <ErrorState>{error}</ErrorState> : null}
        {resultado ? <p className="ds-hint">{resultado.texto}</p> : null}
        <div className="ds-card-actions">
          <Button
            type="submit"
            variant="primary"
            disabled={mutation.isPending}
            loading={mutation.isPending}
          >
            {mutation.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </Card>
    </form>
  );
}

export function AgentModelPage() {
  return (
    <div className="ds-form">
      <PageHeader help={AYUDA.modeloDeIa} title="Modelo de IA" />
      <div className="ds-stack">
        <p className="ds-hint">
          El modelo lo elige la plataforma: todas las organizaciones usan la misma clave del
          proveedor. Un agente nuevo nace con el modelo por defecto del servidor.
        </p>
        <ModeloDeAgenteCard />
        <ModeloDeAgenteInternoCard />
      </div>
    </div>
  );
}
