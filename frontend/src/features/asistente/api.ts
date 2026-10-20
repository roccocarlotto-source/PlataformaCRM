import { request } from "../../lib/api";
import { getAccessToken } from "../../auth/getAccessToken";

// El asistente "¿Cómo se hace?" (src/routes/helpAssistant.routes.ts). Todo lo
// que decide —qué guía ve la persona, el tope del día, el freno de gasto— lo
// decide el backend; acá solo se manda la pregunta.

export interface FuenteDeLaGuia {
  titulo: string;
  href: string;
}

export interface RespuestaDelAsistente {
  id: string;
  /** Markdown, con los links ya validados por el backend. */
  respuesta: string;
  fuentes: FuenteDeLaGuia[];
  tipo: "ANSWERED" | "NOT_COVERED" | "DATA_REDIRECT" | "OFF_TOPIC";
  restantesHoy: number;
}

export interface ParDelHistorial {
  pregunta: string;
  respuesta: string;
}

export function preguntar(input: {
  pregunta: string;
  pantalla?: string;
  historial?: ParDelHistorial[];
}): Promise<RespuestaDelAsistente> {
  return request<RespuestaDelAsistente>("/help-assistant/questions", {
    method: "POST",
    body: input,
    getAccessToken,
  });
}

export function darFeedback(id: string, feedback: "UP" | "DOWN"): Promise<void> {
  return request<void>(`/help-assistant/questions/${encodeURIComponent(id)}/feedback`, {
    method: "PATCH",
    body: { feedback },
    getAccessToken,
  });
}
