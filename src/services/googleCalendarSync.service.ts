import { logger } from "../lib/logger";
import {
  findBookingByGoogleEventId,
  markBookingCancelled,
} from "../repositories/booking.repository";
import {
  findConnectionByChannelId,
  setConnectionSyncToken,
} from "../repositories/googleCalendarConnection.repository";
import { AppError } from "../utils/AppError";
import { verificarWebhookToken } from "../utils/webhookToken";
import {
  GoogleSyncTokenInvalidoError,
  getClienteGoogleCalendar,
  type ClienteGoogleCalendar,
  type EventoCambiado,
} from "./googleCalendar.service";
import { obtenerAccessToken } from "./googleCalendarConnection.service";

// ---------------------------------------------------------------------------
// Sincronización inversa (paso 4 de docs/booking-architecture.md §9): qué hacer
// cuando alguien cancela o mueve un evento DESDE Google Calendar en vez de desde
// el CRM.
//
// ---------------------------------------------------------------------------
// LAS DOS DECISIONES DE PRODUCTO, Y POR QUÉ SON DISTINTAS
// ---------------------------------------------------------------------------
//
// EVENTO CANCELADO EN GOOGLE -> el Booking pasa a CANCELLED y libera el cupo.
//   Es lo que §4 pide explícitamente. Es seguro de automatizar porque la
//   cancelación NO NECESITA VALIDAR NADA: liberar un cupo nunca puede producir
//   un estado inválido.
//
// EVENTO MOVIDO EN GOOGLE -> NO se aplica. Solo se registra.
//   Mover un Booking es REPROGRAMAR, y reprogramar exige revalidar el horario de
//   trabajo del recurso, la capacidad en el horario nuevo y el evento en Google
//   — la creación completa otra vez. Eso quedó fuera de alcance en el paso 3 por
//   esa misma razón, y aplicarlo automáticamente acá sería construir esa
//   validación por la puerta de atrás, o peor: NO construirla y mover el Booking
//   a un horario fuera del horario de trabajo o encima de otro turno.
//
//   LO QUE SE ACEPTA: la reserva queda localmente desactualizada hasta que
//   alguien la resuelva a mano. Es aceptable porque es el caso menos común de
//   los dos —cancelar desde el calendario es mucho más frecuente que mover— y
//   porque el log deja el rastro completo (bookingId, horario viejo y nuevo).
// ---------------------------------------------------------------------------

// Lo que el handler necesita saber de una notificación. Los nombres son los de
// los headers de Google, verificados contra la guía de push.
export interface NotificacionDeGoogle {
  channelId: string;
  // X-Goog-Resource-State: "sync" | "exists" | "not_exists".
  resourceState: string;
  // X-Goog-Channel-Token: nuestro token firmado.
  token: string;
}

export interface ResultadoDeNotificacion {
  // Qué se hizo, para el log del controller y para los tests.
  accion: "sync-inicial" | "sin-cambios" | "procesada" | "canal-desconocido" | "recurso-eliminado";
  bookingsCancelados: number;
  eventosMovidos: number;
}

type ClienteInyectado = ClienteGoogleCalendar | undefined;

// ---------------------------------------------------------------------------
// El punto de entrada del webhook.
//
// EL ORDEN DE ACÁ ES LA SEGURIDAD DE ESTE ENDPOINT, igual que en el callback
// OAuth del paso 2: el token firmado se verifica ANTES de tocar Postgres y antes
// de hablar con Google. Un request sin token válido muere en un HMAC sobre unos
// cientos de bytes, sin consulta, sin conexión del pool y sin llamada externa.
// ---------------------------------------------------------------------------
export async function procesarNotificacion(
  notificacion: NotificacionDeGoogle,
  cliente?: ClienteInyectado,
): Promise<ResultadoDeNotificacion> {
  // 1. El token firmado. Lanza AppError(403) si no salió de acá.
  const firmado = await verificarWebhookToken(notificacion.token);

  // 2. EL TOKEN TIENE QUE HABLAR DEL MISMO CANAL QUE EL HEADER, y este chequeo
  //    no es redundante: sin él, un token válido del canal de la sucursal A
  //    podría reproducirse junto al X-Goog-Channel-ID de la sucursal B, y el
  //    procesamiento seguiría con la conexión de B autorizado por el token de A.
  //    Es la misma clase de agujero que el `state` de OAuth cierra al codificar
  //    la sucursal en vez de leerla de la query string.
  if (firmado.channelId !== notificacion.channelId) {
    throw new AppError("El token no corresponde al canal indicado", 403);
  }

  // 3. resourceState = "sync" es el mensaje de confirmación que Google manda al
  //    CREAR el canal. No trae ningún cambio y no hay nada que sincronizar:
  //    procesarlo dispararía una sincronización completa inútil por cada canal
  //    creado. Se responde 200 y listo.
  if (notificacion.resourceState === "sync") {
    return { accion: "sync-inicial", bookingsCancelados: 0, eventosMovidos: 0 };
  }

  const conexion = await findConnectionByChannelId(notificacion.channelId);

  if (!conexion) {
    // El canal ya no existe de nuestro lado: se reemplazó por uno nuevo, o la
    // sucursal se desconectó. NO es un error y no puede devolver un 5xx —
    // Google reintentaría con backoff una notificación que nunca vamos a poder
    // procesar. Se responde 200 y el canal muere solo al vencer.
    logger.warn(
      { channelId: notificacion.channelId },
      "Notificación de un canal que ya no está en la base: probablemente reemplazado o desconectado",
    );
    return { accion: "canal-desconocido", bookingsCancelados: 0, eventosMovidos: 0 };
  }

  // 4. La conexión encontrada por channelId tiene que ser la que el token dice.
  //    No debería poder fallar —channelId es único— y si fallara sería un bug
  //    que hay que ver, no un caso a tolerar en silencio.
  if (
    conexion.organizationId !== firmado.organizationId ||
    conexion.branchId !== firmado.branchId
  ) {
    logger.error(
      {
        channelId: notificacion.channelId,
        segunToken: { organizationId: firmado.organizationId, branchId: firmado.branchId },
        segunBase: { organizationId: conexion.organizationId, branchId: conexion.branchId },
      },
      "El canal está asociado a otra sucursal que la que dice su token: no se procesa",
    );
    throw new AppError("El token no corresponde al canal indicado", 403);
  }

  if (notificacion.resourceState === "not_exists") {
    // El recurso observado dejó de existir (el calendario se borró). No hay
    // cambios que listar; queda registrado para que alguien lo mire.
    logger.warn(
      { organizationId: conexion.organizationId, branchId: conexion.branchId },
      "Google avisa que el recurso observado ya no existe (not_exists)",
    );
    return { accion: "recurso-eliminado", bookingsCancelados: 0, eventosMovidos: 0 };
  }

  return sincronizar(conexion, cliente);
}

// ---------------------------------------------------------------------------
// La sincronización propiamente dicha.
// ---------------------------------------------------------------------------
interface ConexionConSecreto {
  organizationId: string;
  branchId: string;
  syncToken: string | null;
}

async function sincronizar(
  conexion: ConexionConSecreto,
  cliente?: ClienteInyectado,
): Promise<ResultadoDeNotificacion> {
  const { organizationId, branchId } = conexion;

  // M-3 de docs/auditoria-2026-08-29.md: una sincronización COMPLETA se acota
  // desde ahora. Las dos ramas que la hacen (primera sincronización, y 410)
  // descartan los eventos que trae —solo usan nextSyncToken—, así que listar
  // el calendario entero era paginar años de eventos para tirarlos; y en un
  // calendario grande el tope de 100 páginas cortaba antes de la última,
  // nextSyncToken quedaba undefined y la conexión no convergía nunca. Es la
  // consecuencia directa de "no reconciliar hacia atrás", no una decisión
  // nueva. Se calcula una vez para las dos llamadas de esta misma ejecución.
  const ahora = new Date().toISOString();

  // obtenerAccessToken descifra el refresh token, lo renueva contra Google y
  // —lo importante— traduce un grant muerto a status = ERROR. Reusarlo es lo
  // que hace que este camino no tenga su propia versión de ese manejo.
  const { accessToken, calendarId } = await obtenerAccessToken(organizationId, branchId, cliente);

  const clienteGoogle = cliente ?? getClienteGoogleCalendar();

  let cambios;

  try {
    cambios = await clienteGoogle.listarCambios({
      accessToken,
      calendarId,
      syncToken: conexion.syncToken ?? undefined,
      // Solo la primera sincronización (sin syncToken) es una lista completa;
      // timeMin la acota. Con syncToken tiene que ir undefined: Google no
      // admite los dos juntos.
      timeMin: conexion.syncToken ? undefined : ahora,
    });
  } catch (err) {
    if (!(err instanceof GoogleSyncTokenInvalidoError)) {
      throw err;
    }

    // 410 GONE: el token venció. Se resincroniza COMPLETO solo para obtener uno
    // nuevo.
    //
    // SIN RECONCILIAR RETROACTIVAMENTE cada evento de esa lista contra los
    // Bookings existentes, y es una decisión explícita de alcance: una
    // sincronización completa trae el calendario entero del negocio —años de
    // eventos, la mayoría ajenos al CRM— y compararlos todos es un problema
    // distinto y mucho más grande que "mantenerse al día". Alcanza con quedar
    // sincronizado HACIA ADELANTE.
    //
    // LO QUE SE PIERDE, anotado para que no sorprenda: los cambios ocurridos
    // entre que el token venció y esta resincronización no se aplican nunca.
    logger.warn(
      { organizationId, branchId },
      "El syncToken venció (410): se resincroniza completo sin reconciliar hacia atrás",
    );

    cambios = await clienteGoogle.listarCambios({ accessToken, calendarId, timeMin: ahora });

    if (cambios.nextSyncToken) {
      await setConnectionSyncToken(branchId, organizationId, cambios.nextSyncToken);
    }

    return { accion: "sync-inicial", bookingsCancelados: 0, eventosMovidos: 0 };
  }

  // Primera sincronización de esta conexión: no había token, así que lo que
  // volvió es el calendario completo. Mismo criterio que el 410 — se guarda el
  // token y no se reconcilia hacia atrás.
  const esPrimeraSincronizacion = !conexion.syncToken;

  let bookingsCancelados = 0;
  let eventosMovidos = 0;

  if (!esPrimeraSincronizacion) {
    for (const evento of cambios.eventos) {
      const resultado = await aplicarCambio(organizationId, evento);
      if (resultado === "cancelado") {
        bookingsCancelados++;
      } else if (resultado === "movido") {
        eventosMovidos++;
      }
    }
  }

  // EL TOKEN SE GUARDA AL FINAL, después de procesar todo. Si algo falla en el
  // medio, el token viejo sigue en la fila y la próxima notificación reprocesa
  // los mismos cambios — reprocesar es inofensivo (cancelar un Booking ya
  // cancelado no hace nada) y perder cambios no lo es.
  //
  // Si Google no devolvió nextSyncToken, NO se guarda nada: es preferible
  // reprocesar en la próxima notificación a guardar un token que no existe.
  if (cambios.nextSyncToken) {
    await setConnectionSyncToken(branchId, organizationId, cambios.nextSyncToken);
  }

  return {
    accion: esPrimeraSincronizacion
      ? "sync-inicial"
      : bookingsCancelados + eventosMovidos > 0
        ? "procesada"
        : "sin-cambios",
    bookingsCancelados,
    eventosMovidos,
  };
}

// ---------------------------------------------------------------------------
// ¿Google y el CRM dicen horarios distintos? — B-5 de docs/auditoria-2026-08-29.md
//
// Google devuelve `dateTime` con precisión de SEGUNDOS (RFC3339 sin fracción),
// y Booking.startsAt/endsAt pueden traer milisegundos: createBooking guarda
// input.startsAt tal cual llega, y Date.toISOString() —lo que manda cualquier
// cliente JS— siempre los incluye. Comparar los getTime() exactos hacía que ESE
// booking se logueara como "movido" en cada notificación sobre su evento,
// incluida una que solo editó la descripción, para siempre.
//
// TOLERANCIA POR DIFERENCIA ABSOLUTA, y no truncar los dos lados a segundo: no
// está verificado contra Google si al guardar TRUNCA o REDONDEA los
// milisegundos, y con truncado un 12:00:00.600 que Google redondeara a 12:00:01
// seguiría siendo un falso positivo; con la tolerancia da lo mismo qué haga.
// Un movimiento real en Google es de minutos, nunca de menos de un segundo, así
// que la tolerancia no puede tapar uno.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Un evento cambiado, contra el Booking que lo refleje (si hay alguno).
// ---------------------------------------------------------------------------
async function aplicarCambio(
  organizationId: string,
  evento: EventoCambiado,
): Promise<"cancelado" | "movido" | "ignorado"> {
  const booking = await findBookingByGoogleEventId(evento.id, organizationId);

  if (!booking) {
    // El evento no salió de una reserva nuestra: es del calendario propio del
    // negocio. La inmensa mayoría de los cambios caen acá.
    return "ignorado";
  }

  // -------------------------------------------------------------------------
  // CANCELADO EN GOOGLE -> se cancela acá.
  //
  // Un evento borrado llega con status "cancelled" — verificado contra la
  // referencia del recurso Events. En sincronización incremental vienen solos,
  // sin necesidad de showDeleted.
  // -------------------------------------------------------------------------
  if (evento.status === "cancelled") {
    if (booking.status !== "CONFIRMED") {
      // Ya estaba cancelada (o es historia). Reprocesar una notificación no
      // puede tener efecto, que es lo que hace seguro guardar el syncToken al
      // final.
      return "ignorado";
    }

    // SE USA EL REPOSITORIO Y NO cancelBooking() DEL SERVICE, a propósito:
    // aquel intenta borrar el evento en Google, y acá el evento YA ESTÁ BORRADO
    // —es la causa de esta notificación—. Llamarlo produciría una llamada
    // garantizadamente inútil a Google por cada cancelación externa.
    const resultado = await markBookingCancelled(booking.id, organizationId);

    if (resultado.count === 0) {
      // Otra cosa la canceló entre la lectura y la escritura. No es un error.
      return "ignorado";
    }

    logger.info(
      { bookingId: booking.id, organizationId, googleEventId: evento.id },
      "Reserva cancelada desde Google Calendar: se canceló también en el CRM y se liberó el cupo",
    );

    return "cancelado";
  }

  // -------------------------------------------------------------------------
  // MOVIDO EN GOOGLE -> solo se registra. Ver el encabezado del archivo.
  // -------------------------------------------------------------------------
  const cambioDeHorario =
    (evento.inicio && evento.inicio.getTime() !== booking.startsAt.getTime()) ||
    (evento.fin && evento.fin.getTime() !== booking.endsAt.getTime());

  if (cambioDeHorario) {
    logger.warn(
      {
        bookingId: booking.id,
        organizationId,
        googleEventId: evento.id,
        horarioEnElCrm: { startsAt: booking.startsAt, endsAt: booking.endsAt },
        horarioEnGoogle: { startsAt: evento.inicio, endsAt: evento.fin },
      },
      "Un evento se movió en Google Calendar: la reserva NO se reprogramó automáticamente y queda desactualizada hasta que alguien la resuelva a mano",
    );

    return "movido";
  }

  return "ignorado";
}
