import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AYUDA } from "../features/guia/anclas";

// ---------------------------------------------------------------------------
// El estado del asistente "¿Cómo se hace?" para toda la app: si el panel está
// abierto, la charla, el envío y la pantalla en la que está la persona. Vive al
// nivel de AppLayout (como el tema en src/theme/), así la charla sobrevive a
// navegar pero NO a recargar la página: el historial es solo de la sesión del
// navegador (P8 del diseño, docs-privados/asistente-de-ayuda-diseno.md).
//
// La pantalla la registra PageHeader con su `help` (el destino del "?"), y acá
// se traduce a la CLAVE de AYUDA que espera el backend: la URL nunca sale (lleva
// ids). Si dos claves comparten destino da igual cuál: el backend solo usa el
// destino.
//
// Sin proveedor (los tests de cada pantalla, el login), useAsistente devuelve
// null y PageHeader se comporta como siempre.
// ---------------------------------------------------------------------------

export interface MensajeDeLaCharla {
  id: string;
  rol: "persona" | "asistente" | "error";
  texto: string;
  /** El id de la respuesta en el backend, para el 👍/👎. */
  respuestaId?: string;
  /** La firma del servidor sobre la pregunta y esta respuesta (AGE-01). */
  firma?: string;
  feedback?: "UP" | "DOWN";
}

export interface EstadoDelAsistente {
  /** Prendido para esta persona (/api/me). Si no, nada del asistente se ve. */
  disponible: boolean;
  abierto: boolean;
  abrir: () => void;
  cerrar: () => void;
  /** Abre el panel y manda la pregunta (la caja de Ayuda, el compositor). */
  enviar: (pregunta: string) => void;
  enviando: boolean;
  mensajes: MensajeDeLaCharla[];
  /** Cuántas preguntas le quedan hoy, si ya se sabe. */
  restantesHoy: number | null;
  /** El aviso del tope del día; mientras está, no se puede preguntar. */
  agotado: string | null;
  calificar: (mensaje: MensajeDeLaCharla, valor: "UP" | "DOWN") => void;
  /** La clave de AYUDA de la pantalla actual, o null. */
  pantalla: string | null;
  registrarPantalla: (destinoDelSignoDePregunta: string | null) => void;
  /** La hoja del "?" en el celular: el destino de la guía de esa pantalla. */
  hojaDeAyuda: string | null;
  abrirHojaDeAyuda: (destino: string) => void;
  cerrarHojaDeAyuda: () => void;
}

export const Contexto = createContext<EstadoDelAsistente | null>(null);

export const LARGO_MAXIMO_DE_LA_PREGUNTA = 500;
export const PARES_DE_HISTORIAL = 3;

export const CLAVE_POR_DESTINO: ReadonlyMap<string, string> = new Map(
  Object.entries(AYUDA)
    .reverse()
    .map(([clave, destino]) => [destino, clave]),
);

/** El asistente, o null si la pantalla no está dentro de AppLayout. */
export function useAsistente(): EstadoDelAsistente | null {
  return useContext(Contexto);
}

/** Registra la pantalla actual mientras el componente está montado. */
export function useRegistrarPantalla(destino: string | undefined) {
  const registrar = useAsistente()?.registrarPantalla;
  useEffect(() => {
    if (!registrar) return;
    registrar(destino ?? null);
    return () => registrar(null);
  }, [registrar, destino]);
}

// Desde 1024px el asistente es un botón flotante y un panel; por debajo, se
// entra por el "?" de cada pantalla y el chat ocupa la pantalla entera
// (docs-privados/asistente-de-ayuda-diseno.md §4.1).
const CELULAR = "(max-width: 1023px)";

/** true en celular y tablet. Sin matchMedia (jsdom), false. */
export function useEsCelular(): boolean {
  const consulta = useMemo(
    () =>
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia(CELULAR)
        : null,
    [],
  );
  const [esCelular, setEsCelular] = useState(consulta?.matches ?? false);
  useEffect(() => {
    if (!consulta) return;
    const cambiar = () => setEsCelular(consulta.matches);
    consulta.addEventListener("change", cambiar);
    return () => consulta.removeEventListener("change", cambiar);
  }, [consulta]);
  return esCelular;
}
