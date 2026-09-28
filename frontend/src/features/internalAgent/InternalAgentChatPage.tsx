import {
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "../../design-system/Button";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { ThemeToggle } from "../../design-system/ThemeToggle";
import { ApiError } from "../../lib/api";
import { useSendInternalAgentMessage } from "./mutations";
import { useInternalAgentMessages } from "./queries";
import type { InternalAgentMessage } from "./types";

// El tope de `content` en postMessageSchema (internalAgent.controller.ts).
// Espejo a mano, mismo criterio que MENSAJE_MAX_LENGTH del probador.
const MENSAJE_MAX_LENGTH = 4000;

// Alto máximo del textarea que crece: pasado esto, scrollea adentro. En un
// teléfono, más alto que esto se come la conversación.
const TEXTAREA_MAX_HEIGHT_PX = 160;

const TITULO_POR_DEFECTO = "Agente interno";

// ---------------------------------------------------------------------------
// Chat con el agente de IA interno (ítem 180; backend en el 179), pensado para
// usarse desde el celular.
//
// VIVE FUERA DE AppLayout, a propósito: el shell es una sidebar fija sin
// ningún @media de layout, y en un teléfono no colapsa. Adaptar AppLayout a
// mobile es una decisión aparte que no se toma acá; esta pantalla tiene su
// propio layout de una columna a pantalla completa (.ds-internal-chat) y
// "‹ Volver" para quien la abre desde una compu. Sigue dentro de
// ProtectedRoute (ver app/router.tsx).
//
// Reusa .ds-chat* tal cual (probador y bandeja): el usuario a la derecha
// (--contacto, que en CSS es "el lado de quien escribe"), el agente a la
// izquierda. Las tool calls de cada mensaje NO se muestran: acá del otro lado
// hay un empleado, no un ADMIN diagnosticando — la respuesta del agente ya
// cuenta lo que hizo ("Listo, te agendé la tarea…").
//
// Enviar se deshabilita mientras hay un turno en curso: el backend no toma
// lock por hilo (ítem 179), y dos mensajes simultáneos se intercalarían. Esto
// cierra el caso real —tocar dos veces desde el celular—; dos pestañas a la
// vez siguen siendo posibles.
// ---------------------------------------------------------------------------

// Las páginas llegan "lo más nuevo primero" y se acumulan hacia atrás. Se dan
// vuelta para mostrar en orden cronológico, y se deduplica por id: la
// paginación es por offset, así que después de mandar mensajes la página 2
// puede repetir el final de la 1 hasta el próximo refetch.
function enOrdenCronologico(paginas: { data: InternalAgentMessage[] }[]): InternalAgentMessage[] {
  const vistos = new Set<string>();
  const nuevosPrimero: InternalAgentMessage[] = [];
  for (const pagina of paginas) {
    for (const mensaje of pagina.data) {
      if (vistos.has(mensaje.id)) continue;
      vistos.add(mensaje.id);
      nuevosPrimero.push(mensaje);
    }
  }
  return nuevosPrimero.reverse();
}

function Layout({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="ds-internal-chat">
      <header className="ds-internal-chat-header">
        <Link to="/" className="ds-internal-chat-back">
          ‹ Volver
        </Link>
        <h1 className="ds-internal-chat-title">{titulo}</h1>
        <ThemeToggle />
      </header>
      {children}
    </div>
  );
}

// El cuerpo cuando no hay chat que mostrar (sin agente, sin acceso, error).
function Aviso({ children }: { children: ReactNode }) {
  return <div className="ds-internal-chat-notice">{children}</div>;
}

export function InternalAgentChatPage() {
  const { me } = useAuth();
  const isAdmin = me?.role === "ADMIN";
  const mensajesQuery = useInternalAgentMessages();
  const enviarMutation = useSendInternalAgentMessage();

  const [texto, setTexto] = useState("");
  // El mensaje del turno en curso, mostrado de inmediato (optimista) hasta
  // que vuelve la respuesta y entra a la cache junto con ella (mutations.ts).
  const [pendiente, setPendiente] = useState<string | null>(null);
  const [errorDeEnvio, setErrorDeEnvio] = useState<string | null>(null);

  const listaRef = useRef<HTMLOListElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const mensajes = enOrdenCronologico(mensajesQuery.data?.pages ?? []);
  const ultimoId = mensajes.at(-1)?.id;

  // Abajo de todo al cargar, al llegar un mensaje nuevo y al empezar/terminar
  // un turno — pero NO al traer mensajes anteriores, que se agregan arriba y
  // no cambian el último.
  useLayoutEffect(() => {
    const lista = listaRef.current;
    if (lista) lista.scrollTop = lista.scrollHeight;
  }, [ultimoId, pendiente, errorDeEnvio]);

  function ajustarAlto(textarea: HTMLTextAreaElement) {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`;
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setTexto(event.target.value);
    ajustarAlto(event.target);
  }

  const enviando = enviarMutation.isPending;

  async function enviar() {
    const contenido = texto.trim();
    if (contenido.length === 0 || enviando) return;

    setPendiente(contenido);
    setErrorDeEnvio(null);
    setTexto("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    try {
      await enviarMutation.mutateAsync(contenido);
    } catch (error) {
      // El mensaje del backend tal cual (sin acceso, sin agente, content
      // inválido) y el texto de vuelta en la caja, para reintentar sin
      // reescribirlo (salvo que ya se haya empezado a escribir otro mientras
      // esperaba). No se reintenta solo.
      setErrorDeEnvio(error instanceof Error ? error.message : "No pudimos enviar el mensaje.");
      setTexto((actual) => (actual === "" ? contenido : actual));
    } finally {
      setPendiente(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void enviar();
  }

  // Enter manda, Shift+Enter hace un salto de línea, igual que el probador.
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void enviar();
    }
  }

  if (mensajesQuery.isLoading) {
    return (
      <Layout titulo={TITULO_POR_DEFECTO}>
        <Aviso>
          <LoadingState variant="lines" />
        </Aviso>
      </Layout>
    );
  }

  if (mensajesQuery.isError) {
    const error = mensajesQuery.error;
    const status = error instanceof ApiError ? error.status : undefined;
    let cuerpo: ReactNode;
    if (status === 404) {
      cuerpo = isAdmin ? (
        <EmptyState>
          Todavía no hay un agente interno configurado.{" "}
          <Link to="/internal-agent/settings">Configuralo acá</Link>.
        </EmptyState>
      ) : (
        <EmptyState>
          Todavía no hay un agente interno configurado. Pedíselo a un administrador.
        </EmptyState>
      );
    } else if (status === 403) {
      // El texto del backend (MENSAJE_SIN_ACCESO_AL_AGENTE_INTERNO): pasa si
      // un ADMIN sacó el acceso con la pestaña abierta. Sin reintento — el
      // queryClient no reintenta 4xx.
      cuerpo = <ErrorState>{error.message}</ErrorState>;
    } else {
      cuerpo = (
        <ErrorState>
          No pudimos cargar la conversación
          {error instanceof Error ? `: ${error.message}` : "."}
        </ErrorState>
      );
    }
    return (
      <Layout titulo={TITULO_POR_DEFECTO}>
        <Aviso>{cuerpo}</Aviso>
      </Layout>
    );
  }

  const agentName = mensajesQuery.data?.pages[0]?.agentName ?? TITULO_POR_DEFECTO;
  const vacio = mensajes.length === 0 && pendiente === null && errorDeEnvio === null;

  return (
    <Layout titulo={agentName}>
      <ol ref={listaRef} className="ds-chat" aria-label="Conversación">
        {mensajesQuery.hasNextPage ? (
          <li className="ds-internal-chat-older">
            <Button
              onClick={() => void mensajesQuery.fetchNextPage()}
              disabled={mensajesQuery.isFetchingNextPage}
              loading={mensajesQuery.isFetchingNextPage}
            >
              {mensajesQuery.isFetchingNextPage ? "Cargando…" : "Ver mensajes anteriores"}
            </Button>
          </li>
        ) : null}
        {vacio ? (
          <li className="ds-internal-chat-older">
            <EmptyState>Escribile a {agentName} para empezar.</EmptyState>
          </li>
        ) : null}
        {mensajes.map((mensaje) => (
          <li
            key={mensaje.id}
            className={`ds-chat-row ds-chat-row--${mensaje.senderType === "USER" ? "contacto" : "agente"}`}
          >
            <div className="ds-chat-bubble">
              <span className="ds-chat-author">
                {mensaje.senderType === "USER" ? "Vos" : agentName}
              </span>
              {mensaje.content}
            </div>
          </li>
        ))}
        {pendiente !== null ? (
          <>
            <li className="ds-chat-row ds-chat-row--contacto">
              <div className="ds-chat-bubble">
                <span className="ds-chat-author">Vos</span>
                {pendiente}
              </div>
            </li>
            <li className="ds-chat-row ds-chat-row--agente">
              <div className="ds-chat-bubble" role="status">
                <span className="ds-chat-author">{agentName}</span>
                Escribiendo…
              </div>
            </li>
          </>
        ) : null}
        {errorDeEnvio !== null ? (
          <li className="ds-chat-row ds-chat-row--error">
            <p className="ds-chat-note ds-chat-note--error" role="alert">
              {errorDeEnvio}
            </p>
          </li>
        ) : null}
      </ol>

      <form className="ds-chat-form ds-internal-chat-form" onSubmit={handleSubmit}>
        <label className="ds-sr-only" htmlFor="internal-agent-message">
          Mensaje
        </label>
        <textarea
          id="internal-agent-message"
          ref={textareaRef}
          rows={1}
          value={texto}
          maxLength={MENSAJE_MAX_LENGTH}
          placeholder="Escribí tu mensaje…"
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
        <Button
          type="submit"
          variant="primary"
          disabled={enviando || texto.trim().length === 0}
          loading={enviando}
        >
          {enviando ? "Enviando…" : "Enviar"}
        </Button>
      </form>
    </Layout>
  );
}
