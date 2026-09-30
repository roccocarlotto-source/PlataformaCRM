import { env } from "../config/env";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Cliente OAuth de Meta para conectar la página de Facebook de una
// organización (ítem 170; canales Instagram y Messenger). AISLADO A PROPÓSITO,
// mismo criterio que googleCalendar.service.ts: habla HTTP con Meta y NADA
// MÁS — no toca Postgres ni sabe qué es una MetaPageConnection. Quien cruza
// los dos mundos es metaPageConnection.service.ts. Así este archivo se prueba
// como unitario, con un fetch inyectado y sin red (metaOAuth.service.test.ts).
//
// ---------------------------------------------------------------------------
// VERIFICADO CONTRA LA DOCUMENTACIÓN DE META (27/09/2026), NO ASUMIDO
// ---------------------------------------------------------------------------
//
// 1. El diálogo es el de Facebook Login, versionado:
//    https://www.facebook.com/v25.0/dialog/oauth (guía "Manually Build a Login
//    Flow"). La app usa FACEBOOK LOGIN FOR BUSINESS, y ahí los permisos NO van
//    en `scope`: van en una "configuración" creada en el panel, y la URL lleva
//    su `config_id`. Textual de la guía de Login for Business: "config_id has
//    replaced scope (although scope can still be included, we recommend that
//    you do not use it)". Por eso acá no hay lista de scopes: los permisos
//    (pages_messaging, pages_manage_metadata, pages_show_list,
//    pages_read_engagement, instagram_basic, instagram_manage_messages,
//    business_management) viven en esa configuración, no en el código.
//
// 2. code → user access token: GET /v25.0/oauth/access_token con client_id,
//    redirect_uri, client_secret y code. El redirect_uri tiene que ser el
//    mismo que se usó en el diálogo.
//
// 3. user token corto → largo (~60 días): GET /oauth/access_token con
//    grant_type=fb_exchange_token. ES LA PIEZA QUE IMPORTA: la guía "Long-Lived
//    Access Tokens" dice que un Page access token obtenido con un user token de
//    larga duración "do[es] not have an expiration date and only expire[s] or
//    [is] invalidated under certain conditions" (el usuario revoca el permiso,
//    cambia la contraseña, deja de ser admin de la página…). Con el user token
//    corto, el de página vencería con él en una o dos horas — el mismo tipo de
//    muerte silenciosa que tuvo el token de WhatsApp.
//
// 4. Páginas autorizadas: GET /me/accounts con ese user token largo. Cada
//    elemento trae id, name, access_token (el Page access token) y, si se pide
//    en `fields`, instagram_business_account { id }.
//
// 5. Suscribir la página a la app (ítem 171): POST /{page-id}/subscribed_apps
//    con el PAGE access token y subscribed_fields. La guía de webhooks de
//    Messenger lo dice explícito: además de configurar el webhook en el panel
//    de la app, "you must also subscribe the specific Page"; sin esto la
//    página no manda nada. La de Instagram (Instagram API with Facebook Login)
//    exige lo mismo — "POST /me/subscribed_apps" con el Page token, que es
//    esta misma llamada. Requiere pages_messaging y pages_manage_metadata (ya
//    en la configuración de Login). Responde { success: true }.
//
// LA VERSIÓN DE LA GRAPH API es la misma que usa whatsappGraph.service.ts
// (v25.0) pero es una constante propia, mismo criterio que META_APP_SECRET vs.
// WHATSAPP_APP_SECRET: subir la versión de un canal no debería arrastrar al
// otro sin que alguien lo decida.
// ---------------------------------------------------------------------------

export const META_GRAPH_API_VERSION = "v25.0";

const URL_DIALOGO = `https://www.facebook.com/${META_GRAPH_API_VERSION}/dialog/oauth`;
const URL_GRAPH = `https://graph.facebook.com/${META_GRAPH_API_VERSION}`;
const URL_TOKEN = `${URL_GRAPH}/oauth/access_token`;
const URL_PAGINAS = `${URL_GRAPH}/me/accounts`;

// Mismo tope y mismo motivo que googleCalendar.service.ts: del otro lado del
// callback hay una persona esperando.
const TIMEOUT_MS = 10_000;

// /me/accounts pagina. Una organización conecta UNA página, así que en la
// práctica alcanza la primera; el tope es solo para que un `paging.next` que
// no termina nunca no deje el callback dando vueltas.
const MAX_PAGINAS_DE_RESULTADOS = 10;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ConfiguracionMeta {
  appId: string;
  appSecret: string;
  redirectUri: string;
  loginConfigId: string;
  fetch?: FetchLike;
}

export interface TokenDeUsuarioMeta {
  accessToken: string;
  // 0 si Meta no lo informa. Solo informativo: nada lo persiste.
  expiraEnSegundos: number;
}

export interface PaginaAutorizada {
  id: string;
  name: string;
  // El Page access token. Sale de acá EN CLARO: cifrarlo es trabajo del
  // service, igual que el refresh token de Google.
  accessToken: string;
  // El Instagram profesional vinculado a la página, si tiene.
  instagramBusinessAccountId: string | null;
}

// ---------------------------------------------------------------------------
// Errores de Meta, con la distinción que importa río arriba — mismo rol que
// GoogleAuthError.grantInvalido.
//
// `tokenInvalido` = Meta RESPONDIÓ y rechazó la credencial o el código (un
// OAuthException: code ya usado o vencido, token revocado, app mal
// configurada). `false` = no hubo respuesta interpretable: red caída, timeout,
// un 5xx, o uno de los códigos que Meta documenta como transitorios. Hoy el
// único consumidor es el callback, que responde lo mismo en los dos casos; la
// distinción existe para quien use el Page token después (el envío del ítem
// 172), donde solo un rechazo real debe llevar la conexión a ERROR.
// ---------------------------------------------------------------------------
export class MetaAuthError extends AppError {
  public readonly tokenInvalido: boolean;

  constructor(message: string, tokenInvalido: boolean) {
    super(message, 502);
    this.tokenInvalido = tokenInvalido;
    Object.setPrototypeOf(this, MetaAuthError.prototype);
  }
}

// Códigos de error de la Graph API que Meta documenta como transitorios o de
// límite de uso ("Handling errors"): 1 API desconocida/temporal, 2 servicio
// temporalmente no disponible, 4/17/32/613 rate limits, 341 límite de la
// aplicación. Reintentar más tarde los resuelve; no son un rechazo del token.
// Exportada desde el ítem 172: el envío (metaSend.service.ts) clasifica con la
// misma lista, que la tabla de errores del Send API confirma (2, 4, 613).
export const CODIGOS_TRANSITORIOS = new Set([1, 2, 4, 17, 32, 341, 613]);

interface ErrorDeGraph {
  message?: unknown;
  type?: unknown;
  code?: unknown;
}

// Meta devuelve { error: { message, type, code, error_subcode, fbtrace_id } }
// tanto en /oauth/access_token como en el resto de la Graph API. Nunca se
// devuelve el cuerpo crudo: puede ser HTML de un intermediario.
async function describirFallo(res: Response): Promise<{ mensaje: string; tokenInvalido: boolean }> {
  let cuerpo: unknown;

  try {
    cuerpo = await res.json();
  } catch {
    return {
      mensaje: `Meta respondió ${res.status} sin un cuerpo interpretable`,
      tokenInvalido: false,
    };
  }

  const error =
    cuerpo && typeof cuerpo === "object" ? (cuerpo as { error?: unknown }).error : undefined;

  if (error && typeof error === "object") {
    const { message, type, code } = error as ErrorDeGraph;
    const detalle = typeof message === "string" ? message : `status ${res.status}`;
    const codigo = typeof code === "number" ? code : undefined;

    const tokenInvalido =
      res.status < 500 &&
      (codigo === 190 ||
        (type === "OAuthException" && !(codigo !== undefined && CODIGOS_TRANSITORIOS.has(codigo))));

    return { mensaje: `Meta rechazó la solicitud: ${detalle}`, tokenInvalido };
  }

  return { mensaje: `Meta respondió ${res.status}`, tokenInvalido: false };
}

export interface ClienteMetaOAuth {
  // Pura, sin red: la URL a la que hay que mandar al usuario.
  construirUrlDeAutorizacion(state: string): string;
  // code del callback → user access token (corto).
  intercambiarCodigo(code: string): Promise<TokenDeUsuarioMeta>;
  // user token corto → user token de larga duración (~60 días).
  obtenerTokenDeLargaDuracion(userAccessToken: string): Promise<TokenDeUsuarioMeta>;
  // Las páginas que la persona autorizó, con su Page access token.
  listarPaginasAutorizadas(userAccessToken: string): Promise<PaginaAutorizada[]>;
  // Ítem 171: que la página le mande sus mensajes al webhook de la app.
  suscribirPaginaALaApp(pageId: string, pageAccessToken: string): Promise<void>;
  // D-11: la inversa, al desconectar. DELETE /{page-id}/subscribed_apps.
  desuscribirPaginaDeLaApp(pageId: string, pageAccessToken: string): Promise<void>;
}

// Los campos de la página que se suscriben (ítem 171): los mismos que se
// tildan en el panel de la app. `messages` trae los mensajes de Messenger y de
// Instagram; `messaging_postbacks` los botones (hoy se ignoran, pero quedan
// suscriptos para no tener que reconectar cada página el día que se usen).
// Sin message_echoes: el webhook descarta los echoes igual, no hace falta
// recibirlos.
export const CAMPOS_SUSCRIPTOS_DE_LA_PAGINA = ["messages", "messaging_postbacks"];

// FACTORY, mismo patrón que crearClienteGoogleCalendar: la configuración y el
// fetch entran por parámetro para que el test unitario exista.
export function crearClienteMetaOAuth(config: ConfiguracionMeta): ClienteMetaOAuth {
  const hacerFetch = config.fetch ?? ((url, init) => fetch(url, init));

  async function pedir(url: string, init: RequestInit): Promise<Response> {
    const conTimeout: RequestInit = { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) };

    try {
      return await hacerFetch(url, conTimeout);
    } catch (err) {
      // Falla de RED: no hubo respuesta de Meta. Nunca es un rechazo del token.
      // No se incluye la URL en el mensaje: la del canje lleva el client_secret
      // y el token en la query string.
      const detalle = err instanceof Error ? err.message : String(err);
      throw new MetaAuthError(`No se pudo contactar a Meta: ${detalle}`, false);
    }
  }

  async function pedirToken(parametros: Record<string, string>): Promise<TokenDeUsuarioMeta> {
    // GET con los parámetros en la query, que es la forma que documenta Meta
    // para los dos canjes. Va por HTTPS y servidor a servidor; lo que sí se
    // cuida es que esta URL no termine en ningún mensaje ni log (ver pedir()).
    const res = await pedir(`${URL_TOKEN}?${new URLSearchParams(parametros).toString()}`, {
      method: "GET",
    });

    if (!res.ok) {
      const { mensaje, tokenInvalido } = await describirFallo(res);
      throw new MetaAuthError(mensaje, tokenInvalido);
    }

    const datos = (await res.json()) as { access_token?: unknown; expires_in?: unknown };

    if (typeof datos.access_token !== "string" || datos.access_token === "") {
      // Un 200 sin token no es un rechazo: es algo que no entendemos.
      throw new MetaAuthError("Meta respondió sin access_token", false);
    }

    return {
      accessToken: datos.access_token,
      expiraEnSegundos: typeof datos.expires_in === "number" ? datos.expires_in : 0,
    };
  }

  return {
    construirUrlDeAutorizacion(state) {
      const parametros = new URLSearchParams({
        client_id: config.appId,
        redirect_uri: config.redirectUri,
        // Los permisos. En Facebook Login for Business reemplaza a `scope`;
        // ver el encabezado.
        config_id: config.loginConfigId,
        // Authorization code grant: el token se canjea servidor a servidor con
        // el App Secret, nunca viaja por el navegador.
        response_type: "code",
        // CSRF y frontera de tenant; ver utils/metaOauthState.ts.
        state,
      });

      return `${URL_DIALOGO}?${parametros.toString()}`;
    },

    intercambiarCodigo(code) {
      return pedirToken({
        client_id: config.appId,
        redirect_uri: config.redirectUri,
        client_secret: config.appSecret,
        code,
      });
    },

    obtenerTokenDeLargaDuracion(userAccessToken) {
      return pedirToken({
        grant_type: "fb_exchange_token",
        client_id: config.appId,
        client_secret: config.appSecret,
        fb_exchange_token: userAccessToken,
      });
    },

    async listarPaginasAutorizadas(userAccessToken) {
      const paginas: PaginaAutorizada[] = [];

      // El token va en el header Authorization y no en la query: Graph acepta
      // los dos, y así la URL —incluidas las de `paging.next` que arma Meta—
      // no lo lleva.
      let url: string | undefined = `${URL_PAGINAS}?${new URLSearchParams({
        fields: "id,name,access_token,instagram_business_account{id}",
        limit: "100",
      }).toString()}`;

      for (let vuelta = 0; url && vuelta < MAX_PAGINAS_DE_RESULTADOS; vuelta++) {
        const res = await pedir(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${userAccessToken}` },
        });

        if (!res.ok) {
          const { mensaje, tokenInvalido } = await describirFallo(res);
          throw new MetaAuthError(mensaje, tokenInvalido);
        }

        const datos = (await res.json()) as {
          data?: unknown;
          paging?: { next?: unknown };
        };

        if (!Array.isArray(datos.data)) {
          throw new MetaAuthError("Meta respondió sin la lista de páginas", false);
        }

        for (const item of datos.data) {
          const pagina = item as {
            id?: unknown;
            name?: unknown;
            access_token?: unknown;
            instagram_business_account?: { id?: unknown };
          };

          // Una página sin access_token no se puede usar para nada, y
          // descartarla en silencio podría convertir "autorizaste una página
          // que no sirve" en un engañoso "no autorizaste ninguna". Se falla
          // explícito.
          if (typeof pagina.id !== "string" || typeof pagina.access_token !== "string") {
            throw new MetaAuthError("Meta devolvió una página sin id o sin access_token", false);
          }

          const instagramId = pagina.instagram_business_account?.id;

          paginas.push({
            id: pagina.id,
            name: typeof pagina.name === "string" ? pagina.name : "",
            accessToken: pagina.access_token,
            instagramBusinessAccountId: typeof instagramId === "string" ? instagramId : null,
          });
        }

        url = typeof datos.paging?.next === "string" ? datos.paging.next : undefined;
      }

      return paginas;
    },

    async suscribirPaginaALaApp(pageId, pageAccessToken) {
      // Token en el header, igual que /me/accounts; los campos en el cuerpo.
      const res = await pedir(`${URL_GRAPH}/${encodeURIComponent(pageId)}/subscribed_apps`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${pageAccessToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          subscribed_fields: CAMPOS_SUSCRIPTOS_DE_LA_PAGINA.join(","),
        }).toString(),
      });

      if (!res.ok) {
        const { mensaje, tokenInvalido } = await describirFallo(res);
        throw new MetaAuthError(mensaje, tokenInvalido);
      }

      const datos = (await res.json().catch(() => null)) as { success?: unknown } | null;
      if (datos?.success !== true) {
        throw new MetaAuthError("Meta no confirmó la suscripción de la página", false);
      }
    },

    // D-11 de docs-privados/auditoria-2026-09-30-corta.md (local): sin esto,
    // una página desconectada seguía mandándole mensajes al webhook. Mismo
    // formato que la suscripción, con DELETE y sin cuerpo.
    async desuscribirPaginaDeLaApp(pageId, pageAccessToken) {
      const res = await pedir(`${URL_GRAPH}/${encodeURIComponent(pageId)}/subscribed_apps`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${pageAccessToken}` },
      });

      if (!res.ok) {
        const { mensaje, tokenInvalido } = await describirFallo(res);
        throw new MetaAuthError(mensaje, tokenInvalido);
      }

      const datos = (await res.json().catch(() => null)) as { success?: unknown } | null;
      if (datos?.success !== true) {
        throw new MetaAuthError("Meta no confirmó la baja de la suscripción de la página", false);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// El cliente real, perezoso y memoizado — mismo criterio que
// getClienteGoogleCalendar(): las META_* son opcionales para que el servidor
// arranque sin ellas, y se validan recién al usarlas, todas juntas.
// ---------------------------------------------------------------------------
let cliente: ClienteMetaOAuth | undefined;

export function getClienteMetaOAuth(): ClienteMetaOAuth {
  if (cliente) {
    return cliente;
  }

  const faltantes = [
    !env.META_APP_ID && "META_APP_ID",
    !env.META_APP_SECRET && "META_APP_SECRET",
    !env.META_REDIRECT_URI && "META_REDIRECT_URI",
    !env.META_LOGIN_CONFIG_ID && "META_LOGIN_CONFIG_ID",
  ].filter((nombre): nombre is string => typeof nombre === "string");

  if (faltantes.length > 0) {
    // isOperational: false — lista variables de entorno; es para el log, no
    // para el cliente (M-11 b).
    throw new AppError(
      `La conexión con Facebook no está configurada en el servidor. Faltan: ${faltantes.join(", ")}`,
      500,
      false,
    );
  }

  cliente = crearClienteMetaOAuth({
    appId: env.META_APP_ID as string,
    appSecret: env.META_APP_SECRET as string,
    redirectUri: env.META_REDIRECT_URI as string,
    loginConfigId: env.META_LOGIN_CONFIG_ID as string,
  });

  return cliente;
}

// Solo para tests, mismo motivo que resetClienteParaTests() de Google.
export function resetClienteMetaParaTests(): void {
  cliente = undefined;
}
