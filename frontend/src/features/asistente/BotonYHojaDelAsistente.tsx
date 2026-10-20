import { useEffect, useId } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BookOpen, MessageCircleQuestionMark } from "lucide-react";
import { useAsistente, useEsCelular } from "../../asistente/contexto";

// ---------------------------------------------------------------------------
// Las dos entradas al asistente "¿Cómo se hace?" que no son la caja de Ayuda
// (docs-privados/asistente-de-ayuda-diseno.md §4.1):
//
//   - en la compu, un botón flotante abajo a la derecha;
//   - en el celular no hay botón flotante (taparía el "Guardar" de un
//     formulario o el compositor de una conversación): el "?" de cada pantalla
//     abre esta hoja, con "Preguntale a la guía" y "Ver la guía de esta
//     pantalla".
// ---------------------------------------------------------------------------

// Pantallas con su propio compositor abajo: el botón confundiría dos chats.
const SIN_BOTON = [/^\/conversations\/[^/]+$/, /^\/internal-agent$/];

export function BotonDelAsistente() {
  const asistente = useAsistente();
  const esCelular = useEsCelular();
  const { pathname } = useLocation();
  if (!asistente?.disponible || asistente.abierto || esCelular) return null;
  if (SIN_BOTON.some((ruta) => ruta.test(pathname))) return null;
  return (
    <button type="button" className="ds-asistente-boton" onClick={() => asistente.abrir()}>
      <MessageCircleQuestionMark size={18} strokeWidth={1.5} aria-hidden="true" />
      ¿Cómo se hace?
    </button>
  );
}

export function HojaDeAyuda() {
  const asistente = useAsistente();
  const navigate = useNavigate();
  const tituloId = useId();
  const destino = asistente?.hojaDeAyuda ?? null;
  const cerrar = asistente?.cerrarHojaDeAyuda;

  useEffect(() => {
    if (!destino || !cerrar) return;
    function alApretar(event: KeyboardEvent) {
      if (event.key === "Escape") cerrar?.();
    }
    document.addEventListener("keydown", alApretar);
    return () => document.removeEventListener("keydown", alApretar);
  }, [destino, cerrar]);

  if (!asistente || !destino) return null;
  return (
    <>
      <div
        className="ds-asistente-hoja-fondo"
        aria-hidden="true"
        onClick={asistente.cerrarHojaDeAyuda}
      />
      <div className="ds-asistente-hoja" role="dialog" aria-labelledby={tituloId}>
        <h2 id={tituloId} className="ds-sr-only">
          Ayuda de esta pantalla
        </h2>
        <button
          type="button"
          className="ds-asistente-hoja-opcion"
          onClick={() => asistente.abrir()}
        >
          <MessageCircleQuestionMark size={20} strokeWidth={1.5} aria-hidden="true" />
          Preguntale a la guía
        </button>
        <button
          type="button"
          className="ds-asistente-hoja-opcion"
          onClick={() => {
            asistente.cerrarHojaDeAyuda();
            navigate(`/ayuda/${destino}`);
          }}
        >
          <BookOpen size={20} strokeWidth={1.5} aria-hidden="true" />
          Ver la guía de esta pantalla
        </button>
      </div>
    </>
  );
}
