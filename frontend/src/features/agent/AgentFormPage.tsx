import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../../design-system/PageHeader";
import { AYUDA } from "../guia/anclas";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { Modal } from "../../design-system/Modal";
import { MultiSelect } from "../../design-system/MultiSelect";
import { RequiredFieldsHint } from "../../design-system/RequiredFieldsHint";
import { Select } from "../../design-system/Select";
import { useAuth } from "../../auth/AuthContext";
import { useFormDraft } from "../../lib/useFormDraft";
import { BranchSelect } from "../branch/BranchSelect";
import { useAssignAgentModel } from "../platformAdmin/mutations";
import { translateGuardrails } from "./api";
import { formatGuardrails, resumirDescartes, resumirGuardrails } from "./guardrails";
import { CHANNEL_OPTIONS, DEFAULT_MODEL_PROVIDER, MODEL_PROVIDER_OPTIONS } from "./labels";
import { useCreateAgent, useUpdateAgent } from "./mutations";
import { useAgent } from "./queries";
import { agentToolOptions, avisoDeAccionesSinGuardarElNombre } from "./tools";
import type {
  Agent,
  ConversationChannel,
  CreateAgentInput,
  GuardrailsTranslation,
  UpdateAgentInput,
} from "./types";

// El aviso "nadie disponible": el tope de la columna y el texto de siempre
// (AVISO_SIN_RESPUESTA en avisoSinRespuesta.service.ts del backend), que se
// muestra de ejemplo en el campo vacío.
const MAX_AVISO_SIN_RESPUESTA = 500;
const AVISO_SIN_RESPUESTA_DE_SIEMPRE =
  "Por el momento no hay nadie del equipo disponible. Te vamos a contactar más tarde. Mientras tanto, si querés, puedo seguir ayudándote.";

interface AgentFormValues {
  branchId: string | undefined;
  name: string;
  goal: string;
  instructions: string;
  tone: string;
  // Texto y no número: el input vacío es un valor válido (desactivado).
  avisoSinRespuestaMinutos: string;
  // Vacío = el texto de siempre.
  avisoSinRespuestaTexto: string;
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
  // El mismo default que la base.
  avisoSinRespuestaMinutos: "15",
  avisoSinRespuestaTexto: "",
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
    avisoSinRespuestaMinutos:
      agent.unansweredHandoffNoticeMinutes === null ||
      agent.unansweredHandoffNoticeMinutes === undefined
        ? ""
        : String(agent.unansweredHandoffNoticeMinutes),
    avisoSinRespuestaTexto: agent.unansweredHandoffNoticeText ?? "",
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

// Los minutos del aviso sin respuesta: vacío = null (desactivado, igual que
// 0). validar() ya garantizó que, si hay algo, es un entero de 0 a 1440.
function minutosOpcionales(value: string): number | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : Number(trimmed);
}

// El error de validación del cliente, o null si el formulario puede viajar.
// Solo mira lo que se puede decidir sin preguntarle al servidor, y solo lo que
// la validación nativa del navegador NO cubre: Nombre e Instrucciones llevan
// `required` y los frena el propio <form>.
function validar(
  values: AgentFormValues,
  isEditMode: boolean,
  puedeElegirModelo: boolean,
): string | null {
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
  const minutos = values.avisoSinRespuestaMinutos.trim();
  if (minutos !== "" && !/^\d+$/.test(minutos)) {
    return "Los minutos del aviso si nadie responde tienen que ser un número entero, o quedar vacíos para no avisar.";
  }
  if (minutos !== "" && Number(minutos) > 1440) {
    return "El aviso si nadie responde puede esperar como mucho un día (1440 minutos).";
  }
  if (puedeElegirModelo && isEditMode && values.modelName.trim() === "") {
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
  // B-05 (docs-privados/auditoria-2026-09-24-punta-a-punta.md, local): el
  // modelo lo elige la plataforma. Para un ADMIN común el campo es de solo
  // lectura y el POST/PATCH no lo manda; para un platform admin es editable y
  // se guarda por su propio endpoint (PUT /api/admin/agents/:id/model).
  const { me } = useAuth();
  const puedeElegirModelo = me?.isPlatformAdmin === true;
  const assignModelMutation = useAssignAgentModel();

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

  const isSubmitting =
    createAgentMutation.isPending || updateAgentMutation.isPending || assignModelMutation.isPending;
  const guardarDeshabilitado = isSubmitting || traduciendo;

  // B-05: solo un platform admin, y solo si escribió uno distinto del que el
  // agente tiene (o del que le puso la plataforma al crearlo).
  async function guardarModelo(agentId: string, vigente: string, pedido: string) {
    if (!puedeElegirModelo || pedido === "" || pedido === vigente) {
      return;
    }
    await assignModelMutation.mutateAsync({
      agentId,
      modelProvider: values.modelProvider,
      modelName: pedido,
    });
  }

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
          unansweredHandoffNoticeMinutes: minutosOpcionales(values.avisoSinRespuestaMinutos),
          unansweredHandoffNoticeText: textoOpcional(values.avisoSinRespuestaTexto),
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
        await guardarModelo(id ?? "", agentQuery.data?.modelName ?? "", modelName);
      } else {
        const input: CreateAgentInput = {
          // validar() ya garantizó que hay sucursal elegida.
          branchId: values.branchId ?? "",
          name: values.name.trim(),
          goal: textoOpcional(values.goal),
          instructions: values.instructions.trim(),
          tone: textoOpcional(values.tone),
          unansweredHandoffNoticeMinutes: minutosOpcionales(values.avisoSinRespuestaMinutos),
          unansweredHandoffNoticeText: textoOpcional(values.avisoSinRespuestaTexto),
          // Sin modelo: el agente nace con el de la plataforma (B-05).
          enabledTools: values.enabledTools,
          channels: values.channels,
          guardrails,
          guardrailsText,
          isActive: values.isActive,
        };
        const creado = await createAgentMutation.mutateAsync(input);
        await guardarModelo(creado.id, creado.modelName, modelName);
      }
      navigate("/agents");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardar el agente");
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

    const errorDeValidacion = validar(values, isEditMode, puedeElegirModelo);
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
      <PageHeader help={AYUDA.agenteForm} title={isEditMode ? "Editar agente" : "Nuevo agente"} />
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
                No se puede cambiar. Para otra sucursal, creá un agente nuevo.
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
              Resumen para esta pantalla; el agente lee las instrucciones.
            </p>

            <FormField label="Avisar al cliente si nadie responde en (minutos)">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={1440}
                step={1}
                value={values.avisoSinRespuestaMinutos}
                placeholder="Sin aviso"
                onChange={(event) =>
                  setValues({ ...values, avisoSinRespuestaMinutos: event.target.value })
                }
              />
            </FormField>

            <p className="ds-hint ds-field-grid--full">Vacío o 0: no se avisa.</p>

            <div className="ds-field-grid--full">
              <FormField label="Mensaje cuando no hay nadie disponible">
                <textarea
                  rows={3}
                  maxLength={MAX_AVISO_SIN_RESPUESTA}
                  value={values.avisoSinRespuestaTexto}
                  placeholder={AVISO_SIN_RESPUESTA_DE_SIEMPRE}
                  onChange={(event) =>
                    setValues({ ...values, avisoSinRespuestaTexto: event.target.value })
                  }
                />
              </FormField>
            </div>

            <p className="ds-hint ds-field-grid--full">
              Le llega al cliente. No escribas el horario: se agrega solo.
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
              Lo que el agente lee antes de cada conversación.
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
              disabled={!puedeElegirModelo}
              onChange={(modelProvider) => {
                if (modelProvider) setValues({ ...values, modelProvider });
              }}
            />

            {/* El asterisco depende del modo porque la obligatoriedad también
                — ver validar(). Solo lectura salvo para un platform admin
                (B-05), mismo patrón que el número de WhatsApp. */}
            <FormField
              label={
                puedeElegirModelo && isEditMode ? (
                  <span className="ds-required">Modelo</span>
                ) : (
                  <span>Modelo</span>
                )
              }
            >
              <input
                type="text"
                value={values.modelName}
                maxLength={100}
                placeholder={puedeElegirModelo ? "openai/gpt-4o-mini" : "El de la plataforma"}
                disabled={!puedeElegirModelo}
                readOnly={!puedeElegirModelo}
                onChange={(event) => setValues({ ...values, modelName: event.target.value })}
              />
            </FormField>

            <p className="ds-hint ds-field-grid--full">
              {!puedeElegirModelo
                ? "Lo elige el equipo de la plataforma."
                : isEditMode
                  ? "El nombre del modelo tal cual lo publica el proveedor."
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
              Sin canales, el agente no atiende por ningún lado.
            </p>

            {avisoDeAccionesSinGuardarElNombre(values.enabledTools) ? (
              <p className="ds-hint ds-field-grid--full" role="alert">
                {avisoDeAccionesSinGuardarElNombre(values.enabledTools)}
              </p>
            ) : null}

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

            <p className="ds-hint ds-field-grid--full">Lo asigna el equipo de la plataforma.</p>
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
              El sistema las hace cumplir antes de cada acción.
            </p>
          </div>
        </Card>

        {error ? <ErrorState>{error}</ErrorState> : null}
        {puedeReintentar ? (
          <div>
            <Button onClick={() => void traducir()} disabled={traduciendo} loading={traduciendo}>
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
          <p className="ds-hint">Si algo no es lo que quisiste decir, volvé a editar.</p>
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
