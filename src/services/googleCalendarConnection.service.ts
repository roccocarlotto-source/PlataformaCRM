import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { lockBranchForUpdate } from "../repositories/branch.repository";
import {
  findConnectionByBranch,
  findConnectionWithSecretByBranch,
  markConnectionError,
  markConnectionRevoked,
  upsertConnection,
  type ConexionPublica,
} from "../repositories/googleCalendarConnection.repository";
import { AppError } from "../utils/AppError";
import { getCifrador } from "../utils/encryption";
import { firmarState, verificarState } from "../utils/oauthState";
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
  // cubre. deleteBranch decide sobre un CONTEO de conexiones ACTIVE (ver el
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
// ---------------------------------------------------------------------------
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

  const refreshToken = getCifrador().decrypt(conexion.refreshToken);

  try {
    const tokens = await resolverCliente(cliente).renovarAccessToken(refreshToken);
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
