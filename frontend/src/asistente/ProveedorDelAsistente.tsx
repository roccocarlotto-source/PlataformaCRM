import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { darFeedback, preguntar, type ParDelHistorial } from "../features/asistente/api";
import { ApiError } from "../lib/api";
import {
  CLAVE_POR_DESTINO,
  Contexto,
  LARGO_MAXIMO_DE_LA_PREGUNTA,
  PARES_DE_HISTORIAL,
  type EstadoDelAsistente,
  type MensajeDeLaCharla,
} from "./contexto";

// El proveedor del asistente "¿Cómo se hace?": la charla, el envío y la
// pantalla actual (ver contexto.ts). Va en su propio archivo para que el fast
// refresh funcione, como ThemeContext.tsx.

let siguiente = 0;
const nuevoId = () => `m${String(++siguiente)}`;

// Los pares pregunta/respuesta anteriores, para que el modelo entienda "¿y
// cómo la edito?". Solo los que tuvieron respuesta y vinieron firmados: el
// servidor descarta los demás (AGE-01), así que no tiene sentido mandarlos.
function historialDe(mensajes: MensajeDeLaCharla[]): ParDelHistorial[] {
  const pares: ParDelHistorial[] = [];
  mensajes.forEach((m, i) => {
    const despues = mensajes[i + 1];
    if (m.rol === "persona" && despues?.rol === "asistente" && despues.firma) {
      pares.push({ pregunta: m.texto, respuesta: despues.texto, firma: despues.firma });
    }
  });
  return pares.slice(-PARES_DE_HISTORIAL);
}

export function ProveedorDelAsistente({
  disponible,
  children,
}: {
  disponible: boolean;
  children: ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  const [pantalla, setPantalla] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<MensajeDeLaCharla[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [restantesHoy, setRestantesHoy] = useState<number | null>(null);
  const [agotado, setAgotado] = useState<string | null>(null);
  const [hojaDeAyuda, setHojaDeAyuda] = useState<string | null>(null);
  // Lo que enviar necesita leer sin rehacerse en cada mensaje.
  // enviar solo corre desde un evento, siempre después de este efecto.
  const actual = useRef({ mensajes, pantalla, enviando, agotado });
  useEffect(() => {
    actual.current = { mensajes, pantalla, enviando, agotado };
  }, [mensajes, pantalla, enviando, agotado]);

  const abrir = useCallback(() => {
    setHojaDeAyuda(null);
    setAbierto(true);
  }, []);
  const cerrar = useCallback(() => setAbierto(false), []);

  const enviar = useCallback((pregunta: string) => {
    const contenido = pregunta.trim().slice(0, LARGO_MAXIMO_DE_LA_PREGUNTA);
    setHojaDeAyuda(null);
    setAbierto(true);
    const {
      mensajes: previos,
      pantalla: clave,
      enviando: ocupado,
      agotado: sinMas,
    } = actual.current;
    if (!contenido || ocupado || sinMas) return;
    const historial = historialDe(previos);
    setMensajes((m) => [...m, { id: nuevoId(), rol: "persona", texto: contenido }]);
    setEnviando(true);
    preguntar({
      pregunta: contenido,
      ...(clave ? { pantalla: clave } : {}),
      ...(historial.length ? { historial } : {}),
    })
      .then((r) => {
        setMensajes((m) => [
          ...m,
          {
            id: nuevoId(),
            rol: "asistente",
            texto: r.respuesta,
            respuestaId: r.id,
            ...(r.firma ? { firma: r.firma } : {}),
          },
        ]);
        setRestantesHoy(r.restantesHoy);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 429) {
          setAgotado(error.message);
          setRestantesHoy(0);
          return;
        }
        setMensajes((m) => [
          ...m,
          {
            id: nuevoId(),
            rol: "error",
            texto:
              error instanceof Error
                ? error.message
                : "No pudimos responder ahora. Probá de nuevo.",
          },
        ]);
      })
      .finally(() => setEnviando(false));
  }, []);

  const calificar = useCallback((mensaje: MensajeDeLaCharla, valor: "UP" | "DOWN") => {
    if (!mensaje.respuestaId || mensaje.feedback) return;
    setMensajes((m) => m.map((x) => (x.id === mensaje.id ? { ...x, feedback: valor } : x)));
    // Sin red, el 👍 no llega: no vale la pena interrumpir la charla.
    darFeedback(mensaje.respuestaId, valor).catch(() => undefined);
  }, []);

  const registrarPantalla = useCallback((destino: string | null) => {
    setPantalla(destino ? (CLAVE_POR_DESTINO.get(destino) ?? null) : null);
  }, []);
  const abrirHojaDeAyuda = useCallback((destino: string) => setHojaDeAyuda(destino), []);
  const cerrarHojaDeAyuda = useCallback(() => setHojaDeAyuda(null), []);

  const valor = useMemo<EstadoDelAsistente>(
    () => ({
      disponible,
      abierto: disponible && abierto,
      abrir,
      cerrar,
      enviar,
      enviando,
      mensajes,
      restantesHoy,
      agotado,
      calificar,
      pantalla,
      registrarPantalla,
      hojaDeAyuda: disponible ? hojaDeAyuda : null,
      abrirHojaDeAyuda,
      cerrarHojaDeAyuda,
    }),
    [
      disponible,
      abierto,
      abrir,
      cerrar,
      enviar,
      enviando,
      mensajes,
      restantesHoy,
      agotado,
      calificar,
      pantalla,
      registrarPantalla,
      hojaDeAyuda,
      abrirHojaDeAyuda,
      cerrarHojaDeAyuda,
    ],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
