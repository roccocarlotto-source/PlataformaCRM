import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { MultiSelect } from "../../design-system/MultiSelect";
import { Select } from "../../design-system/Select";
import { useToast } from "../../design-system/useToast";
import { useFormDraft } from "../../lib/useFormDraft";
import { DEFAULT_MODEL_PROVIDER, MODEL_PROVIDER_OPTIONS } from "../agent/labels";
import { usePutInternalAgent } from "./mutations";
import { useInternalAgentConfig } from "./queries";
import { internalAgentToolOptions } from "./tools";
import type { InternalAgent } from "./types";

interface InternalAgentFormValues {
  name: string;
  instructions: string;
  modelProvider: string;
  modelName: string;
  enabledTools: string[];
}

// Primera vez: vacío, con el único proveedor preseleccionado y las dos tools
// apagadas — mismo arranque que "Nuevo agente". Un agente sin tools solo
// conversa, y prenderlas es una decisión explícita del ADMIN.
const EMPTY_FORM: InternalAgentFormValues = {
  name: "",
  instructions: "",
  modelProvider: DEFAULT_MODEL_PROVIDER,
  modelName: "",
  enabledTools: [],
};

function toFormValues(agente: InternalAgent): InternalAgentFormValues {
  return {
    name: agente.name,
    instructions: agente.instructions,
    modelProvider: agente.modelProvider,
    modelName: agente.modelName,
    enabledTools: agente.enabledTools,
  };
}

// ---------------------------------------------------------------------------
// Configuración del agente de IA interno (ítem 180; backend en el 179).
// Singleton como Organización y Plantilla de WhatsApp: un registro por
// organización, sin lista, sin :id, sin "nuevo". GET 404 = formulario vacío
// (getInternalAgent lo traduce a null) y el PUT, que es un upsert, lo crea.
//
// Vive bajo AdminRoute y dentro de AppLayout: es configuración administrativa
// —las instructions son el prompt, y el backend no deja ni leerlas a un USER—.
// El chat (/internal-agent) es otra cosa y vive afuera del shell.
//
// El PUT es reemplazo completo: se mandan siempre todos los campos, salvo
// modelName vacío, que se omite para que el backend ponga su modelo por
// defecto (mismo criterio que al crear un Agent).
// ---------------------------------------------------------------------------
export function InternalAgentSettingsPage() {
  const configQuery = useInternalAgentConfig();
  const putMutation = usePutInternalAgent();
  const toast = useToast();

  const agente = configQuery.data ?? null;
  // La clave del borrador es el id del registro: al crearlo por primera vez
  // cambia de undefined al id nuevo y el formulario se vuelve a derivar de lo
  // que guardó el backend (ej. el modelo por defecto que asignó).
  const [values, setValues] = useFormDraft<InternalAgentFormValues>(
    agente?.id,
    agente ? toFormValues(agente) : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const modelName = values.modelName.trim();
    try {
      await putMutation.mutateAsync({
        name: values.name.trim(),
        instructions: values.instructions,
        modelProvider: values.modelProvider,
        ...(modelName === "" ? {} : { modelName }),
        enabledTools: values.enabledTools,
      });
      toast.show("Agente interno guardado");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el agente interno");
    }
  }

  if (configQuery.isLoading) {
    return <LoadingState variant="lines" />;
  }

  if (configQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar el agente interno
        {configQuery.error instanceof Error ? `: ${configQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="ds-form">
      <h1>Agente interno</h1>
      <div className="ds-stack">
        <p className="ds-hint">
          Es el asistente de IA del equipo, no el que habla con los clientes: lo usan los
          administradores y los usuarios a los que les habilites el acceso en{" "}
          <Link to="/users">Usuarios</Link>, desde el <Link to="/internal-agent">chat</Link>.
          {agente ? null : " Todavía no está configurado: completá el formulario para crearlo."}
        </p>

        <Card heading="Datos del agente">
          <div className="ds-field-grid">
            <FormField label={<span className="ds-required">Nombre</span>}>
              <input
                type="text"
                value={values.name}
                maxLength={200}
                onChange={(event) => setValues({ ...values, name: event.target.value })}
                required
              />
            </FormField>
            <div className="ds-field-grid--full">
              <FormField label={<span className="ds-required">Instrucciones</span>}>
                <textarea
                  value={values.instructions}
                  rows={10}
                  onChange={(event) => setValues({ ...values, instructions: event.target.value })}
                  required
                />
              </FormField>
            </div>
            <p className="ds-hint ds-field-grid--full">
              Es lo que el modelo lee antes de cada respuesta: qué es el negocio, cómo tiene que
              contestar y qué no tiene que hacer.
            </p>
          </div>
        </Card>

        <Card heading="Modelo">
          <div className="ds-field-grid">
            <Select
              label="Proveedor"
              required
              value={values.modelProvider}
              options={MODEL_PROVIDER_OPTIONS}
              onChange={(modelProvider) => {
                if (modelProvider) setValues({ ...values, modelProvider });
              }}
            />
            <FormField label="Modelo">
              <input
                type="text"
                value={values.modelName}
                maxLength={100}
                placeholder="openai/gpt-4o-mini"
                onChange={(event) => setValues({ ...values, modelName: event.target.value })}
              />
            </FormField>
            <p className="ds-hint ds-field-grid--full">
              El nombre del modelo tal cual lo publica el proveedor. Si lo dejás vacío, se usa el
              modelo por defecto.
            </p>
          </div>
        </Card>

        <Card heading="Capacidades">
          <div className="ds-field-grid">
            {/* Suelto, sin FormField: MultiSelect trae su propio <label htmlFor>. */}
            <MultiSelect
              id="internal-agent-tools"
              label="Acciones habilitadas"
              value={values.enabledTools}
              options={internalAgentToolOptions(values.enabledTools)}
              emptyLabel="Ninguna"
              onChange={(enabledTools) => setValues({ ...values, enabledTools })}
            />
            <p className="ds-hint ds-field-grid--full">
              Sin acciones, el agente solo conversa. Las tareas que cree quedan asignadas a quien se
              las pidió.
            </p>
          </div>
        </Card>

        {error ? <ErrorState>{error}</ErrorState> : null}
        <div>
          <Button
            type="submit"
            variant="primary"
            disabled={putMutation.isPending}
            loading={putMutation.isPending}
          >
            {putMutation.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </form>
  );
}
