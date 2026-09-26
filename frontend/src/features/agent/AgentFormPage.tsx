import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { Modal } from "../../design-system/Modal";
import { MultiSelect } from "../../design-system/MultiSelect";
import { RequiredFieldsHint } from "../../design-system/RequiredFieldsHint";
import { Select } from "../../design-system/Select";
import { useFormDraft } from "../../lib/useFormDraft";
import { BranchSelect } from "../branch/BranchSelect";
import { translateGuardrails } from "./api";
import { formatGuardrails, resumirDescartes, resumirGuardrails } from "./guardrails";
import { CHANNEL_OPTIONS, DEFAULT_MODEL_PROVIDER, MODEL_PROVIDER_OPTIONS } from "./labels";
import { useCreateAgent, useUpdateAgent } from "./mutations";
import { useAgent } from "./queries";
import { agentToolOptions } from "./tools";
import type {
  Agent,
  ConversationChannel,
  CreateAgentInput,
  GuardrailsTranslation,
  UpdateAgentInput,
} from "./types";

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
  // EL TEXTO, en las palabras del ADMIN — no el JSON. Hasta el §55 este campo
  // del estado se llamaba `guardrails` y guardaba el JSON escrito a mano, con
  // el mismo nombre que el `guardrails` del payload: dos cosas distintas
  // llamadas igual. Acá el nombre dice cuál de las dos es, y el objeto que
  // viaja al backend no vive en el estado del formulario sino en `confirmado`.
  guardrailsText: string;
  // Sin whatsappPhoneNumberId desde el ítem 127: el número lo asigna la
  // plataforma y acá solo se muestra, leído del agente.
  isActive: boolean;
}

// Lo que el ADMIN ya vio y aceptó: el texto sobre el que confirmó y el objeto
// que se le mostró. Van juntos porque la pregunta que se le hace al enviar es
// exactamente "¿este texto sigue siendo el que confirmaste?".
interface GuardrailsConfirmados {
  text: string;
  guardrails: Record<string, unknown>;
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
  guardrailsText: "",
  isActive: true,
};

// Solo las tres cosas que el sistema verifica con código antes de dejar pasar
// una acción (ítem 72). Los temas prohibidos, las promesas prohibidas y las
// condiciones de derivación se escriben en Instrucciones: nunca fueron un
// candado, son texto que el modelo lee.
const PLACEHOLDER_GUARDRAILS =
  "Ej.: No canceles ni cambies el estado de una oportunidad a ganada sin que un humano lo confirme. No modifiques el email ni el teléfono de un contacto. Antes de reservar un turno, asegurate de tener el nombre y el teléfono del cliente.";

// Las tres claves que esta pantalla ya no escribe pero que un agente viejo
// puede seguir teniendo guardadas — el backend las preserva en cada guardado
// (preservarGuardrailsHeredados en src/services/agent.service.ts). Se
// muestran en el panel de confirmación para que el ADMIN vea todo lo que va a
// regir, no solo la parte que acaba de escribir.
const CLAVES_HEREDADAS = ["temasProhibidos", "promesasProhibidas", "condicionesDeDerivacion"];

function conGuardrailsHeredados(
  actuales: Record<string, unknown> | undefined,
  nuevos: Record<string, unknown>,
): Record<string, unknown> {
  if (!actuales) {
    return nuevos;
  }
  const fusionados: Record<string, unknown> = { ...nuevos };
  for (const clave of CLAVES_HEREDADAS) {
    if (actuales[clave] !== undefined) {
      fusionados[clave] = actuales[clave];
    }
  }
  return fusionados;
}

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
    guardrailsText: agent.guardrailsText,
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
// LOS GUARDRAILS SE ESCRIBEN EN LENGUAJE NATURAL (ítem 56), y es lo que más
// cambió desde el §55. El ADMIN escribe en sus palabras; al guardar, el
// backend traduce ese texto al objeto de docs/ai-agent-architecture.md §6 y la
// pantalla se lo muestra para que lo CONFIRME antes de que quede activo. Tres
// cosas que no son obvias y que sostienen todo el flujo:
//
//   1. Se guarda EXACTAMENTE lo que el ADMIN confirmó. El POST/PATCH lleva el
//      objeto que devolvió la traducción, y el backend no vuelve a traducir:
//      una segunda llamada al modelo podría dar otro resultado, y entonces lo
//      guardado no sería lo que se mostró.
//   2. Si el texto no cambió, no hay traducción. En edición, lo que el agente
//      ya tiene cuenta como confirmado, así que guardar sin tocar el campo no
//      gasta una llamada al proveedor por algo que nadie editó.
//   3. Si la traducción falla, NO se guarda. Nada de caer a `{}` en silencio:
//      un agente con los guardrails vacíos porque se cayó la red es
//      exactamente el accidente que este flujo tiene que impedir. Mismo
//      criterio "fail closed" que allowedOrigins.
//
// DESDE EL ÍTEM 72 ESE CAMPO SOLO CONFIGURA LOS TRES CANDADOS DE CÓDIGO
// (acciones prohibidas, información protegida, datos requeridos antes de una
// acción): son los únicos que puedeEjecutarTool() hace cumplir antes de dejar
// pasar una acción. Los temas prohibidos, las promesas prohibidas y las
// condiciones de derivación se escriben en Instrucciones, en texto libre —
// nunca fueron un candado, iban al prompt con la misma fuerza que ese campo. A
// los agentes que ya las tenían configuradas no se les migró nada: el backend
// las preserva en cada guardado, y el panel de confirmación las sigue
// mostrando (ver conGuardrailsHeredados) para que el ADMIN vea todo lo que
// rige, aunque desde acá ya no lo pueda editar.
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
// lugares vacíos esperándolos: cada uno trajo su propia pantalla (ítems 63,
// 65 y 66).
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
  // La traducción que está esperando confirmación. null = el panel está
  // cerrado; no hace falta un booleano aparte para eso.
  const [traduccion, setTraduccion] = useState<GuardrailsTranslation | null>(null);
  const [traduciendo, setTraduciendo] = useState(false);
  // true solo cuando el error que se está mostrando es de la traducción: es lo
  // que decide si aparece "Reintentar". Un error del POST no se reintenta con
  // ese botón — se reintenta guardando de nuevo.
  const [puedeReintentar, setPuedeReintentar] = useState(false);
  const [confirmado, setConfirmado] = useState<GuardrailsConfirmados | null>(null);

  // En EDICIÓN, lo que el agente ya tiene cuenta como confirmado: el ADMIN lo
  // confirmó cuando lo creó o lo editó por última vez. Se deriva de la query
  // en vez de sembrarse con un efecto, mismo criterio que useFormDraft — un
  // refetch no puede pisar una confirmación recién hecha, porque `confirmado`
  // gana.
  const confirmadoVigente: GuardrailsConfirmados | null =
    confirmado ??
    (agentQuery.data
      ? { text: agentQuery.data.guardrailsText, guardrails: agentQuery.data.guardrails }
      : null);

  const isSubmitting = createAgentMutation.isPending || updateAgentMutation.isPending;
  const guardarDeshabilitado = isSubmitting || traduciendo;

  async function guardar(guardrails: Record<string, unknown>) {
    const modelName = values.modelName.trim();
    const guardrailsText = values.guardrailsText.trim();

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
          // Los dos SIEMPRE juntos: el backend rechaza un PATCH que traiga uno
          // solo, justamente para que el texto que se muestra y el objeto que
          // rige no puedan quedar diciendo cosas distintas.
          guardrails,
          guardrailsText,
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
          guardrails,
          guardrailsText,
          isActive: values.isActive,
        };
        await createAgentMutation.mutateAsync(input);
      }
      navigate("/agents");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el agente");
    }
  }

  // Pide la traducción y abre el panel. Un fallo NO cierra el formulario ni
  // pierde lo escrito: deja el error a la vista con un "Reintentar" al lado.
  async function traducir() {
    setError(null);
    setPuedeReintentar(false);
    setTraduciendo(true);
    try {
      setTraduccion(await translateGuardrails(values.guardrailsText.trim()));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudieron interpretar las reglas del agente",
      );
      setPuedeReintentar(true);
    } finally {
      setTraduciendo(false);
    }
  }

  async function confirmarYGuardar() {
    if (traduccion === null) {
      return;
    }
    const texto = values.guardrailsText.trim();
    // Queda confirmado ANTES de guardar: si el POST falla y el ADMIN vuelve a
    // apretar Guardar sin tocar el texto, no se traduce de nuevo.
    setConfirmado({ text: texto, guardrails: traduccion.guardrails });
    setTraduccion(null);
    await guardar(traduccion.guardrails);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPuedeReintentar(false);

    const errorDeValidacion = validar(values, isEditMode);
    if (errorDeValidacion !== null) {
      setError(errorDeValidacion);
      return;
    }

    const texto = values.guardrailsText.trim();

    // (1) Sin texto no hay nada que traducir: {} directo, sin gastar una
    // llamada al proveedor. Mismo criterio que tenía el textarea de JSON
    // vacío en el §55.
    if (texto === "") {
      await guardar({});
      return;
    }

    // (2) El texto no cambió desde la última confirmación (en edición, desde
    // que se cargó el agente): se reenvía el objeto ya confirmado tal cual.
    if (confirmadoVigente !== null && confirmadoVigente.text.trim() === texto) {
      await guardar(confirmadoVigente.guardrails);
      return;
    }

    // (3) Texto nuevo: se traduce y se muestra para confirmar. Todavía no se
    // guarda nada.
    await traducir();
  }

  if (isEditMode && agentQuery.isLoading) {
    return <LoadingState variant="lines" />;
  }

  if (isEditMode && agentQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar el agente
        {agentQuery.error instanceof Error ? `: ${agentQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  const descartes = traduccion ? resumirDescartes(traduccion.descartado) : [];

  // Lo que el panel muestra al EDITAR no es solo lo que se acaba de traducir:
  // es lo que va a regir. Las claves heredadas del ítem 72 siguen ahí después
  // de guardar —el backend las preserva— así que esconderlas haría que la
  // confirmación dijera menos de lo que el agente realmente hace cumplir. El
  // PATCH sigue llevando `traduccion.guardrails` a secas: quién preserva lo
  // heredado es el backend, no esta pantalla.
  const guardrailsDelPanel = traduccion
    ? conGuardrailsHeredados(agentQuery.data?.guardrails, traduccion.guardrails)
    : {};

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
            </div>
            <p className="ds-hint ds-field-grid--full">
              Es lo que el modelo lee antes de cada conversación: qué hace el negocio, qué tiene que
              lograr el agente y cómo tiene que hablar. Incluí también, con tus palabras, los temas
              que no puede tocar, las promesas que no puede hacer y cuándo tiene que derivar la
              conversación a una persona.
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
              cada acción vuelve a pasar por las reglas del agente de abajo. Sin canales, el agente
              no atiende por ningún lado.
            </p>

            {/* Solo lectura desde el ítem 127 (A-01): el número lo asigna el
                platform admin y el formulario ya no lo manda. Mismo patrón
                que la Sucursal en edición: el campo deshabilitado y el
                porqué debajo. */}
            <FormField label="ID del número de WhatsApp">
              <input
                type="text"
                value={agentQuery.data?.whatsappPhoneNumberId ?? ""}
                placeholder="Sin número asignado"
                disabled
                readOnly
              />
            </FormField>

            <p className="ds-hint ds-field-grid--full">
              Lo configura el equipo de la plataforma. Es el «Phone number ID» de Meta con el que
              sabemos a qué agente le corresponde cada mensaje que llega por WhatsApp. Si este
              agente tiene que atender por WhatsApp, pedíselo al equipo de la plataforma.
            </p>
          </div>
        </Card>

        <Card heading="Reglas del agente">
          <div className="ds-field-grid">
            <div className="ds-field-grid--full">
              <FormField label="Reglas del agente">
                <textarea
                  value={values.guardrailsText}
                  rows={8}
                  maxLength={4000}
                  placeholder={PLACEHOLDER_GUARDRAILS}
                  onChange={(event) => setValues({ ...values, guardrailsText: event.target.value })}
                />
              </FormField>
            </div>
            <p className="ds-hint ds-field-grid--full">
              Escribilo con tus palabras: qué acciones no puede ejecutar nunca (aunque estén
              habilitadas arriba), qué datos no puede modificar y qué tiene que saber antes de
              ejecutar una acción. Esto no es una instrucción más para el modelo: es lo que el
              sistema verifica con código antes de dejar pasar cada acción, así que el agente no lo
              puede saltear. Lo demás —los temas de los que no querés que hable, las promesas que no
              puede hacer y cuándo tiene que derivar a una persona— va en Instrucciones. Al guardar
              te mostramos qué entendimos, para que lo confirmes. Si lo dejás vacío, el agente no
              tiene ninguna restricción además de los permisos de arriba.
            </p>
          </div>
        </Card>

        {error ? <ErrorState>{error}</ErrorState> : null}
        {puedeReintentar ? (
          <div>
            <Button onClick={() => void traducir()} disabled={traduciendo}>
              Reintentar
            </Button>
          </div>
        ) : null}

        <div>
          <RequiredFieldsHint />
          <Button
            type="submit"
            variant="primary"
            disabled={guardarDeshabilitado}
            loading={traduciendo || isSubmitting}
          >
            {traduciendo ? "Traduciendo…" : isSubmitting ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>

      {/* El panel de confirmación. Variante "panel" y no "dialog", y no es un
          detalle: el panel NO se cierra al hacer click afuera ni con Escape
          (ver Modal.tsx), que es justo lo que hace falta acá — un cierre
          accidental sobre una confirmación pendiente dejaría al ADMIN sin
          saber si guardó o no. Los dos caminos son explícitos: confirmar, o
          volver a editar. */}
      {traduccion ? (
        <Modal
          title="Esto es lo que entendimos"
          closeLabel="Volver a editar"
          onClose={() => setTraduccion(null)}
          primaryAction={{
            label: "Confirmar y guardar",
            onClick: () => void confirmarYGuardar(),
            disabled: isSubmitting,
          }}
        >
          <p className="ds-hint">
            Así va a quedar configurado el agente. Si algo no es lo que quisiste decir, volvé a
            editar el texto.
          </p>
          <ul>
            {resumirGuardrails(guardrailsDelPanel, agentToolOptions(values.enabledTools)).map(
              (linea) => (
                <li key={linea}>{linea}</li>
              ),
            )}
          </ul>

          {descartes.length > 0 ? (
            <ErrorState>
              Esto no se puede aplicar y no va a quedar configurado:
              <ul>
                {descartes.map((linea) => (
                  <li key={linea}>{linea}</li>
                ))}
              </ul>
            </ErrorState>
          ) : null}

          {/* Para quien quiera revisar el objeto en crudo. De solo lectura: lo
              que se guarda es lo de arriba, y un campo editable acá volvería a
              pedirle JSON al ADMIN, que es exactamente lo que este ítem sacó. */}
          <details>
            <summary>Ver JSON</summary>
            <pre className="ds-code-field ds-json-preview">
              {formatGuardrails(guardrailsDelPanel)}
            </pre>
          </details>
        </Modal>
      ) : null}
    </form>
  );
}
