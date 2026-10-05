import type { ConversationChannel } from "@prisma/client";
import { partirMensaje } from "../utils/partirMensaje";

// ---------------------------------------------------------------------------
// Mandar un Message por su canal, en las partes que haga falta (OPUS-B-02 /
// FABLE-B-05, docs-privados, local; ver utils/partirMensaje.ts).
//
// Lo usan los dos caminos que mandan texto: la respuesta del agente
// (agentInboundWorker) y la de una persona, el aviso y el cupón manual
// (conversationReply.service).
//
// SI FALLA A MITAD, EL REINTENTO SIGUE DESDE DONDE QUEDÓ. Un mensaje de tres
// partes cuya segunda rebotó por un rate limit no vuelve a mandar la primera:
// el cliente recibiría el comienzo dos veces. Cuántas partes de cada mensaje
// ya salieron se recuerda en memoria del proceso, que es donde corren los
// reintentos (el backoff del worker, el botón "Reintentar" del CRM). Si el
// proceso se reinicia entre el fallo y el reintento, ese recuerdo se pierde y
// el mensaje sale entero otra vez: una repetición rara es preferible a
// guardar el avance en la base, que necesitaría una columna nueva.
// ---------------------------------------------------------------------------

const MAX_MENSAJES_RECORDADOS = 500;
const partesYaEnviadas = new Map<string, number>();

function recordar(messageId: string, enviadas: number) {
  // Tope defensivo: solo quedan acá los mensajes que fallaron a mitad y nunca
  // se reintentaron. Se descarta el más viejo.
  if (!partesYaEnviadas.has(messageId) && partesYaEnviadas.size >= MAX_MENSAJES_RECORDADOS) {
    const masViejo = partesYaEnviadas.keys().next().value;
    if (masViejo !== undefined) {
      partesYaEnviadas.delete(masViejo);
    }
  }
  partesYaEnviadas.set(messageId, enviadas);
}

// Manda `mensaje.content` por `canal` llamando a `enviarParte` una vez por
// parte, en orden. Devuelve lo que devolvió la ÚLTIMA parte (en WhatsApp, el
// wamid que queda en la fila: sus estados de entrega son los del mensaje
// entero). Si una parte falla, el error sube tal cual.
export async function enviarEnPartes<T>(
  mensaje: { id: string; content: string },
  canal: ConversationChannel,
  enviarParte: (texto: string) => Promise<T>,
): Promise<T> {
  const partes = partirMensaje(mensaje.content, canal);
  // Si el contenido cambió y ahora hay menos partes, se empieza de cero.
  const desde = Math.min(partesYaEnviadas.get(mensaje.id) ?? 0, partes.length - 1);
  let ultimo: T | undefined;
  for (let i = desde; i < partes.length; i++) {
    ultimo = await enviarParte(partes[i]!);
    if (i < partes.length - 1) {
      recordar(mensaje.id, i + 1);
    }
  }
  partesYaEnviadas.delete(mensaje.id);
  return ultimo as T;
}

// Solo para tests.
export function olvidarPartesEnviadasParaTests(): void {
  partesYaEnviadas.clear();
}
