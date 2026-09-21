// ---------------------------------------------------------------------------
// Cliente mínimo de la Graph API de Meta para el canal WhatsApp (ítem 81):
// mandar UNA respuesta de texto. Nada más — plantillas, media y estados de
// lectura están fuera de alcance.
//
// Es un tipo de función y no un módulo con estado para que el webhook lo
// reciba inyectado (mismo patrón que FetchPreapproval en qrWebhook.service.ts):
// producción usa sendWhatsappTextReal, los tests de integración un doble que
// registra lo que se habría mandado sin salir a la red.
// ---------------------------------------------------------------------------

export const WHATSAPP_GRAPH_API_BASE_URL = "https://graph.facebook.com/v25.0";

// Tope para no dejar colgado el request del webhook si Meta no contesta: el
// webhook responde a Meta recién cuando termina de procesar el lote.
const TIMEOUT_MS = 10_000;

export interface SendWhatsappTextInput {
  phoneNumberId: string;
  // El wa_id del destinatario (solo dígitos, sin "+"), tal cual lo mandó Meta.
  to: string;
  body: string;
  accessToken: string;
}

export type SendWhatsappText = (input: SendWhatsappTextInput) => Promise<void>;

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
    throw new Error(`WhatsApp Graph API returned ${res.status}: ${detalle}`);
  }
};
