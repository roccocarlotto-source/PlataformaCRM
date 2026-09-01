import { randomUUID } from "node:crypto";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { lockBranchForUpdate } from "../repositories/branch.repository";
import {
  clearConnectionChannel,
  findConnectionByBranch,
  findConnectionWithSecretByBranch,
  markConnectionError,
  markConnectionRevoked,
  setConnectionChannel,
  upsertConnection,
  type ConexionPublica,
} from "../repositories/googleCalendarConnection.repository";
import { AppError } from "../utils/AppError";
import { getCifrador } from "../utils/encryption";
import { firmarState, verificarState } from "../utils/oauthState";
import { firmarWebhookToken } from "../utils/webhookToken";
import { getBranchById } from "./branch.service";
import {
  GoogleAuthError,
  getClienteGoogleCalendar,
  type ClienteGoogleCalendar,
  type IntervaloOcupado,
} from "./googleCalendar.service";

// ---------------------------------------------------------------------------
// Conexión de una sucursal con Google Calendar (P2.1, paso 2 de §9).
//
// ESTE ARCHIVO ES EL QUE CRUZA LOS DOS MUNDOS: saca el refresh token de la fila,
// lo descifra, llama a googleCalendar.service.ts (que no sabe nada de Postgres),
// y traduce un fallo de Google a un estado en la base. Esa separación es lo que
// permite que el cliente de Google se pruebe sin base y sin red.
//
// QUÉ NO ESTÁ ACÁ, y no es un olvido:
//
//   - GET /api/availability. Depende de un "rango de trabajo" por Resource que
//     NO existe en el schema ni está diseñado en ningún documento —es una frase
//     suelta en §5— y de Booking, que es el paso 3. Decidir ahí adentro cómo se
//     modelan los horarios de un recurso sería tomar una decisión de producto de
//     contrabando. consultarDisponibilidad() de más abajo deja lista la mitad
//     que sí se puede resolver hoy (hablar con Google); la otra mitad es una
//     conversación pendiente.
//   - POST /api/bookings y events.insert — paso 3.
//   - El webhook de sincronización inversa y el worker de renovación de canales
//     push — paso 4.
// ---------------------------------------------------------------------------

// La inyección existe para los tests: producción no pasa nada y usa el cliente
// real. Mismo criterio que los `overrides` de las factories de rateLimit.ts —
// una puerta explícita y acotada, no un parámetro que cambie el comportamiento.
type ClienteInyectado = ClienteGoogleCalendar | undefined;

function resolverCliente(cliente: ClienteInyectado): ClienteGoogleCalendar {
  return cliente ?? getClienteGoogleCalendar();
}

// ---------------------------------------------------------------------------
// 1. Iniciar la conexión
// ---------------------------------------------------------------------------

export interface InicioDeConexion {
  authorizationUrl: string;
}

// DEVUELVE LA URL, NO UN 302, y es una decisión con motivo mecánico y no
// estético: este endpoint está detrás de `authenticate`, así que quien lo llama
// manda un header Authorization con el JWT de Supabase. Un navegador siguiendo
// una redirección NO reenvía ese header, y un `fetch` que la siga tampoco sirve
// —la respuesta de Google es una pantalla HTML para una persona, no algo que un
// cliente de API pueda consumir—. La URL en el cuerpo deja que el frontend haga
// `window.location.href = authorizationUrl`, que es el único camino que funciona
// de verdad, y de paso hace el endpoint probable sin un navegador.
export async function iniciarConexion(
  organizationId: string,
  branchId: string,
  cliente?: ClienteInyectado,
): Promise<InicioDeConexion> {
  // 404 si la sucursal no existe o es de otra organización. Va PRIMERO: no tiene
  // sentido firmar un state para una sucursal que no se puede tocar, y esto es
  // lo único que ata el flujo a la organización del JWT.
  await getBranchById(organizationId, branchId);

  const state = await firmarState({ organizationId, branchId });

  return { authorizationUrl: resolverCliente(cliente).construirUrlDeAutorizacion(state) };
}

// ---------------------------------------------------------------------------
// 2. El callback
// ---------------------------------------------------------------------------

export interface EntradaDeCallback {
  state?: string;
  code?: string;
  // Google manda `error=access_denied` cuando la persona cancela en la pantalla
  // de consentimiento. Es un camino normal, no una falla del sistema.
  error?: string;
}

export async function completarConexion(
  entrada: EntradaDeCallback,
  cliente?: ClienteInyectado,
): Promise<ConexionPublica> {
  // -------------------------------------------------------------------------
  // EL ORDEN DE ACÁ ABAJO ES LA SEGURIDAD DE ESTE ENDPOINT, NO UN DETALLE.
  //
  // Este es el único camino de escritura del módulo que corre SIN authenticate:
  // Google redirige el navegador acá y no reenvía el JWT (ver utils/oauthState.
  // ts). El state se verifica ANTES DE TOCAR NADA — antes de leer la sucursal,
  // antes de hablar con Google, antes de cualquier escritura. Todo lo que pase
  // después usa el organizationId y el branchId QUE SALEN DEL TOKEN FIRMADO, y
  // jamás algo que venga suelto en la query string.
  // -------------------------------------------------------------------------
  if (!entrada.state) {
    throw new AppError("Falta el parámetro state", 400);
  }

  const { organizationId, branchId } = await verificarState(entrada.state);

  // Recién ahora, con una identidad probada, se mira el resto del request.
  if (entrada.error) {
    // Cancelar es una decisión del usuario, no un error del servidor: 400 y un
    // mensaje que se entienda, sin escribir nada en la base. Una conexión que
    // nunca se autorizó no deja fila.
    throw new AppError(
      entrada.error === "access_denied"
        ? "Se canceló la autorización en Google. La sucursal quedó sin conectar."
        : `Google rechazó la autorización (${entrada.error})`,
      400,
    );
  }

  if (!entrada.code) {
    throw new AppError("Falta el parámetro code", 400);
  }

  // La sucursal puede haber sido borrada entre que se inició el flujo y que
  // volvió el callback — el state sigue siendo válido diez minutos. Sin este
  // chequeo el upsert moriría contra la FK con un error crudo de Prisma.
  await getBranchById(organizationId, branchId);

  const tokens = await resolverCliente(cliente).intercambiarCodigo(entrada.code);

  // SIN REFRESH TOKEN NO HAY INTEGRACIÓN. Pasa si alguien saca `prompt=consent`
  // de la URL de autorización: Google devuelve un 200 impecable y sin
  // refresh_token para una cuenta que ya había autorizado antes. Guardar solo el
  // access token dejaría una conexión que funciona una hora y se muere sin
  // ruido, así que se falla acá, fuerte y explicando dónde mirar.
  if (!tokens.refreshToken) {
    throw new AppError(
      "Google no devolvió un refresh token. Suele significar que la cuenta ya había autorizado esta aplicación y que falta prompt=consent en la URL de autorización.",
      502,
    );
  }

  const refreshTokenCifrado = getCifrador().encrypt(tokens.refreshToken);

  // TRANSACCIÓN CON EL LOCK DE LA SUCURSAL, y es la mitad que el upsert solo no
  // cubre. deleteBranch decide sobre un CONTEO de conexiones con secreto (ver el
  // RESTRICT en branch.service.ts): sin serializar contra esta escritura, ese
  // conteo se queda viejo entre que se lee y que se borra, y una sucursal se
  // podría borrar justo mientras alguien la conecta. Es la misma clase de bug
  // que ALTO-8 y H-1, y el mismo remedio.
  return prisma.$transaction(async (tx) => {
    await lockBranchForUpdate(branchId, organizationId, tx);

    return upsertConnection(
      {
        organizationId,
        branchId,
        refreshToken: refreshTokenCifrado,
        // El calendario primario de la cuenta que autorizó. Elegir otro es una
        // funcionalidad que el documento menciona ("calendario primario u otro
        // elegido por el negocio") y que no tiene interfaz todavía; el default
        // de la columna y este valor son el mismo a propósito.
        calendarId: "primary",
      },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// 3. Desconectar
// ---------------------------------------------------------------------------

export async function desconectar(
  organizationId: string,
  branchId: string,
  cliente?: ClienteInyectado,
): Promise<void> {
  await getBranchById(organizationId, branchId);

  const conexion = await findConnectionWithSecretByBranch(branchId, organizationId);

  if (!conexion) {
    throw new AppError("Esta sucursal no tiene Google Calendar conectado", 404);
  }

  if (conexion.status === "REVOKED") {
    // 409 y no un no-op silencioso, mismo criterio que revocar dos veces una
    // ApiKey: quien llama pidió un cambio de estado que no ocurrió, y merecer
    // enterarse.
    throw new AppError("Esta conexión ya estaba desconectada", 409);
  }

  // -------------------------------------------------------------------------
  // LA REVOCACIÓN CONTRA GOOGLE ES BEST-EFFORT Y EL ORDEN IMPORTA.
  //
  // Se intenta primero decirle a Google que invalide el grant —es lo correcto:
  // deja de existir una credencial viva de este CRM sobre la cuenta del
  // negocio— pero un fallo ahí NO puede impedir la desconexión local. Si Google
  // está caído y esto abortara, el ADMIN quedaría sin forma de desconectar una
  // integración que quizás quiere sacar con urgencia.
  //
  // El peor caso de seguir adelante es un grant que sigue vivo del lado de
  // Google y que este sistema ya no puede usar (borra su copia del token). El
  // peor caso de abortar es un ADMIN que no puede desconectar. El primero es
  // claramente preferible, y queda registrado en el log.
  // -------------------------------------------------------------------------
  // EL CANAL SE CIERRA ANTES QUE EL TOKEN, y el orden importa: channels.stop se
  // autentica con un access token que sale del refresh token. Revocar primero
  // dejaría el canal imposible de cerrar, vivo hasta vencer, mandando
  // notificaciones que este sistema ya no puede procesar.
  //
  // Best-effort por el mismo criterio que la revocación de abajo: si esto
  // abortara, un Google caído dejaría al ADMIN sin poder desconectar.
  if (conexion.channelId && conexion.channelResourceId) {
    await detenerCanalDeConexion(
      organizationId,
      branchId,
      { channelId: conexion.channelId, resourceId: conexion.channelResourceId },
      cliente,
    );
  }

  if (conexion.refreshToken) {
    try {
      const enClaro = getCifrador().decrypt(conexion.refreshToken);
      await resolverCliente(cliente).revocarToken(enClaro);
    } catch (err) {
      logger.warn(
        { err, branchId, organizationId },
        "No se pudo revocar el token contra Google; la conexión se desconecta igual del lado del CRM",
      );
    }
  }

  await markConnectionRevoked(branchId, organizationId);
  // El canal se limpia de la fila SIEMPRE, haya podido cerrarse en Google o no:
  // una conexión REVOKED con datos de canal describiría un canal que este
  // sistema ya no puede usar ni renovar. El CHECK de la migración exige que los
  // tres campos vayan juntos, y esto los limpia juntos.
  await clearConnectionChannel(branchId, organizationId);
}

// ---------------------------------------------------------------------------
// 4. Consultar el estado
//
// Sin esto, `status = ERROR` sería una anomalía que nadie puede observar: §4 del
// documento pide notificar al admin y no hay ningún mecanismo de notificación
// construido, así que la fila ES el canal — y algo tiene que poder leerla.
// Nunca devuelve el token: findConnectionByBranch usa un `select` que no lo
// incluye.
// ---------------------------------------------------------------------------
export async function obtenerConexion(
  organizationId: string,
  branchId: string,
): Promise<ConexionPublica> {
  await getBranchById(organizationId, branchId);

  const conexion = await findConnectionByBranch(branchId, organizationId);

  if (!conexion) {
    throw new AppError("Esta sucursal no tiene Google Calendar conectado", 404);
  }

  return conexion;
}

// ---------------------------------------------------------------------------
// 5. Obtener un access token utilizable
//
// ES EL ÚNICO CAMINO por el que el resto del sistema debería hablar con Google:
// concentra en un lugar el descifrado del token, la renovación, y —lo que de
// verdad justifica que exista— LA TRADUCCIÓN DE UN GRANT MUERTO A status =
// ERROR.
//
// Sin esto, cada consumidor futuro (el paso 3, el paso 4) tendría que acordarse
// de marcar la conexión cuando Google la rechaza, y el día que uno se olvide la
// sucursal quedaría rota y en ACTIVE, o sea invisible.
//
// CON CACHE EN MEMORIA DEL ACCESS TOKEN — B-2 de docs/auditoria-2026-08-29.md.
// Antes se renovaba contra Google en CADA llamada: dos requests por operación
// (disponibilidad, reserva, cancelación, webhook, worker), descartando el
// `expires_in` que Google devuelve. Un Map a nivel de módulo, sin librería:
//
//   - Clave `${organizationId}:${branchId}`, no branchId solo — branchId ya es
//     único, pero todo este archivo scopea por los dos y el cache no es la
//     excepción.
//   - EL CACHE REEMPLAZA SOLO LA LLAMADA DE RED. La lectura fresca de la fila y
//     el chequeo de status/refreshToken siguen corriendo en cada llamada, ANTES
//     de mirar el cache: una conexión en ERROR o REVOKED rebota en el 409 aunque
//     tenga una entrada cacheada de cuando estaba ACTIVE — por eso
//     markConnectionError no necesita invalidar nada.
//   - LA RECONEXIÓN SE DETECTA SOLA: la entrada guarda el refresh token CIFRADO
//     tal como está en la fila, y si el de la fila fresca no coincide es un
//     miss. upsertConnection y markConnectionRevoked no tocan el cache. (El
//     cifrado usa un IV aleatorio, así que reconectar con la MISMA cuenta
//     también da un ciphertext distinto y un miss: una renovación de más,
//     inofensiva.)
//   - `expiraEn` = ahora + expires_in − un minuto de margen, para no entregar un
//     token al que le quedan segundos. Si Google no manda expires_in
//     (expiraEnSegundos = 0) la entrada nace vencida y se comporta como antes,
//     sin caso especial.
//   - En MEMORIA DEL PROCESO: con varias instancias cada una tiene el suyo, lo
//     que es correcto (un access token puede pedirse N veces) aunque no óptimo.
//
// FUERA DE ALCANCE, decidido en la revisión: deduplicar llamadas concurrentes
// en vuelo (dos requests simultáneas sobre la misma sucursal con el cache frío
// renuevan dos veces). El hallazgo es el caso común, no ese borde.
// ---------------------------------------------------------------------------
interface EntradaCacheDeToken {
  accessToken: string;
  calendarId: string;
  refreshTokenCifrado: string;
  expiraEn: number; // epoch ms
}

const cacheDeTokens = new Map<string, EntradaCacheDeToken>();
const MARGEN_DE_SEGURIDAD_MS = 60_000;

function claveDeCache(organizationId: string, branchId: string): string {
  return `${organizationId}:${branchId}`;
}

export async function obtenerAccessToken(
  organizationId: string,
  branchId: string,
  cliente?: ClienteInyectado,
): Promise<{ accessToken: string; calendarId: string }> {
  const conexion = await findConnectionWithSecretByBranch(branchId, organizationId);

  if (!conexion) {
    throw new AppError("Esta sucursal no tiene Google Calendar conectado", 404);
  }

  if (conexion.status !== "ACTIVE" || !conexion.refreshToken) {
    throw new AppError(
      "La conexión de esta sucursal con Google Calendar no está activa. Hay que reconectarla.",
      409,
    );
  }

  const clave = claveDeCache(organizationId, branchId);
  const cacheada = cacheDeTokens.get(clave);

  if (
    cacheada &&
    cacheada.refreshTokenCifrado === conexion.refreshToken &&
    cacheada.expiraEn > Date.now()
  ) {
    return { accessToken: cacheada.accessToken, calendarId: cacheada.calendarId };
  }

  const refreshToken = getCifrador().decrypt(conexion.refreshToken);

  try {
    const tokens = await resolverCliente(cliente).renovarAccessToken(refreshToken);

    cacheDeTokens.set(clave, {
      accessToken: tokens.accessToken,
      calendarId: conexion.calendarId,
      refreshTokenCifrado: conexion.refreshToken,
      expiraEn: Date.now() + tokens.expiraEnSegundos * 1000 - MARGEN_DE_SEGURIDAD_MS,
    });

    return { accessToken: tokens.accessToken, calendarId: conexion.calendarId };
  } catch (err) {
    // SOLO grantInvalido degrada la conexión. Un timeout o un 500 de Google son
    // transitorios, y marcar ERROR por eso obligaría al negocio a reconectar por
    // un mal minuto ajeno — ver el comentario de GoogleAuthError.
    if (err instanceof GoogleAuthError && err.grantInvalido) {
      await markConnectionError(branchId, organizationId, err.message);

      logger.warn(
        { branchId, organizationId, motivo: err.message },
        "Google rechazó el refresh token: la conexión pasó a ERROR y necesita reconectarse",
      );

      throw new AppError(
        "Google rechazó la autorización de esta sucursal. Hay que volver a conectarla.",
        409,
      );
    }

    throw err;
  }
}

// ---------------------------------------------------------------------------
// 6. Disponibilidad cruda (freebusy)
//
// LO QUE ESTO ES: los intervalos OCUPADOS que Google reporta para el calendario
// de una sucursal, en un rango. Es la mitad del problema que se puede resolver
// hoy sin tomar ninguna decisión de producto.
//
// LO QUE ESTO NO ES: GET /api/availability. Convertir "ocupado" en "horarios
// disponibles" necesita las dos piezas que no existen — el RANGO DE TRABAJO por
// Resource (días y horarios), que no está en el schema ni diseñado en ningún
// documento, y el conteo de Booking para los ServiceType con capacity > 1. Las
// dos llegan con el paso 3.
//
// Se expone igual, y no como código muerto: es lo que hace que el cliente de
// Google, el descifrado, la renovación y el camino a ERROR estén conectados de
// punta a punta y probados juntos, en vez de ser piezas que recién se enteran de
// si encajan cuando alguien construya la disponibilidad.
// ---------------------------------------------------------------------------
export async function consultarDisponibilidad(
  organizationId: string,
  branchId: string,
  rango: { timeMin: string; timeMax: string },
  cliente?: ClienteInyectado,
): Promise<IntervaloOcupado[]> {
  const branch = await getBranchById(organizationId, branchId);

  const { accessToken, calendarId } = await obtenerAccessToken(organizationId, branchId, cliente);

  try {
    return await resolverCliente(cliente).consultarFreeBusy({
      accessToken,
      calendarIds: [calendarId],
      timeMin: rango.timeMin,
      timeMax: rango.timeMax,
      // La zona de la SUCURSAL, nunca la del servidor — §4 del documento es
      // explícito, y es la razón por la que Branch.timezone se agregó en el
      // primer tramo antes de que existiera nada de Google.
      timeZone: branch.timezone,
    });
  } catch (err) {
    // Mismo criterio que obtenerAccessToken: un calendario que se borró o al que
    // se le quitó el permiso es un grant efectivamente roto, y tiene que quedar
    // registrado en la fila. Un Google caído, no.
    if (err instanceof GoogleAuthError && err.grantInvalido) {
      await markConnectionError(branchId, organizationId, err.message);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 7. Reflejo de una reserva en Google — usado por booking.service.ts
//
// LAS DOS FUNCIONES DE ACÁ ABAJO SON BEST-EFFORT Y NUNCA LANZAN. Devuelven lo
// que consiguieron y registran el resto en el log.
//
// No es comodidad: §4 del documento de diseño dice que "el sistema no debe
// bloquear una reserva por una falla del proveedor externo", y la forma de
// garantizar eso a nivel de código es que el camino de Google no tenga manera de
// tumbar al que lo llama. Si esto lanzara, cada consumidor tendría que acordarse
// de envolverlo en un try, y el día que uno se olvide una reserva perfectamente
// válida termina en un 500.
//
// El caso "esta sucursal no tiene Google conectado" NO ES UN ERROR y viaja por
// el mismo camino: es un estado normal del producto (conectar Google es
// opcional), y por eso ni siquiera se loguea como advertencia.
// ---------------------------------------------------------------------------

// Un grant muerto detectado EN LA LLAMADA A LA API, no en el refresh — B-4 de
// docs/auditoria-2026-08-29.md. obtenerAccessToken cubre el refresh del token y
// consultarDisponibilidad hace este mismo chequeo (y relanza); las dos funciones
// de abajo lo hacían a medias: el GoogleAuthError que lanzan crearEvento y
// eliminarEvento ante un 401 de Google es un 502, nunca 404/409, así que ya
// salía por el logger.warn de siempre — pero NADIE marcaba la fila, y la
// conexión seguía ACTIVE indefinidamente: obtenerConexion mentía y el worker de
// canales la trataba como sana. Un log es una migaja en un archivo; la fila es
// el estado que alguien puede consultar.
//
// NUNCA LANZA, y esa es la parte que no es opcional: quien la llama tiene
// contrato "nunca lanza", y una escritura a la base que falle acá no puede
// convertir un fallo best-effort contra Google en una excepción que tumbe la
// reserva o la cancelación. Si no se puede marcar, queda registrado como error
// de sistema y la fila sigue como estaba.
async function marcarConexionSiGrantInvalido(
  err: unknown,
  organizationId: string,
  branchId: string,
): Promise<void> {
  if (!(err instanceof GoogleAuthError && err.grantInvalido)) {
    return;
  }

  try {
    await markConnectionError(branchId, organizationId, err.message);
  } catch (errAlMarcar) {
    logger.error(
      { err: errAlMarcar, organizationId, branchId, motivo: err.message },
      "Google rechazó el grant pero no se pudo marcar la conexión en ERROR; sigue figurando ACTIVE y hay que revisarla",
    );
  }
}

// Crea el evento y devuelve su id, o `undefined` si no se pudo por cualquier
// motivo. `undefined` es exactamente lo que va a Booking.googleEventId.
export async function reflejarReservaEnGoogle(
  organizationId: string,
  branchId: string,
  evento: { titulo: string; descripcion?: string; inicio: Date; fin: Date },
  cliente?: ClienteInyectado,
): Promise<string | undefined> {
  try {
    const branch = await getBranchById(organizationId, branchId);
    const { accessToken, calendarId } = await obtenerAccessToken(organizationId, branchId, cliente);

    return await resolverCliente(cliente).crearEvento({
      accessToken,
      calendarId,
      titulo: evento.titulo,
      descripcion: evento.descripcion,
      inicio: evento.inicio,
      fin: evento.fin,
      // La zona de la SUCURSAL, nunca la del servidor.
      zona: branch.timezone,
    });
  } catch (err) {
    await marcarConexionSiGrantInvalido(err, organizationId, branchId);

    // Una sucursal sin conexión activa da 404/409 desde obtenerAccessToken, y es
    // un estado NORMAL: no se loguea como problema. Cualquier otra cosa sí, para
    // que quede rastro de que la reserva quedó sin reflejar.
    const esSinConexion =
      err instanceof AppError && (err.statusCode === 404 || err.statusCode === 409);

    if (!esSinConexion) {
      logger.warn(
        { err, organizationId, branchId },
        "No se pudo crear el evento en Google Calendar; la reserva se guarda igual sin googleEventId",
      );
    }

    return undefined;
  }
}

// Borra el evento. No devuelve nada: quien cancela no puede hacer nada distinto
// según haya funcionado o no.
export async function borrarReservaDeGoogle(
  organizationId: string,
  branchId: string,
  googleEventId: string,
  cliente?: ClienteInyectado,
): Promise<void> {
  try {
    const { accessToken, calendarId } = await obtenerAccessToken(organizationId, branchId, cliente);

    await resolverCliente(cliente).eliminarEvento({
      accessToken,
      calendarId,
      eventId: googleEventId,
    });
  } catch (err) {
    await marcarConexionSiGrantInvalido(err, organizationId, branchId);

    const esSinConexion =
      err instanceof AppError && (err.statusCode === 404 || err.statusCode === 409);

    if (!esSinConexion) {
      logger.warn(
        { err, organizationId, branchId, googleEventId },
        "No se pudo borrar el evento en Google Calendar; la reserva queda cancelada igual del lado del CRM",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 8. Canal de notificaciones push (paso 4)
//
// LO USA EL WORKER DE RENOVACIÓN, no el flujo OAuth. completarConexion() NO crea
// canales a propósito: cablearlo ahí habría tocado un camino ya revisado y
// mergeado para agregarle una llamada externa más que puede fallar, y la demora
// hasta el próximo tick del worker (una hora) no importa — un canal que no
// existe todavía solo significa que los cambios hechos en Google en esa ventana
// no se detectan, que es exactamente lo mismo que pasaba antes de este paso.
// ---------------------------------------------------------------------------

// Cierra un canal en Google. BEST-EFFORT Y NUNCA LANZA, mismo criterio que
// reflejarReservaEnGoogle: quien llama no puede hacer nada distinto según haya
// funcionado o no, y un fallo acá jamás debe tumbar la operación que lo pidió
// (desconectar una integración, o renovar un canal).
export async function detenerCanalDeConexion(
  organizationId: string,
  branchId: string,
  canal: { channelId: string; resourceId: string },
  cliente?: ClienteInyectado,
): Promise<void> {
  try {
    const { accessToken } = await obtenerAccessToken(organizationId, branchId, cliente);

    await resolverCliente(cliente).detenerCanal({
      accessToken,
      channelId: canal.channelId,
      resourceId: canal.resourceId,
    });
  } catch (err) {
    const esSinConexion =
      err instanceof AppError && (err.statusCode === 404 || err.statusCode === 409);

    if (!esSinConexion) {
      logger.warn(
        { err, organizationId, branchId, channelId: canal.channelId },
        "No se pudo cerrar el canal de notificaciones en Google; queda vivo hasta vencer",
      );
    }
  }
}

export interface ResultadoDeRenovacion {
  channelId: string;
  expiration: Date;
}

// Abre un canal nuevo para una conexión y lo guarda. Si había uno anterior, lo
// cierra DESPUÉS de que el nuevo quedó guardado.
//
// EL ORDEN —crear, guardar, recién ahí cerrar el viejo— es deliberado y es lo
// que evita la ventana ciega: cerrando primero, cualquier cambio hecho en Google
// entre el cierre y la creación no dispararía ninguna notificación y se
// perdería. Con este orden, en el peor caso los dos canales conviven un instante
// y llega una notificación duplicada, que es inofensiva (procesarla dos veces no
// hace nada: el segundo pase no encuentra cambios, o encuentra un Booking ya
// cancelado).
export async function renovarCanal(
  conexion: {
    organizationId: string;
    branchId: string;
    channelId: string | null;
    channelResourceId: string | null;
  },
  cliente?: ClienteInyectado,
): Promise<ResultadoDeRenovacion> {
  const { organizationId, branchId } = conexion;

  if (!env.GOOGLE_WEBHOOK_URL) {
    // isOperational: false — nombra una variable de entorno (M-11 b).
    throw new AppError(
      "GOOGLE_WEBHOOK_URL no está configurada en el servidor: sin ella no se pueden abrir canales de notificaciones",
      500,
      false,
    );
  }

  const { accessToken, calendarId } = await obtenerAccessToken(organizationId, branchId, cliente);

  // El id del canal se genera ACÁ y ANTES de firmar el token, porque el token lo
  // codifica: es lo que ata el token a un canal concreto y no solo a una
  // sucursal (ver utils/webhookToken.ts).
  const channelId = randomUUID();

  const token = await firmarWebhookToken({ organizationId, branchId, channelId });

  const creado = await resolverCliente(cliente).crearCanalDeNotificaciones({
    accessToken,
    calendarId,
    channelId,
    address: env.GOOGLE_WEBHOOK_URL,
    token,
    ttlSegundos: env.GOOGLE_CHANNEL_TTL_SECONDS,
  });

  const guardado = await setConnectionChannel(branchId, organizationId, {
    channelId: creado.channelId,
    channelResourceId: creado.resourceId,
    channelExpiration: creado.expiration,
  });

  // B-7 de docs/auditoria-2026-08-29.md: la conexión dejó de estar ACTIVE
  // mientras se creaba el canal en Google (desconectar() o markConnectionError
  // corrieron en esa ventana), y setConnectionChannel no escribió nada. El
  // canal que se acaba de abrir quedó huérfano: no está en ninguna fila, así
  // que nadie lo va a renovar ni cerrar hasta que venza. Se cierra acá,
  // best-effort y DIRECTO contra el cliente con el accessToken que ya está en
  // scope — detenerCanalDeConexion no sirve para esto: pasa por
  // obtenerAccessToken, que con la fila ya fuera de ACTIVE rebota en 409 y no
  // cerraría nada. Y se LANZA, no se traga: renovarCanal no es una de las
  // funciones "nunca lanzan" de este archivo, y el worker atrapa por conexión —
  // así lo cuenta como fallido en vez de loguear "creado o renovado" sobre una
  // conexión que ya no lo está.
  if (guardado.count !== 1) {
    try {
      await resolverCliente(cliente).detenerCanal({
        accessToken,
        channelId: creado.channelId,
        resourceId: creado.resourceId,
      });
    } catch (err) {
      logger.warn(
        { err, organizationId, branchId, channelId: creado.channelId },
        "La conexión dejó de estar activa mientras se creaba el canal y no se pudo cerrar el canal huérfano; queda vivo hasta vencer",
      );
    }

    throw new AppError(
      "La conexión de esta sucursal con Google Calendar dejó de estar activa mientras se renovaba el canal; el canal creado se cerró y no se guardó",
      409,
    );
  }

  // Recién ahora el viejo, y solo si había uno. Best-effort.
  if (conexion.channelId && conexion.channelResourceId) {
    await detenerCanalDeConexion(
      organizationId,
      branchId,
      { channelId: conexion.channelId, resourceId: conexion.channelResourceId },
      cliente,
    );
  }

  return { channelId: creado.channelId, expiration: creado.expiration };
}
