import { esTransitorio } from "./llmProvider.service";
import { CODIGOS_TRANSITORIOS, META_GRAPH_API_VERSION, type FetchLike } from "./metaOAuth.service";

// ---------------------------------------------------------------------------
// Cliente mínimo del Send API de Meta para Messenger e Instagram (ítem 172;
// paso 4 de 5 de los canales de Meta): mandar UNA respuesta de texto con el
// Page access token. SOLO TEXTO, decisión de toda la serie.
//
// Mismo patrón que whatsappGraph.service.ts: un tipo de función inyectable,
// sin estado y sin Postgres. Quien llama (el worker) resuelve y DESCIFRA el
// token antes (metaPageConnection.service.ts → obtenerTokenParaEnviar).
//
// ---------------------------------------------------------------------------
// VERIFICADO CONTRA LA DOCUMENTACIÓN DE META (27/09/2026), NO ASUMIDO
// ---------------------------------------------------------------------------
//
// 1. ENDPOINT. Messenger ("Send a message", Messenger Platform): POST
//    /{PAGE-ID}/messages o POST /me/messages con el Page access token.
//    Instagram con Facebook Login ("Send a message", Messenger Platform →
//    Instagram): el MISMO POST /me/messages en graph.facebook.com, con el Page
//    access token y recipient.id = IGSID. El /{IG-ID}/messages de
//    graph.instagram.com es el de "Instagram API with INSTAGRAM Login", que
//    usa un token de usuario de Instagram — no es el camino de esta app. Por
//    eso esta función no recibe el canal: la URL y el cuerpo son los mismos.
//    Se usa /me (con un Page token, /me ES la página) y no /{PAGE-ID} para no
//    necesitar otro parámetro. El token va en Authorization: Bearer (Graph lo
//    acepta igual que el query param `access_token`, y así no queda en URLs).
//
// 2. CUERPO. { recipient: { id }, messaging_type: "RESPONSE", message: { text } }.
//    "RESPONSE" sigue siendo el valor vigente: "the message you are sending is
//    a response to a received message", dentro de la ventana estándar de 24 h.
//    Es exactamente el caso de este worker, que contesta en segundos o minutos.
//
// 3. LA ETIQUETA HUMAN_AGENT NO SE USA, NI NINGUNA OTRA. La política de Meta
//    la define para que "a business representative [can] manually respond"
//    dentro de 7 días, exige el permiso Human Agent por App Review, y prohíbe
//    usarla en mensajes automatizados. Quien contesta acá es el agente de IA,
//    no una persona: taggearlo sería violar la política de la plataforma. Un
//    envío fuera de la ventana de 24 h Meta lo rechaza con el código 10,
//    subcódigo 2018278 ("This message is sent outside of allowed window"), y
//    se trata como PERMANENTE (un 4xx sin código transitorio): reintentar no
//    reabre la ventana. En la práctica es rarísimo, porque el turno corre
//    apenas llega el mensaje.
//
// 4. ERRORES. El cuerpo es el de toda la Graph API: { error: { message, type,
//    code, error_subcode, fbtrace_id } }. La tabla de errores del Send API
//    lista como reintentables el 2 ("retry your request later"), el 4 y el 613
//    (rate limits) — los mismos de CODIGOS_TRANSITORIOS del ítem 170, que se
//    reusa. Ojo: Meta manda los rate limits con HTTP 400/403, así que el corte
//    por status solo (esTransitorio) los daría por permanentes; por eso se mira
//    también el código. 190 = token inválido (lo usa el worker para llevar la
//    conexión a ERROR). 551 (el usuario no recibe mensajes), 100/2018001
//    (destinatario inexistente), 200 (permiso) son permanentes.
// ---------------------------------------------------------------------------

export const META_SEND_URL = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/me/messages`;

// Mismo tope y mismo motivo que whatsappGraph.service.ts: el worker espera el
// envío con el lock de la conversación tomado.
const TIMEOUT_MS = 10_000;

// Código de la Graph API para un access token inválido, vencido o revocado.
const CODIGO_TOKEN_INVALIDO = 190;

export interface SendMetaTextInput {
  // YA DESCIFRADO — quien llama descifra.
  pageAccessToken: string;
  // PSID (Messenger) o IGSID (Instagram), tal cual lo mandó el webhook.
  recipientId: string;
  text: string;
}

export type SendMetaText = (input: SendMetaTextInput) => Promise<void>;

// El Send API respondió, y no fue un 2xx. Tipo propio y no MetaAuthError: ese
// es del flujo OAuth; un envío rechazado es otra cosa aunque hable con la misma
// API (mismo criterio que WhatsappGraphError). Un corte de red o un timeout NO
// llegan como MetaSendError (no hubo respuesta) y el worker los reintenta.
export class MetaSendError extends Error {
  readonly status: number;
  // El cuerpo de error de Meta, recortado. Nunca lleva el token.
  readonly detalle: string;
  // error.code / error.error_subcode del cuerpo, si vinieron.
  readonly codigo: number | null;
  readonly subcodigo: number | null;

  constructor(status: number, detalle: string, codigo: number | null, subcodigo: number | null) {
    super(
      `Meta Send API returned ${status}${codigo !== null ? ` (code ${codigo}${subcodigo !== null ? `/${subcodigo}` : ""})` : ""}: ${detalle}`,
    );
    this.name = "MetaSendError";
    this.status = status;
    this.detalle = detalle;
    this.codigo = codigo;
    this.subcodigo = subcodigo;
    Object.setPrototypeOf(this, MetaSendError.prototype);
  }

  // 429/5xx (el corte del proveedor de LLM) o uno de los códigos que Meta
  // documenta como reintentables, venga con el status que venga.
  get transitorio(): boolean {
    return (
      esTransitorio(this.status) || (this.codigo !== null && CODIGOS_TRANSITORIOS.has(this.codigo))
    );
  }

  // Meta rechazó el Page token (190): no se arregla reintentando, hay que
  // reconectar la página.
  get tokenInvalido(): boolean {
    return this.codigo === CODIGO_TOKEN_INVALIDO;
  }
}

// El cuerpo exacto que viaja. Pura y exportada para fijar el contrato sin red.
export function cuerpoDeRespuesta(input: Pick<SendMetaTextInput, "recipientId" | "text">) {
  return {
    recipient: { id: input.recipientId },
    messaging_type: "RESPONSE",
    message: { text: input.text },
  };
}

function numeroONull(valor: unknown): number | null {
  return typeof valor === "number" ? valor : null;
}

async function errorDeLaRespuesta(res: Response): Promise<MetaSendError> {
  const crudo = await res.text().catch(() => "");
  let codigo: number | null = null;
  let subcodigo: number | null = null;
  try {
    const cuerpo = JSON.parse(crudo) as { error?: { code?: unknown; error_subcode?: unknown } };
    codigo = numeroONull(cuerpo.error?.code);
    subcodigo = numeroONull(cuerpo.error?.error_subcode);
  } catch {
    // HTML de un intermediario o cuerpo vacío: queda solo el status.
  }
  return new MetaSendError(res.status, crudo.slice(0, 500), codigo, subcodigo);
}

// FACTORY solo para que el test inyecte el fetch; producción usa
// sendMetaTextReal.
export function crearSendMetaText(hacerFetch: FetchLike = (url, init) => fetch(url, init)) {
  const send: SendMetaText = async (input) => {
    const res = await hacerFetch(META_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.pageAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cuerpoDeRespuesta(input)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      throw await errorDeLaRespuesta(res);
    }
  };
  return send;
}

export const sendMetaTextReal: SendMetaText = crearSendMetaText();
