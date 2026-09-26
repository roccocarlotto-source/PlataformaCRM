// ---------------------------------------------------------------------------
// Cliente mínimo de la Graph API de Meta para el canal WhatsApp: mandar UNA
// respuesta de texto (ítem 81) o UNA plantilla aprobada (ítem 159, el
// seguimiento con el QR al ganar una oportunidad), y dar de alta, consultar y
// borrar la plantilla de un negocio (ítem 160). Media y estados de lectura
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
  // El cuerpo de error de Meta, recortado. Aparte del message para que quien
  // tenga que mostrárselo a una persona (el alta de una plantilla, ítem 160)
  // pueda sacar de ahí el motivo legible; ver mensajeDeMeta.
  readonly detalle: string;

  constructor(status: number, detalle: string) {
    super(`WhatsApp Graph API returned ${status}: ${detalle}`);
    this.name = "WhatsappGraphError";
    this.status = status;
    this.detalle = detalle;
    Object.setPrototypeOf(this, WhatsappGraphError.prototype);
  }
}

// El motivo que Meta da en su cuerpo de error, para mostrárselo a una persona:
// error_user_msg (el que Meta redacta para el usuario final) si viene, si no
// error.message. Null si el cuerpo no es el JSON de error de Meta.
export function mensajeDeMeta(err: WhatsappGraphError): string | null {
  try {
    const cuerpo = JSON.parse(err.detalle) as {
      error?: { message?: unknown; error_user_msg?: unknown; error_user_title?: unknown };
    };
    const candidatos = [cuerpo.error?.error_user_msg, cuerpo.error?.message];
    const mensaje = candidatos.find((m): m is string => typeof m === "string" && m.trim() !== "");
    return mensaje?.trim() ?? null;
  } catch {
    return null;
  }
}

export function buildSendMessageUrl(phoneNumberId: string): string {
  return `${WHATSAPP_GRAPH_API_BASE_URL}/${encodeURIComponent(phoneNumberId)}/messages`;
}

// Todo request a la Graph API: la autenticación, el timeout y la
// clasificación del error son los mismos para mandar un mensaje que para
// administrar una plantilla. Devuelve el JSON de la respuesta ({} si no trae).
async function llamarGraph(
  url: string,
  method: "GET" | "POST" | "DELETE",
  accessToken: string,
  cuerpo?: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(cuerpo !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
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
  const texto = await res.text().catch(() => "");
  try {
    return texto === "" ? {} : (JSON.parse(texto) as unknown);
  } catch {
    return {};
  }
}

// El POST a /{phone_number_id}/messages, común a los dos tipos de mensaje: el
// cuerpo cambia, la autenticación, el timeout y la clasificación del error no.
async function postMessage(
  phoneNumberId: string,
  accessToken: string,
  cuerpo: Record<string, unknown>,
): Promise<void> {
  await llamarGraph(buildSendMessageUrl(phoneNumberId), "POST", accessToken, {
    messaging_product: "whatsapp",
    ...cuerpo,
  });
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

// ---------------------------------------------------------------------------
// Administración de la plantilla de un negocio (ítem 160)
//
// El negocio arma su plantilla desde el CRM y el backend la da de alta en el
// WABA (WhatsApp Business Account) compartido por todas las organizaciones.
// Mismo criterio que el envío: tipos de función que el service recibe
// inyectados, y cualquier respuesta que no sea 2xx llega como
// WhatsappGraphError con su status.
// ---------------------------------------------------------------------------

export function buildMessageTemplatesUrl(wabaId: string): string {
  return `${WHATSAPP_GRAPH_API_BASE_URL}/${encodeURIComponent(wabaId)}/message_templates`;
}

export interface CreateWhatsappTemplateInput {
  wabaId: string;
  accessToken: string;
  name: string;
  language: string;
  // El cuerpo YA traducido a {{1}}/{{2}} (utils/whatsappTemplateText.ts).
  bodyText: string;
  // Un valor de ejemplo por variable, en orden: Meta los exige en el alta de
  // una plantilla con variables, y los mira quien la revisa.
  bodyExamples: string[];
}

export interface PlantillaEnMeta {
  id: string;
  // El estado crudo de Meta (PENDING, APPROVED, REJECTED, PAUSED...). La
  // traducción al estado local la hace el service.
  status: string;
}

export type CreateWhatsappTemplate = (
  input: CreateWhatsappTemplateInput,
) => Promise<PlantillaEnMeta>;

// El cuerpo exacto del alta. Pura y exportada para probar el contrato sin red.
//
// CATEGORÍA FIJA UTILITY: el seguimiento post-venta es un mensaje
// transaccional (la consecuencia de una compra), que es lo que Meta llama
// UTILITY. MARKETING tiene más fricción en la revisión, más costo por
// mensaje y el cliente puede silenciarlo; no es una decisión del negocio.
export function cuerpoDeAltaDePlantilla(
  input: Omit<CreateWhatsappTemplateInput, "wabaId" | "accessToken">,
) {
  return {
    name: input.name,
    language: input.language,
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: input.bodyText,
        example: { body_text: [input.bodyExamples] },
      },
    ],
  };
}

export const createWhatsappTemplateReal: CreateWhatsappTemplate = async (input) => {
  const respuesta = (await llamarGraph(
    buildMessageTemplatesUrl(input.wabaId),
    "POST",
    input.accessToken,
    cuerpoDeAltaDePlantilla(input),
  )) as { id?: unknown; status?: unknown };
  if (typeof respuesta.id !== "string" && typeof respuesta.id !== "number") {
    // Un 2xx sin id: no hay con qué seguirla. Se trata como una respuesta
    // rota de Meta (5xx), no como un rechazo del contenido.
    throw new WhatsappGraphError(502, "Meta aceptó el alta pero no devolvió el id de la plantilla");
  }
  return {
    id: String(respuesta.id),
    status: typeof respuesta.status === "string" ? respuesta.status : "PENDING",
  };
};

export interface DeleteWhatsappTemplateInput {
  wabaId: string;
  accessToken: string;
  name: string;
  // Con el id, Meta borra ESA plantilla y no todos los idiomas del nombre.
  // Puede faltar: la fila reservada cuyo alta no llegó a guardar el id.
  metaTemplateId: string | null;
}

export type DeleteWhatsappTemplate = (input: DeleteWhatsappTemplateInput) => Promise<void>;

export function buildDeleteTemplateUrl(
  input: Pick<DeleteWhatsappTemplateInput, "wabaId" | "name" | "metaTemplateId">,
): string {
  const params = new URLSearchParams({ name: input.name });
  if (input.metaTemplateId) {
    params.set("hsm_id", input.metaTemplateId);
  }
  return `${buildMessageTemplatesUrl(input.wabaId)}?${params.toString()}`;
}

export const deleteWhatsappTemplateReal: DeleteWhatsappTemplate = async (input) => {
  await llamarGraph(buildDeleteTemplateUrl(input), "DELETE", input.accessToken);
};

export interface EstadoDePlantillaEnMeta {
  status: string;
  // El motivo del rechazo tal cual lo da Meta (INVALID_FORMAT, ...), o null.
  rejectedReason: string | null;
}

export type GetWhatsappTemplateStatus = (input: {
  metaTemplateId: string;
  accessToken: string;
}) => Promise<EstadoDePlantillaEnMeta>;

export function buildTemplateStatusUrl(metaTemplateId: string): string {
  return `${WHATSAPP_GRAPH_API_BASE_URL}/${encodeURIComponent(metaTemplateId)}?fields=status,rejected_reason`;
}

export const getWhatsappTemplateStatusReal: GetWhatsappTemplateStatus = async (input) => {
  const respuesta = (await llamarGraph(
    buildTemplateStatusUrl(input.metaTemplateId),
    "GET",
    input.accessToken,
  )) as { status?: unknown; rejected_reason?: unknown };
  if (typeof respuesta.status !== "string") {
    throw new WhatsappGraphError(502, "Meta no devolvió el estado de la plantilla");
  }
  return {
    status: respuesta.status,
    rejectedReason:
      typeof respuesta.rejected_reason === "string" ? respuesta.rejected_reason : null,
  };
};
