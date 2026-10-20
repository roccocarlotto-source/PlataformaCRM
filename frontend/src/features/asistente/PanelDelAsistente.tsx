import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { ThumbsDown, ThumbsUp, X } from "lucide-react";
import { LARGO_MAXIMO_DE_LA_PREGUNTA, useAsistente, useEsCelular } from "../../asistente/contexto";
import { Button } from "../../design-system/Button";
import { renderizarMarkdown } from "../guia/markdown";

// ---------------------------------------------------------------------------
// El chat del asistente "¿Cómo se hace?". En la compu es un panel en la
// esquina, sobre el contenido; en el celular ocupa la pantalla entera (CSS,
// .ds-asistente-panel). El envío y la charla viven en src/asistente/contexto;
// acá solo se muestran. Las respuestas son markdown que ya validó el backend
// (solo links que la persona puede abrir) y se muestran con el mismo render
// sanitizado de la guía.
// ---------------------------------------------------------------------------

// A partir de cuántas preguntas restantes se avisa cuántas quedan.
const AVISAR_DESDE = 5;
const TEXTAREA_MAX_HEIGHT_PX = 160;

export function PanelDelAsistente({ contactosEnPlural }: { contactosEnPlural: string }) {
  const asistente = useAsistente();
  const esCelular = useEsCelular();
  const navigate = useNavigate();
  const tituloId = useId();
  const [texto, setTexto] = useState("");
  const listaRef = useRef<HTMLOListElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abierto = asistente?.abierto === true;
  const cantidad = asistente?.mensajes.length ?? 0;
  const enviando = asistente?.enviando === true;
  const cerrar = asistente?.cerrar;

  useLayoutEffect(() => {
    const lista = listaRef.current;
    if (lista) lista.scrollTop = lista.scrollHeight;
  }, [cantidad, enviando]);

  useEffect(() => {
    if (!abierto || !cerrar) return;
    textareaRef.current?.focus();
    function alApretar(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") cerrar?.();
    }
    document.addEventListener("keydown", alApretar);
    return () => document.removeEventListener("keydown", alApretar);
  }, [abierto, cerrar]);

  if (!asistente || !abierto) return null;
  const { mensajes, agotado, restantesHoy } = asistente;

  function mandar() {
    if (!asistente || !texto.trim() || enviando || agotado) return;
    asistente.enviar(texto);
    setTexto("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setTexto(event.target.value);
    event.target.style.height = "auto";
    event.target.style.height = `${String(Math.min(event.target.scrollHeight, TEXTAREA_MAX_HEIGHT_PX))}px`;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      mandar();
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    mandar();
  }

  // Los links de una respuesta son internos (/ayuda/..., /contacts): se
  // navegan con el router. En el celular el panel tapa todo, así que se cierra.
  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const link = (event.target as HTMLElement).closest("a");
    const href = link?.getAttribute("href");
    if (!href || !href.startsWith("/")) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
    if (esCelular) asistente?.cerrar();
  }

  return (
    <section className="ds-asistente-panel" role="dialog" aria-labelledby={tituloId}>
      <header className="ds-asistente-header">
        <h2 id={tituloId}>¿Cómo se hace?</h2>
        <button
          type="button"
          className="ds-asistente-cerrar"
          aria-label="Cerrar"
          onClick={asistente.cerrar}
        >
          <X size={18} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </header>

      <ol ref={listaRef} className="ds-chat ds-asistente-chat" aria-label="Charla con la ayuda">
        {mensajes.length === 0 ? (
          <li className="ds-chat-row ds-chat-row--sistema">
            <p className="ds-chat-note">
              Preguntá cómo hacer algo en la plataforma y te explico los pasos, con el link a la
              guía. No escribas datos de {contactosEnPlural}.
            </p>
          </li>
        ) : null}
        {mensajes.map((m) =>
          m.rol === "error" ? (
            <li key={m.id} className="ds-chat-row ds-chat-row--error">
              <p className="ds-chat-note ds-chat-note--error" role="alert">
                {m.texto}
              </p>
            </li>
          ) : m.rol === "persona" ? (
            <li key={m.id} className="ds-chat-row ds-chat-row--contacto">
              <div className="ds-chat-bubble">{m.texto}</div>
            </li>
          ) : (
            <li key={m.id} className="ds-chat-row ds-chat-row--agente">
              <div className="ds-chat-bubble ds-asistente-respuesta">
                <div
                  className="ds-guia-prose"
                  onClick={handleClick}
                  // Sanitizado con DOMPurify en renderizarMarkdown; además, el
                  // backend ya validó los links.
                  dangerouslySetInnerHTML={{ __html: renderizarMarkdown(m.texto) }}
                />
                <div className="ds-asistente-feedback">
                  {m.feedback ? (
                    <span>Gracias por avisar.</span>
                  ) : (
                    <>
                      <span>¿Te sirvió?</span>
                      <button
                        type="button"
                        aria-label="Me sirvió"
                        onClick={() => asistente.calificar(m, "UP")}
                      >
                        <ThumbsUp size={16} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label="No me sirvió"
                        onClick={() => asistente.calificar(m, "DOWN")}
                      >
                        <ThumbsDown size={16} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          ),
        )}
        {enviando ? (
          <li className="ds-chat-row ds-chat-row--agente">
            <div className="ds-chat-bubble" role="status">
              Buscando en la guía…
            </div>
          </li>
        ) : null}
      </ol>

      {agotado ? (
        <p className="ds-asistente-aviso" role="status">
          {agotado.replace(/ Mientras tanto.*$/, "")} Mientras tanto, toda la guía está en{" "}
          <Link to="/ayuda" onClick={() => esCelular && asistente.cerrar()}>
            Ayuda
          </Link>
          .
        </p>
      ) : restantesHoy !== null && restantesHoy <= AVISAR_DESDE ? (
        <p className="ds-asistente-aviso">
          {restantesHoy === 1
            ? "Te queda 1 pregunta hoy."
            : `Te quedan ${String(restantesHoy)} preguntas hoy.`}
        </p>
      ) : null}

      <form className="ds-chat-form ds-asistente-form" onSubmit={handleSubmit}>
        <label className="ds-sr-only" htmlFor="asistente-pregunta">
          Tu pregunta
        </label>
        <textarea
          id="asistente-pregunta"
          ref={textareaRef}
          rows={1}
          value={texto}
          maxLength={LARGO_MAXIMO_DE_LA_PREGUNTA}
          placeholder="Escribí tu pregunta"
          disabled={agotado !== null}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
        <Button
          type="submit"
          variant="primary"
          disabled={enviando || agotado !== null || texto.trim().length === 0}
          loading={enviando}
        >
          Preguntar
        </Button>
      </form>
    </section>
  );
}
