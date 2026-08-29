import { env } from "../config/env";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Cliente de la API de Google Calendar. AISLADO A PROPÓSITO: este archivo habla
// HTTP con Google y NADA MÁS — no toca Postgres, no conoce Prisma, no sabe qué
// es una GoogleCalendarConnection ni una sucursal. Todo lo que necesita entra
// por parámetro.
//
// El motivo es que sea probable de verdad: googleCalendar.service.test.ts corre
// como test UNITARIO, sin base y sin red, inyectando un fetch falso. Si este
// archivo leyera una fila para sacar el token, probar `freebusy.query` exigiría
// levantar Postgres y ese test se convertiría en uno de integración.
//
// Quien SÍ cruza los dos mundos es googleCalendarConnection.service.ts: saca el
// token de la fila, lo descifra, llama acá, y traduce un fallo de acá a un
// status ERROR en la base.
//
// ---------------------------------------------------------------------------
// LOS SCOPES — VERIFICADOS CONTRA LA DOCUMENTACIÓN DE GOOGLE, NO ASUMIDOS
// ---------------------------------------------------------------------------
//
// docs/booking-architecture.md §4 pide `calendar.events` "como mínimo" y deja
// abierto si hace falta `calendar.readonly` además. Se verificó contra la
// referencia oficial del endpoint y LAS DOS MITADES DE ESA FRASE ESTABAN MAL:
//
//   `freebusy.query` acepta EXACTAMENTE cuatro scopes, y `calendar.events` NO
//   ES NINGUNO DE ELLOS:
//     - https://www.googleapis.com/auth/calendar.readonly
//     - https://www.googleapis.com/auth/calendar
//     - https://www.googleapis.com/auth/calendar.events.freebusy
//     - https://www.googleapis.com/auth/calendar.freebusy
//
// (developers.google.com/workspace/calendar/api/v3/reference/freebusy/query,
// sección "Authorization".)
//
// Así que pedir solo `calendar.events` habría compilado, desplegado, y fallado
// con un 403 recién la primera vez que alguien consultara disponibilidad.
//
// SE ELIGE EL PAR MÁS ACOTADO QUE CUBRE EL MÓDULO ENTERO:
//
//   - calendar.events → crear/mover/cancelar eventos (events.insert, el paso 3).
//   - calendar.events.freebusy → SOLO busy/free, sin leer ningún detalle de
//     ningún evento. Es el más chico de los cuatro que sirven.
//
// Y NO calendar.readonly, que también funcionaría: ese da lectura COMPLETA de
// todos los calendarios de la cuenta —títulos, invitados, descripciones,
// adjuntos— para responder una pregunta que es "¿está ocupado a las 15?". Sería
// pedirle a cada negocio muchísimo más acceso del que el producto usa.
//
// SE PIDEN LOS DOS AHORA aunque este paso solo consulte disponibilidad, y no es
// anticipación gratuita: el consentimiento OAuth se otorga UNA vez por cuenta.
// Agregar un scope después obliga a que TODA sucursal ya conectada vuelva a
// pasar por la pantalla de Google, y esa migración no la dispara nadie —
// aparecería como reservas que fallan.
// ---------------------------------------------------------------------------

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
] as const;

const URL_AUTORIZACION = "https://accounts.google.com/o/oauth2/v2/auth";
const URL_TOKEN = "https://oauth2.googleapis.com/token";
const URL_REVOCACION = "https://oauth2.googleapis.com/revoke";
const URL_FREEBUSY = "https://www.googleapis.com/calendar/v3/freeBusy";

// Un evento de Google trae `dateTime` (con hora) o `date` (evento de día
// completo, "yyyy-mm-dd"). Se contemplan los dos: un evento de día completo en
// el calendario del negocio es perfectamente posible —un feriado, una jornada
// cerrada— y devolver `undefined` para esos haría que un cambio de horario sobre
// uno se leyera como "sin horario" en vez de como un cambio.
function leerInstante(campo?: { dateTime?: unknown; date?: unknown }): Date | undefined {
  const crudo =
    typeof campo?.dateTime === "string"
      ? campo.dateTime
      : typeof campo?.date === "string"
        ? campo.date
        : undefined;

  if (!crudo) {
    return undefined;
  }

  const fecha = new Date(crudo);

  return Number.isNaN(fecha.getTime()) ? undefined : fecha;
}

// events.insert / events.delete / events.watch / events.list operan sobre el
// calendario, que va en la RUTA y tiene que ir URL-encodeado: el id de un
// calendario secundario es una dirección de correo
// ("algo@group.calendar.google.com") y sin encodear el "@" rompe la URL.
function urlDeEventos(calendarId: string): string {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
}

// Tope por llamada. Google puede tardar, pero un request colgado no puede
// sostener indefinidamente el handler que lo espera — mismo razonamiento que
// OUTBOX_HANDLER_TIMEOUT_MS, donde la falta de un tope dejaba una transacción
// abierta. Acá no hay transacción de por medio, pero sí un usuario esperando.
const TIMEOUT_MS = 10_000;

// El subconjunto de `fetch` que usa este archivo. Tiparlo así —y no como
// `typeof fetch`— es lo que permite que el test inyecte una función de dos
// líneas en vez de tener que satisfacer la firma completa del fetch del runtime.
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ConfiguracionGoogle {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch?: FetchLike;
}

export interface TokensDeGoogle {
  // Puede faltar: Google SOLO emite refresh token en la primera autorización de
  // una cuenta, salvo que se le pida `prompt=consent` (ver más abajo). Quien
  // llama tiene que decidir qué hacer si no vino — acá no se inventa uno.
  refreshToken?: string;
  accessToken: string;
  expiraEnSegundos: number;
  scope: string;
}

export interface IntervaloOcupado {
  inicio: string;
  fin: string;
}

export interface ConsultaFreeBusy {
  accessToken: string;
  calendarIds: string[];
  // ISO 8601 con offset o Z. Google los exige con zona; una fecha "flotante" es
  // rechazada.
  timeMin: string;
  timeMax: string;
  // Zona IANA de la sucursal (Branch.timezone). §4 del documento es explícito en
  // que se pasa SIEMPRE y nunca se asume la del servidor: la respuesta de Google
  // se interpreta contra ella.
  timeZone: string;
}

// ---------------------------------------------------------------------------
// Errores de Google, con la distinción que importa río arriba
//
// invalid_grant es EL error que hay que poder distinguir: significa que el
// refresh token ya no sirve —el usuario revocó el acceso desde su cuenta de
// Google, o el grant caducó— y es la única condición que tiene que llevar la
// conexión a status = ERROR. Cualquier otro fallo (Google caído, timeout, un
// 500 de su lado) es transitorio y NO debe marcar nada: degradar una conexión
// sana porque Google tuvo un mal minuto obligaría al negocio a reconectar por
// las buenas.
// ---------------------------------------------------------------------------
export class GoogleAuthError extends AppError {
  // true solo cuando Google dice explícitamente que el grant murió.
  public readonly grantInvalido: boolean;

  constructor(message: string, grantInvalido: boolean) {
    super(message, 502);
    this.grantInvalido = grantInvalido;
    Object.setPrototypeOf(this, GoogleAuthError.prototype);
  }
}

interface RespuestaDeError {
  error?: string;
  error_description?: string;
}

// Google devuelve sus errores de OAuth como { error, error_description }, y los
// de la API de Calendar como { error: { message } }. Se contemplan los dos y se
// cae a un texto genérico: nunca se devuelve el cuerpo crudo, que puede traer
// HTML de un balanceador cuando el que falla no es Google sino algo en el medio.
async function describirFallo(res: Response): Promise<{ mensaje: string; codigo?: string }> {
  let cuerpo: unknown;

  try {
    cuerpo = await res.json();
  } catch {
    return { mensaje: `Google respondió ${res.status} sin un cuerpo interpretable` };
  }

  if (cuerpo && typeof cuerpo === "object") {
    const plano = cuerpo as RespuestaDeError & { error?: unknown };

    // Forma OAuth: { "error": "invalid_grant", "error_description": "..." }
    if (typeof plano.error === "string") {
      const detalle = plano.error_description ? `: ${plano.error_description}` : "";
      return {
        mensaje: `Google rechazó la solicitud (${plano.error}${detalle})`,
        codigo: plano.error,
      };
    }

    // Forma API de Calendar: { "error": { "message": "..." } }
    if (plano.error && typeof plano.error === "object") {
      const anidado = plano.error as { message?: unknown };
      if (typeof anidado.message === "string") {
        return { mensaje: `Google rechazó la solicitud: ${anidado.message}` };
      }
    }
  }

  return { mensaje: `Google respondió ${res.status}` };
}

export interface ClienteGoogleCalendar {
  // Pura, sin red: arma la URL a la que hay que mandar al usuario.
  construirUrlDeAutorizacion(state: string): string;
  // Canjea el `code` del callback por tokens.
  intercambiarCodigo(code: string): Promise<TokensDeGoogle>;
  // Cambia un refresh token por un access token fresco.
  renovarAccessToken(refreshToken: string): Promise<TokensDeGoogle>;
  // Invalida el grant del lado de Google.
  revocarToken(token: string): Promise<void>;
  // El endpoint que motiva todo este archivo.
  consultarFreeBusy(consulta: ConsultaFreeBusy): Promise<IntervaloOcupado[]>;
  // events.insert — crea el evento que refleja una reserva. Devuelve el id que
  // Google le asigna, que es lo que se guarda en Booking.googleEventId.
  crearEvento(evento: EventoACrear): Promise<string>;
  // events.delete — best-effort al cancelar. Ver el comentario de su
  // implementación sobre por qué un 404/410 no es un error.
  eliminarEvento(evento: EventoAEliminar): Promise<void>;
  // events.watch — abre un canal de notificaciones push (paso 4).
  crearCanalDeNotificaciones(canal: CanalACrear): Promise<CanalCreado>;
  // channels.stop — cierra uno. Pide id + resourceId, verificado.
  detenerCanal(canal: CanalADetener): Promise<void>;
  // events.list con syncToken. PAGINA INTERNAMENTE; ver su implementación.
  listarCambios(consulta: ConsultaDeCambios): Promise<CambiosDeCalendario>;
}

export interface CanalACrear {
  accessToken: string;
  calendarId: string;
  // El id que NOSOTROS elegimos (un UUID). Google lo devuelve en cada
  // notificación como X-Goog-Channel-ID.
  channelId: string;
  // URL HTTPS del webhook. El dominio tiene que estar VERIFICADO en Search
  // Console y registrado en la API Console — Google rechaza el watch si no.
  address: string;
  // El token firmado que Google va a devolver en X-Goog-Channel-Token. Es lo
  // único que autentica una notificación. Ver utils/webhookToken.ts.
  token: string;
  ttlSegundos: number;
}

export interface CanalCreado {
  channelId: string;
  // Id opaco de Google. Sin él channels.stop es imposible.
  resourceId: string;
  expiration: Date;
}

export interface CanalADetener {
  accessToken: string;
  channelId: string;
  resourceId: string;
}

export interface ConsultaDeCambios {
  accessToken: string;
  calendarId: string;
  // Ausente = sincronización COMPLETA, solo para obtener un token nuevo.
  syncToken?: string;
}

// Un evento tal como llega en una sincronización incremental. Solo los campos
// que este módulo usa — no se modela el recurso Events entero.
export interface EventoCambiado {
  id: string;
  // "confirmed" | "tentative" | "cancelled". Un evento borrado llega con
  // status "cancelled", y en sync incremental llegan solos (no hace falta
  // showDeleted) — verificado contra la referencia del recurso Events.
  status?: string;
  inicio?: Date;
  fin?: Date;
}

export interface CambiosDeCalendario {
  eventos: EventoCambiado[];
  // El token para la PRÓXIMA sincronización. Ver la implementación sobre por
  // qué solo puede salir de la última página.
  nextSyncToken?: string;
}

// ---------------------------------------------------------------------------
// El syncToken venció o es inválido: Google responde 410 GONE y hay que
// resincronizar completo.
//
// ES UNA CLASE APARTE Y NO UN GoogleAuthError porque quien llama tiene que poder
// distinguirlo para RECUPERARSE, no para reportarlo: la respuesta correcta a un
// 410 es volver a llamar sin syncToken, no propagar un error. Si fuera un
// GoogleAuthError con `grantInvalido: false`, sería indistinguible de un Google
// caído y la conexión se quedaría con un token muerto para siempre.
// ---------------------------------------------------------------------------
export class GoogleSyncTokenInvalidoError extends AppError {
  constructor(message: string) {
    super(message, 410);
    Object.setPrototypeOf(this, GoogleSyncTokenInvalidoError.prototype);
  }
}

export interface EventoACrear {
  accessToken: string;
  calendarId: string;
  titulo: string;
  descripcion?: string;
  inicio: Date;
  fin: Date;
  // Zona IANA de la sucursal. §4 del documento: se pasa explícitamente en cada
  // llamada y NUNCA se asume la del servidor.
  //
  // Google exige `timeZone` junto al `dateTime` aunque el dateTime ya lleve
  // offset: es lo que hace que el evento se muestre y se repita bien en el
  // calendario de quien lo mira, y lo que decide cómo se comporta si alguien
  // lo mueve después.
  zona: string;
}

export interface EventoAEliminar {
  accessToken: string;
  calendarId: string;
  eventId: string;
}

// FACTORY, mismo patrón que crearCifrador() / crearRegistroDeHandlers(): recibe
// su configuración y su fetch en vez de leerlos de un singleton. Es lo que hace
// que el test unitario exista.
export function crearClienteGoogleCalendar(config: ConfiguracionGoogle): ClienteGoogleCalendar {
  const hacerFetch = config.fetch ?? ((url, init) => fetch(url, init));

  async function pedir(url: string, init: RequestInit): Promise<Response> {
    // AbortSignal.timeout: nativo desde Node 18, sin dependencia. Un fetch sin
    // timeout puede quedarse esperando lo que el sistema operativo tarde en
    // decidir que la conexión murió, que son minutos.
    const conTimeout: RequestInit = { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) };

    try {
      return await hacerFetch(url, conTimeout);
    } catch (err) {
      // Falla de RED, no de Google: no llegó respuesta. Nunca es invalid_grant,
      // así que jamás debe degradar una conexión.
      const detalle = err instanceof Error ? err.message : String(err);
      throw new GoogleAuthError(`No se pudo contactar a Google: ${detalle}`, false);
    }
  }

  async function pedirTokens(cuerpo: Record<string, string>): Promise<TokensDeGoogle> {
    const res = await pedir(URL_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(cuerpo).toString(),
    });

    if (!res.ok) {
      const { mensaje, codigo } = await describirFallo(res);
      throw new GoogleAuthError(mensaje, codigo === "invalid_grant");
    }

    const datos = (await res.json()) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
      scope?: unknown;
    };

    if (typeof datos.access_token !== "string") {
      // Un 200 sin access_token no es un fallo de autorización: es Google
      // devolviendo algo que no entendemos, o un intermediario respondiendo por
      // él. No puede marcar la conexión como rota.
      throw new GoogleAuthError("Google respondió sin access_token", false);
    }

    return {
      accessToken: datos.access_token,
      refreshToken: typeof datos.refresh_token === "string" ? datos.refresh_token : undefined,
      expiraEnSegundos: typeof datos.expires_in === "number" ? datos.expires_in : 0,
      scope: typeof datos.scope === "string" ? datos.scope : "",
    };
  }

  return {
    construirUrlDeAutorizacion(state) {
      const parametros = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: GOOGLE_CALENDAR_SCOPES.join(" "),

        // access_type=offline ES LO QUE PIDE EL REFRESH TOKEN. Sin esto Google
        // devuelve solo un access token de una hora y la integración se muere
        // sola al día siguiente, sin ningún error que lo anticipe.
        access_type: "offline",

        // prompt=consent FUERZA la pantalla de consentimiento SIEMPRE, y no es
        // una molestia gratuita para el usuario:
        //
        //   Google emite refresh token UNA SOLA VEZ por combinación de cuenta y
        //   cliente. Sin este parámetro, una sucursal que ya autorizó alguna vez
        //   —justo el caso de RECONECTAR después de un REVOKED o un ERROR, que
        //   es el que hay que soportar— completa el flujo con un 200 perfecto y
        //   SIN refresh_token. La fila quedaría sin credencial utilizable y el
        //   fallo aparecería recién en la primera reserva.
        //
        // Es el error clásico de esta integración y la única defensa es pedirlo
        // explícitamente en cada autorización.
        prompt: "consent",

        // CSRF. Ver utils/oauthState.ts: sin esto el callback no tiene forma de
        // saber qué sucursal inició el flujo, porque Google no reenvía el JWT.
        state,
      });

      return `${URL_AUTORIZACION}?${parametros.toString()}`;
    },

    intercambiarCodigo(code) {
      return pedirTokens({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
      });
    },

    renovarAccessToken(refreshToken) {
      return pedirTokens({
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
      });
    },

    async revocarToken(token) {
      const res = await pedir(URL_REVOCACION, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      });

      if (!res.ok) {
        const { mensaje, codigo } = await describirFallo(res);
        throw new GoogleAuthError(mensaje, codigo === "invalid_grant");
      }
    },

    // -----------------------------------------------------------------------
    // freebusy.query — el endpoint que motiva este archivo.
    //
    // Devuelve los intervalos OCUPADOS de los calendarios pedidos. No devuelve
    // los libres: quien calcule disponibilidad tiene que restar esto del rango
    // de trabajo de la sucursal. Ese cálculo NO vive acá y no existe todavía —
    // GET /api/availability quedó explícitamente fuera del paso 2 porque
    // depende de un "rango de trabajo" por Resource que no está en el schema ni
    // diseñado en ningún documento.
    // -----------------------------------------------------------------------
    async consultarFreeBusy({ accessToken, calendarIds, timeMin, timeMax, timeZone }) {
      const res = await pedir(URL_FREEBUSY, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timeMin,
          timeMax,
          timeZone,
          items: calendarIds.map((id) => ({ id })),
        }),
      });

      if (!res.ok) {
        const { mensaje, codigo } = await describirFallo(res);
        // Un 401 acá significa access token vencido o revocado. El access token
        // lo acaba de emitir el refresh, así que si Google lo rechaza el
        // problema es del grant.
        throw new GoogleAuthError(mensaje, codigo === "invalid_grant" || res.status === 401);
      }

      const datos = (await res.json()) as {
        calendars?: Record<string, { busy?: unknown; errors?: unknown }>;
      };

      const calendarios = datos.calendars ?? {};
      const ocupados: IntervaloOcupado[] = [];

      for (const id of calendarIds) {
        const calendario = calendarios[id];

        if (!calendario) {
          // Pedimos un calendario y Google no lo mencionó en la respuesta.
          throw new GoogleAuthError(
            `Google no devolvió disponibilidad para el calendario "${id}"`,
            false,
          );
        }

        // ERRORES POR CALENDARIO: freebusy.query responde 200 aunque un
        // calendario individual haya fallado, y pone el motivo acá adentro
        // (notFound si se borró, accessDenied si se le quitó el permiso).
        //
        // Ignorar esto sería el bug silencioso de este archivo: un calendario
        // inaccesible devuelve `busy: []`, que es indistinguible de "está
        // completamente libre" — y el sistema ofrecería todos los horarios de
        // un calendario que no puede leer.
        const errores = calendario.errors;
        if (Array.isArray(errores) && errores.length > 0) {
          const motivos = errores
            .map((e) =>
              e && typeof e === "object"
                ? String((e as { reason?: unknown }).reason)
                : "desconocido",
            )
            .join(", ");

          // accessDenied/notFound = el permiso sobre ese calendario se perdió.
          // Es la misma clase de problema que un grant muerto y necesita la
          // misma respuesta: que alguien reconecte.
          const esProblemaDeAcceso =
            motivos.includes("accessDenied") || motivos.includes("notFound");

          throw new GoogleAuthError(
            `Google no pudo leer la disponibilidad del calendario "${id}" (${motivos})`,
            esProblemaDeAcceso,
          );
        }

        const busy = calendario.busy;
        if (!Array.isArray(busy)) {
          continue;
        }

        for (const intervalo of busy) {
          if (!intervalo || typeof intervalo !== "object") {
            continue;
          }
          const { start, end } = intervalo as { start?: unknown; end?: unknown };
          if (typeof start === "string" && typeof end === "string") {
            ocupados.push({ inicio: start, fin: end });
          }
        }
      }

      return ocupados;
    },

    // -----------------------------------------------------------------------
    // events.insert — el reflejo en Google de una reserva ya guardada.
    //
    // "YA GUARDADA" no es un detalle de redacción: §4 del documento es explícito
    // en que el sistema no debe bloquear una reserva por una falla del proveedor
    // externo, así que quien llama a esto ya commiteó el Booking. Un error de
    // acá no deshace nada — ver booking.service.ts.
    // -----------------------------------------------------------------------
    async crearEvento({ accessToken, calendarId, titulo, descripcion, inicio, fin, zona }) {
      const res = await pedir(urlDeEventos(calendarId), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: titulo,
          ...(descripcion ? { description: descripcion } : {}),
          // dateTime en ISO con offset + timeZone explícito. Google acepta los
          // dos juntos y es lo recomendado: el offset fija el instante, la zona
          // fija cómo se interpreta y se muestra.
          start: { dateTime: inicio.toISOString(), timeZone: zona },
          end: { dateTime: fin.toISOString(), timeZone: zona },
        }),
      });

      if (!res.ok) {
        const { mensaje, codigo } = await describirFallo(res);
        throw new GoogleAuthError(mensaje, codigo === "invalid_grant" || res.status === 401);
      }

      const datos = (await res.json()) as { id?: unknown };

      if (typeof datos.id !== "string") {
        // Un 200 sin id significa que el evento pudo haberse creado y no
        // tenemos con qué referenciarlo después. No es un fallo de
        // autorización, así que no degrada la conexión.
        throw new GoogleAuthError("Google creó el evento pero no devolvió su id", false);
      }

      return datos.id;
    },

    // -----------------------------------------------------------------------
    // events.delete — al cancelar una reserva.
    //
    // 404 Y 410 NO SON ERRORES ACÁ, y tratarlos como tales sería el bug de esta
    // función: significan que el evento ya no está en Google (alguien lo borró a
    // mano desde el calendario, o esta misma cancelación ya se intentó y llegó
    // más lejos de lo que creíamos). El resultado deseado —que el evento no
    // exista— ya se cumplió, así que fallar obligaría a reintentar algo que ya
    // está hecho y dejaría la cancelación local en un estado raro.
    // -----------------------------------------------------------------------
    async eliminarEvento({ accessToken, calendarId, eventId }) {
      const res = await pedir(`${urlDeEventos(calendarId)}/${encodeURIComponent(eventId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (res.ok || res.status === 404 || res.status === 410) {
        return;
      }

      const { mensaje, codigo } = await describirFallo(res);
      throw new GoogleAuthError(mensaje, codigo === "invalid_grant" || res.status === 401);
    },

    // -----------------------------------------------------------------------
    // events.watch — abre el canal de notificaciones push.
    //
    // El TTL se manda en `params.ttl` (segundos) y no como `expiration`: es la
    // forma que documenta la referencia. El default de Google es 604800 s = 7
    // días exactos.
    //
    // `expiration` VUELVE EN MILISEGUNDOS, no en segundos. Interpretarlo como
    // segundos daría una fecha de 1970 y el worker de renovación recrearía el
    // canal en cada pasada, para siempre, sin que nada fallara visiblemente.
    // -----------------------------------------------------------------------
    async crearCanalDeNotificaciones({
      accessToken,
      calendarId,
      channelId,
      address,
      token,
      ttlSegundos,
    }) {
      const res = await pedir(`${urlDeEventos(calendarId)}/watch`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: channelId,
          type: "web_hook",
          address,
          token,
          params: { ttl: String(ttlSegundos) },
        }),
      });

      if (!res.ok) {
        const { mensaje, codigo } = await describirFallo(res);
        throw new GoogleAuthError(mensaje, codigo === "invalid_grant" || res.status === 401);
      }

      const datos = (await res.json()) as {
        id?: unknown;
        resourceId?: unknown;
        expiration?: unknown;
      };

      // resourceId es OBLIGATORIO para poder llamar a channels.stop después. Un
      // canal sin él es un canal que no se puede cerrar nunca, solo esperar a
      // que venza — así que se falla acá en vez de guardar una fila inservible.
      if (typeof datos.resourceId !== "string") {
        throw new GoogleAuthError("Google creó el canal pero no devolvió resourceId", false);
      }

      // `expiration` es opcional en el esquema de Google. Si no viene, se asume
      // el TTL pedido: es preferible una expiración estimada (que a lo sumo hace
      // renovar un poco antes) a una fila sin expiración, que el worker no
      // sabría cuándo renovar.
      const expiration =
        typeof datos.expiration === "string" || typeof datos.expiration === "number"
          ? new Date(Number(datos.expiration))
          : new Date(Date.now() + ttlSegundos * 1000);

      if (Number.isNaN(expiration.getTime())) {
        throw new GoogleAuthError(
          `Google devolvió una expiración de canal ininteligible: ${String(datos.expiration)}`,
          false,
        );
      }

      return {
        channelId: typeof datos.id === "string" ? datos.id : channelId,
        resourceId: datos.resourceId,
        expiration,
      };
    },

    // -----------------------------------------------------------------------
    // channels.stop — pide id + resourceId, verificado contra la referencia.
    //
    // Un 404 NO es un error, por lo mismo que en eliminarEvento: el canal ya no
    // existe (venció, o alguien ya lo detuvo) y el resultado deseado ya se
    // cumplió. Todo el uso de este método es best-effort, así que fallar acá
    // solo serviría para tumbar al que llama.
    // -----------------------------------------------------------------------
    async detenerCanal({ accessToken, channelId, resourceId }) {
      const res = await pedir("https://www.googleapis.com/calendar/v3/channels/stop", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: channelId, resourceId }),
      });

      if (res.ok || res.status === 404) {
        return;
      }

      const { mensaje, codigo } = await describirFallo(res);
      throw new GoogleAuthError(mensaje, codigo === "invalid_grant" || res.status === 401);
    },

    // -----------------------------------------------------------------------
    // events.list — los cambios desde la última sincronización.
    //
    // PAGINA INTERNAMENTE, Y ESA ES LA RAZÓN DE QUE ESTA FUNCIÓN EXISTA EN VEZ
    // DE DEVOLVER UNA PÁGINA CRUDA. Textual en la guía de sync de Google:
    //
    //     "the nextSyncToken field is present only on the last page"
    //
    // Las páginas intermedias traen `nextPageToken` y NO traen `nextSyncToken`.
    // Si quien llama guardara el token de una página intermedia —o peor, se
    // quedara con la primera página y guardara un token que no existe— la
    // próxima sincronización arrancaría desde un punto que nunca reflejó todos
    // los cambios: un HUECO INVISIBLE. No hay error, no hay log, solo eventos
    // que nunca se procesan.
    //
    // Teniendo el bucle acá adentro, ese error no se puede cometer desde
    // afuera: la función devuelve todos los eventos y UN solo token, el bueno.
    //
    // Los eventos CANCELADOS llegan solos en sync incremental —no hace falta
    // `showDeleted`— y son justamente los que este módulo necesita ver.
    // -----------------------------------------------------------------------
    async listarCambios({ accessToken, calendarId, syncToken }) {
      const eventos: EventoCambiado[] = [];
      let pageToken: string | undefined;
      let nextSyncToken: string | undefined;

      // Tope de páginas: una guarda contra un nextPageToken que Google devuelva
      // en bucle (o contra un doble de test mal escrito). 100 páginas × 250
      // eventos por defecto son 25.000 cambios en una pasada, muy por encima de
      // cualquier volumen real de este producto.
      for (let pagina = 0; pagina < 100; pagina++) {
        const parametros = new URLSearchParams();
        if (syncToken) {
          parametros.set("syncToken", syncToken);
        }
        if (pageToken) {
          parametros.set("pageToken", pageToken);
        }

        const res = await pedir(`${urlDeEventos(calendarId)}?${parametros.toString()}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        // 410 GONE = el syncToken venció o es inválido. Es RECUPERABLE y por eso
        // tiene su propia clase: la respuesta correcta es volver a llamar sin
        // syncToken, no propagar un fallo.
        if (res.status === 410) {
          throw new GoogleSyncTokenInvalidoError(
            "El token de sincronización de Google venció o es inválido: hay que resincronizar",
          );
        }

        if (!res.ok) {
          const { mensaje, codigo } = await describirFallo(res);
          throw new GoogleAuthError(mensaje, codigo === "invalid_grant" || res.status === 401);
        }

        const datos = (await res.json()) as {
          items?: unknown;
          nextPageToken?: unknown;
          nextSyncToken?: unknown;
        };

        if (Array.isArray(datos.items)) {
          for (const item of datos.items) {
            if (!item || typeof item !== "object") {
              continue;
            }
            const evento = item as {
              id?: unknown;
              status?: unknown;
              start?: { dateTime?: unknown; date?: unknown };
              end?: { dateTime?: unknown; date?: unknown };
            };

            if (typeof evento.id !== "string") {
              continue;
            }

            eventos.push({
              id: evento.id,
              status: typeof evento.status === "string" ? evento.status : undefined,
              inicio: leerInstante(evento.start),
              fin: leerInstante(evento.end),
            });
          }
        }

        nextSyncToken = typeof datos.nextSyncToken === "string" ? datos.nextSyncToken : undefined;

        pageToken = typeof datos.nextPageToken === "string" ? datos.nextPageToken : undefined;

        if (!pageToken) {
          // Última página: acá —y solo acá— puede venir el nextSyncToken.
          break;
        }
      }

      return { eventos, nextSyncToken };
    },
  };
}

// ---------------------------------------------------------------------------
// El cliente que usa producción. PEREZOSO, mismo criterio que getCifrador() y
// getJwks(): las tres GOOGLE_* son opcionales en config/env.ts para que el
// servidor arranque sin ellas, así que la validación de presencia tiene que
// ocurrir en el momento de uso y no al importar.
// ---------------------------------------------------------------------------
let cliente: ClienteGoogleCalendar | undefined;

export function getClienteGoogleCalendar(): ClienteGoogleCalendar {
  if (cliente) {
    return cliente;
  }

  const faltantes = [
    !env.GOOGLE_CLIENT_ID && "GOOGLE_CLIENT_ID",
    !env.GOOGLE_CLIENT_SECRET && "GOOGLE_CLIENT_SECRET",
    !env.GOOGLE_REDIRECT_URI && "GOOGLE_REDIRECT_URI",
  ].filter((nombre): nombre is string => typeof nombre === "string");

  if (faltantes.length > 0) {
    // Las lista TODAS de una. Reportar solo la primera obligaría a configurar,
    // reintentar y descubrir la siguiente, una por vez.
    throw new AppError(
      `La integración con Google Calendar no está configurada en el servidor. Faltan: ${faltantes.join(", ")}`,
      500,
    );
  }

  cliente = crearClienteGoogleCalendar({
    clientId: env.GOOGLE_CLIENT_ID as string,
    clientSecret: env.GOOGLE_CLIENT_SECRET as string,
    redirectUri: env.GOOGLE_REDIRECT_URI as string,
  });

  return cliente;
}

// Solo para tests, mismo motivo que resetCifradorParaTests().
export function resetClienteParaTests(): void {
  cliente = undefined;
}
