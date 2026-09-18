import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { MultiSelect } from "../../design-system/MultiSelect";
import { RequiredFieldsHint } from "../../design-system/RequiredFieldsHint";
import { Select } from "../../design-system/Select";
import { useFormDraft } from "../../lib/useFormDraft";
import { BranchSelect } from "../branch/BranchSelect";
import {
  EMPTY_GUARDRAILS_TEXT,
  formatGuardrails,
  parseGuardrails,
  type ParseGuardrailsResult,
} from "./guardrails";
import { CHANNEL_OPTIONS, DEFAULT_MODEL_PROVIDER, MODEL_PROVIDER_OPTIONS } from "./labels";
import { useCreateAgent, useUpdateAgent } from "./mutations";
import { useAgent } from "./queries";
import { agentToolOptions } from "./tools";
import type { Agent, ConversationChannel, CreateAgentInput, UpdateAgentInput } from "./types";

interface AgentFormValues {
  branchId: string | undefined;
  name: string;
  goal: string;
  instructions: string;
  tone: string;
  modelProvider: string;
  modelName: string;
  enabledTools: string[];
  channels: ConversationChannel[];
  // Los guardrails viven como TEXTO mientras se editan y se convierten a
  // objeto recién al enviar — ver guardrails.ts para por qué no pueden ser el
  // objeto directo. Mismo reparto que mappingRows en SourceFormPage.
  guardrails: string;
  isActive: boolean;
}

const EMPTY_FORM: AgentFormValues = {
  branchId: undefined,
  name: "",
  goal: "",
  instructions: "",
  tone: "",
  // Un solo proveedor hoy: viene elegido. Ver MODEL_PROVIDER_OPTIONS.
  modelProvider: DEFAULT_MODEL_PROVIDER,
  // Vacío = el backend usa el default de OPENROUTER_MODEL.
  modelName: "",
  enabledTools: [],
  channels: [],
  guardrails: EMPTY_GUARDRAILS_TEXT,
  isActive: true,
};

function toFormValues(agent: Agent): AgentFormValues {
  return {
    branchId: agent.branchId,
    name: agent.name,
    goal: agent.goal ?? "",
    instructions: agent.instructions,
    tone: agent.tone ?? "",
    modelProvider: agent.modelProvider,
    modelName: agent.modelName,
    enabledTools: agent.enabledTools,
    channels: agent.channels,
    guardrails: formatGuardrails(agent.guardrails),
    isActive: agent.isActive,
  };
}

// Un texto opcional vacío se manda como null y no como "": en el POST los dos
// se aceptarían (goalSchema no tiene min) y quedaría un string vacío
// persistido; en el PATCH null es la única forma de VACIAR un campo que ya
// tenía valor. Una sola regla para los dos caminos.
function textoOpcional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// El error de validación del cliente, o null si el formulario puede viajar.
// Solo mira lo que se puede decidir sin preguntarle al servidor, y solo lo que
// la validación nativa del navegador NO cubre: Nombre e Instrucciones llevan
// `required` y los frena el propio <form>.
function validar(values: AgentFormValues, isEditMode: boolean): string | null {
  // El `required` de BranchSelect no alcanza: mientras la lista de sucursales
  // carga, el componente no renderiza ningún input (solo el rótulo y el aviso
  // de carga), así que no hay nada que el navegador pueda frenar. Es el hueco
  // que el propio BranchSelect documenta y que cada formulario cubre por su
  // cuenta.
  if (!isEditMode && !values.branchId) {
    return "Elegí la sucursal a la que pertenece este agente.";
  }
  // Vacío al CREAR es válido: el POST sale sin modelName y el backend asigna
  // el default de OPENROUTER_MODEL, que es exactamente lo que el hint del
  // campo promete. Vacío al EDITAR no: el agente ya tiene un modelo, el PATCH
  // parcial simplemente no lo tocaría, y la pantalla habría dicho "guardado"
  // sobre un campo que se dejó en blanco a propósito. Mismo razonamiento que
  // el N° del QR en §54, y por eso el asterisco también depende del modo.
  if (isEditMode && values.modelName.trim() === "") {
    return "El modelo no puede quedar vacío. Borrarlo no vuelve al modelo por defecto: escribí el que querés usar.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Alta y edición de un agente de IA en un solo componente — el modo se
// distingue del propio param de ruta (:id), mismo patrón que BranchFormPage y
// SourceFormPage. Página completa y no diálogo, por la cantidad de campos.
//
// LA SUCURSAL ES INMUTABLE, y es lo que más lo diferencia de los otros
// formularios: branchId viaja en el POST pero NO existe en updateAgentSchema
// (agent.controller.ts). Cada Conversation lleva el branchId denormalizado
// desde el agente, así que mover el agente dejaría sus conversaciones
// históricas apuntando a una sucursal que no las atendió — ver la nota de
// UpdateAgentInput en src/services/agent.service.ts. En edición se muestra
// deshabilitada con la razón escrita, en vez de esconderla: mismo criterio
// que el `type` de SourceFormPage.
//
// LO QUE ESTA PANTALLA NO CONFIGURA, a propósito: `allowedOrigins` (ver el
// comentario de CreateAgentInput en types.ts), los tokens de embed y su
// snippet, el playground de prueba y la bandeja de conversaciones. No hay
// lugares vacíos esperándolos: cuando existan, traen su propia pantalla.
// ---------------------------------------------------------------------------
export function AgentFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();

  const agentQuery = useAgent(isEditMode ? id : undefined);
  const createAgentMutation = useCreateAgent();
  const updateAgentMutation = useUpdateAgent(id ?? "");

  const [values, setValues] = useFormDraft<AgentFormValues>(
    agentQuery.data?.id,
    agentQuery.data ? toFormValues(agentQuery.data) : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);

  const isSubmitting = createAgentMutation.isPending || updateAgentMutation.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const errorDeValidacion = validar(values, isEditMode);
    if (errorDeValidacion !== null) {
      setError(errorDeValidacion);
      return;
    }

    // Los guardrails se validan ANTES de tocar la red: que el texto sea un
    // objeto JSON es un problema de forma que se puede decir sin preguntarle
    // al servidor, y mandarlo igual daría un 400 con el mismo diagnóstico una
    // vuelta más tarde. Anotado a mano el tipo, como en SourceFormPage: sin
    // él la unión discriminada deja de discriminar.
    const resultado: ParseGuardrailsResult = parseGuardrails(values.guardrails);
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }

    const modelName = values.modelName.trim();

    try {
      if (isEditMode) {
        // Se mandan todos los campos, sin diferenciar cuál cambió (mismo
        // criterio que Branch y Source): "el agente queda así" es más simple
        // que un diff, y el PATCH parcial lo acepta.
        //
        // SIN allowedOrigins, y ahí la omisión sí significa algo: el campo no
        // se edita en esta pantalla, y omitirlo en un PATCH parcial es
        // justamente lo que lo deja intacto. Mandarlo como [] borraría la
        // configuración del widget de un agente que ya la tuviera.
        const input: UpdateAgentInput = {
          name: values.name.trim(),
          goal: textoOpcional(values.goal),
          instructions: values.instructions.trim(),
          tone: textoOpcional(values.tone),
          modelProvider: values.modelProvider,
          modelName,
          enabledTools: values.enabledTools,
          channels: values.channels,
          guardrails: resultado.guardrails,
          isActive: values.isActive,
        };
        await updateAgentMutation.mutateAsync(input);
      } else {
        const input: CreateAgentInput = {
          // validar() ya garantizó que hay sucursal elegida.
          branchId: values.branchId ?? "",
          name: values.name.trim(),
          goal: textoOpcional(values.goal),
          instructions: values.instructions.trim(),
          tone: textoOpcional(values.tone),
          modelProvider: values.modelProvider,
          // Ausente = el backend usa el default de OPENROUTER_MODEL. El campo
          // es `.default()` y no `.nullable()`, así que "sin modelo" se
          // expresa OMITIENDO la clave: mandar null o "" sería un 400.
          ...(modelName === "" ? {} : { modelName }),
          enabledTools: values.enabledTools,
          channels: values.channels,
          guardrails: resultado.guardrails,
          isActive: values.isActive,
        };
        await createAgentMutation.mutateAsync(input);
      }
      navigate("/agents");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el agente");
    }
  }

  if (isEditMode && agentQuery.isLoading) {
    return <LoadingState />;
  }

  if (isEditMode && agentQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar el agente
        {agentQuery.error instanceof Error ? `: ${agentQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="ds-form">
      <h1>{isEditMode ? "Editar agente" : "Nuevo agente"}</h1>
      <div className="ds-stack">
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

            {/* Suelto, sin FormField: BranchSelect trae su propio
                <label htmlFor> y FormField ES un <label>. */}
            <BranchSelect
              id="agent-form-branch"
              label="Sucursal"
              value={values.branchId}
              onChange={(branchId) => setValues({ ...values, branchId: branchId || undefined })}
              required={!isEditMode}
              disabled={isEditMode}
            />
            {isEditMode ? (
              <p className="ds-hint ds-field-grid--full">
                La sucursal no se puede cambiar: las conversaciones que este agente ya atendió
                quedaron registradas con ella. Si necesitás otra sucursal, creá un agente nuevo.
              </p>
            ) : null}

            <FormField label="Objetivo">
              <input
                type="text"
                value={values.goal}
                maxLength={500}
                onChange={(event) => setValues({ ...values, goal: event.target.value })}
              />
            </FormField>

            <FormField label="Tono">
              <input
                type="text"
                value={values.tone}
                maxLength={100}
                placeholder="formal, cercano…"
                onChange={(event) => setValues({ ...values, tone: event.target.value })}
              />
            </FormField>

            <p className="ds-hint ds-field-grid--full">
              El objetivo es un resumen corto para esta pantalla, no el prompt del agente: lo que el
              modelo lee son las instrucciones de abajo. El tono es informativo y se compone dentro
              de ellas.
            </p>

            <div className="ds-field-grid--full">
              <FormField label="Activo">
                <input
                  type="checkbox"
                  checked={values.isActive}
                  onChange={(event) => setValues({ ...values, isActive: event.target.checked })}
                />
              </FormField>
            </div>
          </div>
        </Card>

        <Card heading="Instrucciones">
          <div className="ds-field-grid">
            <div className="ds-field-grid--full">
              {/* EL PROMPT REAL del agente: objetivo, tono y contexto del
                  negocio en texto libre. Sin máximo en el backend, así que
                  tampoco lleva maxLength acá — un textarea grande es la única
                  forma honesta de mostrar un campo que se escribe en párrafos. */}
              <FormField label={<span className="ds-required">Instrucciones</span>}>
                <textarea
                  value={values.instructions}
                  rows={12}
                  onChange={(event) => setValues({ ...values, instructions: event.target.value })}
                  required
                />
              </FormField>
              <p className="ds-hint">
                Es lo que el modelo lee antes de cada conversación: qué hace el negocio, qué tiene
                que lograr el agente y cómo tiene que hablar.
              </p>
            </div>
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

            {/* El asterisco depende del modo porque la obligatoriedad también
                — ver validar(). */}
            <FormField
              label={isEditMode ? <span className="ds-required">Modelo</span> : <span>Modelo</span>}
            >
              <input
                type="text"
                value={values.modelName}
                maxLength={100}
                placeholder="openai/gpt-4o-mini"
                onChange={(event) => setValues({ ...values, modelName: event.target.value })}
              />
            </FormField>

            <p className="ds-hint ds-field-grid--full">
              {isEditMode
                ? "El nombre del modelo tal cual lo publica el proveedor. Un modelo inexistente no falla acá: falla al usarlo, con el error del proveedor."
                : "Si lo dejás vacío, se usa el modelo por defecto."}
            </p>
          </div>
        </Card>

        <Card heading="Capacidades">
          <div className="ds-field-grid">
            {/* Los dos sueltos, sin FormField: MultiSelect trae su propio
                <label htmlFor>, igual que los Select. */}
            <MultiSelect
              id="agent-form-tools"
              label="Acciones habilitadas"
              value={values.enabledTools}
              options={agentToolOptions(values.enabledTools)}
              emptyLabel="Ninguna"
              onChange={(enabledTools) => setValues({ ...values, enabledTools })}
            />

            <MultiSelect<ConversationChannel>
              id="agent-form-channels"
              label="Canales"
              value={values.channels}
              options={CHANNEL_OPTIONS}
              emptyLabel="Ninguno"
              onChange={(channels) => setValues({ ...values, channels })}
            />

            <p className="ds-hint ds-field-grid--full">
              Habilitar una acción es condición necesaria pero no suficiente: antes de ejecutarla,
              cada acción vuelve a pasar por los guardrails de abajo. Sin canales, el agente no
              atiende por ningún lado.
            </p>
          </div>
        </Card>

        <Card heading="Guardrails">
          <div className="ds-field-grid">
            <div className="ds-field-grid--full">
              <FormField label="Guardrails (JSON)">
                <textarea
                  className="ds-code-field"
                  value={values.guardrails}
                  rows={10}
                  spellCheck={false}
                  onChange={(event) => setValues({ ...values, guardrails: event.target.value })}
                />
              </FormField>
              {/* Por qué es JSON crudo y no un formulario con un campo por
                  clave: ver el encabezado de guardrails.ts. */}
              <p className="ds-hint">
                Un objeto JSON con los límites del agente: temas y acciones prohibidas, información
                que no puede modificar, condiciones para derivar a una persona. La forma completa
                está en docs/ai-agent-architecture.md §6. Sin guardrails declarados, dejá{" "}
                <code>{EMPTY_GUARDRAILS_TEXT}</code>.
              </p>
            </div>
          </div>
        </Card>

        {error ? <ErrorState>{error}</ErrorState> : null}

        <div>
          <RequiredFieldsHint />
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </form>
  );
}
