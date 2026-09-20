import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Select } from "../../design-system/Select";
import { useFormDraft } from "../../lib/useFormDraft";
import { ContactSelect } from "../opportunity/ContactSelect";
import { CHANNEL_LABEL, CHANNEL_OPTIONS } from "./labels";
import { useTestMessage } from "./mutations";
import { useAgent } from "./queries";
import { ToolCallBlock } from "./ToolCallBlock";
import type { ConversationChannel, TestMessageResult, TestMessageToolCall } from "./types";

// El tope de `message` en testMessageSchema (agent.controller.ts). Espejo a
// mano, mismo criterio que ORIGEN_MAX_LENGTH en origin.ts: no hay endpoint que
// exponga el límite, y frenarlo en el textarea evita un 400 por algo que se
// puede ver antes de mandar.
const MENSAJE_MAX_LENGTH = 4000;

// ---------------------------------------------------------------------------
// Probador del agente (ítem 65 de docs/frontend-cambios-pendientes.md): mandar
// mensajes a mano a un agente, como si fueran del contacto, y ver qué
// contesta y qué hace.
//
// CERO BACKEND NUEVO. POST /api/agents/:id/test-message existe desde el paso
// 2b de docs/ai-agent-architecture.md §9 (agent.routes.ts +
// testMessageHandler). Lo que faltaba era la pantalla: hasta acá el único modo
// de ejercitar el loop de orquestación era un curl a mano.
//
// ESTO NO ES UN ENTORNO DE PRUEBA AISLADO, y es la primera cosa que dice la
// pantalla. `test-message` exige un `contactId` de un Contacto REAL de la
// organización, y runAgentTurn —que este endpoint ejercita completo— resuelve
// o crea una Conversation de verdad, persiste los Message de verdad, y si el
// agente tiene tools habilitadas puede crear una Oportunidad, escribir los
// campos de calificación del contacto o derivar la conversación a un vendedor
// (una Activity real). Es EL MISMO camino de código que un mensaje entrante de
// un canal externo; lo único distinto es quién lo dispara.
//
// Es una decisión, no una omisión: se elige un contacto real existente, con la
// advertencia bien visible arriba de todo. No se arma un "contacto de prueba"
// descartable ni ningún mecanismo de aislamiento nuevo — un sandbox que no
// ejecutara las tools probaría otra cosa que la que se quiere probar, y un
// contacto descartable inventaría un concepto que el modelo de datos no tiene.
//
// LA TRANSCRIPCIÓN DE ESTA PANTALLA VIVE SOLO EN ESTA VISITA: al recargar o
// volver más tarde, lo de antes no está acá. Hasta el ítem 65 eso era además
// definitivo, porque no existía ningún GET de Conversation/Message; desde el
// ítem 66 el hilo completo SÍ se puede ver, en /conversations, y el hint de
// abajo manda ahí en vez de decir que no hay forma.
//
// Este probador sigue sin traer el historial, y es a propósito: mostrar
// mensajes viejos en la misma caja donde se escriben los nuevos borraría la
// distinción entre lo que uno acaba de mandar y lo que pasó antes — que es
// justo lo que hay que tener claro en una herramienta que escribe datos
// reales. La bandeja es de solo lectura y para eso está.
//
// TODA LA PANTALLA ES ADMIN-ONLY (vive dentro de <AdminRoute />, ver
// app/router.tsx): el endpoint es authorize("ADMIN"), mismo criterio que
// /agents/:id/embed. Por eso no hay ningún gate `isAdmin` acá adentro.
// ---------------------------------------------------------------------------

// Una línea de la transcripción, antes de recibir su id. Las notas de sistema
// y de error son entradas de primera clase y no burbujas: lo que pasó en el
// turno (una derivación, un 400 del backend) no lo "dijo" nadie, y ponerlo en
// una burbuja del agente sería atribuirle al modelo un texto que no escribió.
type EntradaSinId =
  | { tipo: "contacto"; texto: string }
  | { tipo: "agente"; texto: string }
  | { tipo: "sistema"; texto: string }
  | { tipo: "error"; texto: string }
  | { tipo: "tool"; llamada: TestMessageToolCall };

type Entrada = EntradaSinId & { id: number };

// Lo que un turno agrega a la transcripción, en el orden en que ocurrió: las
// tools se ejecutan ANTES de que el modelo produzca su respuesta final, así
// que van arriba de la burbuja. Pura y fuera del componente: es toda la
// traducción del contrato del backend a lo que se ve, y así se lee de una.
function entradasDelTurno(resultado: TestMessageResult): EntradaSinId[] {
  const entradas: EntradaSinId[] = resultado.toolCalls.map((llamada) => ({
    tipo: "tool",
    llamada,
  }));

  if (resultado.respuesta === null) {
    // Una burbuja vacía se leería como "el agente contestó nada". Esto es otra
    // cosa: la conversación ya estaba derivada a un humano, así que el agente
    // no contesta más y el mensaje solo quedó registrado en el hilo.
    entradas.push({
      tipo: "sistema",
      texto: "El agente no respondió — la conversación ya estaba derivada a un humano.",
    });
  } else {
    entradas.push({ tipo: "agente", texto: resultado.respuesta });
  }

  if (resultado.handoff) {
    entradas.push({ tipo: "sistema", texto: "Se derivó esta conversación a un humano." });
  }

  return entradas;
}

export function AgentPlaygroundPage() {
  const { id } = useParams<{ id: string }>();
  const agentId = id ?? "";

  const agentQuery = useAgent(id);
  const testMessageMutation = useTestMessage(agentId);

  const [contactId, setContactId] = useState<string | undefined>(undefined);
  const [texto, setTexto] = useState("");
  const [entradas, setEntradas] = useState<Entrada[]>([]);
  // Contador propio en vez de un índice de array: las entradas nunca se
  // reordenan ni se borran de a una, pero un key por índice volvería a usar el
  // mismo número después de "Cambiar de contacto" y React reutilizaría nodos
  // de la conversación anterior.
  const siguienteId = useRef(0);

  // El canal elegido se DERIVA del agente (el primero de los habilitados)
  // mientras nadie lo tocó, igual que cualquier formulario del proyecto: un
  // refetch no puede pisar la elección, y un agente distinto vuelve a derivar.
  const [canal, setCanal] = useFormDraft<ConversationChannel | "">(
    agentQuery.data?.id,
    agentQuery.data?.channels[0] ?? "",
  );

  function agregar(...nuevas: EntradaSinId[]) {
    const conId = nuevas.map((entrada) => {
      siguienteId.current += 1;
      return { ...entrada, id: siguienteId.current };
    });
    setEntradas((actuales) => [...actuales, ...conId]);
  }

  // Cambiar de contacto LIMPIA la transcripción: para la pantalla es otra
  // conversación, aunque del lado del backend runAgentTurn reutilice una
  // Conversation existente si ya había una abierta para ese agente + contacto
  // + canal. Dejar los mensajes del contacto anterior a la vista mientras se
  // le escribe a otro sería la peor confusión posible en una herramienta que
  // escribe datos reales.
  function handleContacto(nuevo: string) {
    if (nuevo === contactId) return;
    setContactId(nuevo);
    setEntradas([]);
    testMessageMutation.reset();
  }

  async function enviar() {
    const mensaje = texto.trim();
    if (mensaje.length === 0 || contactId === undefined || canal === "") return;

    // Optimista: el mensaje del ADMIN entra a la transcripción antes de que el
    // backend conteste. No hay nada que revertir si falla — el turno se mandó
    // igual, y el error entra como una nota más abajo.
    agregar({ tipo: "contacto", texto: mensaje });
    setTexto("");

    try {
      const resultado = await testMessageMutation.mutateAsync({
        contactId,
        message: mensaje,
        channel: canal,
      });
      agregar(...entradasDelTurno(resultado));
    } catch (error) {
      // El mensaje del backend TAL CUAL ("El agente está desactivado", "El
      // agente no atiende el canal WEB", "Contacto no encontrado"): son
      // errores de negocio escritos para que se lean, y reinterpretarlos acá
      // solo podría empeorarlos.
      agregar({
        tipo: "error",
        texto: error instanceof Error ? error.message : "No pudimos enviar el mensaje.",
      });
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void enviar();
  }

  // Enter manda, Shift+Enter hace un salto de línea: el gesto que espera
  // cualquiera que haya usado un chat.
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void enviar();
    }
  }

  if (agentQuery.isLoading) {
    return <LoadingState />;
  }

  if (agentQuery.isError || !agentQuery.data) {
    return (
      <ErrorState>
        No pudimos cargar el agente
        {agentQuery.error instanceof Error ? `: ${agentQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  const agent = agentQuery.data;
  const opcionesDeCanal = CHANNEL_OPTIONS.filter((opcion) => agent.channels.includes(opcion.value));
  const sinCanales = opcionesDeCanal.length === 0;

  // El agente desactivado NO se deja mandar: el backend responde 400 con "El
  // agente está desactivado" y ofrecer un botón que solo puede fallar es peor
  // que no ofrecerlo — mismo criterio que "Revocar" sobre un token ya
  // revocado. El aviso de arriba dice qué hacer. Si alguien lo desactiva
  // desde otra pestaña MIENTRAS esta está abierta, ahí sí llega el 400 y se
  // muestra con el texto del backend, sin tocarlo.
  const puedeEscribir = !sinCanales && agent.isActive && contactId !== undefined;
  const enviando = testMessageMutation.isPending;

  return (
    <div className="ds-form">
      <h1>Probar el agente</h1>
      <p className="ds-hint">
        Agente: <strong>{agent.name}</strong>. <Link to="/agents">Volver a Agentes</Link>
      </p>

      {/* role="alert" a propósito, aunque esté desde que la pantalla carga y
          normalmente ese rol se reserve para lo que irrumpe: es la única
          advertencia del sistema que describe efectos irreversibles sobre
          datos reales, y que un lector de pantalla la anuncie antes que el
          resto es exactamente lo que se busca. */}
      <p role="alert" className="ds-error">
        Esto no es un entorno de prueba aislado: los mensajes generan una conversación real con el
        contacto que elijas, y si el agente tiene herramientas habilitadas puede crear
        oportunidades, calificar al lead o derivar la conversación a un vendedor de verdad.
      </p>

      {sinCanales ? (
        // Sin canales no hay NADA con qué probar: el backend rechaza cualquier
        // channel que se mande (agent.channels.includes(channel) o 400). Se
        // reemplaza toda la pantalla en vez de mostrarla deshabilitada: un
        // chat gris sin forma de usarlo no dice por qué.
        <Card heading="Este agente no tiene ningún canal habilitado">
          <p>
            Activá un canal en su configuración antes de probarlo:{" "}
            <Link to={`/agents/${agent.id}/edit`}>editar el agente</Link>.
          </p>
        </Card>
      ) : (
        <div className="ds-stack">
          <Card heading="Con quién hablás">
            <ContactSelect
              id="agent-playground-contact"
              label="Contacto"
              value={contactId}
              onChange={handleContacto}
            />

            {opcionesDeCanal.length > 1 ? (
              <Select
                id="agent-playground-channel"
                label="Canal"
                value={canal}
                options={opcionesDeCanal}
                onChange={(valor) => setCanal(valor)}
              />
            ) : (
              // Un solo canal habilitado no es una elección: mostrarlo como
              // un selector de una opción sería pedir una decisión que no
              // existe.
              <p className="ds-field-value">
                Canal: <strong>{CHANNEL_LABEL[opcionesDeCanal[0].value]}</strong>
              </p>
            )}

            {!agent.isActive ? (
              <p role="alert" className="ds-error">
                Este agente está desactivado y no responde mensajes.{" "}
                <Link to={`/agents/${agent.id}/edit`}>Activalo en su configuración</Link> para poder
                probarlo.
              </p>
            ) : null}
          </Card>

          <Card heading="Conversación">
            <p className="ds-hint">
              Escribís <strong>como el contacto</strong>, no como vos. Lo que se ve acá es solo lo
              que pasó desde que abriste esta pantalla; el hilo completo, con lo de sesiones
              anteriores, está en <Link to="/conversations">Conversaciones</Link>.
            </p>

            {entradas.length === 0 ? (
              <EmptyState>
                {contactId === undefined
                  ? "Elegí un contacto para empezar."
                  : "Escribí un mensaje para empezar."}
              </EmptyState>
            ) : (
              <ol className="ds-chat" aria-label="Transcripción">
                {entradas.map((entrada) => (
                  <li key={entrada.id} className={`ds-chat-row ds-chat-row--${entrada.tipo}`}>
                    {entrada.tipo === "tool" ? (
                      <ToolCallBlock llamada={entrada.llamada} />
                    ) : entrada.tipo === "sistema" || entrada.tipo === "error" ? (
                      <p className={`ds-chat-note ds-chat-note--${entrada.tipo}`}>
                        {entrada.texto}
                      </p>
                    ) : (
                      <div className="ds-chat-bubble">
                        <span className="ds-chat-author">
                          {entrada.tipo === "contacto" ? "Contacto (vos)" : agent.name}
                        </span>
                        {entrada.texto}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}

            {/* La derivación se muestra aparte de la nota de sistema cuando
                dejó una Activity: el id solo no le sirve a nadie, y la
                pantalla que la muestra existe (/activities/:id/edit, también
                ADMIN-only). Sin Activity no se inventa un link: el contacto
                no tenía vendedor asignado, así que no hay nada que abrir. */}
            {testMessageMutation.data?.handoff && testMessageMutation.data.handoffActivityId ? (
              <p className="ds-hint">
                Actividad de la derivación:{" "}
                <Link to={`/activities/${testMessageMutation.data.handoffActivityId}/edit`}>
                  abrirla
                </Link>
              </p>
            ) : null}

            <form className="ds-chat-form" onSubmit={handleSubmit}>
              <label className="ds-sr-only" htmlFor="agent-playground-message">
                Mensaje del contacto
              </label>
              <textarea
                id="agent-playground-message"
                rows={3}
                value={texto}
                maxLength={MENSAJE_MAX_LENGTH}
                disabled={!puedeEscribir || enviando}
                placeholder={
                  contactId === undefined
                    ? "Elegí un contacto para poder escribir…"
                    : "Escribí como si fueras el contacto…"
                }
                onChange={(event) => setTexto(event.target.value)}
                onKeyDown={handleKeyDown}
              />
              <Button
                type="submit"
                variant="primary"
                disabled={!puedeEscribir || enviando || texto.trim().length === 0}
              >
                {enviando ? "Enviando…" : "Enviar"}
              </Button>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
