import { useState, type FormEvent } from "react";
import { PageHeader } from "../../design-system/PageHeader";
import { AYUDA } from "../guia/anclas";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { Select } from "../../design-system/Select";
import { useAssignAgentModel, useAssignInternalAgentModel } from "./mutations";
import { usePlatformAgentesDeOrganizacion, usePlatformOrganizations } from "./queries";

// Modelo de IA de un agente — B-05 de la auditoría del 24/09. El modelo lo
// elige SOLO la plataforma (es la que paga el proveedor): el formulario del
// agente lo muestra de solo lectura para el ADMIN del cliente. Mismo esqueleto
// que AgentWhatsappNumberPage.
//
// Dos formularios porque son dos cosas distintas: un agente de atención a
// clientes se elige entre los de una organización, y el agente interno es uno
// por organización, así que alcanza con elegir la organización. Antes se
// pegaban los ids a mano; ahora son selectores con buscador. El resultado
// queda escrito debajo del botón.

interface Resultado {
  texto: string;
}

function mensajeDeError(err: unknown, porDefecto: string): string {
  return err instanceof Error ? err.message : porDefecto;
}

interface SelectorProps {
  value: string;
  onChange: (value: string) => void;
}

// El selector de organización de las dos tarjetas. Las dos leen la misma
// query (usePlatformOrganizations), así que la lista se pide una sola vez.
function OrganizacionSelect({ value, onChange }: SelectorProps) {
  const organizationsQuery = usePlatformOrganizations();

  if (organizationsQuery.isLoading) return <LoadingState />;
  if (organizationsQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar las organizaciones
        {organizationsQuery.error instanceof Error ? `: ${organizationsQuery.error.message}` : "."}
      </ErrorState>
    );
  }
  return (
    <Select
      label="Organización"
      value={value}
      options={(organizationsQuery.data ?? []).map((org) => ({
        value: org.id,
        label: org.name,
        subtitle: org.slug,
      }))}
      emptyOption={{ label: "Elegir organización…" }}
      onChange={onChange}
      required
    />
  );
}

// Los agentes de la organización elegida, con la sucursal y el modelo actual
// como subtítulo. Sin organización el selector queda deshabilitado; una
// organización sin agentes lo dice en vez de mostrar una lista vacía.
function AgenteSelect({
  organizationId,
  value,
  onChange,
}: SelectorProps & { organizationId: string }) {
  const agentesQuery = usePlatformAgentesDeOrganizacion(organizationId);

  if (agentesQuery.isLoading) return <LoadingState />;
  if (agentesQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar los agentes
        {agentesQuery.error instanceof Error ? `: ${agentesQuery.error.message}` : "."}
      </ErrorState>
    );
  }
  if (agentesQuery.isSuccess && agentesQuery.data.length === 0) {
    return <p className="ds-hint">Esta organización no tiene agentes de atención a clientes.</p>;
  }
  return (
    <Select
      label="Agente"
      value={value}
      options={(agentesQuery.data ?? []).map((agente) => ({
        value: agente.id,
        label: agente.name,
        subtitle: [agente.branchName, agente.modelName, agente.isActive ? null : "Inactivo"]
          .filter(Boolean)
          .join(" · "),
      }))}
      emptyOption={{ label: "Elegir agente…" }}
      onChange={onChange}
      disabled={organizationId === ""}
      required
    />
  );
}

function ModeloDeAgenteCard() {
  const mutation = useAssignAgentModel();
  const [organizationId, setOrganizationId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [modelName, setModelName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  // Otra organización, otros agentes: el elegido deja de valer.
  function handleOrganizationChange(value: string) {
    setOrganizationId(value);
    setAgentId("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResultado(null);
    try {
      const agente = await mutation.mutateAsync({ agentId, modelName: modelName.trim() });
      setResultado({ texto: `${agente.name} ahora usa ${agente.modelName}.` });
    } catch (err) {
      setError(mensajeDeError(err, "No pudimos cambiar el modelo"));
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card heading="Agente de atención a clientes">
        <div className="ds-field-grid">
          <OrganizacionSelect value={organizationId} onChange={handleOrganizationChange} />
          <AgenteSelect organizationId={organizationId} value={agentId} onChange={setAgentId} />
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
            Tal cual lo publica OpenRouter; uno inexistente falla al usarlo.
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
      const agente = await mutation.mutateAsync({ organizationId, modelName: modelName.trim() });
      setResultado({ texto: `${agente.name} ahora usa ${agente.modelName}.` });
    } catch (err) {
      setError(mensajeDeError(err, "No pudimos cambiar el modelo"));
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card heading="Agente interno de una organización">
        <div className="ds-field-grid">
          <OrganizacionSelect value={organizationId} onChange={setOrganizationId} />
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
        <ModeloDeAgenteCard />
        <ModeloDeAgenteInternoCard />
      </div>
    </div>
  );
}
