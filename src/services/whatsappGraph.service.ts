// ---------------------------------------------------------------------------
// Cliente mínimo de la Graph API de Meta para el canal WhatsApp: mandar UNA
// respuesta de texto (ítem 81) o UNA plantilla aprobada (ítem 159, el
// seguimiento con el QR al ganar una oportunidad). Media y estados de lectura
// están fuera de alcance.
//
// Son tipos de función y no un módulo con estado para que los workers los
// reciban inyectados: producción usa las *Real, los tests un doble que
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

// El POST a /{phone_number_id}/messages, común a los dos tipos de mensaje: el
// cuerpo cambia, la autenticación, el timeout y la clasificación del error no.
async function postMessage(
  phoneNumberId: string,
  accessToken: string,
  cuerpo: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(buildSendMessageUrl(phoneNumberId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...cuerpo }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    // El cuerpo de error de Meta ({ error: { message, code, ... } }) es lo que
    // dice POR QUÉ falló (token vencido, número no registrado, fuera de la
    // ventana de 24 h, plantilla inexistente...). Se incluye recortado; nunca
    // lleva el token.
    const detalle = (await res.text().catch(() => "")).slice(0, 500);
    throw new WhatsappGraphError(res.status, detalle);
  }
}

export const sendWhatsappTextReal: SendWhatsappText = (input) =>
  postMessage(input.phoneNumberId, input.accessToken, {
    to: input.to,
    type: "text",
    text: { body: input.body },
  });

// ---------------------------------------------------------------------------
// Plantillas (ítem 159)
//
// Un mensaje que la EMPRESA inicia —sin que el cliente haya escrito en las
// últimas 24 h— tiene que ser una plantilla aprobada por Meta; texto libre,
// Meta lo rechaza con un 4xx. El seguimiento post-venta es exactamente eso.
//
// PARÁMETROS POSICIONALES ({{1}}, {{2}}...), no nombrados: el orden del array
// es el número de la variable. Solo parámetros del CUERPO — la plantilla del
// seguimiento no tiene encabezado ni botones variables, y agregar esas formas
// sin un consumidor sería inventar contrato.
// ---------------------------------------------------------------------------

export interface SendWhatsappTemplateInput {
  phoneNumberId: string;
  // Solo dígitos, con código de país, sin "+" (el formato del wa_id).
  to: string;
  // Nombre y código de idioma exactamente como quedaron aprobados en Meta.
  templateName: string;
  languageCode: string;
  // {{1}}, {{2}}... en ese orden.
  bodyParameters: string[];
  accessToken: string;
}

export type SendWhatsappTemplate = (input: SendWhatsappTemplateInput) => Promise<void>;

// Meta rechaza (400, código 132000/131008) un parámetro de texto vacío, o con
// saltos de línea, tabs o más de cuatro espacios seguidos. El texto que llega
// acá sale de datos cargados por personas —un nombre, una URL—, así que se
// normaliza en vez de dejar que un salto de línea pegado en un formulario
// termine en un FAILED.
export function normalizarParametroDePlantilla(valor: string): string {
  return valor.replace(/\s+/g, " ").trim();
}

// El cuerpo exacto que viaja, sin messaging_product (lo pone postMessage).
// Pura y exportada para probar el contrato con Meta sin red.
//
// SIN PARÁMETROS, SIN `components`: una plantilla sin variables (la de muestra
// `hello_world` que Meta da con cada número de prueba) se manda con `name` y
// `language` a secas. Mandarle un componente body con cero parámetros —o con
// más de los que tiene— es un 400 (#132000, "number of parameters does not
// match"). Es lo que permite probar el circuito de envío (token, número,
// destinatario) antes de que la plantilla real esté aprobada.
export function cuerpoDePlantilla(
  input: Omit<SendWhatsappTemplateInput, "phoneNumberId" | "accessToken">,
) {
  const components =
    input.bodyParameters.length === 0
      ? []
      : [
          {
            type: "body",
            parameters: input.bodyParameters.map((texto) => ({
              type: "text",
              text: normalizarParametroDePlantilla(texto),
            })),
          },
        ];
  return {
    to: input.to,
    type: "template",
    template: {
      name: input.templateName,
      language: { code: input.languageCode },
      ...(components.length > 0 ? { components } : {}),
    },
  };
}

export const sendWhatsappTemplateReal: SendWhatsappTemplate = (input) =>
  postMessage(input.phoneNumberId, input.accessToken, cuerpoDePlantilla(input));
