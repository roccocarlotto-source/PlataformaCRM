// ---------------------------------------------------------------------------
// Cliente mínimo de la Graph API de Meta para el canal WhatsApp (ítem 81):
// mandar UNA respuesta de texto. Nada más — plantillas, media y estados de
// lectura están fuera de alcance.
//
// Es un tipo de función y no un módulo con estado para que el webhook lo
// reciba inyectado: producción usa sendWhatsappTextReal, los tests de integración un doble que
// registra lo que se habría mandado sin salir a la red.
// ---------------------------------------------------------------------------

export const WHATSAPP_GRAPH_API_BASE_URL = "https://graph.facebook.com/v25.0";

// Tope para no dejar colgado el envío si Meta no contesta. Desde el ítem 125
// el envío lo hace el worker de la cola, no el request del webhook, pero el
// tope sigue haciendo falta: el worker lo espera con el lock de la
// conversación tomado.
const TIMEOUT_MS = 10_000;

export interface SendWhatsappTextInput {
  phoneNumberId: string;
  // El wa_id del destinatario (solo dígitos, sin "+"), tal cual lo mandó Meta.
  to: string;
  body: string;
  accessToken: string;
}

export type SendWhatsappText = (input: SendWhatsappTextInput) => Promise<void>;

// La Graph API respondió, y no fue un 2xx. Lleva el status para que el worker
// decida si reintentar con el mismo criterio que el proveedor de LLM
// (esTransitorio: 429 o 5xx). Un 4xx —token vencido, número no registrado,
// fuera de la ventana de 24 h— no se arregla reintentando. Un corte de red o
// un timeout NO llegan como WhatsappGraphError (no hubo respuesta) y el
// worker los trata como transitorios.
export class WhatsappGraphError extends Error {
  readonly status: number;

  constructor(status: number, detalle: string) {
    super(`WhatsApp Graph API returned ${status}: ${detalle}`);
    this.name = "WhatsappGraphError";
    this.status = status;
    Object.setPrototypeOf(this, WhatsappGraphError.prototype);
  }
}

export function buildSendMessageUrl(phoneNumberId: string): string {
  return `${WHATSAPP_GRAPH_API_BASE_URL}/${encodeURIComponent(phoneNumberId)}/messages`;
}

export const sendWhatsappTextReal: SendWhatsappText = async (input) => {
  const res = await fetch(buildSendMessageUrl(input.phoneNumberId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: input.to,
      type: "text",
      text: { body: input.body },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    // El cuerpo de error de Meta ({ error: { message, code, ... } }) es lo que
    // dice POR QUÉ falló (token vencido, número no registrado, fuera de la
    // ventana de 24 h...). Se incluye recortado; nunca lleva el token.
    const detalle = (await res.text().catch(() => "")).slice(0, 500);
    throw new WhatsappGraphError(res.status, detalle);
  }
};
