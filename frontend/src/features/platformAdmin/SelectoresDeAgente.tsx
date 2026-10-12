import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Select } from "../../design-system/Select";
import { usePlatformAgentesDeOrganizacion, usePlatformOrganizations } from "./queries";

// Los selectores de organización y de agente de las pantallas de Plataforma
// que actúan sobre un agente de otra organización (Modelo de IA, Número de
// WhatsApp, Página de Facebook). Antes cada una pedía pegar el id del agente a
// mano. El estado (qué organización y qué agente) lo lleva cada pantalla: al
// cambiar de organización, la pantalla vacía el agente elegido.

interface SelectorProps {
  value: string;
  onChange: (value: string) => void;
}

// La lista de organizaciones sale de usePlatformOrganizations: si una pantalla
// tiene más de un selector, se pide una sola vez. `required` (por defecto sí)
// pone el "*" y bloquea el submit; Página de Facebook lo apaga en el selector
// de arriba, que no está en un formulario.
export function OrganizacionSelect({
  value,
  onChange,
  required = true,
}: SelectorProps & { required?: boolean }) {
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
      required={required}
    />
  );
}

// Los agentes de la organización elegida, con la sucursal y el modelo actual
// como subtítulo. Sin organización el selector queda deshabilitado (y no se
// pide nada); una organización sin agentes lo dice en vez de mostrar una
// lista vacía.
export function AgenteSelect({
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
