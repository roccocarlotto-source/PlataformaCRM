import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "../../design-system/PageHeader";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { Select } from "../../design-system/Select";
import type { Agent } from "../agent/types";
import { useAssignFacebookPage } from "./mutations";
import { OrganizationMetaConnectionCard } from "./OrganizationMetaConnectionCard";
import { usePlatformOrganizations } from "./queries";
import type { MetaConnectionPendiente } from "./types";

interface AgentFacebookPageFormValues {
  agentId: string;
  facebookPageId: string;
}

const EMPTY_FORM: AgentFacebookPageFormValues = { agentId: "", facebookPageId: "" };

// El code y el state que el callback de Meta deja en el fragmento de la URL
// (#metaCode=…&metaState=…). Pura: se llama desde un inicializador de useState.
function leerConexionPendiente(hash: string): MetaConnectionPendiente | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const code = params.get("metaCode");
  const state = params.get("metaState");
  return code && state ? { code, state } : null;
}

// La página de Facebook, del lado de la plataforma. Dos cosas, en el orden en
// que se hacen al dar de alta un cliente (docs/meta-alta-de-cliente.md):
//
//   1. Arriba, la conexión de la página con la organización (decisión del
//      02/10/2026: la hace el platform admin, no el ADMIN del negocio). La
//      organización elegida vive en ?organizationId=, que es también como
//      vuelve el callback de Meta.
//   2. Debajo, la asignación de la página a un agente — ítem 173 (backend del
//      ítem 169). Calco de AgentWhatsappNumberPage: con ella el webhook de
//      Messenger e Instagram sabe de qué agente es cada mensaje. El agente se
//      identifica por su id. Vaciar la página la libera. Al confirmar se
//      reemplaza el formulario por el resultado.
export function AgentFacebookPagePage() {
  const assignMutation = useAssignFacebookPage();
  const organizationsQuery = usePlatformOrganizations();

  // La vuelta del callback de Meta: ?organizationId=, y ?metaError=<mensaje> o
  // el code y el state en el fragmento. El fragmento se lee una vez y se saca
  // de la URL: no tiene que quedar en el historial ni volver a mandarse al
  // recargar.
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const organizationId = searchParams.get("organizationId") ?? "";
  const [vuelta] = useState(() => ({
    organizationId,
    pendiente: leerConexionPendiente(location.hash),
  }));
  useEffect(() => {
    if (leerConexionPendiente(location.hash)) {
      navigate({ pathname: location.pathname, search: location.search }, { replace: true });
    }
  }, [location.hash, location.pathname, location.search, navigate]);
  // Solo para la organización con la que volvió el callback: si después se
  // elige otra, su tarjeta arranca limpia.
  const resultadoDelCallback =
    organizationId !== "" && organizationId === vuelta.organizationId
      ? { error: searchParams.get("metaError"), pendiente: vuelta.pendiente }
      : undefined;

  function handleOrganizationChange(value: string) {
    // Elegir otra organización también descarta el ?metaError= de la vuelta.
    setSearchParams(value ? { organizationId: value } : {}, { replace: true });
  }

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
      setError(err instanceof Error ? err.message : "No pudimos asignar la página");
    }
  }

  function handleReset() {
    setAssigned(null);
    setError(null);
    setValues(EMPTY_FORM);
  }

  return (
    <div className="ds-form">
      <PageHeader title="Página de Facebook" />
      <div className="ds-stack">
        <Card heading="Organización">
          {organizationsQuery.isLoading ? <LoadingState /> : null}
          {organizationsQuery.isError ? (
            <ErrorState>
              No pudimos cargar las organizaciones
              {organizationsQuery.error instanceof Error
                ? `: ${organizationsQuery.error.message}`
                : "."}
            </ErrorState>
          ) : null}
          {organizationsQuery.isSuccess ? (
            <Select
              label="Organización"
              value={organizationId}
              options={organizationsQuery.data.map((org) => ({
                value: org.id,
                label: org.name,
                subtitle: org.slug,
              }))}
              emptyOption={{ label: "Elegir organización…" }}
              onChange={handleOrganizationChange}
            />
          ) : null}
        </Card>

        {organizationId ? (
          <OrganizationMetaConnectionCard
            key={organizationId}
            organizationId={organizationId}
            resultadoDelCallback={resultadoDelCallback}
          />
        ) : null}

        {assigned ? (
          <>
            <Card heading={`Página asignada a ${assigned.name}`}>
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
          </>
        ) : (
          <form onSubmit={handleSubmit} className="ds-stack">
            <Card heading="Página de un agente">
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
                    onChange={(event) =>
                      setValues({ ...values, facebookPageId: event.target.value })
                    }
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
          </form>
        )}
      </div>
    </div>
  );
}
